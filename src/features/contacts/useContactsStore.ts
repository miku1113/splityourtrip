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

      // Re-sort: Pending settlements on top!
      merged.sort((a, b) => {
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
            a.name !== b.name
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
    if (!trips || trips.length === 0) {
      set(state => ({
        contacts: state.contacts
          .filter(c => !c.isGuest)
          .map(c => ({
            ...c,
            netBalancePaise: 0,
            owedToYouPaise: 0,
            youOwePaise: 0,
            sharedTripsCount: 0,
          })),
      }));
      return;
    }

    try {
      const { computeBalances, normalizeExpensesForTrip, findMyMember, useTripStore } = require('../trips/useTripStore');
      const { calculateSettlement } = require('../../services/settle');
      const { useAuthStore } = require('../auth/useAuthStore');

      const authState = useAuthStore.getState();
      const resolvedUserId = currentUserId || authState.user?.id;
      const resolvedUserPhone = normalizePhone(authState.profile?.phone_number || (authState.user as any)?.phone);

      // Load all cached trip details to calculate individual balances across both Group Trips and Friend Splits
      const friendBalanceMap = new Map<
        string,
        { owedToYouPaise: number; youOwePaise: number; netPaise: number; tripCount: number }
      >();
      const synthesizedFriends: FriendContact[] = [];

      const currentContactsList = get().contacts;

      for (const t of trips) {
        let details: { members?: TripMember[]; expenses?: any[]; messages?: any[] } | null = null;
        try {
          const raw = await AppStorage.getItem(`@splityourtrip_local_details_${t.id}`);
          if (raw) details = JSON.parse(raw);
        } catch {}

        let members: TripMember[] = details?.members || [];
        let rawExpenses: any[] = details?.expenses || [];

        // Fallback to active trip store if local details cache is not yet populated
        if (members.length === 0) {
          const tripStoreState = useTripStore.getState();
          members = tripStoreState.members.filter((m: TripMember) => m.trip_id === t.id);
        }
        if (rawExpenses.length === 0) {
          const tripStoreState = useTripStore.getState();
          rawExpenses = tripStoreState.expenses.filter((e: any) => e.trip_id === t.id);
        }

        // Fallback to Supabase if neither cache nor store has the data yet
        if ((members.length === 0 || rawExpenses.length === 0) && isSupabaseConfigured && t.id && t.id.includes('-')) {
          try {
            const { supabaseAdmin } = require('../../lib/supabase');
            const [mRes, eRes]: [any, any] = await Promise.all([
              members.length === 0
                ? withTimeout<any>(supabaseAdmin.from('trip_members').select('*').eq('trip_id', t.id), 2500).catch(() => ({ data: [] }))
                : Promise.resolve({ data: members }),
              rawExpenses.length === 0
                ? withTimeout<any>(supabaseAdmin.from('expenses').select('*').eq('trip_id', t.id).order('created_at', { ascending: false }), 2500).catch(() => ({ data: [] }))
                : Promise.resolve({ data: rawExpenses }),
            ]);

            if (mRes?.data && mRes.data.length > 0) members = mRes.data;
            if (eRes?.data && eRes.data.length > 0) {
              const expIds = eRes.data.map((e: any) => e.id);
              let splits: any[] = [];
              if (expIds.length > 0) {
                const sRes: any = await withTimeout<any>(
                  supabaseAdmin.from('expense_splits').select('*').in('expense_id', expIds),
                  2500
                ).catch(() => ({ data: [] }));
                splits = sRes?.data || [];
              }
              rawExpenses = eRes.data.map((e: any) => ({
                ...e,
                splits: splits.filter((s: any) => s.expense_id === e.id),
                payerName:
                  e.merchant_name ||
                  members.find((m: any) => m.id === e.paid_by || m.profile_id === e.paid_by)?.display_name ||
                  'Member',
              }));
              // Cache it locally so subsequent renders are instant!
              try {
                await AppStorage.setItem(
                  `@splityourtrip_local_details_${t.id}`,
                  JSON.stringify({
                    members,
                    expenses: rawExpenses,
                    messages: details?.messages || [],
                  })
                );
              } catch {}
            }
          } catch {}
        }

        const expenses = normalizeExpensesForTrip(rawExpenses, members);

        const isFriendSplit =
          t.trip_type === 'friend_split' ||
          (t as any).is_friend_split ||
          t.name.toLowerCase().startsWith('split with ');

        // Current user's member in this trip
        const myMember = findMyMember(members, resolvedUserId, resolvedUserPhone);

        if (isFriendSplit) {
          const otherFromMembers = members.find(m => !myMember || m.id !== myMember.id);
          const isOtherMe =
            otherFromMembers &&
            ((resolvedUserId && (otherFromMembers.profile_id === resolvedUserId || otherFromMembers.user_id === resolvedUserId)) ||
              (resolvedUserPhone && otherFromMembers.phone_number && normalizePhone(otherFromMembers.phone_number) === resolvedUserPhone));

          if (otherFromMembers && !isOtherMe) {
            const rawPhone = otherFromMembers.phone_number;
            const fallbackName = getEffectiveContactName({
              phoneNumber: rawPhone,
              contactName: otherFromMembers.display_name,
              displayName: otherFromMembers.display_name,
              fallback: otherFromMembers.display_name || (t.created_by === resolvedUserId ? t.name.replace(/^split with\s+/i, '').trim() : 'Friend'),
            });

            if (fallbackName && fallbackName !== 'You') {
              synthesizedFriends.push({
                id: t.friend_id || otherFromMembers.id || `friend_${t.id}`,
                name: fallbackName,
                phoneNumber: rawPhone || undefined,
                cleanPhone: normalizePhone(rawPhone) || undefined,
                isRegistered: Boolean(otherFromMembers.profile_id),
                isGuest:
                  otherFromMembers.is_guest === false
                    ? false
                    : Boolean(!otherFromMembers.profile_id && !otherFromMembers.phone_number),
                profileId: otherFromMembers.profile_id || undefined,
              });
            }
          }
        }

        if (members.length === 0 || !myMember) continue;

        // Compute trip balances and exact debt-simplified settlements for this trip
        const tripBalances: TripBalanceRow[] = computeBalances(t.id, members, expenses);
        const netBalancesRecord: Record<string, number> = {};
        tripBalances.forEach(b => {
          netBalancesRecord[b.member_id] = b.net_balance;
        });
        const settlements = calculateSettlement(netBalancesRecord);

        for (const otherMember of members) {
          if (otherMember.id === myMember.id) continue;
          if (resolvedUserId && (otherMember.profile_id === resolvedUserId || otherMember.user_id === resolvedUserId)) continue;
          if (resolvedUserPhone && otherMember.phone_number && normalizePhone(otherMember.phone_number) === resolvedUserPhone) continue;

          // Ensure every member from every Group Trip also exists in contacts list
          if (otherMember.display_name && otherMember.display_name.trim()) {
            const rawPhone = otherMember.phone_number;
            const resolvedName = getEffectiveContactName({
              phoneNumber: rawPhone,
              contactName: otherMember.display_name,
              displayName: otherMember.display_name,
              fallback: otherMember.display_name.trim(),
            });
            if (resolvedName && resolvedName !== 'You') {
              synthesizedFriends.push({
                id: (isFriendSplit && t.friend_id) ? t.friend_id : otherMember.id,
                name: resolvedName,
                phoneNumber: rawPhone || undefined,
                cleanPhone: normalizePhone(rawPhone) || undefined,
                isRegistered: Boolean(otherMember.profile_id && !otherMember.is_guest),
                isGuest: Boolean(otherMember.is_guest && !otherMember.phone_number),
                profileId: otherMember.profile_id || undefined,
              });
            }
          }

          let toGetWithOther = 0;
          let toGiveWithOther = 0;

          // 1. Debt simplification settlements: In all trips, debt-simplified settlements are the strict source of truth
          for (const s of settlements) {
            if (s.from === otherMember.id && s.to === myMember.id) {
              toGetWithOther += Number(s.amount) || 0;
            } else if (s.from === myMember.id && s.to === otherMember.id) {
              toGiveWithOther += Number(s.amount) || 0;
            }
          }

          const netWithOther = toGetWithOther - toGiveWithOther;

          // Store under all matching keys (phone, lowercase name, normalized name, stripped name, profile_id, member.id)
          const keysToUpdate = new Set<string>();
          const otherNormPhone = normalizePhone(otherMember.phone_number);
          if (otherNormPhone) {
            keysToUpdate.add(`phone:${otherNormPhone}`);
          }
          if (otherMember.display_name) {
            keysToUpdate.add(`name:${otherMember.display_name.trim().toLowerCase()}`);
            const normName = normalizeNameForMatch(otherMember.display_name);
            if (normName) keysToUpdate.add(`normname:${normName}`);
            const stripName = stripEmojisAndSpecial(otherMember.display_name);
            if (stripName) keysToUpdate.add(`stripname:${stripName}`);
          }
          if (otherMember.profile_id) {
            keysToUpdate.add(`profile:${otherMember.profile_id}`);
          }
          keysToUpdate.add(`id:${otherMember.id}`);
          if (isFriendSplit && t.friend_id) {
            keysToUpdate.add(`id:${t.friend_id}`);
          }

          // Cross-reference with existing contacts so any alias or contact entry inherits this balance
          currentContactsList.forEach(c => {
            const cPhone = c.cleanPhone || normalizePhone(c.phoneNumber);
            const cNorm = normalizeNameForMatch(c.name);
            const cStrip = stripEmojisAndSpecial(c.name);
            const mNorm = normalizeNameForMatch(otherMember.display_name);
            const mStrip = stripEmojisAndSpecial(otherMember.display_name);

            const isMatch =
              (otherNormPhone && cPhone && otherNormPhone === cPhone) ||
              (otherMember.profile_id && c.profileId && otherMember.profile_id === c.profileId) ||
              (mNorm && cNorm && mNorm === cNorm) ||
              (mStrip && cStrip && mStrip === cStrip && mStrip.length >= 3);

            if (isMatch) {
              keysToUpdate.add(`id:${c.id}`);
              if (c.profileId) keysToUpdate.add(`profile:${c.profileId}`);
              if (cPhone) keysToUpdate.add(`phone:${cPhone}`);
              keysToUpdate.add(`name:${c.name.trim().toLowerCase()}`);
              if (cNorm) keysToUpdate.add(`normname:${cNorm}`);
              if (cStrip) keysToUpdate.add(`stripname:${cStrip}`);
            }
          });

          keysToUpdate.forEach(k => {
            const current = friendBalanceMap.get(k) || {
              owedToYouPaise: 0,
              youOwePaise: 0,
              netPaise: 0,
              tripCount: 0,
            };
            friendBalanceMap.set(k, {
              owedToYouPaise: current.owedToYouPaise + toGetWithOther,
              youOwePaise: current.youOwePaise + toGiveWithOther,
              netPaise: current.netPaise + netWithOther,
              tripCount: current.tripCount + 1,
            });
          });
        }
      }

      // Ensure any synthesized friend from group trips or friend_split trips is in the contacts list
      // Also filter out stale unlinked guest entries that no longer match any trip member
      const activeSynthesizedNormNames = new Set(
        synthesizedFriends.map(sf => normalizeNameForMatch(sf.name))
      );
      const baseContacts = get().contacts.filter(c => {
        if (c.isGuest && !c.phoneNumber && !activeSynthesizedNormNames.has(normalizeNameForMatch(c.name))) {
          return false;
        }
        return true;
      });

      for (const sf of synthesizedFriends) {
        const sfNorm = normalizeNameForMatch(sf.name);
        const sfStrip = stripEmojisAndSpecial(sf.name);
        const existingIdx = baseContacts.findIndex(
          c =>
            c.id === sf.id ||
            (sf.profileId && c.profileId === sf.profileId) ||
            (sf.cleanPhone && c.cleanPhone === sf.cleanPhone) ||
            normalizeNameForMatch(c.name) === sfNorm ||
            (sfStrip && stripEmojisAndSpecial(c.name) === sfStrip && sfStrip.length >= 3)
        );
        if (existingIdx === -1) {
          baseContacts.unshift(sf);
        } else {
          const existing = baseContacts[existingIdx];
          const resolvedPhone = sf.phoneNumber || existing.phoneNumber;
          const resolvedCleanPhone = sf.cleanPhone || existing.cleanPhone;
          const resolvedIsGuest =
            sf.isGuest === false || existing.isGuest === false || Boolean(resolvedPhone)
              ? false
              : Boolean(sf.isGuest);
          baseContacts[existingIdx] = {
            ...existing,
            name: sf.name || existing.name,
            phoneNumber: resolvedPhone,
            cleanPhone: resolvedCleanPhone,
            isGuest: resolvedIsGuest,
          };
        }
      }

      // Merge both owedToYou and youOwe balances into contacts
      const seenPeople = new Set<string>();
      let totalOwedToYouPaise = 0;
      let totalYouOwePaise = 0;

      const updatedContacts = baseContacts.map(c => {
        const cNorm = normalizeNameForMatch(c.name);
        const cStrip = stripEmojisAndSpecial(c.name);
        const bal =
          (c.id && friendBalanceMap.get(`id:${c.id}`)) ||
          (c.profileId && friendBalanceMap.get(`profile:${c.profileId}`)) ||
          (c.cleanPhone && friendBalanceMap.get(`phone:${c.cleanPhone}`)) ||
          friendBalanceMap.get(`name:${c.name.trim().toLowerCase()}`) ||
          (cNorm && friendBalanceMap.get(`normname:${cNorm}`)) ||
          (cStrip && friendBalanceMap.get(`stripname:${cStrip}`));

        const toGet = bal ? bal.owedToYouPaise : 0;
        const toGive = bal ? bal.youOwePaise : 0;

        const personKey = c.profileId || c.cleanPhone || normalizePhone(c.phoneNumber) || c.id;
        if (!seenPeople.has(personKey)) {
          seenPeople.add(personKey);
          totalOwedToYouPaise += toGet;
          totalYouOwePaise += toGive;
        }

        return {
          ...c,
          owedToYouPaise: toGet,
          youOwePaise: toGive,
          netBalancePaise: bal ? bal.netPaise : 0,
          sharedTripsCount: bal ? bal.tripCount : 0,
        };
      });

      // Sort: Pending settlements FIRST, sorted descending by absolute pending balance
      updatedContacts.sort((a, b) => {
        const aPending = (a.netBalancePaise || 0) !== 0 || (a.owedToYouPaise || 0) > 0 || (a.youOwePaise || 0) > 0;
        const bPending = (b.netBalancePaise || 0) !== 0 || (b.owedToYouPaise || 0) > 0 || (b.youOwePaise || 0) > 0;
        if (aPending && !bPending) return -1;
        if (!aPending && bPending) return 1;
        if (aPending && bPending) {
          return Math.abs(b.netBalancePaise || 0) - Math.abs(a.netBalancePaise || 0);
        }
        return (a.name || '').localeCompare(b.name || '');
      });

      set({
        contacts: updatedContacts,
        friendsSummary: {
          totalOwedToYouPaise,
          totalYouOwePaise,
          netOverallPaise: totalOwedToYouPaise - totalYouOwePaise,
        },
      });
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
}));
