import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ScrollView,
  Modal,
  TextInput,
  Share,
  Linking,
  ActivityIndicator,
  Keyboard,
  Platform,
  Image,
  StatusBar,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Contacts from 'expo-contacts/legacy';
import {
  useTripStore,
  normalizeExpensesForTrip,
  computeBalances,
  findMyMember,
} from '../../../src/features/trips/useTripStore';
import { useAuthStore } from '../../../src/features/auth/useAuthStore';
import {
  useContactsStore,
  normalizePhone,
} from '../../../src/features/contacts/useContactsStore';
import { AppStorage } from '../../../src/lib/storage';
import { generateSettlementWhatsAppMessage } from '../../../src/services/shareMessage';
import { calculateSettlement } from '../../../src/services/settle';
import { formatCurrencyAmount } from '../../../src/services/currency';
import { theme } from '../../../src/theme/colors';
import { useTheme } from '../../../src/theme/useThemeStore';

type InfoTabKey = 'expenses' | 'members' | 'balances' | 'settle';

const PAGE_SIZE = 10;

export default function TripInfoScreen() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { user, profile } = useAuthStore();
  const currentUserPhone =
    profile?.phone_number || (user as any)?.phone || (user as any)?.user_metadata?.phone_number;
  const {
    trips,
    members: rawMembers,
    expenses: rawExpenses,
    balances: rawBalances,
    isLoading: tripStoreLoading,
    loadTripDetails,
    addMember,
    linkGuestWithContact,
    findContactByPhone,
    searchRegisteredUsers,
    generateInviteCode,
  } = useTripStore();
  const {
    contacts: storeContacts,
    isLoading: contactsStoreLoading,
    initContacts,
  } = useContactsStore();

  const initialTab: InfoTabKey =
    tab === 'expenses' || tab === 'balances' || tab === 'settle' || tab === 'members'
      ? (tab as InfoTabKey)
      : 'expenses';
  const [activeTab, setActiveTab] = useState<InfoTabKey>(initialTab);

  // Filter for this trip (safely match even if trip_id is missing or matches id)
  const members = React.useMemo(
    () => rawMembers.filter(m => !m.trip_id || m.trip_id === id),
    [rawMembers, id]
  );
  const expenses = React.useMemo(
    () => rawExpenses.filter(e => !e.trip_id || e.trip_id === id),
    [rawExpenses, id]
  );
  const balances = React.useMemo(
    () => rawBalances.filter(b => !b.trip_id || b.trip_id === id),
    [rawBalances, id]
  );

  // Modals & Member search states
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [optionsSidebarOpen, setOptionsSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [registeredUsers, setRegisteredUsers] = useState<
    Array<{ id: string; full_name: string; phone_number: string | null; avatar_url: string | null }>
  >([]);
  const [deviceContacts, setDeviceContacts] = useState<
    Array<{ id: string; name: string; phoneNumber?: string; profileId?: string; isRegistered?: boolean }>
  >([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [guestNameInput, setGuestNameInput] = useState('');
  const [manualPhone, setManualPhone] = useState('');
  const [addingGuestSuccess, setAddingGuestSuccess] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Record<string, boolean>>({});
  const [addingMemberId, setAddingMemberId] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);

  // Navigation lock & active action state
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const navLockRef = React.useRef(false);

  const runGuardedNav = (_actionId: string, fn: () => void) => {
    fn();
  };

  // Pagination states (compulsory page size 10)
  const [expensesVisibleCount, setExpensesVisibleCount] = useState(PAGE_SIZE);
  const [expensesLoadingMore, setExpensesLoadingMore] = useState(false);
  const [membersVisibleCount, setMembersVisibleCount] = useState(PAGE_SIZE);
  const [membersLoadingMore, setMembersLoadingMore] = useState(false);
  const [balancesVisibleCount, setBalancesVisibleCount] = useState(PAGE_SIZE);
  const [settleVisibleCount, setSettleVisibleCount] = useState(PAGE_SIZE);
  const [contactsVisibleCount, setContactsVisibleCount] = useState(PAGE_SIZE);
  const [contactsLoadingMore, setContactsLoadingMore] = useState(false);
  const [regUsersVisibleCount, setRegUsersVisibleCount] = useState(PAGE_SIZE);

  // Link Guest Member with Contact Modal
  const [linkingGuestMember, setLinkingGuestMember] = useState<{ id: string; name: string } | null>(null);
  const [linkContactSearch, setLinkContactSearch] = useState('');
  const [linkContactsVisibleCount, setLinkContactsVisibleCount] = useState(PAGE_SIZE);
  const [linkingContactId, setLinkingContactId] = useState<string | null>(null);
  const [linkDbResult, setLinkDbResult] = useState<{ profileId?: string; name: string; phoneNumber?: string; isAppUser: boolean } | null>(null);

  useEffect(() => {
    const raw = linkContactSearch.trim();
    const digits = raw.replace(/[^0-9]/g, '');
    if (digits.length >= 10) {
      let isCurrent = true;
      findContactByPhone(raw).then(res => {
        if (isCurrent) setLinkDbResult(res);
      });
      return () => {
        isCurrent = false;
      };
    } else {
      setLinkDbResult(null);
    }
  }, [linkContactSearch]);

  const trip = trips.find(t => t.id === id) || {
    id: id || '',
    name: 'Trip Info',
    status: 'active',
    currency: 'INR',
    created_by: user?.id || '',
    created_at: new Date().toISOString(),
  };

  useEffect(() => {
    if (id) {
      loadTripDetails(id);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      navLockRef.current = false;
      setActiveActionId(null);
      if (tab === 'expenses' || tab === 'balances' || tab === 'settle' || tab === 'members') {
        setActiveTab(tab as InfoTabKey);
      }
      if (id) {
        loadTripDetails(id);
      }
    }, [id, tab, loadTripDetails])
  );

  useEffect(() => {
    if (id) {
      generateInviteCode(id, user?.id || 'local_user').then(code => setInviteCode(code));
    }
  }, [id, user?.id]);

  // Settlement calculations
  const netBalancesRecord: Record<string, number> = {};
  balances.forEach(b => {
    netBalancesRecord[b.member_id] = b.net_balance;
  });
  const settlements = calculateSettlement(netBalancesRecord);

  const memberNamesMap: Record<string, string> = {};
  members.forEach(m => {
    memberNamesMap[m.id] = m.display_name;
  });

  const totalSpentPaise = expenses.reduce((sum, e) => sum + e.amount, 0);

  // Friend Split Detection & Cross-Trip Shared Data Integration
  const isFriendSplit =
    trip.trip_type === 'friend_split' ||
    Boolean((trip as any).is_friend_split) ||
    trip.name.toLowerCase().startsWith('split with ');

  const cleanFriendName = isFriendSplit
    ? trip.name.replace(/^split with\s+/i, '').trim() || 'Friend'
    : trip.name;

  const [friendSharedExpenses, setFriendSharedExpenses] = useState<any[]>([]);
  const [friendNetPaise, setFriendNetPaise] = useState<number>(0);
  const [friendMemberObj, setFriendMemberObj] = useState<any>(null);
  const [friendBreakdownTrips, setFriendBreakdownTrips] = useState<string[]>([]);
  const [friendSplitLoading, setFriendSplitLoading] = useState(false);

  const loadFriendSplitData = useCallback(async () => {
    if (!isFriendSplit) return;
    setFriendSplitLoading(true);

    try {
      const allTrips = useTripStore.getState().trips;
      const contactsList = storeContacts;
      const cleanName = cleanFriendName.toLowerCase();

      // Find any phone from direct members or matched contacts
      const tripFriendMember = members.find(
        m => m.display_name.trim().toLowerCase() === cleanName || m.role !== 'admin'
      );
      const friendPhone = tripFriendMember?.phone_number || '';
      const cleanFriendPhone = normalizePhone(friendPhone);

      const matchedContact = contactsList.find(
        c =>
          (cleanFriendPhone && c.cleanPhone === cleanFriendPhone) ||
          c.name.trim().toLowerCase() === cleanName
      );
      const targetProfileId = matchedContact?.profileId || tripFriendMember?.profile_id;
      const targetPhone = cleanFriendPhone || matchedContact?.cleanPhone || '';

      let totalNet = 0;
      const collectedExpenses: any[] = [];
      const breakdownLabels: string[] = [];
      let foundFriendObj: any = tripFriendMember || null;

      for (const t of allTrips) {
        let tMembers: any[] = [];
        let tExpenses: any[] = [];

        try {
          const raw = await AppStorage.getItem(`@splityourtrip_local_details_${t.id}`);
          if (raw) {
            const parsed = JSON.parse(raw);
            tMembers = Array.isArray(parsed.members) ? parsed.members : [];
            tExpenses = Array.isArray(parsed.expenses) ? parsed.expenses : [];
          }
        } catch {}

        if (tMembers.length === 0 && t.id === id) {
          tMembers = members;
        }
        if (tExpenses.length === 0 && t.id === id) {
          tExpenses = expenses;
        }

        if (tMembers.length === 0) continue;

        const myMember = findMyMember(tMembers, user?.id, currentUserPhone) || tMembers[0];

        const isDirectFriendTrip =
          t.id === id ||
          (t.trip_type === 'friend_split' &&
            t.name.toLowerCase() === `split with ${cleanName}`);

        const fMember = tMembers.find(m => {
          if (m.id === myMember?.id) return false;
          if (isDirectFriendTrip && tMembers.length === 2) return true;
          if (targetProfileId && m.profile_id === targetProfileId) return true;
          if (targetPhone && normalizePhone(m.phone_number) === targetPhone) return true;
          return m.display_name.trim().toLowerCase() === cleanName;
        });

        if (!fMember || !myMember) continue;
        if (!foundFriendObj) foundFriendObj = fMember;

        const normalizedExps = normalizeExpensesForTrip(tExpenses, tMembers);
        const tBalances = computeBalances(t.id, tMembers, normalizedExps);
        const netRecord: Record<string, number> = {};
        tBalances.forEach(b => {
          netRecord[b.member_id] = b.net_balance;
        });
        const tripSettlements = calculateSettlement(netRecord);

        let tripNetWithFriend = 0;
        for (const s of tripSettlements) {
          if (s.from === fMember.id && s.to === myMember.id) {
            tripNetWithFriend += Number(s.amount) || 0;
          } else if (s.from === myMember.id && s.to === fMember.id) {
            tripNetWithFriend -= Number(s.amount) || 0;
          }
        }

        if (tripNetWithFriend !== 0) {
          totalNet += tripNetWithFriend;
          const isSplit =
            t.trip_type === 'friend_split' || t.name.toLowerCase().startsWith('split with ');
          breakdownLabels.push(isSplit ? 'Direct Split' : t.name);
        }

        for (const exp of normalizedExps) {
          const amt = Number(exp.amount) || 0;
          const expSplits = exp.splits || [];
          const isPayerMe =
            (exp.payerName && myMember.display_name && exp.payerName.trim().toLowerCase() === myMember.display_name.trim().toLowerCase()) ||
            (!exp.payerName && (
              exp.paid_by === myMember.id ||
              (myMember.profile_id && exp.paid_by === myMember.profile_id)
            ));
          const isPayerFriend =
            (exp.payerName && fMember.display_name && exp.payerName.trim().toLowerCase() === fMember.display_name.trim().toLowerCase()) ||
            (!exp.payerName && (
              exp.paid_by === fMember.id ||
              (fMember.profile_id && exp.paid_by === fMember.profile_id)
            ));
          const mySplit = expSplits.find((s: any) => s.member_id === myMember.id);
          const friendSplit = expSplits.find((s: any) => s.member_id === fMember.id);

          if (!isPayerMe && !isPayerFriend && !friendSplit) continue;

          let impactPaise = 0;
          if (isPayerMe && friendSplit) {
            impactPaise = Number(friendSplit.amount) || 0;
          } else if (isPayerFriend && mySplit) {
            impactPaise = -(Number(mySplit.amount) || 0);
          }

          const isSplitTrip =
            t.trip_type === 'friend_split' || t.name.toLowerCase().startsWith('split with ');
          collectedExpenses.push({
            id: exp.id,
            trip_id: t.id,
            trip_name: isSplitTrip ? 'Direct Split' : t.name,
            description: exp.description,
            amount: amt,
            currency: t.currency || trip.currency || 'INR',
            paid_by: exp.paid_by,
            payerName: exp.payerName || (isPayerMe ? 'You' : fMember.display_name),
            isMine: isPayerMe,
            split_count: expSplits.length || tMembers.length,
            category: exp.category || 'General',
            impact_paise: impactPaise,
            created_at: exp.created_at || exp.date || new Date().toISOString(),
          });
        }
      }

      setFriendNetPaise(totalNet);
      setFriendSharedExpenses(collectedExpenses);
      setFriendMemberObj(foundFriendObj);
      setFriendBreakdownTrips(breakdownLabels);
    } catch (e) {
      console.log('Error loading friend split data in info:', e);
    } finally {
      setFriendSplitLoading(false);
    }
  }, [isFriendSplit, cleanFriendName, id, members, expenses, storeContacts, trip.currency, user?.id]);

  useEffect(() => {
    if (isFriendSplit) {
      loadFriendSplitData();
    }
  }, [isFriendSplit, loadFriendSplitData]);

  const effectiveExpenses = isFriendSplit ? friendSharedExpenses : expenses;
  const effectiveTotalSpentPaise = isFriendSplit
    ? friendSharedExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
    : totalSpentPaise;

  const effectiveMembers = React.useMemo(() => {
    if (!isFriendSplit) return members;
    const myMember = findMyMember(members, user?.id, currentUserPhone) || {
      id: user?.id || 'me',
      trip_id: id,
      display_name: 'You',
      role: 'admin',
      is_guest: false,
    };
    const fMember =
      members.find(m => m.id !== myMember.id) ||
      friendMemberObj || {
        id: 'friend_member',
        trip_id: id,
        display_name: cleanFriendName,
        role: 'member',
        is_guest: false,
      };
    return [myMember, fMember];
  }, [isFriendSplit, members, user?.id, id, friendMemberObj, cleanFriendName]);

  const effectiveBalances = React.useMemo(() => {
    if (!isFriendSplit) return balances;
    const myPaid = friendSharedExpenses
      .filter(e => e.isMine || e.payerName === 'You')
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const friendPaid = friendSharedExpenses
      .filter(e => !e.isMine && e.payerName !== 'You')
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    return [
      {
        id: 'bal_me',
        trip_id: id,
        member_id: user?.id || 'me',
        display_name: 'You',
        total_paid: myPaid,
        total_share: 0,
        net_balance: friendNetPaise,
        is_guest: false,
      },
      {
        id: 'bal_friend',
        trip_id: id,
        member_id: friendMemberObj?.id || 'friend',
        display_name: cleanFriendName,
        total_paid: friendPaid,
        total_share: 0,
        net_balance: -friendNetPaise,
        is_guest: Boolean(friendMemberObj?.is_guest),
      },
    ];
  }, [isFriendSplit, balances, friendSharedExpenses, id, user?.id, friendNetPaise, friendMemberObj, cleanFriendName]);

  const effectiveSettlements = React.useMemo(() => {
    if (!isFriendSplit) return settlements;
    if (friendNetPaise === 0) return [];
    return [
      {
        from: friendNetPaise > 0 ? (friendMemberObj?.id || 'friend') : (user?.id || 'me'),
        to: friendNetPaise > 0 ? (user?.id || 'me') : (friendMemberObj?.id || 'friend'),
        amount: Math.abs(friendNetPaise),
      },
    ];
  }, [isFriendSplit, settlements, friendNetPaise, friendMemberObj, user?.id]);

  const effectiveMemberNamesMap: Record<string, string> = React.useMemo(() => {
    if (!isFriendSplit) return memberNamesMap;
    return {
      [user?.id || 'me']: 'You',
      [friendMemberObj?.id || 'friend']: cleanFriendName,
      ...(friendMemberObj?.id ? { [friendMemberObj.id]: cleanFriendName } : {}),
    };
  }, [isFriendSplit, memberNamesMap, user?.id, friendMemberObj, cleanFriendName]);

  // Automatically ensure phone contacts are loaded when Add Member or Link Contact modal opens
  useEffect(() => {
    if ((memberModalOpen || linkingGuestMember) && storeContacts.length === 0) {
      initContacts();
    }
  }, [memberModalOpen, linkingGuestMember, storeContacts.length]);

  useEffect(() => {
    setContactsVisibleCount(PAGE_SIZE);
    setRegUsersVisibleCount(PAGE_SIZE);
  }, [searchQuery]);

  useEffect(() => {
    setLinkContactsVisibleCount(PAGE_SIZE);
  }, [linkContactSearch]);

  // Live search registered users
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q || q.length < 2) {
      setRegisteredUsers([]);
      setSearchingUsers(false);
      return;
    }

    const timer = setTimeout(async () => {
      setSearchingUsers(true);
      const results = await searchRegisteredUsers(q);
      setRegisteredUsers(results);
      setSearchingUsers(false);
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleLoadDeviceContacts = async () => {
    try {
      setLoadingContacts(true);
      await initContacts(true);
      const { status } = await Contacts.requestPermissionsAsync();
      if (status === 'granted') {
        const { data } = await Contacts.getContactsAsync({
          fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
        });
        if (data && data.length > 0) {
          const list = data
            .filter(c => c.name && c.name.trim().length > 0)
            .map(c => ({
              id: c.id,
              name: c.name,
              phoneNumber: c.phoneNumbers?.[0]?.number || undefined,
            }));
          setDeviceContacts(list);
        }
      }
    } catch (err: any) {
      console.log('Error reading contacts:', err?.message);
    } finally {
      setLoadingContacts(false);
    }
  };

  const handleAddRegisteredMember = async (regUser: {
    id: string;
    full_name: string;
    phone_number: string | null;
  }) => {
    if (!id || addingMemberId) return;
    setAddingMemberId(regUser.id);
    try {
      const res = await addMember({
        tripId: id,
        displayName: regUser.full_name,
        phoneNumber: regUser.phone_number,
        profileId: regUser.id,
        isGuest: false,
      });
      if (res) {
        setAddedIds(prev => ({ ...prev, [regUser.id]: true }));
      }
    } finally {
      setAddingMemberId(null);
    }
  };

  const handleAddContactMember = async (contact: {
    name: string;
    phoneNumber?: string;
    id?: string;
    profileId?: string;
    isRegistered?: boolean;
  }) => {
    if (!id || !contact.name.trim() || addingMemberId) return;
    const cId = contact.id || contact.name;
    setAddingMemberId(cId);
    try {
      const res = await addMember({
        tripId: id,
        displayName: contact.name.trim(),
        phoneNumber: contact.phoneNumber || null,
        profileId: contact.profileId || null,
        isGuest: false,
      });
      if (res && contact.id) {
        setAddedIds(prev => ({ ...prev, [contact.id!]: true }));
      }
      return res;
    } finally {
      setAddingMemberId(null);
    }
  };

  const handleAddGuestDirectly = async (customName?: string) => {
    const targetName = (customName ?? guestNameInput).trim();
    if (!id || !targetName || addingMemberId) return;
    setAddingMemberId('guest_manual');
    try {
      const res = await addMember({
        tripId: id,
        displayName: targetName,
        phoneNumber: manualPhone.trim() || null,
        isGuest: true,
      });
      if (res) {
        setAddingGuestSuccess(`Added "${targetName}" as guest!`);
        setGuestNameInput('');
        setManualPhone('');
        if (customName) setSearchQuery('');
        setTimeout(() => setAddingGuestSuccess(null), 2500);
      }
    } finally {
      setAddingMemberId(null);
    }
  };

  const handleInviteContact = (name: string, phoneNumber?: string | null) => {
    const code = inviteCode || id?.replace(/-/g, '').substring(0, 6).toUpperCase() || 'TRIP';
    const text = `Hey ${name}! I've added you to our trip "${trip.name}" on Split Your Trip to manage & split expenses. Use code ${code} to join: https://splityourtrip.app/join/${code}`;

    if (phoneNumber) {
      const clean = phoneNumber.replace(/[^0-9+]/g, '');
      const url = `whatsapp://send?phone=${clean}&text=${encodeURIComponent(text)}`;
      Linking.canOpenURL(url)
        .then(supported => {
          if (supported) {
            Linking.openURL(url);
          } else {
            Share.share({ message: text });
          }
        })
        .catch(() => {
          Share.share({ message: text });
        });
    } else {
      Share.share({ message: text });
    }
  };

  const handleShareSummary = async () => {
    const paidByMembers = members.map(m => {
      const b = balances.find(row => row.member_id === m.id);
      return {
        name: m.display_name,
        amountPaise: b ? b.total_paid : 0,
      };
    });

    const msg = generateSettlementWhatsAppMessage({
      tripName: trip.name,
      totalSpentPaise,
      paidByMembers,
      settlements,
      memberNames: memberNamesMap,
      currencyCode: trip.currency,
    });

    try {
      await Share.share({
        message: msg,
      });
    } catch {}
  };

  const handlePayViaUpi = (amountPaise: number, receiverName: string) => {
    const rupees = (amountPaise / 100).toFixed(2);
    const upiUrl = `upi://pay?pn=${encodeURIComponent(receiverName)}&am=${rupees}&cu=INR`;
    Linking.openURL(upiUrl).catch(() => {
      alert(`UPI deep link: ${upiUrl}`);
    });
  };

  // Merge contacts from useContactsStore + deviceContacts
  const allCombinedContacts = React.useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; phoneNumber?: string; profileId?: string; isRegistered?: boolean }
    >();
    for (const sc of storeContacts) {
      if (!sc.name || !sc.name.trim()) continue;
      const key = sc.phoneNumber
        ? sc.phoneNumber.replace(/[^0-9]/g, '').slice(-10)
        : sc.name.trim().toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          id: sc.id,
          name: sc.name.trim(),
          phoneNumber: sc.phoneNumber,
          profileId: sc.profileId,
          isRegistered: sc.isRegistered,
        });
      }
    }
    for (const dc of deviceContacts) {
      if (!dc.name || !dc.name.trim()) continue;
      const key = dc.phoneNumber
        ? dc.phoneNumber.replace(/[^0-9]/g, '').slice(-10)
        : dc.name.trim().toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          id: dc.id,
          name: dc.name.trim(),
          phoneNumber: dc.phoneNumber,
          profileId: dc.profileId,
          isRegistered: dc.isRegistered,
        });
      }
    }
    return Array.from(map.values());
  }, [storeContacts, deviceContacts]);

  const filteredContacts = React.useMemo(() => {
    if (!searchQuery.trim()) return allCombinedContacts;
    const q = searchQuery.toLowerCase().trim();
    const qDigits = q.replace(/[^0-9]/g, '');
    return allCombinedContacts.filter(c => {
      const nameMatch = c.name.toLowerCase().includes(q);
      const phoneMatch = c.phoneNumber
        ? c.phoneNumber.toLowerCase().includes(q) ||
          (qDigits.length > 0 && c.phoneNumber.replace(/[^0-9]/g, '').includes(qDigits))
        : false;
      return nameMatch || phoneMatch;
    });
  }, [allCombinedContacts, searchQuery]);

  const paginatedContacts = filteredContacts.slice(0, contactsVisibleCount);
  const hasMoreContacts = contactsVisibleCount < filteredContacts.length;

  const filteredLinkContacts = React.useMemo(() => {
    const withPhone = allCombinedContacts.filter(c => c.phoneNumber || c.isRegistered);
    const pool = withPhone.length > 0 ? withPhone : allCombinedContacts;
    if (!linkContactSearch.trim()) return pool;
    const q = linkContactSearch.toLowerCase().trim();
    return pool.filter(
      c =>
        c.name.toLowerCase().includes(q) ||
        (c.phoneNumber && c.phoneNumber.toLowerCase().includes(q))
    );
  }, [allCombinedContacts, linkContactSearch]);

  const paginatedLinkContacts = filteredLinkContacts.slice(0, linkContactsVisibleCount);
  const hasMoreLinkContacts = linkContactsVisibleCount < filteredLinkContacts.length;

  const headerBg = colors.card;
  const effectiveSubtitleInfo = isFriendSplit
    ? friendNetPaise < 0
      ? `You owe ${cleanFriendName} ${formatCurrencyAmount(Math.abs(friendNetPaise), trip.currency)}`
      : friendNetPaise > 0
      ? `${cleanFriendName} owes you ${formatCurrencyAmount(friendNetPaise, trip.currency)}`
      : 'All settled up'
    : `${members.length} ${members.length === 1 ? 'member' : 'members'} • ${expenses.length} ${expenses.length === 1 ? 'expense' : 'expenses'} • Total ${formatCurrencyAmount(totalSpentPaise, trip.currency)}`;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Top Header Bar with Trip Icon + Trip Name + Info Subtitle */}
      <View
        style={[
          styles.headerBar,
          {
            backgroundColor: headerBg,
            borderBottomColor: colors.border,
            borderBottomWidth: 1,
            paddingTop: Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 44) + 6,
          },
        ]}
      >
        <TouchableOpacity
          style={styles.headerBackBtn}
          onPress={() => {
            router.back();
          }}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>

        {/* Trip Identity: Avatar + Name + Info Subtitle */}
        <View style={styles.headerTitleContainer}>
          <View style={[styles.headerAvatar, { backgroundColor: colors.primaryLight, overflow: 'hidden' }]}>
            {isFriendSplit ? (
              <Text style={[styles.headerAvatarText, { color: colors.primary }]}>
                {cleanFriendName.charAt(0).toUpperCase()}
              </Text>
            ) : trip.image_url ? (
              trip.image_url.startsWith('emoji:') ? (
                <Text style={{ fontSize: 20 }}>{trip.image_url.replace('emoji:', '')}</Text>
              ) : (
                <Image source={{ uri: trip.image_url }} style={{ width: '100%', height: '100%' }} />
              )
            ) : (
              <Ionicons name="airplane" size={20} color={colors.primary} />
            )}
          </View>
          <View style={styles.headerTitleCol}>
            <Text style={[styles.headerTitleText, { color: colors.text }]} numberOfLines={1}>
              {isFriendSplit ? cleanFriendName : trip.name}
            </Text>
            <Text style={[styles.headerSubtitleText, { color: colors.textSecondary }]} numberOfLines={1}>
              {effectiveSubtitleInfo}
            </Text>
          </View>
        </View>

        {/* Header Right Actions: Invite Code & Three-Dots Menu */}
        <View style={styles.headerRightActions}>
          {!isFriendSplit && inviteCode ? (
            <TouchableOpacity
              style={styles.headerCodeBadge}
              onPress={() => {
                Share.share({
                  message: `Join my trip "${trip.name}" on Split Your Trip! Use invite code: ${inviteCode}`,
                });
              }}
            >
              <Ionicons name="share-social-outline" size={13} color="#FFFFFF" />
              <Text style={styles.headerCodeBadgeText}>{inviteCode}</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={styles.headerMenuBtn}
            onPress={() => setOptionsSidebarOpen(true)}
          >
            <Ionicons name="ellipsis-vertical" size={21} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Segmented Tab Bar: Expenses | Members | Balances | Settle Up */}
      <View
        style={[
          styles.tabBar,
          { backgroundColor: colors.card, borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity
          style={[
            styles.tabItem,
            activeTab === 'expenses' && [styles.tabActive, { borderBottomColor: colors.primary }],
          ]}
          onPress={() => setActiveTab('expenses')}
        >
          <Text
            style={[
              styles.tabText,
              { color: activeTab === 'expenses' ? colors.primary : colors.textSecondary },
              activeTab === 'expenses' && styles.tabTextActive,
            ]}
          >
            🧾 Expenses ({effectiveExpenses.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.tabItem,
            activeTab === 'members' && [styles.tabActive, { borderBottomColor: colors.primary }],
          ]}
          onPress={() => setActiveTab('members')}
        >
          <Text
            style={[
              styles.tabText,
              { color: activeTab === 'members' ? colors.primary : colors.textSecondary },
              activeTab === 'members' && styles.tabTextActive,
            ]}
          >
            👥 Members ({effectiveMembers.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.tabItem,
            activeTab === 'balances' && [styles.tabActive, { borderBottomColor: colors.primary }],
          ]}
          onPress={() => setActiveTab('balances')}
        >
          <Text
            style={[
              styles.tabText,
              { color: activeTab === 'balances' ? colors.primary : colors.textSecondary },
              activeTab === 'balances' && styles.tabTextActive,
            ]}
          >
            ⚖️ Balances
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.tabItem,
            activeTab === 'settle' && [styles.tabActive, { borderBottomColor: colors.primary }],
          ]}
          onPress={() => setActiveTab('settle')}
        >
          <Text
            style={[
              styles.tabText,
              { color: activeTab === 'settle' ? colors.primary : colors.textSecondary },
              activeTab === 'settle' && styles.tabTextActive,
            ]}
          >
            🤝 Settle Up
          </Text>
        </TouchableOpacity>
      </View>

      {/* TAB 0: EXPENSES (Paginated by 10, single loading indicator, tap opens expense details) */}
      {activeTab === 'expenses' && (
        <View style={styles.tabContainer}>
          <View style={styles.memberActionRow}>
            <TouchableOpacity
              style={[styles.addMemberBtn, { backgroundColor: colors.primary }]}
              onPress={() => router.push(`/trip/${id}/add`)}
            >
              <Ionicons name="add" size={19} color="#FFFFFF" />
              <Text style={styles.addMemberBtnText}>Add Expense</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.shareCodeBtn,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
              onPress={handleShareSummary}
            >
              <Ionicons name="logo-whatsapp" size={17} color="#25D366" />
              <Text style={[styles.shareCodeText, { color: colors.text }]}>Share Summary</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={effectiveExpenses.slice(0, expensesVisibleCount)}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.listContent}
            onEndReached={() => {
              if (expensesVisibleCount < effectiveExpenses.length && !expensesLoadingMore) {
                setExpensesLoadingMore(true);
                setTimeout(() => {
                  setExpensesVisibleCount(prev => prev + PAGE_SIZE);
                  setExpensesLoadingMore(false);
                }, 200);
              }
            }}
            onEndReachedThreshold={0.3}
            ListEmptyComponent={
              tripStoreLoading || friendSplitLoading ? (
                <View style={styles.emptyView}>
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Text style={[styles.emptyTitle, { color: colors.text, marginTop: 10 }]}>
                    Loading expenses...
                  </Text>
                </View>
              ) : (
                <View style={styles.emptyView}>
                  <Text style={styles.emptyIcon}>🧾</Text>
                  <Text style={[styles.emptyTitle, { color: colors.text }]}>
                    {isFriendSplit ? `No shared expenses with ${cleanFriendName} yet` : 'No expenses logged yet'}
                  </Text>
                  <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
                    {isFriendSplit
                      ? `Tap "+ Add Expense" above to log a split bill with ${cleanFriendName}.`
                      : 'Tap "+ Add Expense" above to log and split a bill with trip members.'}
                  </Text>
                </View>
              )
            }
            ListFooterComponent={
              expensesVisibleCount < effectiveExpenses.length ? (
                <TouchableOpacity
                  style={[
                    styles.loadMoreBtn,
                    { borderColor: colors.border, backgroundColor: colors.card },
                  ]}
                  onPress={() => {
                    setExpensesLoadingMore(true);
                    setTimeout(() => {
                      setExpensesVisibleCount(prev => prev + PAGE_SIZE);
                      setExpensesLoadingMore(false);
                    }, 200);
                  }}
                >
                  {expensesLoadingMore ? (
                    <View style={styles.loadMoreRow}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={[styles.loadMoreText, { color: colors.primary }]}>
                        Loading more...
                      </Text>
                    </View>
                  ) : (
                    <Text style={[styles.loadMoreText, { color: colors.primary }]}>
                      Load More ({effectiveExpenses.length - expensesVisibleCount} remaining)
                    </Text>
                  )}
                </TouchableOpacity>
              ) : effectiveExpenses.length > 0 ? (
                <Text
                  style={{
                    textAlign: 'center',
                    fontSize: 12,
                    color: colors.textMuted,
                    marginTop: 8,
                  }}
                >
                  Showing {Math.min(expensesVisibleCount, effectiveExpenses.length)} of {effectiveExpenses.length}{' '}
                  expenses
                </Text>
              ) : null
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.expenseCardRow,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                  },
                ]}
                activeOpacity={0.8}
                onPress={() =>
                  router.push(`/trip/${item.trip_id || id}/expense/${item.id}`)
                }
              >
                <View
                  style={[
                    styles.expIconContainer,
                    { backgroundColor: colors.primaryLight },
                  ]}
                >
                  <Text style={styles.expIconEmoji}>
                    {item.category === 'Food'
                      ? '🍕'
                      : item.category === 'Stay'
                      ? '🏨'
                      : item.category === 'Fuel'
                      ? '⛽'
                      : '💳'}
                  </Text>
                </View>

                <View style={styles.expDetailsCol}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[styles.expDescText, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                      {item.description}
                    </Text>
                    {isFriendSplit && item.trip_name && (
                      <View style={{ backgroundColor: colors.primaryLight, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                        <Text style={{ fontSize: 10, color: colors.primary, fontWeight: '700' }}>{item.trip_name}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.expMetaText, { color: colors.textSecondary }]}>
                    Paid by <Text style={{ fontWeight: '700', color: colors.text }}>{item.payerName}</Text>{' '}
                    • {(item.payment_mode || item.currency || 'INR').toUpperCase()}
                  </Text>
                </View>

                <View style={styles.expAmountCol}>
                  <Text style={[styles.expAmountText, { color: colors.text }]}>
                    {formatCurrencyAmount(item.amount, item.currency || trip.currency)}
                  </Text>
                  <Text style={[styles.expViewText, { color: colors.primary }]}>
                    View Bill ›
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      {/* TAB 1: MEMBERS (Paginated by 10, single loading indicator) */}
      {activeTab === 'members' && (
        <View style={styles.tabContainer}>
          {!isFriendSplit && (
            <View style={styles.memberActionRow}>
              <TouchableOpacity
                style={[styles.addMemberBtn, { backgroundColor: colors.primary }]}
                onPress={() => setMemberModalOpen(true)}
              >
                <Ionicons name="person-add" size={18} color="#FFFFFF" />
                <Text style={styles.addMemberBtnText}>Add / Search Members</Text>
              </TouchableOpacity>

              {inviteCode && (
                <TouchableOpacity
                  style={[
                    styles.shareCodeBtn,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                  onPress={() => {
                    Share.share({
                      message: `Join my trip "${trip.name}" on Split Your Trip! Use invite code: ${inviteCode}`,
                    });
                  }}
                >
                  <Ionicons name="share-social-outline" size={18} color={colors.primary} />
                  <Text style={[styles.shareCodeText, { color: colors.primary }]}>Share Code</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <FlatList
            data={effectiveMembers.slice(0, membersVisibleCount)}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.listContent}
            onEndReached={() => {
              if (membersVisibleCount < members.length && !membersLoadingMore) {
                setMembersLoadingMore(true);
                setTimeout(() => {
                  setMembersVisibleCount(prev => prev + PAGE_SIZE);
                  setMembersLoadingMore(false);
                }, 200);
              }
            }}
            onEndReachedThreshold={0.3}
            ListEmptyComponent={
              tripStoreLoading ? (
                <View style={styles.emptyView}>
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Text style={[styles.emptyTitle, { color: colors.text, marginTop: 10 }]}>
                    Loading members...
                  </Text>
                </View>
              ) : null
            }
            ListFooterComponent={
              membersVisibleCount < members.length ? (
                <TouchableOpacity
                  style={[
                    styles.loadMoreBtn,
                    { borderColor: colors.border, backgroundColor: colors.card },
                  ]}
                  onPress={() => {
                    setMembersLoadingMore(true);
                    setTimeout(() => {
                      setMembersVisibleCount(prev => prev + PAGE_SIZE);
                      setMembersLoadingMore(false);
                    }, 200);
                  }}
                >
                  {membersLoadingMore ? (
                    <View style={styles.loadMoreRow}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={[styles.loadMoreText, { color: colors.primary }]}>
                        Loading more...
                      </Text>
                    </View>
                  ) : (
                    <Text style={[styles.loadMoreText, { color: colors.primary }]}>
                      Load More ({members.length - membersVisibleCount} remaining)
                    </Text>
                  )}
                </TouchableOpacity>
              ) : null
            }
            renderItem={({ item }) => {
              const isAppUser = Boolean(item.profile_id);
              const isUnlinkedGuest = Boolean(
                item.is_guest && !item.phone_number && !item.profile_id
              );
              const displayPhoneText =
                item.phone_number && item.phone_number !== 'Linked Contact'
                  ? item.phone_number
                  : null;

              return (
                <View
                  style={[
                    styles.memberCard,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  <View
                    style={[
                      styles.memberAvatar,
                      {
                        backgroundColor: !isUnlinkedGuest
                          ? colors.primaryLight
                          : isDark
                          ? '#334155'
                          : '#E2E8F0',
                        overflow: 'hidden',
                      },
                    ]}
                  >
                    {((user?.id && (item.profile_id === user.id || item.user_id === user.id)) && profile?.avatar_url) || item.avatar_url ? (
                      <Image
                        source={{
                          uri: ((user?.id && (item.profile_id === user.id || item.user_id === user.id))
                            ? profile?.avatar_url
                            : item.avatar_url) || '',
                        }}
                        style={{ width: '100%', height: '100%' }}
                        resizeMode="cover"
                      />
                    ) : (
                      <Text
                        style={[
                          styles.memberAvatarText,
                          { color: !isUnlinkedGuest ? colors.primaryDark : colors.text },
                        ]}
                      >
                        {item.display_name.charAt(0).toUpperCase()}
                      </Text>
                    )}
                  </View>

                  <View style={styles.memberDetails}>
                    <View style={styles.memberNameRow}>
                      <Text style={[styles.memberName, { color: colors.text }]}>
                        {item.display_name}
                      </Text>
                      {item.role === 'admin' && (
                        <View
                          style={[
                            styles.adminBadge,
                            { backgroundColor: colors.primaryLight },
                          ]}
                        >
                          <Text style={[styles.adminBadgeText, { color: colors.primaryDark }]}>
                            Admin
                          </Text>
                        </View>
                      )}
                    </View>

                    <View style={styles.memberSubRow}>
                      {displayPhoneText ? (
                        <View style={styles.phoneTag}>
                          <Ionicons name="call-outline" size={11} color={colors.textSecondary} />
                          <Text style={[styles.phoneTagText, { color: colors.textSecondary }]}>
                            {displayPhoneText}
                          </Text>
                        </View>
                      ) : null}

                      <View
                        style={[
                          styles.typeBadge,
                          {
                            backgroundColor: isAppUser
                              ? isDark
                                ? 'rgba(99, 102, 241, 0.2)'
                                : '#EEF2FF'
                              : !isUnlinkedGuest
                              ? isDark
                                ? 'rgba(16, 185, 129, 0.2)'
                                : '#ECFDF5'
                              : isDark
                              ? 'rgba(245, 158, 11, 0.2)'
                              : '#FEF3C7',
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.typeBadgeText,
                            {
                              color: isAppUser
                                ? isDark
                                  ? '#818CF8'
                                  : '#4F46E5'
                                : !isUnlinkedGuest
                                ? isDark
                                  ? '#6EE7B7'
                                  : '#059669'
                                : isDark
                                ? '#FBBF24'
                                : '#D97706',
                            },
                          ]}
                        >
                          {isAppUser ? '✨ App User' : !isUnlinkedGuest ? '📱 Contact' : '👤 Guest'}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {item.role !== 'admin' && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {isUnlinkedGuest && (
                        <TouchableOpacity
                          style={[
                            styles.memberInviteBtn,
                            { backgroundColor: colors.primary, marginLeft: 0 },
                          ]}
                          onPress={() => {
                            setLinkContactSearch('');
                            setLinkContactsVisibleCount(PAGE_SIZE);
                            setLinkingGuestMember({ id: item.id, name: item.display_name });
                          }}
                        >
                          <Ionicons name="link-outline" size={14} color="#FFFFFF" />
                          <Text style={styles.memberInviteBtnText}>Link</Text>
                        </TouchableOpacity>
                      )}

                      {!isAppUser && (
                        <TouchableOpacity
                          style={[
                            styles.memberInviteBtn,
                            { backgroundColor: '#25D366', marginLeft: 0 },
                          ]}
                          onPress={() =>
                            handleInviteContact(item.display_name, displayPhoneText)
                          }
                        >
                          <Ionicons name="logo-whatsapp" size={14} color="#FFFFFF" />
                          <Text style={styles.memberInviteBtnText}>Invite</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
              );
            }}
          />
        </View>
      )}

      {/* TAB 2: BALANCES (Paginated by 10) */}
      {activeTab === 'balances' && (
        <ScrollView contentContainerStyle={styles.listContent}>
          {effectiveBalances.slice(0, balancesVisibleCount).map(b => {
            const isOwed = b.net_balance > 0;
            const isZero = b.net_balance === 0;

            return (
              <View
                key={b.member_id}
                style={[
                  styles.balanceCard,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <View style={styles.balanceInfo}>
                  <Text style={[styles.balanceMemberName, { color: colors.text }]}>
                    {b.display_name} {b.is_guest ? '(Guest)' : ''}
                  </Text>
                  <Text style={[styles.balanceSub, { color: colors.textSecondary }]}>
                    Paid {formatCurrencyAmount(b.total_paid, trip.currency)} • Share{' '}
                    {formatCurrencyAmount(b.total_share, trip.currency)}
                  </Text>
                </View>

                <View style={styles.balanceAmountCol}>
                  <Text
                    style={[
                      styles.balanceNet,
                      isOwed
                        ? { color: colors.success }
                        : isZero
                        ? { color: colors.textSecondary }
                        : { color: colors.danger },
                    ]}
                  >
                    {isOwed
                      ? `+${formatCurrencyAmount(b.net_balance, trip.currency)}`
                      : formatCurrencyAmount(b.net_balance, trip.currency)}
                  </Text>
                  <Text style={[styles.netLabel, { color: colors.textMuted }]}>
                    {isOwed ? 'Gets back' : isZero ? 'Settled' : 'Owes'}
                  </Text>
                </View>
              </View>
            );
          })}

          {balancesVisibleCount < effectiveBalances.length && (
            <TouchableOpacity
              style={[
                styles.loadMoreBtn,
                { borderColor: colors.border, backgroundColor: colors.card },
              ]}
              onPress={() => setBalancesVisibleCount(prev => prev + PAGE_SIZE)}
            >
              <Text style={[styles.loadMoreText, { color: colors.primary }]}>
                Load More ({effectiveBalances.length - balancesVisibleCount} remaining)
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}

      {/* TAB 3: SETTLE UP (Paginated by 10) */}
      {activeTab === 'settle' && (
        <ScrollView contentContainerStyle={styles.listContent}>
          <View
            style={[
              styles.settleBanner,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.settleTitle, { color: colors.text }]}>
              Debt-Simplified Settlements
            </Text>
            <Text style={[styles.settleDesc, { color: colors.textSecondary }]}>
              Minimum number of payments computed to clear all trip balances.
            </Text>

            <TouchableOpacity style={styles.shareBtn} onPress={handleShareSummary}>
              <Ionicons name="logo-whatsapp" size={20} color="#FFFFFF" />
              <Text style={styles.shareBtnText}>Share Summary to WhatsApp</Text>
            </TouchableOpacity>
          </View>

          {effectiveSettlements.length === 0 ? (
            <View style={styles.emptyView}>
              <Text style={styles.emptyIcon}>🎉</Text>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>All Settled Up!</Text>
              <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
                No outstanding debts among members.
              </Text>
            </View>
          ) : (
            <>
              {effectiveSettlements.slice(0, settleVisibleCount).map((s, idx) => {
                const fromName = effectiveMemberNamesMap[s.from] || 'Member';
                const toName = effectiveMemberNamesMap[s.to] || 'Member';

                return (
                  <View
                    key={idx}
                    style={[
                      styles.settleCard,
                      { backgroundColor: colors.card, borderColor: colors.border },
                    ]}
                  >
                    <View style={styles.settleCardInfo}>
                      <Text style={[styles.settleRoute, { color: colors.text }]}>
                        <Text style={styles.bold}>{fromName}</Text> owes{' '}
                        <Text style={styles.bold}>{toName}</Text>
                      </Text>
                      <Text style={[styles.settleAmount, { color: colors.text }]}>
                        {formatCurrencyAmount(s.amount, trip.currency)}
                      </Text>
                    </View>

                    <TouchableOpacity
                      style={[styles.payUpiBtn, { backgroundColor: colors.primary }]}
                      onPress={() => handlePayViaUpi(s.amount, toName)}
                    >
                      <Ionicons name="flash" size={16} color="#FFFFFF" />
                      <Text style={styles.payUpiBtnText}>Pay via UPI</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}

              {settleVisibleCount < effectiveSettlements.length && (
                <TouchableOpacity
                  style={[
                    styles.loadMoreBtn,
                    { borderColor: colors.border, backgroundColor: colors.card },
                  ]}
                  onPress={() => setSettleVisibleCount(prev => prev + PAGE_SIZE)}
                >
                  <Text style={[styles.loadMoreText, { color: colors.primary }]}>
                    Load More ({effectiveSettlements.length - settleVisibleCount} remaining)
                  </Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </ScrollView>
      )}

      {/* Add / Search Member Modal */}
      {memberModalOpen && (
        <Modal visible={memberModalOpen} transparent animationType="slide">
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.modalOverlay}
          >
            <View
              style={[
                styles.memberModalContainer,
                { backgroundColor: colors.card, borderTopColor: colors.border },
              ]}
            >
              <View style={[styles.modalHeaderRow, { borderBottomColor: colors.border }]}>
                <View>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>Add Members</Text>
                  <Text style={[styles.modalSubtitle, { color: colors.textSecondary }]}>
                    Search phone contacts, app users, or add as guest
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.modalCloseBtn, { backgroundColor: colors.inputBackground }]}
                  onPress={() => {
                    setMemberModalOpen(false);
                    setSearchQuery('');
                    setRegisteredUsers([]);
                  }}
                >
                  <Ionicons name="close" size={20} color={colors.text} />
                </TouchableOpacity>
              </View>

              <View style={styles.modalSearchSection}>
                <View
                  style={[
                    styles.searchBar,
                    { backgroundColor: colors.inputBackground, borderColor: colors.border },
                  ]}
                >
                  <Ionicons
                    name="search"
                    size={18}
                    color={colors.textSecondary}
                    style={{ marginRight: 8 }}
                  />
                  <TextInput
                    style={[styles.searchInput, { color: colors.text }]}
                    placeholder="Search contacts or users by name/phone..."
                    placeholderTextColor={colors.textMuted}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    autoCorrect={false}
                  />
                  {searchQuery.length > 0 && (
                    <TouchableOpacity onPress={() => setSearchQuery('')}>
                      <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                    </TouchableOpacity>
                  )}
                </View>

                {allCombinedContacts.length === 0 && !contactsStoreLoading && !loadingContacts && (
                  <TouchableOpacity
                    style={[
                      styles.importContactsBtn,
                      {
                        borderColor: colors.primary,
                        backgroundColor: isDark ? 'rgba(99, 102, 241, 0.15)' : '#EEF2FF',
                      },
                    ]}
                    onPress={handleLoadDeviceContacts}
                  >
                    <Ionicons name="book-outline" size={18} color={colors.primary} />
                    <Text style={[styles.importContactsText, { color: colors.primary }]}>
                      Sync Phone Contacts
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              <ScrollView style={styles.modalScrollArea} keyboardShouldPersistTaps="handled">
                {/* Add Member as Guest Card */}
                <View
                  style={[
                    styles.manualAddCard,
                    {
                      backgroundColor: isDark ? 'rgba(99, 102, 241, 0.12)' : '#F5F7FF',
                      borderColor: isDark ? colors.border : '#E0E7FF',
                      marginBottom: 14,
                    },
                  ]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Ionicons name="person-add" size={18} color={colors.primary} />
                    <Text style={[styles.manualAddTitle, { color: colors.text }]}>
                      Add Member as Guest
                    </Text>
                  </View>
                  <Text style={[styles.manualAddDesc, { color: colors.textSecondary }]}>
                    Add anyone by name even if they are not in your contacts. You can link them to a contact anytime!
                  </Text>

                  {addingGuestSuccess && (
                    <View
                      style={{
                        backgroundColor: colors.successBg,
                        paddingVertical: 6,
                        paddingHorizontal: 10,
                        borderRadius: 8,
                        marginTop: 8,
                      }}
                    >
                      <Text style={{ color: colors.success, fontWeight: '700', fontSize: 12 }}>
                        ✓ {addingGuestSuccess}
                      </Text>
                    </View>
                  )}

                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                    <TextInput
                      style={[
                        styles.manualPhoneInput,
                        {
                          flex: 1,
                          backgroundColor: colors.inputBackground,
                          borderColor: colors.border,
                          color: colors.text,
                        },
                      ]}
                      placeholder="Guest Name (e.g. Rahul)"
                      placeholderTextColor={colors.textMuted}
                      value={guestNameInput}
                      onChangeText={setGuestNameInput}
                    />
                    <TextInput
                      style={[
                        styles.manualPhoneInput,
                        {
                          flex: 1,
                          backgroundColor: colors.inputBackground,
                          borderColor: colors.border,
                          color: colors.text,
                        },
                      ]}
                      placeholder="Phone (Optional)"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="phone-pad"
                      value={manualPhone}
                      onChangeText={setManualPhone}
                    />
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.manualAddBtn,
                      {
                        backgroundColor:
                          guestNameInput.trim() || searchQuery.trim()
                            ? colors.primary
                            : colors.border,
                      },
                    ]}
                    disabled={(!guestNameInput.trim() && !searchQuery.trim()) || Boolean(addingMemberId)}
                    onPress={() =>
                      handleAddGuestDirectly(
                        guestNameInput.trim() ? guestNameInput.trim() : searchQuery.trim()
                      )
                    }
                  >
                    {addingMemberId === 'guest_manual' ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <>
                        <Ionicons name="person-add" size={16} color="#FFFFFF" />
                        <Text style={styles.manualAddBtnText}>
                          {guestNameInput.trim()
                            ? `+ Add "${guestNameInput.trim()}" as Guest`
                            : searchQuery.trim()
                            ? `+ Add "${searchQuery.trim()}" as Guest`
                            : '+ Add as Guest Member'}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>

                {((searchingUsers && registeredUsers.length === 0) ||
                  ((contactsStoreLoading || loadingContacts) && allCombinedContacts.length === 0)) && (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      paddingVertical: 10,
                      gap: 8,
                    }}
                  >
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={{ fontSize: 12, color: colors.textSecondary, fontWeight: '600' }}>
                      Searching contacts & users...
                    </Text>
                  </View>
                )}

                {/* Registered Users Matches (Paginated by 10) */}
                {registeredUsers.length > 0 && (
                  <View style={styles.sectionBlock}>
                    <View style={styles.sectionHeaderRow}>
                      <Text style={[styles.sectionHeading, { color: colors.primary }]}>
                        ✨ REGISTERED USERS ({registeredUsers.length})
                      </Text>
                    </View>

                    {registeredUsers.slice(0, regUsersVisibleCount).map(reg => {
                      const isAlreadyMember = members.some(
                        m => m.profile_id === reg.id || m.user_id === reg.id
                      );
                      const isAddedNow = addedIds[reg.id];
                      const isAddingThis = addingMemberId === reg.id;

                      return (
                        <View
                          key={reg.id}
                          style={[
                            styles.contactItemCard,
                            { backgroundColor: colors.background, borderColor: colors.border },
                          ]}
                        >
                          <View
                            style={[styles.regAvatar, { backgroundColor: colors.primaryLight }]}
                          >
                            <Text style={[styles.regAvatarText, { color: colors.primaryDark }]}>
                              {reg.full_name.charAt(0).toUpperCase()}
                            </Text>
                          </View>
                          <View style={{ flex: 1, marginRight: 8 }}>
                            <Text style={[styles.contactItemName, { color: colors.text }]}>
                              {reg.full_name}
                            </Text>
                            {reg.phone_number ? (
                              <Text
                                style={[styles.contactItemPhone, { color: colors.textSecondary }]}
                              >
                                {reg.phone_number}
                              </Text>
                            ) : null}
                          </View>

                          <TouchableOpacity
                            style={[
                              styles.addContactActionBtn,
                              isAlreadyMember || isAddedNow
                                ? { backgroundColor: colors.successBg }
                                : { backgroundColor: colors.primary },
                            ]}
                            disabled={isAlreadyMember || isAddedNow || Boolean(addingMemberId)}
                            onPress={() => handleAddRegisteredMember(reg)}
                          >
                            {isAddingThis ? (
                              <ActivityIndicator size="small" color="#FFFFFF" />
                            ) : (
                              <Text
                                style={[
                                  styles.addContactActionText,
                                  isAlreadyMember || isAddedNow
                                    ? { color: colors.success }
                                    : { color: '#FFFFFF' },
                                ]}
                              >
                                {isAlreadyMember || isAddedNow ? '✓ Added' : '+ Add'}
                              </Text>
                            )}
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                  </View>
                )}

                {/* Phone Contacts Matching (Paginated by 10) */}
                {filteredContacts.length > 0 ? (
                  <View style={styles.sectionBlock}>
                    <View style={styles.sectionHeaderRow}>
                      <Text style={[styles.sectionHeading, { color: colors.textSecondary }]}>
                        📱 PHONE CONTACTS ({filteredContacts.length})
                      </Text>
                      <Text style={[styles.sectionSub, { color: colors.textSecondary }]}>
                        Showing {paginatedContacts.length} of {filteredContacts.length}
                      </Text>
                    </View>

                    {paginatedContacts.map(contact => {
                      const isAlreadyMember = members.some(
                        m =>
                          m.display_name.toLowerCase() === contact.name.toLowerCase() ||
                          (contact.phoneNumber && m.phone_number === contact.phoneNumber) ||
                          (contact.profileId && m.profile_id === contact.profileId)
                      );
                      const isAddedNow = addedIds[contact.id];
                      const isAddingThis = addingMemberId === (contact.id || contact.name);

                      return (
                        <View
                          key={contact.id}
                          style={[
                            styles.contactItemCard,
                            { backgroundColor: colors.background, borderColor: colors.border },
                          ]}
                        >
                          <View
                            style={[
                              styles.guestAvatar,
                              {
                                backgroundColor: contact.isRegistered
                                  ? colors.primaryLight
                                  : isDark
                                  ? '#334155'
                                  : '#E2E8F0',
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.guestAvatarText,
                                {
                                  color: contact.isRegistered ? colors.primaryDark : colors.text,
                                },
                              ]}
                            >
                              {contact.name.charAt(0).toUpperCase()}
                            </Text>
                          </View>
                          <View style={{ flex: 1, marginRight: 8 }}>
                            <Text style={[styles.contactItemName, { color: colors.text }]}>
                              {contact.name}
                            </Text>
                            {contact.phoneNumber ? (
                              <Text
                                style={[styles.contactItemPhone, { color: colors.textSecondary }]}
                              >
                                {contact.phoneNumber}
                              </Text>
                            ) : null}
                          </View>

                          <View style={{ flexDirection: 'row', gap: 6 }}>
                            <TouchableOpacity
                              style={[
                                styles.addContactActionBtn,
                                isAlreadyMember || isAddedNow
                                  ? { backgroundColor: colors.successBg }
                                  : { backgroundColor: colors.primary },
                              ]}
                              disabled={isAlreadyMember || isAddedNow || Boolean(addingMemberId)}
                              onPress={() => handleAddContactMember(contact)}
                            >
                              {isAddingThis ? (
                                <ActivityIndicator size="small" color="#FFFFFF" />
                              ) : (
                                <Text
                                  style={[
                                    styles.addContactActionText,
                                    isAlreadyMember || isAddedNow
                                      ? { color: colors.success }
                                      : { color: '#FFFFFF' },
                                  ]}
                                >
                                  {isAlreadyMember || isAddedNow ? '✓ Added' : '+ Add'}
                                </Text>
                              )}
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={[styles.quickWhatsAppBtn, { backgroundColor: '#25D366' }]}
                              onPress={() =>
                                handleInviteContact(contact.name, contact.phoneNumber)
                              }
                            >
                              <Ionicons name="logo-whatsapp" size={15} color="#FFFFFF" />
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    })}

                    {hasMoreContacts && (
                      <TouchableOpacity
                        style={[
                          styles.loadMoreBtn,
                          { borderColor: colors.border, backgroundColor: colors.background },
                        ]}
                        disabled={contactsLoadingMore}
                        onPress={() => {
                          setContactsLoadingMore(true);
                          setTimeout(() => {
                            setContactsVisibleCount(prev => prev + PAGE_SIZE);
                            setContactsLoadingMore(false);
                          }, 200);
                        }}
                      >
                        {contactsLoadingMore ? (
                          <View style={styles.loadMoreRow}>
                            <ActivityIndicator size="small" color={colors.primary} />
                            <Text style={[styles.loadMoreText, { color: colors.primary }]}>
                              Loading next 10 contacts...
                            </Text>
                          </View>
                        ) : (
                          <Text style={[styles.loadMoreText, { color: colors.primary }]}>
                            Load More Contacts ({filteredContacts.length - contactsVisibleCount}{' '}
                            remaining)
                          </Text>
                        )}
                      </TouchableOpacity>
                    )}
                  </View>
                ) : null}
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      )}

      {/* Link Guest Member with a Phone Contact Modal (Paginated by 10) */}
      {Boolean(linkingGuestMember) && (
        <Modal
          visible={Boolean(linkingGuestMember)}
          transparent
          animationType="slide"
          onRequestClose={() => setLinkingGuestMember(null)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.modalOverlay}
          >
            <View
              style={[
                styles.memberModalContainer,
                { backgroundColor: colors.card, borderTopColor: colors.border },
              ]}
            >
              <View style={[styles.modalHeaderRow, { borderBottomColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>
                    Link "{linkingGuestMember?.name}" to Contact
                  </Text>
                  <Text style={[styles.modalSubtitle, { color: colors.textSecondary }]}>
                    Select a phone contact to link with this guest member
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.modalCloseBtn, { backgroundColor: colors.inputBackground }]}
                  onPress={() => setLinkingGuestMember(null)}
                >
                  <Ionicons name="close" size={20} color={colors.text} />
                </TouchableOpacity>
              </View>

              <View style={styles.modalSearchSection}>
                <View
                  style={[
                    styles.searchBar,
                    { backgroundColor: colors.inputBackground, borderColor: colors.border },
                  ]}
                >
                  <Ionicons
                    name="search"
                    size={18}
                    color={colors.textSecondary}
                    style={{ marginRight: 8 }}
                  />
                  <TextInput
                    style={[styles.searchInput, { color: colors.text }]}
                    placeholder="Search phone contact..."
                    placeholderTextColor={colors.textMuted}
                    value={linkContactSearch}
                    onChangeText={setLinkContactSearch}
                  />
                  {linkContactSearch.length > 0 && (
                    <TouchableOpacity onPress={() => setLinkContactSearch('')}>
                      <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {linkDbResult && (
                <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      padding: 12,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: colors.success,
                      backgroundColor: isDark ? 'rgba(16, 185, 129, 0.15)' : '#D1FAE5',
                      gap: 10,
                    }}
                  >
                    <Ionicons name="checkmark-circle" size={22} color={colors.success} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>
                        Found in database: "{linkDbResult.name}"
                      </Text>
                      <Text style={{ fontSize: 11, color: colors.success, marginTop: 1 }}>
                        {linkDbResult.isAppUser ? '✨ Registered User Account' : '📱 Previously Linked'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={{
                        backgroundColor: colors.success,
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        borderRadius: 8,
                      }}
                      onPress={async () => {
                        if (!linkingGuestMember) return;
                        await linkGuestWithContact({
                          tripId: id,
                          guestMemberId: linkingGuestMember.id,
                          guestName: linkingGuestMember.name,
                          contact: {
                            id: linkDbResult.profileId || `phone_${linkDbResult.phoneNumber}`,
                            name: linkDbResult.name,
                            phoneNumber: linkDbResult.phoneNumber || linkContactSearch.trim(),
                            profileId: linkDbResult.profileId,
                          },
                        });
                        setLinkingGuestMember(null);
                      }}
                    >
                      <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 12 }}>Link User</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              <FlatList
                data={paginatedLinkContacts}
                keyExtractor={item => item.id}
                contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
                onEndReached={() => {
                  if (hasMoreLinkContacts) {
                    setLinkContactsVisibleCount(prev => prev + PAGE_SIZE);
                  }
                }}
                onEndReachedThreshold={0.3}
                ListEmptyComponent={
                  contactsStoreLoading || loadingContacts ? (
                    <View style={styles.emptyView}>
                      <ActivityIndicator size="large" color={colors.primary} />
                      <Text style={[styles.emptyTitle, { color: colors.text, marginTop: 10 }]}>
                        Loading phone contacts...
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.emptyView}>
                      <Text style={[styles.emptyTitle, { color: colors.text }]}>
                        No contacts found
                      </Text>
                      <TouchableOpacity
                        style={[
                          styles.importContactsBtn,
                          { borderColor: colors.primary, marginTop: 12, paddingHorizontal: 16 },
                        ]}
                        onPress={handleLoadDeviceContacts}
                      >
                        <Text style={{ color: colors.primary, fontWeight: '700' }}>
                          Sync Phone Contacts
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )
                }
                ListFooterComponent={
                  hasMoreLinkContacts ? (
                    <TouchableOpacity
                      style={[
                        styles.loadMoreBtn,
                        { borderColor: colors.border, backgroundColor: colors.background },
                      ]}
                      onPress={() => setLinkContactsVisibleCount(prev => prev + PAGE_SIZE)}
                    >
                      <Text style={[styles.loadMoreText, { color: colors.primary }]}>
                        Load More ({filteredLinkContacts.length - linkContactsVisibleCount}{' '}
                        remaining)
                      </Text>
                    </TouchableOpacity>
                  ) : null
                }
                renderItem={({ item: contact }) => {
                  const isLinkingThis = linkingContactId === contact.id;
                  return (
                    <TouchableOpacity
                      disabled={Boolean(linkingContactId)}
                      style={[
                        styles.contactItemCard,
                        { backgroundColor: colors.background, borderColor: colors.border },
                      ]}
                      onPress={async () => {
                        if (!linkingGuestMember || linkingContactId) return;
                        setLinkingContactId(contact.id);
                        try {
                          await linkGuestWithContact({
                            tripId: id,
                            guestMemberId: linkingGuestMember.id,
                            guestName: linkingGuestMember.name,
                            contact,
                          });
                          setLinkingGuestMember(null);
                        } finally {
                          setLinkingContactId(null);
                        }
                      }}
                    >
                      <View
                        style={[styles.guestAvatar, { backgroundColor: colors.primaryLight }]}
                      >
                        <Text style={[styles.guestAvatarText, { color: colors.primaryDark }]}>
                          {contact.name.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.contactItemName, { color: colors.text }]}>
                          {contact.name}
                        </Text>
                        <Text style={[styles.contactItemPhone, { color: colors.textSecondary }]}>
                          {contact.phoneNumber || 'Phone Contact'}
                        </Text>
                      </View>
                      <View
                        style={[styles.addContactActionBtn, { backgroundColor: colors.primary }]}
                      >
                        {isLinkingThis ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <Text style={[styles.addContactActionText, { color: '#FFFFFF' }]}>
                            Link
                          </Text>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />
            </View>
          </KeyboardAvoidingView>
        </Modal>
      )}

      {/* Three-Dots Options Sidebar Drawer for Info Screen */}
      {optionsSidebarOpen && (
        <Modal
          visible={optionsSidebarOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setOptionsSidebarOpen(false)}
        >
          <View style={styles.sidebarOverlay}>
            <TouchableOpacity
              style={styles.sidebarBackdrop}
              activeOpacity={1}
              onPress={() => setOptionsSidebarOpen(false)}
            />

            <View
              style={[
                styles.sidebarDrawer,
                { backgroundColor: colors.card, borderLeftColor: colors.border },
              ]}
            >
              <View style={[styles.sidebarHeader, { backgroundColor: headerBg }]}>
                <View style={styles.sidebarHeaderTopRow}>
                  <View style={[styles.sidebarAvatar, { backgroundColor: colors.primaryLight }]}>
                    {isFriendSplit ? (
                      <Text style={[styles.headerAvatarText, { color: colors.primary }]}>
                        {cleanFriendName.charAt(0).toUpperCase()}
                      </Text>
                    ) : (
                      <Ionicons name="airplane" size={22} color={colors.primary} />
                    )}
                  </View>
                  <TouchableOpacity
                    style={[styles.sidebarCloseBtn, { backgroundColor: colors.cardSecondary }]}
                    onPress={() => setOptionsSidebarOpen(false)}
                  >
                    <Ionicons name="close" size={22} color={colors.text} />
                  </TouchableOpacity>
                </View>

                <Text style={[styles.sidebarTitle, { color: colors.text }]} numberOfLines={1}>
                  {isFriendSplit ? cleanFriendName : trip.name}
                </Text>
                <Text style={[styles.sidebarSubtitle, { color: colors.textSecondary }]} numberOfLines={2}>
                  {effectiveSubtitleInfo}
                </Text>
              </View>

              <View style={styles.sidebarBody}>
                <Text style={[styles.sidebarSectionLabel, { color: colors.textMuted }]}>
                  TABS & NAVIGATION
                </Text>

                <TouchableOpacity
                  style={[styles.sidebarMenuItem, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    setOptionsSidebarOpen(false);
                    setActiveTab('expenses');
                  }}
                >
                  <View style={[styles.sidebarIconBox, { backgroundColor: 'rgba(99, 102, 241, 0.14)' }]}>
                    <Ionicons name="receipt-outline" size={19} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sidebarMenuTitle, { color: colors.text }]}>Expenses</Text>
                    <Text style={[styles.sidebarMenuSub, { color: colors.textSecondary }]}>
                      {expenses.length} expenses logged
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.sidebarMenuItem, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    setOptionsSidebarOpen(false);
                    setActiveTab('members');
                  }}
                >
                  <View style={[styles.sidebarIconBox, { backgroundColor: 'rgba(16, 185, 129, 0.14)' }]}>
                    <Ionicons name="people-outline" size={19} color="#10B981" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sidebarMenuTitle, { color: colors.text }]}>Members</Text>
                    <Text style={[styles.sidebarMenuSub, { color: colors.textSecondary }]}>
                      {members.length} members in trip
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.sidebarMenuItem, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    setOptionsSidebarOpen(false);
                    setActiveTab('balances');
                  }}
                >
                  <View style={[styles.sidebarIconBox, { backgroundColor: 'rgba(245, 158, 11, 0.14)' }]}>
                    <Ionicons name="wallet-outline" size={19} color="#F59E0B" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sidebarMenuTitle, { color: colors.text }]}>Balances</Text>
                    <Text style={[styles.sidebarMenuSub, { color: colors.textSecondary }]}>
                      Member balances
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.sidebarMenuItem, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    setOptionsSidebarOpen(false);
                    setActiveTab('settle');
                  }}
                >
                  <View style={[styles.sidebarIconBox, { backgroundColor: 'rgba(239, 68, 68, 0.14)' }]}>
                    <Ionicons name="cash-outline" size={19} color="#EF4444" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sidebarMenuTitle, { color: colors.text }]}>Settle Up</Text>
                    <Text style={[styles.sidebarMenuSub, { color: colors.textSecondary }]}>
                      Pay via UPI & share summary
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

                <TouchableOpacity
                  style={[styles.sidebarMenuItem, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    setOptionsSidebarOpen(false);
                    setTimeout(() => {
                      router.push(`/trip/${id}/add`);
                    }, 80);
                  }}
                >
                  <View style={[styles.sidebarIconBox, { backgroundColor: 'rgba(99, 102, 241, 0.14)' }]}>
                    <Ionicons name="add-circle-outline" size={19} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sidebarMenuTitle, { color: colors.text }]}>Add Expense</Text>
                    <Text style={[styles.sidebarMenuSub, { color: colors.textSecondary }]}>
                      Add a new bill to {trip.name}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>

                {/* Settings: Trip Settings vs Friend Settings */}
                {!isFriendSplit ? (
                  <TouchableOpacity
                    style={[styles.sidebarMenuItem, { borderBottomColor: colors.border }]}
                    onPress={() => {
                      setOptionsSidebarOpen(false);
                      setTimeout(() => {
                        router.push(`/trip/${id}/settings`);
                      }, 80);
                    }}
                  >
                    <View style={[styles.sidebarIconBox, { backgroundColor: colors.primaryLight }]}>
                      <Ionicons name="settings-outline" size={19} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.sidebarMenuTitle, { color: colors.text }]}>Trip Settings</Text>
                      <Text style={[styles.sidebarMenuSub, { color: colors.textSecondary }]}>
                        Cover image, members, currency & options
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.sidebarMenuItem, { borderBottomColor: colors.border }]}
                    onPress={() => {
                      setOptionsSidebarOpen(false);
                      setTimeout(() => {
                        router.push({
                          pathname: '/chat/[id]/settings',
                          params: {
                            id,
                            friendName: cleanFriendName,
                            friendPhone: effectiveMembers.find(m => m.role !== 'admin')?.phone_number || '',
                            friendId: trip.friend_id || effectiveMembers.find(m => m.role !== 'admin')?.profile_id || '',
                          },
                        });
                      }, 80);
                    }}
                  >
                    <View style={[styles.sidebarIconBox, { backgroundColor: colors.primaryLight }]}>
                      <Ionicons name="person-circle-outline" size={19} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.sidebarMenuTitle, { color: colors.text }]}>Friend Settings</Text>
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
    </View>
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
  headerTitleContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 6,
  },
  headerAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  headerAvatarText: {
    fontSize: 16,
    fontWeight: '800',
  },
  headerTitleCol: {
    flex: 1,
  },
  headerTitleText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerSubtitleText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.78)',
    marginTop: 1,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerCodeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.22)',
    gap: 4,
  },
  headerCodeBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  headerMenuBtn: {
    padding: 6,
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
    elevation: 16,
  },
  sidebarHeader: {
    paddingTop: 56,
    paddingBottom: 18,
    paddingHorizontal: 18,
  },
  sidebarHeaderTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sidebarAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  sidebarSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 4,
    lineHeight: 17,
  },
  sidebarBody: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  sidebarSectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sidebarMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  sidebarIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarMenuTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  sidebarMenuSub: {
    fontSize: 11,
    marginTop: 2,
  },
  expenseCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  expIconContainer: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  expIconEmoji: {
    fontSize: 20,
  },
  expDetailsCol: {
    flex: 1,
    marginRight: 8,
  },
  expDescText: {
    fontSize: 15,
    fontWeight: '700',
  },
  expMetaText: {
    fontSize: 12,
    marginTop: 3,
  },
  expAmountCol: {
    alignItems: 'flex-end',
  },
  expAmountText: {
    fontSize: 16,
    fontWeight: '800',
  },
  expViewText: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 3,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 13,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: theme.colors.primary,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    fontWeight: '800',
  },
  tabContainer: {
    flex: 1,
  },
  listContent: {
    padding: 16,
    gap: 10,
    paddingBottom: 72,
  },
  memberActionRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
    gap: 10,
  },
  addMemberBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  addMemberBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  shareCodeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  shareCodeText: {
    fontWeight: '700',
    fontSize: 13,
  },
  memberCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  memberAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  memberAvatarText: {
    fontSize: 16,
    fontWeight: '800',
  },
  memberDetails: {
    flex: 1,
  },
  memberNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  memberName: {
    fontSize: 15,
    fontWeight: '700',
  },
  adminBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  adminBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  memberSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  phoneTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  phoneTagText: {
    fontSize: 12,
  },
  typeBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  memberInviteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    gap: 4,
  },
  memberInviteBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  balanceCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  balanceInfo: {
    flex: 1,
  },
  balanceMemberName: {
    fontSize: 15,
    fontWeight: '700',
  },
  balanceSub: {
    fontSize: 12,
    marginTop: 3,
  },
  balanceAmountCol: {
    alignItems: 'flex-end',
  },
  balanceNet: {
    fontSize: 16,
    fontWeight: '800',
  },
  netLabel: {
    fontSize: 11,
    marginTop: 2,
  },
  settleBanner: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  settleTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  settleDesc: {
    fontSize: 13,
    marginTop: 4,
    marginBottom: 14,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#25D366',
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  shareBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  settleCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  settleCardInfo: {
    flex: 1,
  },
  settleRoute: {
    fontSize: 14,
  },
  bold: {
    fontWeight: '700',
  },
  settleAmount: {
    fontSize: 18,
    fontWeight: '800',
    marginTop: 4,
  },
  payUpiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 5,
  },
  payUpiBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  emptyView: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyIcon: {
    fontSize: 44,
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  emptySub: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
  },
  loadMoreBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    marginTop: 8,
  },
  loadMoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadMoreText: {
    fontWeight: '700',
    fontSize: 13,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  memberModalContainer: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    maxHeight: '88%',
    minHeight: '65%',
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  modalSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  modalCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSearchSection: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
  },
  importContactsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    marginTop: 10,
    gap: 6,
  },
  importContactsText: {
    fontWeight: '700',
    fontSize: 13,
  },
  modalScrollArea: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  manualAddCard: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  manualAddTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  manualAddDesc: {
    fontSize: 12,
    marginTop: 4,
    lineHeight: 17,
  },
  manualPhoneInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
  },
  manualAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    borderRadius: 10,
    marginTop: 10,
    gap: 6,
  },
  manualAddBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  sectionBlock: {
    marginBottom: 18,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionHeading: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  sectionSub: {
    fontSize: 11,
  },
  contactItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  regAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  regAvatarText: {
    fontSize: 15,
    fontWeight: '800',
  },
  guestAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  guestAvatarText: {
    fontSize: 15,
    fontWeight: '800',
  },
  contactItemName: {
    fontSize: 14,
    fontWeight: '700',
  },
  contactItemPhone: {
    fontSize: 12,
    marginTop: 2,
  },
  addContactActionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    minWidth: 64,
    alignItems: 'center',
  },
  addContactActionText: {
    fontSize: 12,
    fontWeight: '700',
  },
  quickWhatsAppBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
