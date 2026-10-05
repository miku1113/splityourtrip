import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  Image,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Linking,
  ActivityIndicator,
  Keyboard,
  InteractionManager,
  StatusBar,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useTheme } from '../theme/useThemeStore';
import { useAuthStore, decodeBase64ToArrayBuffer } from '../features/auth/useAuthStore';
import { supabase, supabaseAdmin } from '../lib/supabase';
import {
  useTripStore,
  computeBalances,
  normalizeExpensesForTrip,
  deletedExpenseIdsSet,
} from '../features/trips/useTripStore';
import {
  useContactsStore,
  normalizePhone,
  FriendContact,
} from '../features/contacts/useContactsStore';
import { AppStorage } from '../lib/storage';
import { calculateSettlement } from '../services/settle';
import { formatCurrencyAmount } from '../services/currency';
import { getFriendSettings } from '../services/friendSettings';
import { TripMessage, TripMember } from '../types/database';
import { scaleFont, moderateScale, isSmallDevice } from '../theme/responsive';

const PAGE_SIZE = 20;

interface ChatViewProps {
  tripId: string;
  title: string;
  subtitle?: string;
  avatarText?: string;
  avatarUrl?: string;
  friendId?: string;
  friendPhone?: string;
  isGroup?: boolean;
  showHeader?: boolean;
  onBack?: () => void;
  onAddExpense?: () => void;
  onSettleUp?: () => void;
}

export default function ChatView({
  tripId,
  title,
  subtitle = 'Online',
  avatarText,
  avatarUrl,
  friendId,
  friendPhone,
  isGroup = false,
  showHeader = true,
  onBack,
  onAddExpense,
  onSettleUp,
}: ChatViewProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { user, profile } = useAuthStore();
  const {
    messages,
    sendMessage,
    loadTripDetails,
    subscribeTripRealtime,
    trips,
    members,
    expenses,
    balances,
    isLoading: tripLoading,
    linkGuestWithContact,
  } = useTripStore();
  const {
    contacts,
    isLoading: contactsLoading,
    initContacts,
  } = useContactsStore();

  const [displayTitle, setDisplayTitle] = useState(title);
  const [displayPhone, setDisplayPhone] = useState(friendPhone || '');
  const [isLinkedLocal, setIsLinkedLocal] = useState(Boolean(friendPhone && friendPhone.trim().length > 0));
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const navLockRef = useRef(false);

  const runGuardedNav = (actionId: string, fn: () => void) => {
    fn();
  };

  const [isBlocked, setIsBlocked] = useState(false);

  useEffect(() => {
    setDisplayTitle(title);
  }, [title]);

  useEffect(() => {
    if (friendPhone && friendPhone.trim().length > 0) {
      setDisplayPhone(friendPhone);
      setIsLinkedLocal(true);
    }
  }, [friendPhone]);

  useFocusEffect(
    useCallback(() => {
      if (!isGroup && (friendId || tripId)) {
        getFriendSettings(friendId || tripId).then(data => {
          if (data.isBlocked !== undefined) {
            setIsBlocked(data.isBlocked);
          }
          if (data.nickname) {
            setDisplayTitle(data.nickname);
          }
        });
      }
    }, [isGroup, friendId, tripId])
  );

  const [inputText, setInputText] = useState('');
  const [attachmentModalVisible, setAttachmentModalVisible] = useState(false);
  const [selectedPhotoPreview, setSelectedPhotoPreview] = useState<string | null>(null);
  const [friendNetPaise, setFriendNetPaise] = useState<number>(0);
  const [sharedTripLabels, setSharedTripLabels] = useState<string[]>([]);
  const [sharedExpenseMessages, setSharedExpenseMessages] = useState<TripMessage[]>([]);

  // Pagination state for messages (10 at a time, loaded from the last/newest message)
  const [messagesVisibleCount, setMessagesVisibleCount] = useState(PAGE_SIZE);
  const [loadingEarlierMessages, setLoadingEarlierMessages] = useState(false);
  const [optionsSidebarVisible, setOptionsSidebarVisible] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [isChatLoading, setIsChatLoading] = useState(true);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, () => {
      setIsKeyboardVisible(true);
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 50);
    });

    const hideSub = Keyboard.addListener(hideEvent, () => {
      setIsKeyboardVisible(false);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Link Guest Friend with Phone Contact Modal state
  const [linkContactModalVisible, setLinkContactModalVisible] = useState(false);
  const [linkSearchQuery, setLinkSearchQuery] = useState('');
  const [linkVisibleCount, setLinkVisibleCount] = useState(PAGE_SIZE);
  const [loadingMoreLinkContacts, setLoadingMoreLinkContacts] = useState(false);
  const [linkingInProgress, setLinkingInProgress] = useState(false);

  const flatListRef = useRef<FlatList>(null);
  const didInitialScrollRef = useRef(false);
  const prevMsgCountRef = useRef(0);

  const currentTrip = trips.find(t => t.id === tripId);
  const tripMembers = useMemo(
    () => members.filter(m => !m.trip_id || m.trip_id === tripId),
    [members, tripId]
  );
  const tripExpenses = useMemo(
    () => expenses.filter(e => !e.trip_id || e.trip_id === tripId),
    [expenses, tripId]
  );
  const totalGroupSpendPaise = useMemo(
    () => tripExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0),
    [tripExpenses]
  );

  // Reset initial scroll tracker when switching trips
  useEffect(() => {
    didInitialScrollRef.current = false;
    prevMsgCountRef.current = 0;
    setMessagesVisibleCount(PAGE_SIZE);
  }, [tripId]);

  const currentUserName =
    profile?.full_name || profile?.name || user?.email?.split('@')[0] || 'You';
  const currentUserId = user?.id || 'local_user';

  const myMember = useMemo(() => {
    return (
      tripMembers.find(
        m =>
          (user?.id && (m.profile_id === user.id || m.user_id === user.id)) ||
          m.role === 'admin'
      ) || tripMembers[0]
    );
  }, [tripMembers, user?.id]);

  const otherMember = useMemo(() => {
    return tripMembers.find(m => m.id !== myMember?.id);
  }, [tripMembers, myMember?.id]);

  // Determine if the current 1-on-1 friend is an unlinked Guest
  const isGuestFriend = useMemo(() => {
    if (isGroup) return false;
    if (isLinkedLocal) return false;
    if (displayPhone && displayPhone.trim().length > 0) return false;

    if (otherMember) {
      if (otherMember.is_guest === false || Boolean(otherMember.phone_number) || Boolean(otherMember.profile_id)) {
        return false;
      }
    }

    const cleanName = displayTitle.trim().toLowerCase();
    const matchedContact = contacts.find(
      c =>
        (friendId && c.id === friendId) ||
        c.name.trim().toLowerCase() === cleanName
    );
    if (matchedContact) {
      if (matchedContact.isGuest === false || Boolean(matchedContact.phoneNumber) || matchedContact.isRegistered) {
        return false;
      }
    }

    return true;
  }, [isGroup, isLinkedLocal, displayTitle, displayPhone, friendId, contacts, otherMember]);

  const currentFriendAvatarUrl = useMemo(() => {
    if (avatarUrl) return avatarUrl;
    const cleanFriendName = displayTitle.trim().toLowerCase();
    const cleanFriendPhone = normalizePhone(displayPhone);
    const mc = contacts.find(
      c =>
        (friendId && c.id === friendId) ||
        (cleanFriendPhone && c.cleanPhone === cleanFriendPhone) ||
        c.name.trim().toLowerCase() === cleanFriendName
    );
    return mc?.avatarUrl;
  }, [avatarUrl, displayTitle, displayPhone, contacts, friendId]);

  // Phone contacts available for linking (exclude purely guest entries that have no phone number)
  const phoneContactsToLink = useMemo(() => {
    const validPhoneContacts = contacts.filter(
      c => Boolean(c.phoneNumber && c.phoneNumber.trim().length > 0)
    );
    if (!linkSearchQuery.trim()) return validPhoneContacts;
    const q = linkSearchQuery.toLowerCase().trim();
    return validPhoneContacts.filter(
      c =>
        c.name.toLowerCase().includes(q) ||
        (c.phoneNumber && c.phoneNumber.toLowerCase().includes(q))
    );
  }, [contacts, linkSearchQuery]);

  const paginatedLinkContacts = useMemo(
    () => phoneContactsToLink.slice(0, linkVisibleCount),
    [phoneContactsToLink, linkVisibleCount]
  );

  useEffect(() => {
    setLinkVisibleCount(PAGE_SIZE);
  }, [linkSearchQuery]);

  const handleLoadMoreLinkContacts = useCallback(() => {
    if (loadingMoreLinkContacts || linkVisibleCount >= phoneContactsToLink.length) return;
    setLoadingMoreLinkContacts(true);
    setTimeout(() => {
      setLinkVisibleCount(prev => Math.min(prev + PAGE_SIZE, phoneContactsToLink.length));
      setLoadingMoreLinkContacts(false);
    }, 250);
  }, [loadingMoreLinkContacts, linkVisibleCount, phoneContactsToLink.length]);

  const openLinkContactModal = () => {
    setLinkSearchQuery('');
    setLinkVisibleCount(PAGE_SIZE);
    setLinkContactModalVisible(true);
    if (contacts.length === 0) {
      initContacts();
    }
  };

  const handleLinkFriendToContact = async (contact: FriendContact) => {
    setLinkingInProgress(true);
    try {
      const myMember =
        tripMembers.find(
          m =>
            (user?.id && (m.profile_id === user.id || m.user_id === user.id)) ||
            m.role === 'admin'
        ) || tripMembers[0];
      const otherMember = tripMembers.find(m => m.id !== myMember?.id);

      await linkGuestWithContact({
        tripId,
        guestMemberId: otherMember?.id,
        guestName: displayTitle,
        contact: {
          id: contact.id,
          name: contact.name,
          phoneNumber: contact.phoneNumber,
          profileId: contact.profileId,
        },
      });

      setIsLinkedLocal(true);
      setDisplayTitle(contact.name);
      setDisplayPhone(contact.phoneNumber || 'Linked Contact');
      setLinkContactModalVisible(false);
      await computeSharedFriendData();
      Alert.alert(
        'Linked with Contact',
        `${displayTitle} is now linked with ${contact.name}${contact.phoneNumber ? ` (${contact.phoneNumber})` : ''}.`
      );
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not link with contact.');
    } finally {
      setLinkingInProgress(false);
    }
  };

  const computeSharedFriendData = useCallback(async () => {
    if (isGroup) return;

    const cleanFriendName = displayTitle.trim().toLowerCase();
    const cleanFriendPhone = normalizePhone(displayPhone);

    // Also check matched contact from contacts store
    const matchedContact = contacts.find(
      c =>
        (friendId && c.id === friendId) ||
        (cleanFriendPhone && c.cleanPhone === cleanFriendPhone) ||
        c.name.trim().toLowerCase() === cleanFriendName
    );
    const targetProfileId = matchedContact?.profileId;
    const targetPhone = cleanFriendPhone || matchedContact?.cleanPhone || '';

    let totalNet = 0;
    const tripBreakdownLabels: string[] = [];
    const synthesizedExpMsgs: TripMessage[] = [];

    const allTrips = useTripStore.getState().trips;

    for (const t of allTrips) {
      let tMembers: TripMember[] = [];
      let tExpenses: any[] = [];

      try {
        const raw = await AppStorage.getItem(`@splityourtrip_local_details_${t.id}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          tMembers = Array.isArray(parsed.members) ? parsed.members : [];
          tExpenses = Array.isArray(parsed.expenses) ? parsed.expenses : [];
        }
      } catch {}

      if (tMembers.length === 0 && t.id === tripId) {
        tMembers = useTripStore.getState().members.filter(m => m.trip_id === t.id);
      }
      if (tExpenses.length === 0 && t.id === tripId) {
        tExpenses = useTripStore.getState().expenses.filter(e => e.trip_id === t.id);
      }

      if (tMembers.length === 0) continue;

      const myMember =
        tMembers.find(
          m =>
            (user?.id && (m.profile_id === user.id || m.user_id === user.id)) ||
            m.role === 'admin'
        ) || tMembers[0];

      // Find if this friend is a member of trip `t`
      const isDirectFriendTrip =
        t.id === tripId ||
        (t.trip_type === 'friend_split' &&
          ((friendId && t.friend_id === friendId) ||
            (targetProfileId && (t.friend_id === targetProfileId || t.created_by === targetProfileId)) ||
            t.name.toLowerCase() === `split with ${cleanFriendName}` ||
            (currentUserName && currentUserName !== 'You' && t.name.toLowerCase() === `split with ${currentUserName.toLowerCase().trim()}`)));

      const friendMember = tMembers.find(m => {
        if (m.id === myMember?.id) return false;
        if (isDirectFriendTrip && tMembers.length === 2) return true;
        if (friendId && m.id === friendId) return true;
        if (targetProfileId && m.profile_id === targetProfileId) return true;
        if (targetPhone && normalizePhone(m.phone_number) === targetPhone) return true;
        return m.display_name.trim().toLowerCase() === cleanFriendName;
      });

      if (!friendMember || !myMember) continue;

      const normalizedExps = normalizeExpensesForTrip(tExpenses, tMembers);
      const tBalances = computeBalances(t.id, tMembers, normalizedExps);
      const netRecord: Record<string, number> = {};
      tBalances.forEach(b => {
        netRecord[b.member_id] = b.net_balance;
      });
      const settlements = calculateSettlement(netRecord);

      let tripNetWithFriend = 0;
      for (const s of settlements) {
        if (s.from === friendMember.id && s.to === myMember.id) {
          tripNetWithFriend += Number(s.amount) || 0;
        } else if (s.from === myMember.id && s.to === friendMember.id) {
          tripNetWithFriend -= Number(s.amount) || 0;
        }
      }

      if (tripNetWithFriend !== 0) {
        totalNet += tripNetWithFriend;
        const isSplit =
          t.trip_type === 'friend_split' || t.name.toLowerCase().startsWith('split with ');
        const labelName = isSplit ? 'Direct Split' : t.name;
        tripBreakdownLabels.push(labelName);
      }

      // Collect expenses from this trip that involve this friend
      for (const exp of normalizedExps) {
        if (deletedExpenseIdsSet.has(exp.id)) continue;
        const amt = Number(exp.amount) || 0;
        const expSplits = exp.splits || [];
        const isPayerMe =
          exp.paid_by === myMember.id ||
          (user?.id && (exp.paid_by === user.id || exp.created_by === user.id));
        const isPayerFriend =
          exp.paid_by === friendMember.id ||
          (targetProfileId && exp.paid_by === targetProfileId);
        const mySplit = expSplits.find(
          (s: any) =>
            s.member_id === myMember.id ||
            (user?.id && (s.profile_id === user.id || s.member_id === user.id))
        );
        const friendSplit = expSplits.find(
          (s: any) =>
            s.member_id === friendMember.id ||
            (targetProfileId && (s.profile_id === targetProfileId || s.member_id === targetProfileId))
        );

        const meInSplit = Boolean(mySplit);
        const friendInSplit = Boolean(friendSplit);

        // Strict mutual involvement: in individual chat, show ONLY expenses where WE BOTH ARE SPLITTING TOGETHER!
        // 1. I paid, and friend is in the split
        // 2. Friend paid, and I am in the split
        // 3. Both of us are in the split together (even if a 3rd party paid)
        const isSplittingTogether =
          (isPayerMe && friendInSplit) ||
          (isPayerFriend && meInSplit) ||
          (meInSplit && friendInSplit);

        if (!isSplittingTogether) continue;

        let impactPaise = 0;
        if (isPayerMe && friendInSplit) {
          impactPaise = Number(friendSplit.amount) || 0; // Friend owes you
        } else if (isPayerFriend && mySplit) {
          impactPaise = -(Number(mySplit.amount) || 0); // You owe friend
        }

        const isSplitTrip =
          t.trip_type === 'friend_split' || t.name.toLowerCase().startsWith('split with ');

        synthesizedExpMsgs.push({
          id: `shared_exp_${exp.id}`,
          trip_id: t.id,
          sender_id: isPayerMe ? currentUserId : friendMember.id,
          sender_name: exp.payerName || (isPayerMe ? currentUserName : friendMember.display_name),
          message: `💰 Added expense: "${exp.description}"`,
          content: '',
          type: 'expense',
          expense_id: exp.id,
          expense_data: {
            id: exp.id,
            trip_id: t.id,
            trip_name: isSplitTrip ? 'Direct Split' : t.name,
            is_group_expense: !isSplitTrip,
            description: exp.description,
            amount: amt,
            currency: t.currency || 'INR',
            paid_by_name: exp.payerName || (isPayerMe ? 'You' : friendMember.display_name),
            paid_by_id: exp.paid_by,
            split_count: expSplits.length || tMembers.length,
            category: exp.category || 'General',
            impact_paise: impactPaise,
            date: exp.created_at || exp.date || new Date().toISOString(),
          },
          created_at: exp.created_at || exp.date || new Date().toISOString(),
        });
      }
    }

    // Fallback to contact store balance ONLY if no shared trips were found or processed
    if (totalNet === 0 && tripBreakdownLabels.length === 0 && matchedContact?.netBalancePaise) {
      totalNet = matchedContact.netBalancePaise;
    }

    setFriendNetPaise(totalNet);
    setSharedTripLabels(Array.from(new Set(tripBreakdownLabels)));
    setSharedExpenseMessages(synthesizedExpMsgs);
  }, [isGroup, displayTitle, displayPhone, friendId, contacts, tripId, user?.id, currentUserId, currentUserName]);

  useEffect(() => {
    let isMounted = true;
    didInitialScrollRef.current = false;
    setMessagesVisibleCount(PAGE_SIZE);

    if (tripId) {
      const hasLocalTrip = trips.some(t => t.id === tripId);
      const hasLocalMessages = messages && messages.length > 0;
      if (!hasLocalTrip && !hasLocalMessages) {
        setIsChatLoading(true);
      } else {
        setIsChatLoading(false);
      }

      const safetyTimer = setTimeout(() => {
        if (isMounted) setIsChatLoading(false);
      }, 2000);

      loadTripDetails(tripId)
        .catch(err => console.log('loadTripDetails error in ChatView:', err))
        .finally(() => {
          clearTimeout(safetyTimer);
          if (isMounted) {
            setIsChatLoading(false);
          }
        });

      const unsub = subscribeTripRealtime(tripId);
      const heartbeat = setInterval(() => {
        useTripStore.getState().syncTripMessages(tripId);
      }, 3500);

      return () => {
        isMounted = false;
        clearTimeout(safetyTimer);
        clearInterval(heartbeat);
        unsub();
      };
    } else {
      setIsChatLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    if (!isGroup) {
      computeSharedFriendData();
    }
  }, [isGroup, friendId, displayTitle, displayPhone, computeSharedFriendData]);

  useFocusEffect(
    useCallback(() => {
      navLockRef.current = false;
      setActiveActionId(null);
      if (tripId) {
        useTripStore.getState().syncTripMessages(tripId);
      }
      if (!isGroup) {
        computeSharedFriendData();
      }
    }, [isGroup, tripId, computeSharedFriendData])
  );

  // Merge chat messages with expense cards and sort chronologically ascending (oldest -> newest, so last message is at bottom)
  const combinedMessages = useMemo(() => {
    if (isGroup) {
      const validTripExpenseIds = new Set(
        tripExpenses
          .filter(e => !deletedExpenseIdsSet.has(e.id))
          .map(e => e.id)
      );

      // In group chat: filter out individual messages
      const validMessages = messages.filter(m => {
        if (m.chat_type === 'individual' || m.chat_type === 'user') {
          return false;
        }
        const expId = m.expense_id || m.expense_data?.id;
        if (expId && (deletedExpenseIdsSet.has(expId) || !validTripExpenseIds.has(expId))) {
          return false;
        }
        if (m.type === 'expense') {
          if (!expId || !validTripExpenseIds.has(expId) || deletedExpenseIdsSet.has(expId)) return false;
        }
        return true;
      });

      const existingExpenseIds = new Set<string>();
      validMessages.forEach(m => {
        if (m.expense_id) existingExpenseIds.add(m.expense_id);
        if (m.expense_data?.id) existingExpenseIds.add(m.expense_data.id);
      });

      const missingGroupExpenseMsgs: TripMessage[] = tripExpenses
        .filter(e => !deletedExpenseIdsSet.has(e.id) && !existingExpenseIds.has(e.id))
        .map(exp => ({
          id: `group_exp_${exp.id}`,
          trip_id: tripId,
          sender_id: exp.created_by || exp.paid_by || currentUserId,
          sender_name: exp.payerName || 'Member',
          message: `💰 Added expense: "${exp.description}"`,
          content: '',
          type: 'expense',
          chat_type: 'group',
          expense_id: exp.id,
          expense_data: {
            id: exp.id,
            trip_id: tripId,
            trip_name: displayTitle,
            description: exp.description,
            amount: Number(exp.amount) || 0,
            currency: currentTrip?.currency || 'INR',
            paid_by_name: exp.payerName || 'Member',
            paid_by_id: exp.paid_by,
            split_count: exp.splits?.length || tripMembers.length || 2,
            category: exp.category || 'General',
            date: exp.created_at || exp.date || new Date().toISOString(),
          },
          created_at: exp.created_at || exp.date || new Date().toISOString(),
        }));

      return [...validMessages, ...missingGroupExpenseMsgs].sort(
        (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
      );
    }

    // Individual Chat (!isGroup):
    // Only show shared expenses where we both are splitting together!
    const validSharedExpenseIds = new Set(
      sharedExpenseMessages
        .map(se => se.expense_id || se.expense_data?.id)
        .filter((id): id is string => Boolean(id && !deletedExpenseIdsSet.has(id)))
    );

    // In individual chat: filter out group messages and filter out expenses that don't involve both users
    const validMessages = messages.filter(m => {
      if (m.chat_type === 'group' || m.chat_type === 'trip') {
        return false;
      }
      const expId = m.expense_id || m.expense_data?.id;
      if (expId && (deletedExpenseIdsSet.has(expId) || !validSharedExpenseIds.has(expId))) {
        return false;
      }
      if (m.type === 'expense') {
        if (!expId || !validSharedExpenseIds.has(expId) || deletedExpenseIdsSet.has(expId)) return false;
      }
      return true;
    });

    const existingExpenseIds = new Set<string>();
    const enrichedExisting = validMessages.map(m => {
      if (m.expense_id) {
        existingExpenseIds.add(m.expense_id);
        const matchShared = sharedExpenseMessages.find(se => se.expense_id === m.expense_id);
        if (matchShared && m.expense_data) {
          return {
            ...m,
            expense_data: {
              ...m.expense_data,
              ...matchShared.expense_data,
            },
          };
        }
      }
      return m;
    });

    const additionalShared = sharedExpenseMessages.filter(
      se => se.expense_id && !deletedExpenseIdsSet.has(se.expense_id) && !existingExpenseIds.has(se.expense_id)
    );

    return [...enrichedExisting, ...additionalShared].sort(
      (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
    );
  }, [
    isGroup,
    messages,
    sharedExpenseMessages,
    tripExpenses,
    tripId,
    currentUserId,
    displayTitle,
    currentTrip?.currency,
    tripMembers.length,
  ]);

  // Turn off loading once messages are populated (e.g. from local storage or cloud)
  useEffect(() => {
    if (combinedMessages.length > 0) {
      setIsChatLoading(false);
    }
  }, [combinedMessages.length]);

  // Paginate messages by 10 from the end (most recent `messagesVisibleCount` messages)
  const paginatedMessages = useMemo(() => {
    if (combinedMessages.length <= messagesVisibleCount) return combinedMessages;
    return combinedMessages.slice(combinedMessages.length - messagesVisibleCount);
  }, [combinedMessages, messagesVisibleCount]);

  // Auto-scroll to bottom on initial load or when a new message is added at the end
  useEffect(() => {
    if (paginatedMessages.length === 0) return;

    if (!didInitialScrollRef.current) {
      didInitialScrollRef.current = true;
      prevMsgCountRef.current = combinedMessages.length;
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: false });
      }, 80);
      return;
    }

    if (combinedMessages.length > prevMsgCountRef.current) {
      prevMsgCountRef.current = combinedMessages.length;
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 80);
    }
  }, [paginatedMessages.length, combinedMessages.length]);

  const handleLoadEarlierMessages = useCallback(() => {
    if (loadingEarlierMessages || messagesVisibleCount >= combinedMessages.length) return;
    setLoadingEarlierMessages(true);
    setTimeout(() => {
      setMessagesVisibleCount(prev => Math.min(prev + PAGE_SIZE, combinedMessages.length));
      setLoadingEarlierMessages(false);
    }, 250);
  }, [loadingEarlierMessages, messagesVisibleCount, combinedMessages.length]);

  // Group trip net balance for current user when isGroup === true
  const groupMyNetPaise = useMemo(() => {
    if (!isGroup) return 0;
    const myMember =
      tripMembers.find(
        m =>
          (user?.id && (m.profile_id === user.id || m.user_id === user.id)) ||
          m.role === 'admin'
      ) || tripMembers[0];
    if (!myMember) return 0;
    const row = balances.find(b => b.member_id === myMember.id);
    return row ? row.net_balance : 0;
  }, [isGroup, tripMembers, balances, user?.id]);

  // Primary creditor name when user owes in a group trip
  const groupPrimaryCreditorName = useMemo(() => {
    if (!isGroup) return displayTitle;
    const myMember =
      tripMembers.find(
        m =>
          (user?.id && (m.profile_id === user.id || m.user_id === user.id)) ||
          m.role === 'admin'
      ) || tripMembers[0];
    if (!myMember) return displayTitle;
    const netRecord: Record<string, number> = {};
    balances
      .filter(b => !b.trip_id || b.trip_id === tripId)
      .forEach(b => {
        netRecord[b.member_id] = b.net_balance;
      });
    const settlements = calculateSettlement(netRecord);
    const myDebt = settlements.find(s => s.from === myMember.id);
    if (myDebt) {
      const creditor = tripMembers.find(m => m.id === myDebt.to);
      if (creditor) return creditor.display_name;
    }
    return displayTitle;
  }, [isGroup, tripMembers, balances, tripId, user?.id, displayTitle]);

  const activeBannerNetPaise = isGroup ? groupMyNetPaise : friendNetPaise;

  // Format time (e.g. 10:45 AM)
  const formatTime = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const handleSendText = async () => {
    if (!inputText.trim()) return;
    const textToSend = inputText.trim();
    setInputText('');
    await sendMessage(
      tripId,
      currentUserId,
      currentUserName,
      textToSend,
      undefined,
      isGroup ? 'group' : 'individual'
    );
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  const handlePickImage = async () => {
    setAttachmentModalVisible(false);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        let remoteUrl = asset.uri;

        if (asset.base64) {
          try {
            const client = supabaseAdmin || supabase;
            const storagePath = `chat/${tripId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
            const arrayBuffer = decodeBase64ToArrayBuffer(asset.base64);
            const { data: uploadData } = await client.storage
              .from('attachments')
              .upload(storagePath, arrayBuffer, { contentType: 'image/jpeg', upsert: true });
            if (uploadData?.path) {
              const { data: pubData } = client.storage.from('attachments').getPublicUrl(uploadData.path);
              if (pubData?.publicUrl) {
                remoteUrl = pubData.publicUrl;
              }
            }
          } catch (uploadErr) {
            console.warn('Image upload fallback to local URI:', uploadErr);
          }
        }

        await sendMessage(
          tripId,
          currentUserId,
          currentUserName,
          inputText.trim() || '📷 Photo',
          {
            type: 'image',
            url: remoteUrl,
            name: asset.fileName || 'Photo.jpg',
            size: asset.fileSize ? `${Math.round(asset.fileSize / 1024)} KB` : undefined,
          },
          isGroup ? 'group' : 'individual'
        );
        setInputText('');
        setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
        }, 100);
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not pick photo');
    }
  };

  const handleTakePhoto = async () => {
    setAttachmentModalVisible(false);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Camera Permission', 'Please enable camera permission in device settings.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        let remoteUrl = asset.uri;

        if (asset.base64) {
          try {
            const client = supabaseAdmin || supabase;
            const storagePath = `chat/${tripId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
            const arrayBuffer = decodeBase64ToArrayBuffer(asset.base64);
            const { data: uploadData } = await client.storage
              .from('attachments')
              .upload(storagePath, arrayBuffer, { contentType: 'image/jpeg', upsert: true });
            if (uploadData?.path) {
              const { data: pubData } = client.storage.from('attachments').getPublicUrl(uploadData.path);
              if (pubData?.publicUrl) {
                remoteUrl = pubData.publicUrl;
              }
            }
          } catch (uploadErr) {
            console.warn('Camera upload fallback to local URI:', uploadErr);
          }
        }

        await sendMessage(
          tripId,
          currentUserId,
          currentUserName,
          inputText.trim() || '📷 Photo',
          {
            type: 'image',
            url: remoteUrl,
            name: asset.fileName || 'Photo.jpg',
            size: asset.fileSize ? `${Math.round(asset.fileSize / 1024)} KB` : undefined,
          },
          isGroup ? 'group' : 'individual'
        );
        setInputText('');
        setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
        }, 100);
      }
    } catch (e: any) {
      Alert.alert('Camera Error', e?.message || 'Could not open camera');
    }
  };

  const handlePickDocument = async () => {
    setAttachmentModalVisible(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*', 'text/*'],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        await sendMessage(
          tripId,
          currentUserId,
          currentUserName,
          file.name || 'Document',
          {
            type: 'document',
            url: file.uri,
            name: file.name || 'Document.pdf',
            size: file.size ? `${Math.round(file.size / 1024)} KB` : 'PDF',
          },
          isGroup ? 'group' : 'individual'
        );
        setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
        }, 100);
      }
    } catch (e: any) {
      Alert.alert('Document Error', e?.message || 'Could not pick document');
    }
  };

  const handleOpenDoc = (url?: string) => {
    if (url) {
      Linking.openURL(url).catch(() => {
        Alert.alert('Document', 'Unable to open file preview on this device.');
      });
    }
  };

  const effectiveSubtitle = isGroup
    ? `${tripMembers.length} ${tripMembers.length === 1 ? 'member' : 'members'} • ${tripExpenses.length} ${tripExpenses.length === 1 ? 'expense' : 'expenses'} • Total ${formatCurrencyAmount(totalGroupSpendPaise, currentTrip?.currency)}`
    : displayPhone && displayPhone !== 'Linked Contact'
    ? `${displayPhone} • Split Your Trip`
    : !isGuestFriend
    ? 'Linked Contact • Split Your Trip'
    : 'Guest Friend • Tap Link Contact';

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : (StatusBar.currentHeight || 0)}
    >
      {/* Top Header with Trip/Chat Icon + Name + Info Subtitle (Click Name/Icon to open Info Screen) */}
      {showHeader && (
        <View
          style={[
            styles.headerBar,
            {
              backgroundColor: colors.card,
              borderBottomColor: colors.border,
              borderBottomWidth: 1,
              paddingTop: Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 44) + 6,
            },
          ]}
        >
          <TouchableOpacity
            style={styles.headerBackBtn}
            onPress={() => {
              if (onBack) onBack();
              else router.back();
            }}
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>

          {/* Clickable Trip / Chat Identity Area -> Opens Info Screen */}
          <TouchableOpacity
            style={styles.headerIdentityRow}
            activeOpacity={0.75}
            onPress={() => router.push(`/trip/${tripId}/info`)}
          >
            <View style={[styles.headerAvatar, { backgroundColor: colors.primaryLight, overflow: 'hidden' }]}>
              {isGroup ? (
                currentTrip?.image_url ? (
                  currentTrip.image_url.startsWith('emoji:') ? (
                    <Text style={{ fontSize: 20 }}>{currentTrip.image_url.replace('emoji:', '')}</Text>
                  ) : (
                    <Image
                      source={{ uri: currentTrip.image_url }}
                      style={{ width: '100%', height: '100%' }}
                    />
                  )
                ) : (
                  <Ionicons name="airplane" size={20} color={colors.primary} />
                )
              ) : currentFriendAvatarUrl ? (
                <Image
                  source={{ uri: currentFriendAvatarUrl }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="cover"
                />
              ) : (
                <Text style={[styles.headerAvatarText, { color: colors.primary }]}>
                  {avatarText || displayTitle.charAt(0).toUpperCase()}
                </Text>
              )}
            </View>

            <View style={styles.headerTitleCol}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[styles.headerTitleText, { color: colors.text }]} numberOfLines={1}>
                  {displayTitle}
                </Text>
                {!isGroup && isGuestFriend && (
                  <View style={[styles.guestHeaderPill, { backgroundColor: colors.warningBg }]}>
                    <Text style={[styles.guestHeaderPillText, { color: colors.warning }]}>GUEST</Text>
                  </View>
                )}
                <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
              </View>
              <Text style={[styles.headerSubtitleText, { color: colors.textSecondary }]} numberOfLines={1}>
                {effectiveSubtitle}
              </Text>
            </View>
          </TouchableOpacity>

          {/* Three-Dots Button -> Opens Options Sidebar Drawer */}
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.headerIconBtn}
              onPress={() => setOptionsSidebarVisible(true)}
            >
              <Ionicons name="ellipsis-vertical" size={21} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Guest Friend Link Prompt Banner (if guest / unlinked in 1-on-1 chat) */}
      {!isGroup && isGuestFriend && (
        <View
          style={[
            styles.guestLinkBanner,
            {
              backgroundColor: colors.warningBg,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <View style={styles.guestLinkBannerLeft}>
            <Ionicons name="link-outline" size={18} color={colors.warning} />
            <Text
              style={[
                styles.guestLinkBannerText,
                { color: colors.text },
              ]}
              numberOfLines={2}
            >
              {displayTitle} is added as a Guest. Link with a phone contact to sync splits & phone number.
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.guestLinkActionBtn, { backgroundColor: colors.warning }]}
            onPress={openLinkContactModal}
          >
            <Ionicons name="person-add" size={13} color="#FFFFFF" />
            <Text style={styles.guestLinkActionText}>Link Contact</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Sticky Balance Banner (shows Pay button instead of Split button when You Owe) */}
      <View
        style={[
          styles.balanceBanner,
          {
            backgroundColor:
              activeBannerNetPaise < 0
                ? colors.dangerBg
                : activeBannerNetPaise > 0
                ? colors.successBg
                : colors.cardSecondary,
            borderBottomColor:
              activeBannerNetPaise < 0
                ? colors.danger
                : activeBannerNetPaise > 0
                ? colors.success
                : colors.border,
          },
        ]}
      >
        <View style={styles.balanceBannerLeft}>
          <View
            style={[
              styles.balanceBannerIcon,
              {
                backgroundColor:
                  activeBannerNetPaise < 0
                    ? colors.dangerBg
                    : activeBannerNetPaise > 0
                    ? colors.successBg
                    : colors.borderLight,
              },
            ]}
          >
            <Ionicons
              name={
                activeBannerNetPaise < 0
                  ? 'arrow-up-circle'
                  : activeBannerNetPaise > 0
                  ? 'arrow-down-circle'
                  : 'checkmark-circle'
              }
              size={20}
              color={
                activeBannerNetPaise < 0
                  ? colors.danger
                  : activeBannerNetPaise > 0
                  ? colors.success
                  : colors.textSecondary
              }
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={[
                styles.balanceBannerTitle,
                {
                  color:
                    activeBannerNetPaise < 0
                      ? colors.danger
                      : activeBannerNetPaise > 0
                      ? colors.success
                      : colors.text,
                },
              ]}
            >
              {activeBannerNetPaise < 0
                ? isGroup
                  ? `You owe ${formatCurrencyAmount(Math.abs(activeBannerNetPaise), currentTrip?.currency)}`
                  : `You owe ${displayTitle} ${formatCurrencyAmount(Math.abs(activeBannerNetPaise), currentTrip?.currency)}`
                : activeBannerNetPaise > 0
                ? isGroup
                  ? `You are owed ${formatCurrencyAmount(activeBannerNetPaise, currentTrip?.currency)}`
                  : `${displayTitle} owes you ${formatCurrencyAmount(activeBannerNetPaise, currentTrip?.currency)}`
                : `Settled up with ${displayTitle}`}
            </Text>
            {!isGroup && sharedTripLabels.length > 0 && activeBannerNetPaise !== 0 ? (
              <Text style={[styles.balanceBannerSub, { color: colors.textSecondary }]} numberOfLines={1}>
                From: {sharedTripLabels.join(', ')}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.balanceBannerActions}>
          {activeBannerNetPaise < 0 ? (
            <TouchableOpacity
              style={[styles.payNowMiniBtn, { backgroundColor: colors.danger, minWidth: 74, justifyContent: 'center' }]}
              onPress={() => {
                const payeeName = isGroup ? groupPrimaryCreditorName : displayTitle;
                const rupees = (Math.abs(activeBannerNetPaise) / 100).toFixed(2);
                const upiUrl = `upi://pay?pn=${encodeURIComponent(payeeName)}&am=${rupees}&cu=INR`;
                Linking.openURL(upiUrl).catch(() => {
                  router.push({
                    pathname: '/trip/[id]/info',
                    params: { id: tripId, tab: 'settle' },
                  });
                });
              }}
            >
              <Ionicons name="flash" size={14} color="#FFFFFF" />
              <Text style={styles.payNowMiniText}>Pay</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.addSplitMiniBtn, { backgroundColor: colors.primary }]}
              onPress={() => {
                if (onAddExpense) onAddExpense();
                else router.push(`/trip/${tripId}/add`);
              }}
            >
              <Ionicons name="add" size={15} color="#FFFFFF" />
              <Text style={styles.addSplitMiniText}>Split</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Messages Feed */}
      {isChatLoading && paginatedMessages.length === 0 ? (
        <View style={styles.chatLoadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.chatLoadingText, { color: colors.textSecondary }]}>
            Loading messages...
          </Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={paginatedMessages}
          keyExtractor={item => item.id}
          contentContainerStyle={[
            styles.messagesList,
            paginatedMessages.length === 0 && { flex: 1, justifyContent: 'center' },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          onLayout={() => {
            if (!didInitialScrollRef.current && paginatedMessages.length > 0) {
              didInitialScrollRef.current = true;
              flatListRef.current?.scrollToEnd({ animated: false });
            }
          }}
          onScroll={e => {
            const offsetY = e.nativeEvent.contentOffset.y;
            if (
              offsetY <= 35 &&
              combinedMessages.length > messagesVisibleCount &&
              !loadingEarlierMessages
            ) {
              handleLoadEarlierMessages();
            }
          }}
          scrollEventThrottle={16}
          ListHeaderComponent={
            combinedMessages.length > messagesVisibleCount ? (
              <View style={styles.loadEarlierContainer}>
                {loadingEarlierMessages ? (
                  <View style={styles.loadEarlierRow}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={[styles.loadEarlierText, { color: colors.textSecondary }]}>
                      Loading older messages...
                    </Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[
                      styles.loadEarlierBtn,
                      { backgroundColor: colors.card, borderColor: colors.border },
                    ]}
                    onPress={handleLoadEarlierMessages}
                  >
                    <Ionicons name="arrow-up-circle-outline" size={16} color={colors.primary} />
                    <Text style={[styles.loadEarlierBtnText, { color: colors.primary }]}>
                      Scroll up or tap for older messages ({combinedMessages.length - messagesVisibleCount} older)
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={[styles.encryptionCard, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}>
                <Ionicons name="lock-closed" size={14} color={colors.textSecondary} />
                <Text style={[styles.encryptionText, { color: colors.textSecondary }]}>
                  Messages and shared bills in this chat are end-to-end encrypted and saved locally.
                </Text>
              </View>
              <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
                Say hello or split an expense with {displayTitle}!
              </Text>
            </View>
          }
          renderItem={({ item }) => {
          const isFromOther =
            !isGroup &&
            ((otherMember &&
              ((item.sender_id && (item.sender_id === otherMember.id || item.sender_id === otherMember.profile_id || item.sender_id === otherMember.user_id)) ||
                (item.sender_name && otherMember.display_name && item.sender_name.trim().toLowerCase() === otherMember.display_name.trim().toLowerCase()))) ||
              (item.sender_name && displayTitle && item.sender_name.trim().toLowerCase() === displayTitle.trim().toLowerCase()));

          const isMine = !isFromOther && (
            item.sender_id === currentUserId ||
            (user?.id && item.sender_id === user.id) ||
            !isGroup ||
            (item.sender_name && currentUserName && item.sender_name.trim().toLowerCase() === currentUserName.trim().toLowerCase()) ||
            (item.sender_name && item.sender_name.trim().toLowerCase() === 'you')
          );

          // 1. Photo Message
          if (item.type === 'image' && item.media_url) {
            return (
              <View
                style={[
                  styles.bubbleContainer,
                  isMine ? styles.bubbleRight : styles.bubbleLeft,
                ]}
              >
                <View
                  style={[
                    styles.imageBubble,
                    {
                      backgroundColor: isMine ? colors.primary : colors.card,
                      borderColor: isMine ? 'transparent' : colors.border,
                      borderWidth: isMine ? 0 : 1,
                    },
                  ]}
                >
                  <TouchableOpacity
                    activeOpacity={0.9}
                    onPress={() => setSelectedPhotoPreview(item.media_url || null)}
                  >
                    <Image source={{ uri: item.media_url }} style={styles.messageImage} />
                  </TouchableOpacity>

                  {item.message && item.message !== '📷 Photo' ? (
                    <Text style={[styles.imageCaption, { color: isMine ? '#FFFFFF' : colors.text }]}>
                      {item.message}
                    </Text>
                  ) : null}

                  <View style={styles.bubbleMetaRow}>
                    <Text style={[styles.timestampText, { color: isMine ? 'rgba(255,255,255,0.75)' : colors.textMuted }]}>
                      {formatTime(item.created_at)}
                    </Text>
                    {isMine && <Ionicons name="checkmark-done" size={15} color="#E0E7FF" style={{ marginLeft: 3 }} />}
                  </View>
                </View>
              </View>
            );
          }

          // 2. Document Message
          if (item.type === 'document') {
            return (
              <View
                style={[
                  styles.bubbleContainer,
                  isMine ? styles.bubbleRight : styles.bubbleLeft,
                ]}
              >
                <TouchableOpacity
                  style={[
                    styles.docBubble,
                    {
                      backgroundColor: isMine ? colors.primary : colors.card,
                      borderColor: isMine ? 'transparent' : colors.border,
                      borderWidth: isMine ? 0 : 1,
                    },
                  ]}
                  activeOpacity={0.8}
                  onPress={() => handleOpenDoc(item.media_url)}
                >
                  <View style={[styles.docIconBox, { backgroundColor: isMine ? 'rgba(255,255,255,0.2)' : colors.dangerBg }]}>
                    <Ionicons name="document-text" size={24} color={isMine ? '#FFFFFF' : colors.danger} />
                  </View>
                  <View style={{ flex: 1, marginHorizontal: 8 }}>
                    <Text
                      style={[styles.docName, { color: isMine ? '#FFFFFF' : colors.text }]}
                      numberOfLines={1}
                    >
                      {item.media_name || item.message || 'Document.pdf'}
                    </Text>
                    <Text style={[styles.docSize, { color: isMine ? 'rgba(255,255,255,0.75)' : colors.textMuted }]}>
                      {item.media_size || 'PDF Document'}
                    </Text>
                  </View>
                  <Ionicons name="download-outline" size={20} color={isMine ? 'rgba(255,255,255,0.85)' : colors.textSecondary} />

                  <View style={styles.docMetaRow}>
                    <Text style={[styles.timestampText, { color: isMine ? 'rgba(255,255,255,0.75)' : colors.textMuted }]}>
                      {formatTime(item.created_at)}
                    </Text>
                    {isMine && <Ionicons name="checkmark-done" size={15} color="#E0E7FF" style={{ marginLeft: 3 }} />}
                  </View>
                </TouchableOpacity>
              </View>
            );
          }

          // 3. Expense Notification Card
          if (item.type === 'expense' && item.expense_data) {
            const exp = item.expense_data;
            const impactPaise = Number(exp.impact_paise) || 0;
            const targetTripId = exp.trip_id || tripId;
            return (
              <View style={styles.expenseCardContainer}>
                <View
                  style={[
                    styles.expenseCard,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  {exp.trip_name && !isGroup ? (
                    <View style={styles.expenseTripBadgeRow}>
                      <View
                        style={[
                          styles.expenseTripBadge,
                          { backgroundColor: colors.primaryLight },
                        ]}
                      >
                        <Ionicons
                          name={exp.trip_name === 'Direct Split' ? 'people' : 'airplane'}
                          size={11}
                          color={colors.primary}
                        />
                        <Text style={[styles.expenseTripBadgeText, { color: colors.primary }]}>
                          {exp.trip_name}
                        </Text>
                      </View>

                      {impactPaise !== 0 && (
                        <Text
                          style={[
                            styles.expenseImpactText,
                            {
                              color:
                                exp.is_group_expense || exp.trip_name !== 'Direct Split'
                                  ? colors.textSecondary
                                  : impactPaise < 0
                                  ? colors.danger
                                  : colors.success,
                            },
                          ]}
                        >
                          {exp.is_group_expense || exp.trip_name !== 'Direct Split'
                            ? `Your share ${formatCurrencyAmount(Math.abs(impactPaise), exp.currency || currentTrip?.currency)}`
                            : impactPaise < 0
                            ? `You owe ${formatCurrencyAmount(Math.abs(impactPaise), exp.currency || currentTrip?.currency)}`
                            : `Owes you ${formatCurrencyAmount(impactPaise, exp.currency || currentTrip?.currency)}`}
                        </Text>
                      )}
                    </View>
                  ) : null}

                  <View style={styles.expenseCardTop}>
                    <View style={[styles.expenseIconBox, { backgroundColor: colors.successBg }]}>
                      <Ionicons name="receipt" size={20} color={colors.success} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.expenseCardTitle, { color: colors.text }]}>
                        {exp.description}
                      </Text>
                      <Text style={[styles.expenseCardSubtitle, { color: colors.textSecondary }]}>
                        Paid by {exp.paid_by_name} • Split among {exp.split_count || 2} members
                      </Text>
                      {exp.location ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3, gap: 3 }}>
                          <Ionicons name="location-sharp" size={11} color={colors.primary} />
                          <Text style={{ fontSize: 11, color: colors.textSecondary }} numberOfLines={1}>
                            {exp.location}
                          </Text>
                        </View>
                      ) : null}
                      {exp.attachment_url ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3, gap: 3 }}>
                          <Ionicons name="attach" size={12} color={colors.primary} />
                          <Text style={{ fontSize: 11, color: colors.primary, fontWeight: '600' }} numberOfLines={1}>
                            {exp.attachment_name || (exp.attachment_type === 'image' ? 'Receipt Photo' : 'Ticket / Document')}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={[styles.expenseCardAmount, { color: colors.primary }]}>
                      {formatCurrencyAmount(exp.amount, exp.currency || currentTrip?.currency)}
                    </Text>
                  </View>

                  <View style={[styles.expenseCardBottom, { borderTopColor: colors.border }]}>
                    <Text style={[styles.expenseTime, { color: colors.textMuted }]}>{formatTime(item.created_at)}</Text>
                    <TouchableOpacity
                      style={[styles.viewExpenseBtn, { backgroundColor: colors.primary, minWidth: 84, alignItems: 'center' }]}
                      onPress={() => {
                        const expenseIdToOpen = exp.id || item.expense_id;
                        if (expenseIdToOpen) {
                          router.push(`/trip/${targetTripId}/expense/${expenseIdToOpen}`);
                        } else {
                          router.push(`/trip/${targetTripId}`);
                        }
                      }}
                    >
                      <Text style={styles.viewExpenseText}>View Bill</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            );
          }

          // 4. Standard Text Message Bubble
          return (
            <View
              style={[
                styles.bubbleContainer,
                isMine ? styles.bubbleRight : styles.bubbleLeft,
              ]}
            >
              <View
                style={[
                  styles.textBubble,
                  {
                    backgroundColor: isMine ? colors.primary : colors.card,
                    borderColor: isMine ? 'transparent' : colors.border,
                    borderWidth: isMine ? 0 : 1,
                  },
                ]}
              >
                {isGroup && !isMine && item.sender_name && (
                  <Text style={[styles.senderNameHeader, { color: colors.primary }]}>{item.sender_name}</Text>
                )}
                <Text style={[styles.messageText, { color: isMine ? '#FFFFFF' : colors.text }]}>
                  {item.message}
                </Text>

                <View style={styles.bubbleMetaRow}>
                  <Text style={[styles.timestampText, { color: isMine ? 'rgba(255,255,255,0.75)' : colors.textMuted }]}>
                    {formatTime(item.created_at)}
                  </Text>
                  {isMine && (
                    <Ionicons
                      name="checkmark-done"
                      size={15}
                      color="#E0E7FF"
                      style={{ marginLeft: 3 }}
                    />
                  )}
                </View>
              </View>
            </View>
          );
        }}
      />
      )}

      {/* Composer Bottom Bar */}
      {isBlocked ? (
        <View
          style={[
            styles.blockedBar,
            {
              backgroundColor: colors.card,
              borderTopColor: colors.border,
              paddingBottom: Math.max(insets.bottom, 14),
            },
          ]}
        >
          <Ionicons name="ban-outline" size={20} color={colors.danger} />
          <Text style={[styles.blockedText, { color: colors.danger }]}>
            This friend is blocked. Unblock in Friend Settings to chat.
          </Text>
        </View>
      ) : (
        <View
          style={[
            styles.composerBar,
            {
              backgroundColor: colors.card,
              borderTopColor: colors.border,
              borderTopWidth: 1,
              paddingBottom: isKeyboardVisible
                ? 8
                : Math.max(insets.bottom, 8),
            },
          ]}
        >
        <View
          style={[
            styles.inputBox,
            {
              backgroundColor: colors.inputBackground,
              borderColor: colors.border,
              borderWidth: 1,
            },
          ]}
        >
          {/* Attachment Paperclip 📎 */}
          <TouchableOpacity
            style={styles.composerIconBtn}
            onPress={() => setAttachmentModalVisible(true)}
          >
            <Ionicons name="attach" size={24} color={colors.textSecondary} />
          </TouchableOpacity>

          <TextInput
            style={[styles.textInputField, { color: colors.text }]}
            placeholder="Type a message..."
            placeholderTextColor={colors.textMuted}
            value={inputText}
            onChangeText={setInputText}
            onFocus={() => {
              setTimeout(() => {
                flatListRef.current?.scrollToEnd({ animated: true });
              }, 120);
            }}
            multiline
          />

          {/* Camera Button 📷 */}
          <TouchableOpacity style={styles.composerIconBtn} onPress={handleTakePhoto}>
            <Ionicons name="camera" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Send / Action Button */}
        <TouchableOpacity
          style={[
            styles.sendCircleBtn,
            { backgroundColor: colors.primary },
          ]}
          onPress={inputText.trim() ? handleSendText : handleTakePhoto}
        >
          <Ionicons
            name={inputText.trim() ? 'send' : 'mic'}
            size={20}
            color="#FFFFFF"
            style={{ marginLeft: inputText.trim() ? 2 : 0 }}
          />
        </TouchableOpacity>
      </View>
      )}

      {/* Link Guest Friend with Phone Contact Modal (Paginated by 10) */}
      {linkContactModalVisible && (
      <Modal
        visible={linkContactModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setLinkContactModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.linkModalOverlay}
        >
          <View
            style={[
              styles.linkModalContent,
              { backgroundColor: colors.card, borderTopColor: colors.border },
            ]}
          >
            <View style={styles.linkModalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.linkModalTitle, { color: colors.text }]}>
                  Link "{displayTitle}" with Contact
                </Text>
                <Text style={[styles.linkModalSubtitle, { color: colors.textSecondary }]}>
                  Select a phone contact to link all splits, balances & chat history.
                </Text>
              </View>
              <TouchableOpacity
                style={styles.linkModalCloseBtn}
                onPress={() => setLinkContactModalVisible(false)}
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Search Contacts */}
            <View
              style={[
                styles.linkSearchBox,
                { backgroundColor: colors.inputBackground, borderColor: colors.border },
              ]}
            >
              <Ionicons name="search" size={18} color={colors.textMuted} />
              <TextInput
                style={[styles.linkSearchInput, { color: colors.text }]}
                placeholder="Search phone contacts by name or number..."
                placeholderTextColor={colors.textMuted}
                value={linkSearchQuery}
                onChangeText={setLinkSearchQuery}
              />
              {linkSearchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setLinkSearchQuery('')}>
                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            {contactsLoading || linkingInProgress ? (
              <View style={styles.linkLoadingBox}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[styles.linkLoadingText, { color: colors.textSecondary }]}>
                  {linkingInProgress
                    ? 'Linking guest with selected contact...'
                    : 'Loading phone contacts...'}
                </Text>
              </View>
            ) : (
              <FlatList
                data={paginatedLinkContacts}
                keyExtractor={item => item.id}
                style={{ maxHeight: 380 }}
                onEndReached={handleLoadMoreLinkContacts}
                onEndReachedThreshold={0.3}
                ListEmptyComponent={
                  <View style={styles.linkEmptyBox}>
                    <Ionicons name="people-outline" size={38} color={colors.textMuted} />
                    <Text style={[styles.linkEmptyText, { color: colors.textSecondary }]}>
                      No phone contacts found.
                    </Text>
                    <TouchableOpacity
                      style={[styles.reloadContactsBtn, { backgroundColor: colors.primary }]}
                      onPress={() => initContacts()}
                    >
                      <Ionicons name="refresh" size={15} color="#FFFFFF" />
                      <Text style={styles.reloadContactsBtnText}>Reload Phone Contacts</Text>
                    </TouchableOpacity>
                  </View>
                }
                ListFooterComponent={
                  linkVisibleCount < phoneContactsToLink.length ? (
                    <View style={styles.linkPaginationFooter}>
                      {loadingMoreLinkContacts ? (
                        <View style={styles.loadEarlierRow}>
                          <ActivityIndicator size="small" color={colors.primary} />
                          <Text style={[styles.loadEarlierText, { color: colors.textSecondary }]}>
                            Loading more contacts...
                          </Text>
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={[
                            styles.loadEarlierBtn,
                            { backgroundColor: colors.inputBackground, borderColor: colors.border },
                          ]}
                          onPress={handleLoadMoreLinkContacts}
                        >
                          <Text style={[styles.loadEarlierBtnText, { color: colors.primary }]}>
                            Load More Contacts ({paginatedLinkContacts.length} of {phoneContactsToLink.length})
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ) : phoneContactsToLink.length > 0 ? (
                    <View style={styles.linkPaginationFooter}>
                      <Text style={{ fontSize: 11, color: colors.textMuted }}>
                        Showing all {phoneContactsToLink.length} contacts
                      </Text>
                    </View>
                  ) : null
                }
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[
                      styles.linkContactRow,
                      { borderBottomColor: colors.borderLight },
                    ]}
                    onPress={() => handleLinkFriendToContact(item)}
                  >
                    <View
                      style={[
                        styles.linkContactAvatar,
                        {
                          backgroundColor: item.isRegistered
                            ? colors.primaryLight
                            : colors.cardSecondary,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.linkContactAvatarText,
                          {
                            color: item.isRegistered ? colors.primary : colors.textSecondary,
                          },
                        ]}
                      >
                        {item.name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.linkContactName, { color: colors.text }]}>
                        {item.name}
                      </Text>
                      <Text style={[styles.linkContactPhone, { color: colors.textSecondary }]}>
                        {item.phoneNumber || 'No number'}
                      </Text>
                    </View>
                    <View style={[styles.linkSelectPill, { backgroundColor: colors.primary }]}>
                      <Ionicons name="link" size={13} color="#FFFFFF" />
                      <Text style={styles.linkSelectPillText}>Link</Text>
                    </View>
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
      )}

      {/* WhatsApp Attachment Menu Sheet */}
      {attachmentModalVisible && (
      <Modal
        visible={attachmentModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAttachmentModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.attachmentOverlay}
          activeOpacity={1}
          onPress={() => setAttachmentModalVisible(false)}
        >
          <View
            style={[
              styles.attachmentSheet,
              { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 },
            ]}
          >
            <Text style={[styles.attachmentHeader, { color: colors.textSecondary }]}>
              SHARE TO CHAT
            </Text>

            <View style={styles.attachmentGrid}>
              {/* Document */}
              <TouchableOpacity style={styles.attachmentItem} onPress={handlePickDocument}>
                <View style={[styles.attachCircle, { backgroundColor: colors.primaryLight }]}>
                  <Ionicons name="document-text" size={24} color={colors.primary} />
                </View>
                <Text style={[styles.attachLabel, { color: colors.text }]}>Document</Text>
              </TouchableOpacity>

              {/* Camera */}
              <TouchableOpacity style={styles.attachmentItem} onPress={handleTakePhoto}>
                <View style={[styles.attachCircle, { backgroundColor: isDark ? 'rgba(56, 189, 248, 0.18)' : '#E0F2FE' }]}>
                  <Ionicons name="camera" size={24} color={colors.secondary} />
                </View>
                <Text style={[styles.attachLabel, { color: colors.text }]}>Camera</Text>
              </TouchableOpacity>

              {/* Gallery */}
              <TouchableOpacity style={styles.attachmentItem} onPress={handlePickImage}>
                <View style={[styles.attachCircle, { backgroundColor: colors.primaryLight }]}>
                  <Ionicons name="images" size={24} color={colors.primary} />
                </View>
                <Text style={[styles.attachLabel, { color: colors.text }]}>Gallery</Text>
              </TouchableOpacity>

              {/* Add Expense */}
              <TouchableOpacity
                style={styles.attachmentItem}
                onPress={() => {
                  setAttachmentModalVisible(false);
                  setTimeout(() => {
                    if (onAddExpense) onAddExpense();
                    else router.push(`/trip/${tripId}/add`);
                  }, 120);
                }}
              >
                <View style={[styles.attachCircle, { backgroundColor: colors.successBg }]}>
                  <Ionicons name="receipt" size={24} color={colors.success} />
                </View>
                <Text style={[styles.attachLabel, { color: colors.text }]}>Split Bill</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
      )}

      {/* Photo Full-Screen Modal Preview */}
      {Boolean(selectedPhotoPreview) && (
      <Modal
        visible={Boolean(selectedPhotoPreview)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedPhotoPreview(null)}
      >
        <View style={styles.photoPreviewOverlay}>
          <TouchableOpacity
            style={[styles.photoCloseBtn, { top: Math.max(insets.top, 24) + 16 }]}
            onPress={() => setSelectedPhotoPreview(null)}
          >
            <Ionicons name="close-circle" size={32} color="#FFFFFF" />
          </TouchableOpacity>
          {selectedPhotoPreview && (
            <Image
              source={{ uri: selectedPhotoPreview }}
              style={styles.fullScreenPhoto}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>
      )}

      {/* Three-Dots Options Sidebar Drawer (for both Trip Chat and Normal Friend Chat) */}
      {optionsSidebarVisible && (
        <Modal
          visible={optionsSidebarVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setOptionsSidebarVisible(false)}
        >
          <View style={styles.sidebarOverlay}>
            <TouchableOpacity
              style={styles.sidebarBackdrop}
              activeOpacity={1}
              onPress={() => setOptionsSidebarVisible(false)}
            />

            <View
              style={[
                styles.sidebarDrawer,
                {
                  backgroundColor: colors.card,
                  borderLeftColor: colors.border,
                },
              ]}
            >
              {/* Sidebar Top Header */}
              <View
                style={[
                  styles.sidebarHeader,
                  {
                    backgroundColor: colors.card,
                    borderBottomColor: colors.border,
                    borderBottomWidth: 1,
                    paddingTop: Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 44) + 6,
                  },
                ]}
              >
                <View style={styles.sidebarHeaderTopRow}>
                  <View style={[styles.sidebarAvatar, { backgroundColor: colors.primaryLight }]}>
                    {isGroup ? (
                      <Ionicons name="airplane" size={22} color={colors.primary} />
                    ) : currentFriendAvatarUrl ? (
                      <Image
                        source={{ uri: currentFriendAvatarUrl }}
                        style={{ width: '100%', height: '100%' }}
                        resizeMode="cover"
                      />
                    ) : (
                      <Text style={[styles.headerAvatarText, { color: colors.primary }]}>
                        {avatarText || displayTitle.charAt(0).toUpperCase()}
                      </Text>
                    )}
                  </View>

                  <TouchableOpacity
                    style={[styles.sidebarCloseBtn, { backgroundColor: colors.cardSecondary }]}
                    onPress={() => setOptionsSidebarVisible(false)}
                  >
                    <Ionicons name="close" size={22} color={colors.text} />
                  </TouchableOpacity>
                </View>

                <Text style={[styles.sidebarTitle, { color: colors.text }]} numberOfLines={1}>
                  {displayTitle}
                </Text>
                <Text style={[styles.sidebarSubtitle, { color: colors.textSecondary }]} numberOfLines={2}>
                  {effectiveSubtitle}
                </Text>
              </View>

              {/* Sidebar Menu Items */}
              <View style={[styles.sidebarBody, { paddingBottom: Math.max(insets.bottom, 20) + 16 }]}>
                <Text style={[styles.sidebarSectionLabel, { color: colors.textMuted }]}>
                  TABS & OVERVIEW
                </Text>

                {/* 1. Expenses Tab */}
                <TouchableOpacity
                  style={[styles.sidebarMenuItem, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    setOptionsSidebarVisible(false);
                    setTimeout(() => {
                      router.push({
                        pathname: '/trip/[id]/info',
                        params: { id: tripId, tab: 'expenses' },
                      });
                    }, 80);
                  }}
                >
                  <View style={[styles.sidebarIconBox, { backgroundColor: colors.primaryLight }]}>
                    <Ionicons name="receipt-outline" size={19} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sidebarMenuTitle, { color: colors.text }]}>
                      Expenses
                    </Text>
                    <Text style={[styles.sidebarMenuSub, { color: colors.textSecondary }]}>
                      {tripExpenses.length} {tripExpenses.length === 1 ? 'bill' : 'bills'} • Total{' '}
                      {formatCurrencyAmount(totalGroupSpendPaise, currentTrip?.currency)}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>

                {/* 2. Members Tab */}
                <TouchableOpacity
                  style={[styles.sidebarMenuItem, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    setOptionsSidebarVisible(false);
                    setTimeout(() => {
                      router.push({
                        pathname: '/trip/[id]/info',
                        params: { id: tripId, tab: 'members' },
                      });
                    }, 80);
                  }}
                >
                  <View style={[styles.sidebarIconBox, { backgroundColor: colors.successBg }]}>
                    <Ionicons name="people-outline" size={19} color={colors.success} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sidebarMenuTitle, { color: colors.text }]}>
                      Members
                    </Text>
                    <Text style={[styles.sidebarMenuSub, { color: colors.textSecondary }]}>
                      {tripMembers.length} {tripMembers.length === 1 ? 'member' : 'members'} in chat
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>

                {/* 3. Balances Tab */}
                <TouchableOpacity
                  style={[styles.sidebarMenuItem, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    setOptionsSidebarVisible(false);
                    setTimeout(() => {
                      router.push({
                        pathname: '/trip/[id]/info',
                        params: { id: tripId, tab: 'balances' },
                      });
                    }, 80);
                  }}
                >
                  <View style={[styles.sidebarIconBox, { backgroundColor: colors.warningBg }]}>
                    <Ionicons name="wallet-outline" size={19} color={colors.warning} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sidebarMenuTitle, { color: colors.text }]}>
                      Balances
                    </Text>
                    <Text style={[styles.sidebarMenuSub, { color: colors.textSecondary }]}>
                      Member-wise paid & share breakdown
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>

                {/* 4. Settle Up Tab */}
                <TouchableOpacity
                  style={[styles.sidebarMenuItem, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    setOptionsSidebarVisible(false);
                    setTimeout(() => {
                      router.push({
                        pathname: '/trip/[id]/info',
                        params: { id: tripId, tab: 'settle' },
                      });
                    }, 80);
                  }}
                >
                  <View style={[styles.sidebarIconBox, { backgroundColor: colors.dangerBg }]}>
                    <Ionicons name="cash-outline" size={19} color={colors.danger} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sidebarMenuTitle, { color: colors.text }]}>
                      Settle Up
                    </Text>
                    <Text style={[styles.sidebarMenuSub, { color: colors.textSecondary }]}>
                      Pay via UPI & share WhatsApp summary
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>

                <Text
                  style={[
                    styles.sidebarSectionLabel,
                    { color: colors.textMuted, marginTop: 18 },
                  ]}
                >
                  ACTIONS & SETTINGS
                </Text>

                {/* 5. Add Expense / Split Bill */}
                <TouchableOpacity
                  style={[styles.sidebarMenuItem, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    setOptionsSidebarVisible(false);
                    setTimeout(() => {
                      if (onAddExpense) onAddExpense();
                      else router.push(`/trip/${tripId}/add`);
                    }, 80);
                  }}
                >
                  <View style={[styles.sidebarIconBox, { backgroundColor: colors.primaryLight }]}>
                    <Ionicons name="add-circle-outline" size={19} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sidebarMenuTitle, { color: colors.text }]}>
                      Add Expense / Split Bill
                    </Text>
                    <Text style={[styles.sidebarMenuSub, { color: colors.textSecondary }]}>
                      Log a new bill in {displayTitle}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>

                {/* 6. Link Guest Contact (if 1-on-1 unlinked guest) */}
                {!isGroup && isGuestFriend && (
                  <TouchableOpacity
                    style={[styles.sidebarMenuItem, { borderBottomColor: colors.border }]}
                    onPress={() => {
                      setOptionsSidebarVisible(false);
                      setTimeout(() => {
                        openLinkContactModal();
                      }, 120);
                    }}
                  >
                    <View style={[styles.sidebarIconBox, { backgroundColor: colors.warningBg }]}>
                      <Ionicons name="person-add-outline" size={19} color={colors.warning} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.sidebarMenuTitle, { color: colors.text }]}>
                        Link with Phone Contact
                      </Text>
                      <Text style={[styles.sidebarMenuSub, { color: colors.textSecondary }]}>
                        Connect guest friend to phone number
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                )}

                {/* 7. Settings (Trip Settings vs Friend Settings) */}
                {isGroup ? (
                  <TouchableOpacity
                    style={[styles.sidebarMenuItem, { borderBottomColor: colors.border }]}
                    onPress={() => {
                      setOptionsSidebarVisible(false);
                      setTimeout(() => {
                        router.push(`/trip/${tripId}/settings`);
                      }, 80);
                    }}
                  >
                    <View style={[styles.sidebarIconBox, { backgroundColor: colors.primaryLight }]}>
                      <Ionicons name="settings-outline" size={19} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.sidebarMenuTitle, { color: colors.text }]}>
                        Trip Settings
                      </Text>
                      <Text style={[styles.sidebarMenuSub, { color: colors.textSecondary }]}>
                        Cover photo, members, currency & options
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.sidebarMenuItem, { borderBottomColor: colors.border }]}
                    onPress={() => {
                      setOptionsSidebarVisible(false);
                      setTimeout(() => {
                        router.push({
                          pathname: '/chat/[id]/settings',
                          params: {
                            id: tripId,
                            friendName: displayTitle,
                            friendPhone: displayPhone,
                            friendId,
                          },
                        });
                      }, 80);
                    }}
                  >
                    <View style={[styles.sidebarIconBox, { backgroundColor: colors.primaryLight }]}>
                      <Ionicons name="person-circle-outline" size={19} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.sidebarMenuTitle, { color: colors.text }]}>
                        Friend Settings
                      </Text>
                      <Text style={[styles.sidebarMenuSub, { color: colors.textSecondary }]}>
                        Block contact, custom nickname, mute & options
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        </Modal>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 54 : 16,
    paddingBottom: 12,
    paddingHorizontal: 12,
  },
  headerBackBtn: {
    padding: 6,
    marginRight: 4,
  },
  headerIdentityRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 6,
  },
  headerAvatar: {
    width: moderateScale(38),
    height: moderateScale(38),
    borderRadius: moderateScale(19),
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: moderateScale(10),
  },
  headerAvatarText: {
    fontSize: scaleFont(16),
    fontWeight: '800',
  },
  headerTitleCol: {
    flex: 1,
  },
  sidebarOverlay: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  sidebarBackdrop: {
    flex: 1,
  },
  sidebarDrawer: {
    width: '82%',
    maxWidth: 340,
    height: '100%',
    borderLeftWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 16,
  },
  sidebarHeader: {
    paddingTop: Platform.OS === 'ios' ? 56 : 24,
    paddingBottom: moderateScale(18),
    paddingHorizontal: moderateScale(18),
  },
  sidebarHeaderTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: moderateScale(12),
  },
  sidebarAvatar: {
    width: moderateScale(48),
    height: moderateScale(48),
    borderRadius: moderateScale(24),
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarCloseBtn: {
    width: moderateScale(34),
    height: moderateScale(34),
    borderRadius: moderateScale(17),
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarTitle: {
    fontSize: scaleFont(18),
    fontWeight: '800',
  },
  sidebarSubtitle: {
    fontSize: scaleFont(12),
    marginTop: 4,
    lineHeight: scaleFont(17),
  },
  sidebarBody: {
    flex: 1,
    paddingHorizontal: moderateScale(16),
    paddingTop: moderateScale(16),
  },
  sidebarSectionLabel: {
    fontSize: scaleFont(11),
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sidebarMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: moderateScale(12),
    borderBottomWidth: 1,
    gap: moderateScale(12),
  },
  sidebarIconBox: {
    width: moderateScale(38),
    height: moderateScale(38),
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarMenuTitle: {
    fontSize: scaleFont(14),
    fontWeight: '700',
  },
  sidebarMenuSub: {
    fontSize: scaleFont(11),
    marginTop: 2,
  },
  headerTitleText: {
    fontSize: scaleFont(16),
    fontWeight: '700',
    color: '#FFFFFF',
    flexShrink: 1,
  },
  guestHeaderPill: {
    backgroundColor: 'rgba(245, 158, 11, 0.35)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  guestHeaderPillText: {
    fontSize: scaleFont(9),
    fontWeight: '800',
    color: '#FEF3C7',
  },
  headerSubtitleText: {
    fontSize: scaleFont(12),
    color: 'rgba(255,255,255,0.75)',
    marginTop: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  linkHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: moderateScale(9),
    paddingVertical: moderateScale(5),
    borderRadius: 12,
    gap: 4,
  },
  linkHeaderBtnText: {
    color: '#FFFFFF',
    fontSize: scaleFont(11),
    fontWeight: '700',
  },
  headerIconBtn: {
    padding: 6,
  },
  guestLinkBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: moderateScale(14),
    paddingVertical: moderateScale(8),
    borderBottomWidth: 1,
    gap: 10,
  },
  guestLinkBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  guestLinkBannerText: {
    fontSize: scaleFont(12),
    fontWeight: '600',
    flex: 1,
    lineHeight: scaleFont(16),
  },
  guestLinkActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: moderateScale(10),
    paddingVertical: moderateScale(6),
    borderRadius: 12,
    gap: 4,
  },
  guestLinkActionText: {
    color: '#FFFFFF',
    fontSize: scaleFont(11),
    fontWeight: '700',
  },
  balanceBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: moderateScale(14),
    paddingVertical: moderateScale(10),
    borderBottomWidth: 1,
  },
  balanceBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  balanceBannerIcon: {
    width: moderateScale(34),
    height: moderateScale(34),
    borderRadius: moderateScale(17),
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: moderateScale(10),
  },
  balanceBannerTitle: {
    fontSize: scaleFont(14),
    fontWeight: '800',
  },
  balanceBannerSub: {
    fontSize: scaleFont(11),
    marginTop: 1,
    fontWeight: '500',
  },
  balanceBannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  payNowMiniBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: moderateScale(10),
    paddingVertical: moderateScale(6),
    borderRadius: 14,
    gap: 4,
  },
  payNowMiniText: {
    color: '#FFFFFF',
    fontSize: scaleFont(12),
    fontWeight: '700',
  },
  addSplitMiniBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: moderateScale(10),
    paddingVertical: moderateScale(6),
    borderRadius: 14,
    gap: 3,
  },
  addSplitMiniText: {
    color: '#FFFFFF',
    fontSize: scaleFont(12),
    fontWeight: '700',
  },
  syncingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    gap: 8,
  },
  syncingText: {
    fontSize: scaleFont(12),
    fontWeight: '600',
  },
  loadEarlierContainer: {
    alignItems: 'center',
    marginBottom: 12,
  },
  loadEarlierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    gap: 8,
  },
  loadEarlierText: {
    fontSize: scaleFont(12),
    fontWeight: '600',
  },
  loadEarlierBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: moderateScale(14),
    paddingVertical: moderateScale(8),
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
  },
  loadEarlierBtnText: {
    fontSize: scaleFont(12),
    fontWeight: '700',
  },
  expenseTripBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  expenseTripBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    gap: 4,
  },
  expenseTripBadgeText: {
    fontSize: scaleFont(11),
    fontWeight: '700',
  },
  expenseImpactText: {
    fontSize: scaleFont(12),
    fontWeight: '800',
  },
  messagesList: {
    paddingHorizontal: moderateScale(12),
    paddingVertical: moderateScale(14),
  },
  chatLoadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 40,
  },
  chatLoadingText: {
    fontSize: scaleFont(14),
    fontWeight: '500',
    marginTop: 12,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 40,
    paddingHorizontal: 20,
  },
  encryptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginBottom: 16,
    gap: 8,
    maxWidth: '92%',
  },
  encryptionText: {
    fontSize: scaleFont(11),
    textAlign: 'center',
    lineHeight: scaleFont(16),
  },
  emptySubtitle: {
    fontSize: scaleFont(13),
    marginTop: 8,
  },
  bubbleContainer: {
    marginVertical: 3,
    maxWidth: '82%',
  },
  bubbleRight: {
    alignSelf: 'flex-end',
  },
  bubbleLeft: {
    alignSelf: 'flex-start',
  },
  textBubble: {
    borderRadius: 12,
    paddingHorizontal: moderateScale(12),
    paddingTop: moderateScale(8),
    paddingBottom: moderateScale(6),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  senderNameHeader: {
    fontSize: scaleFont(12),
    fontWeight: '700',
    marginBottom: 2,
  },
  messageText: {
    fontSize: scaleFont(15),
    lineHeight: scaleFont(20),
  },
  bubbleMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  timestampText: {
    fontSize: scaleFont(10),
  },
  imageBubble: {
    borderRadius: 14,
    overflow: 'hidden',
    padding: 3,
  },
  messageImage: {
    width: moderateScale(240),
    height: moderateScale(180),
    borderRadius: 12,
  },
  imageCaption: {
    fontSize: scaleFont(14),
    paddingHorizontal: 6,
    paddingTop: 6,
  },
  docBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 10,
    minWidth: moderateScale(200),
  },
  docIconBox: {
    width: moderateScale(36),
    height: moderateScale(36),
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docName: {
    fontSize: scaleFont(14),
    fontWeight: '700',
  },
  docSize: {
    fontSize: scaleFont(11),
    marginTop: 2,
  },
  docMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'absolute',
    right: 8,
    bottom: 4,
  },
  expenseCardContainer: {
    marginVertical: 8,
    alignItems: 'center',
    width: '100%',
  },
  expenseCard: {
    width: '94%',
    borderRadius: 16,
    borderWidth: 1,
    padding: moderateScale(14),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  expenseCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: moderateScale(12),
  },
  expenseIconBox: {
    width: moderateScale(42),
    height: moderateScale(42),
    borderRadius: moderateScale(21),
    alignItems: 'center',
    justifyContent: 'center',
  },
  expenseCardTitle: {
    fontSize: scaleFont(15),
    fontWeight: '700',
  },
  expenseCardSubtitle: {
    fontSize: scaleFont(12),
    marginTop: 2,
  },
  expenseCardAmount: {
    fontSize: scaleFont(17),
    fontWeight: '800',
  },
  expenseCardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  expenseTime: {
    fontSize: scaleFont(11),
  },
  viewExpenseBtn: {
    paddingHorizontal: moderateScale(12),
    paddingVertical: 5,
    borderRadius: 12,
  },
  viewExpenseText: {
    color: '#FFFFFF',
    fontSize: scaleFont(12),
    fontWeight: '700',
  },
  blockedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: moderateScale(14),
    paddingHorizontal: moderateScale(16),
    gap: 10,
    borderTopWidth: 1,
  },
  blockedText: {
    fontSize: scaleFont(13),
    fontWeight: '600',
    textAlign: 'center',
    flex: 1,
  },
  composerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: moderateScale(8),
    paddingTop: 8,
    paddingBottom: 8,
  },
  inputBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 24,
    paddingHorizontal: moderateScale(10),
    minHeight: moderateScale(46),
    maxHeight: 120,
    marginRight: 6,
  },
  composerIconBtn: {
    padding: 6,
  },
  textInputField: {
    flex: 1,
    fontSize: scaleFont(15),
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  sendCircleBtn: {
    width: moderateScale(46),
    height: moderateScale(46),
    borderRadius: moderateScale(23),
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
  },
  linkModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  linkModalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 34,
    borderTopWidth: 1,
    maxHeight: '82%',
  },
  linkModalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  linkModalTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  linkModalSubtitle: {
    fontSize: 12,
    marginTop: 3,
  },
  linkModalCloseBtn: {
    padding: 4,
  },
  linkSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 12,
    gap: 8,
  },
  linkSearchInput: {
    flex: 1,
    fontSize: 14,
  },
  linkLoadingBox: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 10,
  },
  linkLoadingText: {
    fontSize: 13,
    fontWeight: '600',
  },
  linkEmptyBox: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 10,
  },
  linkEmptyText: {
    fontSize: 13,
  },
  reloadContactsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 6,
    marginTop: 4,
  },
  reloadContactsBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  linkPaginationFooter: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  linkContactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    borderBottomWidth: 1,
    gap: 12,
  },
  linkContactAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkContactAvatarText: {
    fontSize: 15,
    fontWeight: '700',
  },
  linkContactName: {
    fontSize: 14,
    fontWeight: '700',
  },
  linkContactPhone: {
    fontSize: 12,
    marginTop: 2,
  },
  linkSelectPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 4,
  },
  linkSelectPillText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  attachmentOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
    paddingBottom: 70,
  },
  attachmentSheet: {
    marginHorizontal: 16,
    borderRadius: 20,
    padding: 20,
    elevation: 10,
  },
  attachmentHeader: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 16,
    textAlign: 'center',
  },
  attachmentGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  attachmentItem: {
    alignItems: 'center',
  },
  attachCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    elevation: 4,
  },
  attachLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  photoPreviewOverlay: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoCloseBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
  },
  fullScreenPhoto: {
    width: '100%',
    height: '85%',
  },
});
