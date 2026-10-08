import { create } from 'zustand';
import * as Contacts from 'expo-contacts/legacy';
import { Share, Linking } from 'react-native';
import { AppStorage } from '../../lib/storage';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { Trip, TripBalanceRow, TripMember } from '../../types/database';

export interface FriendContact {
  id: string;
  name: string;
  phoneNumber?: string;
  cleanPhone?: string;
  isRegistered: boolean;
  isGuest?: boolean;
  profileId?: string;
  avatarUrl?: string;
  netBalancePaise?: number; // positive = owes you, negative = you owe
  owedToYouPaise?: number; // amount you will get from this friend
  youOwePaise?: number; // amount you need to give to this friend
  sharedTripsCount?: number;
  defaultTripId?: string;
  unseenMessagesCount?: number;
  lastMessageAt?: string;
}

export interface FriendsSummaryTotals {
  totalOwedToYouPaise: number;
  totalYouOwePaise: number;
  netOverallPaise: number;
}

interface ContactsState {
  contacts: FriendContact[];
  deviceContacts: FriendContact[];
  friendsSummary: FriendsSummaryTotals;
  hasPermission: boolean;
  isLoading: boolean;
  lastSyncedAt: string | null;

  // Actions
  clearContacts: () => void;
  initContacts: (force?: boolean) => Promise<void>;
  fetchFriendsSummary: (userId?: string) => Promise<FriendsSummaryTotals>;
  computeFriendBalances: (trips: Trip[], currentUserId?: string) => Promise<void>;
  inviteFriend: (name: string, phoneNumber?: string) => Promise<void>;
  addManualFriend: (
    name: string,
    phoneNumber?: string,
    profileId?: string,
    isRegistered?: boolean
  ) => Promise<FriendContact>;
  handleIncomingMessage: (msg: any, currentUserId?: string) => void;
  subscribeFriendsRealtime: (userId?: string) => () => void;
}

function withTimeout<T>(promise: PromiseLike<T>, ms = 5000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    Promise.resolve(promise)
      .then(v => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch(e => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

// Clean phone number to compare reliably (e.g. extracts last 10 digits)
export function normalizePhone(rawPhone?: string | null): string {
  if (!rawPhone) return '';
  const digits = rawPhone.replace(/[^0-9]/g, '');
  if (digits.length > 10) {
    return digits.slice(-10);
  }
  return digits;
}

// Normalize names removing variation selectors, zero-width characters, and excess whitespace
export function normalizeNameForMatch(name?: string | null): string {
  if (!name) return '';
  return name
    .replace(/[\uFE00-\uFE0F\u200D\u200B\u200C]/g, '')
    .trim()
    .toLowerCase();
}

// Strip emojis and non-alphanumeric characters for fuzzy root name matching
export function stripEmojisAndSpecial(name?: string | null): string {
  if (!name) return '';
  return name
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase();
}

// User-partitioned storage key for contacts cache
export function getUserContactsStorageKey(userId?: string | null): string {
  try {
    const { useAuthStore } = require('../auth/useAuthStore');
    const authUser = useAuthStore.getState().user;
    const id = userId || authUser?.id;
    if (id && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      return `@splityourtrip_cached_contacts_${id}`;
    }
  } catch {}
  return '@splityourtrip_cached_contacts_guest';
}

// In-memory mapping of device phonebook contacts (10-digit phone -> Saved Contact Name)
export const deviceContactNamesByPhone = new Map<string, string>();

// Initialize from storage for instant sync
AppStorage.getItem('@splityourtrip_device_contacts_name_map')
  .then(raw => {
    if (raw) {
      const parsed = JSON.parse(raw);
      Object.entries(parsed).forEach(([k, v]) => {
        if (k && v) deviceContactNamesByPhone.set(k, v as string);
      });
    }
  })
  .catch(() => {});

export function isPhoneNumberLike(str?: string | null): boolean {
  if (!str) return false;
  const trimmed = str.trim();
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (digits.length < 5) return false;
  const nonPhoneChars = trimmed.replace(/[0-9+\-()\s]/g, '');
  return nonPhoneChars.length === 0;
}

export function isGenericPlaceholder(name?: string | null): boolean {
  if (!name) return true;
  const lower = name.trim().toLowerCase();
  return (
    lower === 'member' ||
    lower === 'traveler' ||
    lower === 'split your trip user' ||
    lower === 'user' ||
    lower === 'friend' ||
    lower === 'friend chat' ||
    lower === 'guest' ||
    lower === 'unknown' ||
    isPhoneNumberLike(name)
  );
}

export function getContactNameByPhone(rawPhone?: string | null): string | null {
  if (!rawPhone) return null;
  const norm = normalizePhone(rawPhone);
  if (!norm) return null;
  const found = deviceContactNamesByPhone.get(norm);
  if (found && !isGenericPlaceholder(found)) {
    return found.trim();
  }
  return null;
}

export function getEffectiveContactName(options: {
  phoneNumber?: string | null;
  contactName?: string | null;
  displayName?: string | null;
  profileName?: string | null;
  fallback?: string;
}): string {
  const { phoneNumber, contactName, displayName, profileName, fallback = 'Friend' } = options;

  // 1. Device Phonebook contact name (Saved by the user in device contacts)
  if (phoneNumber) {
    const savedPhoneName = getContactNameByPhone(phoneNumber);
    if (savedPhoneName && savedPhoneName.trim() && !isGenericPlaceholder(savedPhoneName)) {
      return savedPhoneName.trim();
    }
  }

  // 2. Explicit contact name from local contacts list (if it's a real name)
  if (contactName && contactName.trim() && !isGenericPlaceholder(contactName)) {
    return contactName.trim();
  }

  // 3. Trip member display name (if user explicitly assigned a real nickname/name)
  if (displayName && displayName.trim() && !isGenericPlaceholder(displayName)) {
    return displayName.trim();
  }

  // 4. USE PROFILE NAME WHEN NO NAME IS THERE!
  // If the user has not saved this person in contacts, display their remote profile name!
  if (profileName && profileName.trim() && !isGenericPlaceholder(profileName)) {
    return profileName.trim();
  }

  // 5. If no real name is available anywhere, use phone number if present
  if (displayName && displayName.trim() && isPhoneNumberLike(displayName)) {
    return displayName.trim();
  }
  if (phoneNumber && phoneNumber.trim()) {
    return phoneNumber.trim();
  }

  return fallback;
}

export const useContactsStore = create<ContactsState>((set, get) => ({
  contacts: [],
  deviceContacts: [],
  friendsSummary: {
    totalOwedToYouPaise: 0,
    totalYouOwePaise: 0,
    netOverallPaise: 0,
  },
  hasPermission: false,
  isLoading: false,
  lastSyncedAt: null,

  clearContacts: () => {
    set({
      contacts: [],
      deviceContacts: [],
      friendsSummary: {
        totalOwedToYouPaise: 0,
        totalYouOwePaise: 0,
        netOverallPaise: 0,
      },
      isLoading: false,
      lastSyncedAt: null,
    });
  },

  fetchFriendsSummary: async (userId?: string) => {
    try {
      const { useAuthStore } = require('../auth/useAuthStore');
      const authState = useAuthStore.getState();
      const targetId = userId || authState.user?.id || authState.profile?.id;
      if (!targetId) return get().friendsSummary;

      // 0. If current contacts is empty, load instantly from storage cache to avoid blank flash
      if (get().contacts.length === 0) {
        try {
          const cacheKey = `@splityourtrip_friends_summary_${targetId}`;
          const rawCache = await AppStorage.getItem(cacheKey);
          if (rawCache) {
            const parsed = JSON.parse(rawCache);
            if (parsed && Array.isArray(parsed.friends) && parsed.friends.length > 0) {
              set({
                contacts: parsed.friends,
                friendsSummary: {
                  totalOwedToYouPaise: parsed.totalOwedToYouPaise || 0,
                  totalYouOwePaise: parsed.totalYouOwePaise || 0,
                  netOverallPaise: parsed.netOverallPaise || 0,
                },
                isLoading: false,
              });
            }
          }
        } catch {}
      }

      const { fetchFriendsSummaryApi } = require('../../services/friendsApi');
      const summaryRes = await fetchFriendsSummaryApi(targetId);

      const existing = get().contacts;
      const apiFriends = summaryRes.friends || [];
      const seenIds = new Set<string>();
      const seenPhones = new Set<string>();
      const seenNames = new Set<string>();
      const merged: FriendContact[] = [];

      // 1. Add API friends (which only contains people with shared trips/splits/messages)
      for (const f of apiFriends) {
        if (f.profileId && f.profileId === targetId) continue;
        const cleanName = f.name.trim().toLowerCase();
        const normPhone = f.cleanPhone || normalizePhone(f.phoneNumber);

        // Find existing matching contact to preserve details like avatar or phone
        const existingMatch = existing.find(e =>
          (f.id && e.id === f.id) ||
          (f.profileId && e.profileId === f.profileId) ||
          (normPhone && (e.cleanPhone === normPhone || normalizePhone(e.phoneNumber) === normPhone)) ||
          normalizeNameForMatch(e.name) === normalizeNameForMatch(f.name)
        );

        // Resolve Contact Name: device contact name > existing contact name > f.name (never profile name)
        const savedContactName = normPhone ? deviceContactNamesByPhone.get(normPhone) : null;
        const resolvedName = savedContactName || (existingMatch?.name && !isGenericPlaceholder(existingMatch.name) ? existingMatch.name : null) || f.name;

        const canonicalId = f.profileId || f.id || existingMatch?.id || `friend_${cleanName}`;
        if (!seenIds.has(canonicalId) && !seenNames.has(cleanName)) {
          seenIds.add(canonicalId);
          seenNames.add(cleanName);
          if (normPhone) seenPhones.add(normPhone);

          merged.push({
            ...existingMatch,
            ...f,
            id: canonicalId,
            name: resolvedName,
            phoneNumber: f.phoneNumber || existingMatch?.phoneNumber,
            cleanPhone: normPhone || existingMatch?.cleanPhone,
            avatarUrl: f.avatarUrl || existingMatch?.avatarUrl,
            isRegistered: f.isRegistered || Boolean(existingMatch?.isRegistered),
            defaultTripId: f.defaultTripId || existingMatch?.defaultTripId,
            unseenMessagesCount: f.unseenMessagesCount || 0,
            lastMessageAt: f.lastMessageAt,
          });
        }
      }

      // 2. Preserve manually added friends that haven't synced to backend yet
      for (const c of existing) {
        if (!c.id?.startsWith('manual_')) continue;
        const cleanName = c.name.trim().toLowerCase();
        const normPhone = c.cleanPhone || normalizePhone(c.phoneNumber);
        const canonicalId = c.id;

        const isAlreadyAdded =
          seenIds.has(canonicalId) ||
          seenNames.has(cleanName) ||
          (normPhone && seenPhones.has(normPhone));

        if (!isAlreadyAdded) {
          seenIds.add(canonicalId);
          seenNames.add(cleanName);
          if (normPhone) seenPhones.add(normPhone);
          merged.push(c);
        }
      }

      // Re-sort: Unseen messages on top, then highest pending settlements!
      merged.sort((a, b) => {
        const aUnseen = (a.unseenMessagesCount || 0) > 0;
        const bUnseen = (b.unseenMessagesCount || 0) > 0;
        if (aUnseen && !bUnseen) return -1;
        if (!aUnseen && bUnseen) return 1;
        if (aUnseen && bUnseen) {
          return new Date(b.lastMessageAt || 0).getTime() - new Date(a.lastMessageAt || 0).getTime();
        }

        const aPending = (a.netBalancePaise || 0) !== 0 || (a.owedToYouPaise || 0) > 0 || (a.youOwePaise || 0) > 0;
        const bPending = (b.netBalancePaise || 0) !== 0 || (b.owedToYouPaise || 0) > 0 || (b.youOwePaise || 0) > 0;
        if (aPending && !bPending) return -1;
        if (!aPending && bPending) return 1;
        if (aPending && bPending) {
          return Math.abs(b.netBalancePaise || 0) - Math.abs(a.netBalancePaise || 0);
        }
        const tripDiff = (b.sharedTripsCount || 0) - (a.sharedTripsCount || 0);
        if (tripDiff !== 0) return tripDiff;
        return (a.name || '').localeCompare(b.name || '');
      });

      const newTotals = {
        totalOwedToYouPaise: summaryRes.totalOwedToYouPaise,
        totalYouOwePaise: summaryRes.totalYouOwePaise,
        netOverallPaise: summaryRes.netOverallPaise,
      };

      // Check if anything actually changed before triggering a store update to eliminate re-render flicker
      const currentTotals = get().friendsSummary;
      const totalsChanged =
        currentTotals.totalOwedToYouPaise !== newTotals.totalOwedToYouPaise ||
        currentTotals.totalYouOwePaise !== newTotals.totalYouOwePaise ||
        currentTotals.netOverallPaise !== newTotals.netOverallPaise;

      const currentContacts = get().contacts;
      let contactsChanged = currentContacts.length !== merged.length;
      if (!contactsChanged) {
        for (let i = 0; i < merged.length; i++) {
          const a = currentContacts[i];
          const b = merged[i];
          if (
            a.id !== b.id ||
            a.owedToYouPaise !== b.owedToYouPaise ||
            a.youOwePaise !== b.youOwePaise ||
            a.netBalancePaise !== b.netBalancePaise ||
            a.name !== b.name ||
            a.defaultTripId !== b.defaultTripId ||
            (a.unseenMessagesCount || 0) !== (b.unseenMessagesCount || 0)
          ) {
            contactsChanged = true;
            break;
          }
        }
      }

      if (totalsChanged || contactsChanged || get().isLoading) {
        set({
          friendsSummary: newTotals,
          contacts: merged,
          isLoading: false,
        });
      }

      return newTotals;
    } catch (err: any) {
      console.log('fetchFriendsSummary notice:', err?.message);
      set({ isLoading: false });
      return get().friendsSummary;
    }
  },

  initContacts: async (force = false) => {
    // Avoid redundant expensive contact scanning if already synced in the last 2 minutes
    const lastSync = get().lastSyncedAt;
    const isRecent = lastSync && Date.now() - new Date(lastSync).getTime() < 120000;
    if (!force && get().deviceContacts.length > 0 && isRecent) {
      return;
    }

    try {
      // 1. Request permission (with timeout guard)
      let granted = false;
      try {
        const { status } = await withTimeout(Contacts.requestPermissionsAsync(), 5000);
        granted = status === 'granted';
      } catch {}
      set({ hasPermission: granted });

      let rawDeviceContacts: any[] = [];
      if (granted) {
        try {
          const { data } = await withTimeout(
            Contacts.getContactsAsync({
              fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
            }),
            6000
          );
          rawDeviceContacts = data || [];
        } catch {}
      }

      // Map device contacts strictly into deviceContacts (for contact picker / modals)
      const mappedContacts: FriendContact[] = [];
      const seenPhones = new Set<string>();
      const seenNames = new Set<string>();
      const nameMap: Record<string, string> = {};

      for (const dc of rawDeviceContacts) {
        const name = dc.name?.trim();
        if (!name) continue;

        const phone = dc.phoneNumbers?.[0]?.number;
        const norm = normalizePhone(phone);

        if (norm) {
          deviceContactNamesByPhone.set(norm, name);
          nameMap[norm] = name;
        }

        if (norm && seenPhones.has(norm)) continue;
        if (!norm && seenNames.has(name.toLowerCase())) continue;

        if (norm) seenPhones.add(norm);
        seenNames.add(name.toLowerCase());

        mappedContacts.push({
          id: dc.id || `contact_${name}_${norm}`,
          name,
          phoneNumber: phone,
          cleanPhone: norm,
          isRegistered: false,
        });
      }

      try {
        await AppStorage.setItem('@splityourtrip_device_contacts_name_map', JSON.stringify(nameMap));
      } catch {}

      mappedContacts.sort((a, b) => a.name.localeCompare(b.name));

      // Also ensure active contacts reflect the user's saved phone contact names immediately
      const currentContacts = get().contacts;
      const updatedContacts = currentContacts.map(c => {
        const phone = c.cleanPhone || normalizePhone(c.phoneNumber);
        const savedContactName = phone ? deviceContactNamesByPhone.get(phone) : null;
        if (savedContactName && savedContactName !== c.name) {
          return { ...c, name: savedContactName };
        }
        return c;
      });

      set({
        contacts: updatedContacts,
        deviceContacts: mappedContacts,
        lastSyncedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.log('Error initializing device contacts:', err?.message);
    }
  },

  computeFriendBalances: async (trips: Trip[], currentUserId?: string) => {
    try {
      const { useAuthStore } = require('../auth/useAuthStore');
      const authState = useAuthStore.getState();
      const targetUserId = currentUserId || authState.user?.id || authState.profile?.id;
      if (targetUserId) {
        await get().fetchFriendsSummary(targetUserId);
      }
    } catch (e: any) {
      console.log('computeFriendBalances notice:', e?.message);
    }
  },

  inviteFriend: async (name: string, phoneNumber?: string) => {
    const text = `Hey ${name}! I'm using Split Your Trip to manage shared trip expenses and settle up effortlessly. Download the app or join here: https://splityourtrip.app/download`;

    if (phoneNumber) {
      const clean = phoneNumber.replace(/[^0-9+]/g, '');
      const url = `whatsapp://send?phone=${clean}&text=${encodeURIComponent(text)}`;
      try {
        const canOpen = await Linking.canOpenURL(url);
        if (canOpen) {
          await Linking.openURL(url);
          return;
        }
      } catch {}
    }

    try {
      await Share.share({ message: text });
    } catch {}
  },

  addManualFriend: async (
    name: string,
    phoneNumber?: string,
    profileId?: string,
    isRegistered?: boolean
  ) => {
    const cleanPhone = normalizePhone(phoneNumber);
    const existingIndex = get().contacts.findIndex(
      c => (cleanPhone && c.cleanPhone === cleanPhone) || (profileId && c.profileId === profileId)
    );

    let updated: FriendContact[];
    let targetContact: FriendContact;

    if (existingIndex >= 0) {
      const existing = get().contacts[existingIndex];
      targetContact = {
        ...existing,
        name: name.trim() || existing.name,
        phoneNumber: phoneNumber?.trim() || existing.phoneNumber,
        cleanPhone: cleanPhone || existing.cleanPhone,
        profileId: profileId || existing.profileId,
        isRegistered: isRegistered !== undefined ? isRegistered : (Boolean(profileId) || existing.isRegistered),
        isGuest: false,
      };
      updated = [...get().contacts];
      updated[existingIndex] = targetContact;
    } else {
      targetContact = {
        id: `manual_${Date.now()}`,
        name: name.trim(),
        phoneNumber: phoneNumber?.trim(),
        cleanPhone,
        isRegistered: isRegistered !== undefined ? isRegistered : Boolean(profileId),
        profileId,
        isGuest: false,
        netBalancePaise: 0,
        owedToYouPaise: 0,
        youOwePaise: 0,
        sharedTripsCount: 0,
      };
      updated = [targetContact, ...get().contacts];
    }

    set({ contacts: updated });

    try {
      const storageKey = getUserContactsStorageKey();
      await AppStorage.setItem(storageKey, JSON.stringify(updated));
    } catch {}

    return targetContact;
  },

  handleIncomingMessage: (msg: any, currentUserId?: string) => {
    if (!msg || !msg.trip_id) return;
    const isMe = Boolean(currentUserId && msg.sender_id === currentUserId);

    let parsed: any = { msgType: 'text', displayText: msg.message || '' };
    try {
      const { parseMessagePayload } = require('../trips/useTripStore');
      parsed = parseMessagePayload(msg.message || '');
    } catch {}

    const msgText = parsed.displayText || 'New message';

    set((state) => {
      const contacts = [...state.contacts];
      const idx = contacts.findIndex(
        (c) =>
          (c.defaultTripId && c.defaultTripId === msg.trip_id) ||
          (c.profileId && c.profileId === msg.sender_id) ||
          (c.id && c.id === msg.sender_id)
      );

      if (idx !== -1) {
        const target = { ...contacts[idx] };
        target.lastMessageAt = msg.created_at || new Date().toISOString();
        if (!isMe) {
          target.unseenMessagesCount = (target.unseenMessagesCount || 0) + 1;
        }

        // Move to the very top of the list dynamically!
        contacts.splice(idx, 1);
        contacts.unshift(target);

        // Dispatch in-app notification if message is from someone else
        if (!isMe) {
          try {
            const { useNotificationStore } = require('../notifications/useNotificationStore');
            const notifStore = useNotificationStore.getState();

            if (parsed.msgType === 'payment_claim' || parsed.msgType === 'payment_settlement') {
              const amt = parsed.amountPaise ? (parsed.amountPaise / 100).toFixed(0) : 'amount';
              notifStore.addNotification({
                type: 'payment_claim',
                title: `💰 Payment Claim: ₹${amt}`,
                message: `${target.name} sent payment proof for your confirmation. Tap to accept or reject.`,
                tripId: msg.trip_id,
                friendId: target.id,
                amountPaise: parsed.amountPaise,
                senderId: msg.sender_id,
                senderName: target.name,
                screenshotUrl: parsed.mediaUrl,
              });
            } else if (parsed.msgType === 'payment_request') {
              const amt = parsed.amountPaise ? (parsed.amountPaise / 100).toFixed(0) : 'amount';
              notifStore.addNotification({
                type: 'payment_request',
                title: `💸 Payment Requested: ₹${amt}`,
                message: `${target.name} requested money from you. Tap to pay with screenshot.`,
                tripId: msg.trip_id,
                friendId: target.id,
                amountPaise: parsed.amountPaise,
                senderId: msg.sender_id,
                senderName: target.name,
              });
            } else if (parsed.msgType === 'payment_accepted') {
              const amt = parsed.amountPaise ? (parsed.amountPaise / 100).toFixed(0) : '';
              notifStore.addNotification({
                type: 'payment_accepted',
                title: `✅ Payment Accepted`,
                message: `${target.name} accepted your payment${amt ? ` of ₹${amt}` : ''}. Balance updated!`,
                tripId: msg.trip_id,
                friendId: target.id,
                amountPaise: parsed.amountPaise,
                senderId: msg.sender_id,
                senderName: target.name,
              });
            } else if (parsed.msgType === 'payment_rejected') {
              const amt = parsed.amountPaise ? (parsed.amountPaise / 100).toFixed(0) : '';
              notifStore.addNotification({
                type: 'payment_rejected',
                title: `❌ Payment Rejected`,
                message: `${target.name} rejected the payment claim${amt ? ` of ₹${amt}` : ''}.`,
                tripId: msg.trip_id,
                friendId: target.id,
                amountPaise: parsed.amountPaise,
                senderId: msg.sender_id,
                senderName: target.name,
              });
            } else {
              notifStore.addNotification({
                type: 'message',
                title: target.name,
                message: msgText,
                tripId: msg.trip_id,
                friendId: target.id,
                senderId: msg.sender_id,
                senderName: target.name,
              });
            }
          } catch {}
        }

        return { contacts };
      } else {
        // Contact not in local list yet, fetch summary in background
        get().fetchFriendsSummary(currentUserId);
        return state;
      }
    });
  },

  subscribeFriendsRealtime: (userId?: string) => {
    if (!isSupabaseConfigured || !userId) return () => {};

    const channel = supabase
      .channel(`realtime:friends_dynamic:${userId}_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trip_messages' },
        (payload) => {
          get().handleIncomingMessage(payload.new, userId);
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'trip_messages' },
        () => {
          // Trigger dynamic summary update to recalculate amounts
          get().fetchFriendsSummary(userId);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'expenses' },
        () => {
          get().fetchFriendsSummary(userId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },
}));
