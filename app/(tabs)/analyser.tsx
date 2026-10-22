import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
  FlatList,
  TextInput,
  ActivityIndicator,
  InteractionManager,
  KeyboardAvoidingView,
  Platform,
  Share,
  Image,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/useThemeStore';
import {
  useTripStore,
  computeBalances,
  normalizeExpensesForTrip,
  findMyMember,
  normalizePhone,
} from '../../src/features/trips/useTripStore';
import { useContactsStore } from '../../src/features/contacts/useContactsStore';
import { useAuthStore } from '../../src/features/auth/useAuthStore';
import { AppStorage } from '../../src/lib/storage';
import { Trip, TripMember, TripBalanceRow } from '../../src/types/database';
import { formatCurrencyAmount, getUserCurrencyPreference } from '../../src/services/currency';
import AnalyserSkeleton from '../../src/components/AnalyserSkeleton';
import { DraggableBottomSheet } from '../../src/components/DraggableBottomSheet';

const PAGE_SIZE = 10;
const INLINE_TRIPS_LIMIT = 5;
const INLINE_EXPENSES_LIMIT = 10;

const CATEGORY_ICONS: Record<string, { icon: any; color: string; bg: string }> = {
  Food: { icon: 'fast-food', color: '#F59E0B', bg: '#FEF3C7' },
  Stay: { icon: 'bed', color: '#6366F1', bg: '#EEF2FF' },
  Fuel: { icon: 'car', color: '#EF4444', bg: '#FEE2E2' },
  Tickets: { icon: 'ticket', color: '#8B5CF6', bg: '#F3E8FF' },
  Groceries: { icon: 'cart', color: '#10B981', bg: '#ECFDF5' },
  General: { icon: 'pricetag', color: '#3B82F6', bg: '#EFF6FF' },
  Shopping: { icon: 'bag-handle', color: '#EC4899', bg: '#FCE7F3' },
  Entertainment: { icon: 'film', color: '#F97316', bg: '#FFEDD5' },
};

const SORT_OPTIONS = [
  { id: 'date_desc', label: 'Newest First', icon: 'calendar-outline' },
  { id: 'date_asc', label: 'Oldest First', icon: 'hourglass-outline' },
  { id: 'amount_desc', label: 'Amount: High to Low', icon: 'arrow-down-outline' },
  { id: 'amount_asc', label: 'Amount: Low to High', icon: 'arrow-up-outline' },
  { id: 'name_asc', label: 'Title: A to Z', icon: 'text-outline' },
] as const;

type SortOptionId = (typeof SORT_OPTIONS)[number]['id'];
type TimeframeFilter = 'all' | 'today' | 'week' | 'month';
type PaymentFilter = 'all' | 'upi' | 'cash' | 'other';
type PayerFilter = 'all' | 'me' | 'others';
type ViewMode = 'all' | 'daily' | 'categories' | 'transactions';

interface TripCachedAnalytics {
  members: TripMember[];
  expenses: any[];
  balances: TripBalanceRow[];
}

interface AnalyzedExpenseItem {
  id: string;
  trip_id: string;
  trip_name: string;
  amount: number;
  description: string;
  category: string;
  payment_mode: string;
  dateStr: string;
  dateObj: Date;
  paid_by: string;
  payerName: string;
  isMyExpense: boolean;
  currency: string;
  mySharePaise: number;
  splits?: any[];
  involvedMemberKeys?: string[];
  involvedMemberNames?: string[];
}

export interface PersonFilterItem {
  id: string;
  name: string;
  isCurrentUser: boolean;
  phone?: string | null;
  tripIds: string[];
  tripNames: string[];
  expenseCount: number;
  avatarUrl?: string | null;
  isFriend?: boolean;
}

interface DailySpendGroup {
  dateKey: string;
  displayLabel: string;
  formattedDate: string;
  totalPaise: number;
  count: number;
  expenses: AnalyzedExpenseItem[];
}

export default function AnalyserScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const { user, profile } = useAuthStore();
  const currentUserPhone =
    profile?.phone_number || (user as any)?.phone || (user as any)?.user_metadata?.phone_number;
  const { trips, expenses, members, initTrips } = useTripStore();
  const contacts = useContactsStore(s => s.contacts);
  const fetchFriendsSummary = useContactsStore(s => s.fetchFriendsSummary);

  // Primary filters
  const [selectedTripFilter, setSelectedTripFilter] = useState<string>('all');
  const [selectedPersonFilter, setSelectedPersonFilter] = useState<string>('all');
  const [userCurrency, setUserCurrency] = useState('INR');
  const [refreshing, setRefreshing] = useState(false);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [allTripsData, setAllTripsData] = useState<Record<string, TripCachedAnalytics>>({});

  // Search & Filter & Sort state ("filter search short")
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');
  const [selectedTimeframe, setSelectedTimeframe] = useState<TimeframeFilter>('all');
  const [selectedPaymentMode, setSelectedPaymentMode] = useState<PaymentFilter>('all');
  const [selectedPayerFilter, setSelectedPayerFilter] = useState<PayerFilter>('all');
  const [selectedSort, setSelectedSort] = useState<SortOptionId>('date_desc');
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [sortModalVisible, setSortModalVisible] = useState(false);

  // View mode switcher: Default is 'all' (shows entire dashboard)
  const [viewMode, setViewMode] = useState<ViewMode>('all');

  // Daily Expenses UI state
  const [expandedDateKeys, setExpandedDateKeys] = useState<Record<string, boolean>>({});

  // View More All Trips Modal state
  const [allTripsModalVisible, setAllTripsModalVisible] = useState(false);
  const [tripSearchQuery, setTripSearchQuery] = useState('');
  const [modalVisibleCount, setModalVisibleCount] = useState(PAGE_SIZE);
  const [modalLoadingMore, setModalLoadingMore] = useState(false);
  const [openingTripId, setOpeningTripId] = useState<string | null>(null);
  const navLockRef = React.useRef(false);

  const loadAllTripsAnalytics = useCallback(async () => {
    setLoadingAnalytics(true);
    try {
      const currentTrips = useTripStore.getState().trips;
      const result: Record<string, TripCachedAnalytics> = {};

      for (const t of currentTrips) {
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

        if (tMembers.length === 0) {
          tMembers = useTripStore.getState().members.filter(m => m.trip_id === t.id);
        }
        if (tExpenses.length === 0) {
          tExpenses = useTripStore.getState().expenses.filter(e => e.trip_id === t.id);
        }

        const normalizedExps = normalizeExpensesForTrip(tExpenses, tMembers);
        const tBalances = computeBalances(t.id, tMembers, normalizedExps);

        result[t.id] = {
          members: tMembers,
          expenses: normalizedExps,
          balances: tBalances,
        };
      }

      setAllTripsData(result);
    } finally {
      setLoadingAnalytics(false);
    }
  }, []);

  useEffect(() => {
    getUserCurrencyPreference().then(c => setUserCurrency(c));
    loadAllTripsAnalytics();
    if (user?.id) {
      fetchFriendsSummary(user.id);
    }
  }, [trips, expenses, members, user?.id, loadAllTripsAnalytics, fetchFriendsSummary]);

  useFocusEffect(
    useCallback(() => {
      navLockRef.current = false;
      setOpeningTripId(null);
      const task = InteractionManager.runAfterInteractions(() => {
        getUserCurrencyPreference().then(c => setUserCurrency(c));
        loadAllTripsAnalytics();
        if (user?.id) {
          fetchFriendsSummary(user.id);
        }
      });
      return () => task.cancel();
    }, [user?.id, loadAllTripsAnalytics, fetchFriendsSummary])
  );

  const handleOpenTrip = async (tripId: string, closeModalFirst = false) => {
    if (navLockRef.current || openingTripId) return;
    navLockRef.current = true;
    setOpeningTripId(tripId);
    await new Promise(resolve => setTimeout(resolve, 25));
    if (closeModalFirst) {
      setAllTripsModalVisible(false);
      setTimeout(() => {
        router.push(`/trip/${tripId}`);
      }, 120);
    } else {
      router.push(`/trip/${tripId}`);
    }
    setTimeout(() => {
      navLockRef.current = false;
      setOpeningTripId(null);
    }, 900);
  };

  const handleOpenExpense = (tripId: string, expenseId: string) => {
    router.push(`/trip/${tripId}/expense/${expenseId}`);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await initTrips();
    await loadAllTripsAnalytics();
    if (user?.id) {
      await fetchFriendsSummary(user.id);
    }
    setRefreshing(false);
  };

  // Unique Group Trips ONLY (excludes 1-on-1 friend splits)
  const uniqueGroupTrips = useMemo(() => {
    const groupOnly = trips.filter(
      t =>
        t.trip_type !== 'friend_split' &&
        !(t as any).is_friend_split &&
        !t.name.toLowerCase().startsWith('split with ')
    );

    const sorted = [...groupOnly].sort(
      (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    );

    const seenIds = new Set<string>();
    const byNameMap = new Map<string, Trip>();

    for (const t of sorted) {
      if (!t || !t.id || seenIds.has(t.id)) continue;
      seenIds.add(t.id);

      const cleanName = t.name.trim().toLowerCase();
      const existing = byNameMap.get(cleanName);
      if (!existing) {
        byNameMap.set(cleanName, t);
      } else {
        const existingExpCount = allTripsData[existing.id]?.expenses?.length || 0;
        const currentExpCount = allTripsData[t.id]?.expenses?.length || 0;
        if (currentExpCount > existingExpCount) {
          byNameMap.set(cleanName, t);
        }
      }
    }

    return Array.from(byNameMap.values());
  }, [trips, allTripsData]);

  const latestFiveGroupTrips = useMemo(() => {
    return uniqueGroupTrips.slice(0, INLINE_TRIPS_LIMIT);
  }, [uniqueGroupTrips]);

  const filteredModalTrips = useMemo(() => {
    if (!tripSearchQuery.trim()) return uniqueGroupTrips;
    const q = tripSearchQuery.toLowerCase().trim();
    return uniqueGroupTrips.filter(t => t.name.toLowerCase().includes(q));
  }, [uniqueGroupTrips, tripSearchQuery]);

  const paginatedModalTrips = useMemo(() => {
    return filteredModalTrips.slice(0, modalVisibleCount);
  }, [filteredModalTrips, modalVisibleCount]);

  const hasMoreModalTrips = modalVisibleCount < filteredModalTrips.length;

  useEffect(() => {
    setModalVisibleCount(PAGE_SIZE);
  }, [tripSearchQuery]);

  const handleLoadMoreModalTrips = () => {
    if (!hasMoreModalTrips || modalLoadingMore) return;
    setModalLoadingMore(true);
    setTimeout(() => {
      setModalVisibleCount(prev => prev + PAGE_SIZE);
      setModalLoadingMore(false);
    }, 250);
  };

  const uniqueAllTrips = useMemo(() => {
    const seen = new Set<string>();
    return trips.filter(t => {
      if (!t?.id || seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  }, [trips]);

  // Aggregate master raw expense items for the selected trip(s)
  const allRawExpenseItems = useMemo(() => {
    const targetTrips =
      selectedTripFilter === 'all'
        ? uniqueAllTrips
        : uniqueAllTrips.filter(t => t.id === selectedTripFilter);

    const items: AnalyzedExpenseItem[] = [];

    for (const t of targetTrips) {
      const data = allTripsData[t.id];
      if (!data) continue;

      const myMember = findMyMember(data.members, user?.id, currentUserPhone) || data.members[0];

      for (const exp of data.expenses) {
        const rawDate = exp.date || exp.expense_date || exp.created_at || new Date().toISOString();
        const dObj = new Date(rawDate);
        const validDateObj = isNaN(dObj.getTime()) ? new Date() : dObj;

        const pMember = data.members.find(
          m => m.id === exp.paid_by || (m.profile_id && m.profile_id === exp.paid_by)
        );
        const payerName = exp.payerName || pMember?.display_name || 'Member';
        const isMyExpense = Boolean(
          myMember &&
            (exp.paid_by === myMember.id ||
              (myMember.profile_id && exp.paid_by === myMember.profile_id))
        );

        let mySharePaise = 0;
        if (Array.isArray(exp.splits) && exp.splits.length > 0) {
          const mySplit = exp.splits.find(
            (s: any) =>
              (myMember && s.member_id === myMember.id) ||
              (myMember?.profile_id && s.profile_id === myMember.profile_id)
          );
          if (mySplit) {
            mySharePaise = Number(mySplit.amount || mySplit.share_amount || 0);
          }
        } else if (data.members.length > 0) {
          mySharePaise = Math.round((Number(exp.amount) || 0) / data.members.length);
        }

        // Collect member IDs, phones, and display names involved in this expense
        const involvedMemberKeys = new Set<string>();
        const involvedMemberNames = new Set<string>();

        if (exp.paid_by) involvedMemberKeys.add(exp.paid_by);
        if (pMember?.profile_id) involvedMemberKeys.add(pMember.profile_id);
        if (pMember?.phone_number) involvedMemberKeys.add(normalizePhone(pMember.phone_number));
        if (payerName) involvedMemberNames.add(payerName.toLowerCase());
        if (isMyExpense) {
          involvedMemberKeys.add('__current_user__');
          involvedMemberNames.add('you');
        }

        if (Array.isArray(exp.splits)) {
          for (const s of exp.splits) {
            if (s.member_id) involvedMemberKeys.add(s.member_id);
            if (s.profile_id) involvedMemberKeys.add(s.profile_id);
            const sm = data.members.find(m => m.id === s.member_id || (m.profile_id && m.profile_id === s.profile_id));
            if (sm?.display_name) involvedMemberNames.add(sm.display_name.toLowerCase());
            if (sm?.phone_number) involvedMemberKeys.add(normalizePhone(sm.phone_number));
            if (myMember && (s.member_id === myMember.id || (myMember.profile_id && s.profile_id === myMember.profile_id))) {
              involvedMemberKeys.add('__current_user__');
              involvedMemberNames.add('you');
            }
          }
        }

        items.push({
          id: exp.id || `${t.id}-${Math.random()}`,
          trip_id: t.id,
          trip_name: t.name,
          amount: Number(exp.amount) || 0,
          description: exp.description || 'Expense',
          category: exp.category || 'General',
          payment_mode: exp.payment_mode || 'other',
          dateStr: rawDate,
          dateObj: validDateObj,
          paid_by: exp.paid_by,
          payerName,
          isMyExpense,
          currency: t.currency || userCurrency,
          mySharePaise,
          splits: exp.splits || [],
          involvedMemberKeys: Array.from(involvedMemberKeys),
          involvedMemberNames: Array.from(involvedMemberNames),
        });
      }
    }

    return items;
  }, [uniqueAllTrips, allTripsData, selectedTripFilter, user?.id, currentUserPhone, userCurrency]);

  // Extract all distinct people (trip members + friends from contacts) across the currently selected trip scope (or all trips)
  const availablePeople = useMemo<PersonFilterItem[]>(() => {
    const targetTrips =
      selectedTripFilter === 'all'
        ? uniqueAllTrips
        : uniqueAllTrips.filter(t => t.id === selectedTripFilter);

    const peopleMap = new Map<string, PersonFilterItem>();
    const currentUserId = user?.id || profile?.id;

    for (const t of targetTrips) {
      const data = allTripsData[t.id];
      if (!data) continue;

      const myMember = findMyMember(data.members, user?.id, currentUserPhone);

      for (const m of data.members) {
        const isCurrent = Boolean(
          (myMember && m.id === myMember.id) ||
            (currentUserId && (m.profile_id === currentUserId || m.user_id === currentUserId)) ||
            (currentUserPhone &&
              m.phone_number &&
              normalizePhone(currentUserPhone) === normalizePhone(m.phone_number))
        );

        const key = isCurrent
          ? '__current_user__'
          : m.profile_id
          ? m.profile_id
          : m.phone_number
          ? normalizePhone(m.phone_number)
          : m.display_name.trim().toLowerCase();

        let existing = peopleMap.get(key);
        if (!existing) {
          existing = {
            id: key,
            name: isCurrent ? 'You' : m.display_name || 'Member',
            isCurrentUser: isCurrent,
            phone: m.phone_number || null,
            tripIds: [t.id],
            tripNames: [t.name],
            expenseCount: 0,
            avatarUrl: null,
            isFriend: false,
          };
          peopleMap.set(key, existing);
        } else {
          if (!existing.tripIds.includes(t.id)) {
            existing.tripIds.push(t.id);
            existing.tripNames.push(t.name);
          }
        }
      }
    }

    // Merge friends from contacts store
    if (Array.isArray(contacts)) {
      for (const c of contacts) {
        if (!c || !c.name) continue;
        const cleanPhone = c.phoneNumber ? normalizePhone(c.phoneNumber) : null;
        const isCurrent = Boolean(
          (currentUserId && c.profileId === currentUserId) ||
          (currentUserPhone && cleanPhone && normalizePhone(currentUserPhone) === cleanPhone)
        );
        if (isCurrent) continue;

        const key = c.profileId
          ? c.profileId
          : cleanPhone
          ? cleanPhone
          : c.name.trim().toLowerCase();

        let existing = peopleMap.get(key);
        if (!existing) {
          const lowerName = c.name.trim().toLowerCase();
          for (const [_, val] of peopleMap.entries()) {
            if (val.name.trim().toLowerCase() === lowerName) {
              existing = val;
              break;
            }
          }
        }

        if (existing) {
          existing.isFriend = true;
          if (c.avatarUrl && !existing.avatarUrl) existing.avatarUrl = c.avatarUrl;
          if (cleanPhone && !existing.phone) existing.phone = c.phoneNumber;
        } else {
          peopleMap.set(key, {
            id: key,
            name: c.name.trim(),
            isCurrentUser: false,
            phone: c.phoneNumber || null,
            tripIds: c.defaultTripId ? [c.defaultTripId] : [],
            tripNames: [],
            expenseCount: 0,
            avatarUrl: c.avatarUrl || null,
            isFriend: true,
          });
        }
      }
    }

    // Add any explicit payers from raw expenses who are not yet in the map
    for (const exp of allRawExpenseItems) {
      if (exp.payerName && exp.payerName !== 'Member' && exp.payerName !== 'You') {
        const lowerName = exp.payerName.trim().toLowerCase();
        let found = false;
        for (const [_, val] of peopleMap.entries()) {
          if (val.name.trim().toLowerCase() === lowerName) {
            found = true;
            break;
          }
        }
        if (!found) {
          peopleMap.set(lowerName, {
            id: exp.paid_by || lowerName,
            name: exp.payerName.trim(),
            isCurrentUser: false,
            phone: null,
            tripIds: [exp.trip_id],
            tripNames: [exp.trip_name],
            expenseCount: 0,
            avatarUrl: null,
            isFriend: false,
          });
        }
      }
    }

    // Tally matching expenses for each person
    for (const exp of allRawExpenseItems) {
      for (const person of peopleMap.values()) {
        const pLower = person.name.toLowerCase().trim();
        const matchesKey =
          exp.involvedMemberKeys &&
          (exp.involvedMemberKeys.includes(person.id) ||
            (person.phone && exp.involvedMemberKeys.includes(normalizePhone(person.phone))));
        const matchesName =
          (exp.payerName && exp.payerName.toLowerCase().trim() === pLower) ||
          (exp.involvedMemberNames &&
            exp.involvedMemberNames.some(
              n => n === pLower || n.includes(pLower) || pLower.includes(n)
            ));
        const isPayer =
          exp.paid_by === person.id ||
          (exp.payerName && exp.payerName.toLowerCase().trim() === pLower);

        if (matchesKey || matchesName || isPayer) {
          person.expenseCount += 1;
        }
      }
    }

    const list = Array.from(peopleMap.values());
    list.sort((a, b) => {
      if (a.isCurrentUser) return -1;
      if (b.isCurrentUser) return 1;
      if (b.expenseCount !== a.expenseCount) return b.expenseCount - a.expenseCount;
      if (a.isFriend && !b.isFriend) return -1;
      if (!a.isFriend && b.isFriend) return 1;
      return a.name.localeCompare(b.name);
    });

    return list;
  }, [
    uniqueAllTrips,
    allTripsData,
    selectedTripFilter,
    user?.id,
    profile?.id,
    currentUserPhone,
    contacts,
    allRawExpenseItems,
  ]);

  // Filtered & Sorted Expenses List (Trip, Person, Search, Category, Timeframe, Payment, Payer, Sort)
  const filteredAndSortedExpenses = useMemo(() => {
    let result = [...allRawExpenseItems];

    // 1. Person filter
    if (selectedPersonFilter !== 'all') {
      const targetPerson = availablePeople.find(
        p =>
          p.id === selectedPersonFilter ||
          p.name.toLowerCase() === selectedPersonFilter.toLowerCase()
      );
      if (targetPerson) {
        result = result.filter(exp => {
          if (targetPerson.isCurrentUser) {
            return (
              exp.isMyExpense ||
              (exp.involvedMemberKeys && exp.involvedMemberKeys.includes('__current_user__'))
            );
          }
          const matchesKey =
            exp.involvedMemberKeys &&
            (exp.involvedMemberKeys.includes(targetPerson.id) ||
              (targetPerson.phone &&
                exp.involvedMemberKeys.includes(normalizePhone(targetPerson.phone))));
          const matchesName =
            exp.involvedMemberNames &&
            exp.involvedMemberNames.includes(targetPerson.name.toLowerCase());
          const isPayer =
            exp.paid_by === targetPerson.id ||
            exp.payerName.toLowerCase() === targetPerson.name.toLowerCase();
          return matchesKey || matchesName || isPayer;
        });
      }
    }

    // 2. Search query (notes, trips, payers, categories, and involved members)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(exp => {
        const descMatch = exp.description.toLowerCase().includes(q);
        const tripMatch = exp.trip_name.toLowerCase().includes(q);
        const payerMatch = exp.payerName.toLowerCase().includes(q);
        const catMatch = exp.category.toLowerCase().includes(q);
        const memberMatch =
          exp.involvedMemberNames && exp.involvedMemberNames.some(n => n.includes(q));
        const amtStr = (exp.amount / 100).toString();
        const amtMatch = amtStr.includes(q);
        return descMatch || tripMatch || payerMatch || catMatch || memberMatch || amtMatch;
      });
    }

    // 3. Category filter
    if (selectedCategoryFilter !== 'all') {
      result = result.filter(
        exp => exp.category.toLowerCase() === selectedCategoryFilter.toLowerCase()
      );
    }

    // 4. Timeframe filter
    if (selectedTimeframe !== 'all') {
      const now = new Date();
      result = result.filter(exp => {
        const diffMs = now.getTime() - exp.dateObj.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        if (selectedTimeframe === 'today') {
          return exp.dateObj.toDateString() === now.toDateString();
        } else if (selectedTimeframe === 'week') {
          return diffDays <= 7;
        } else if (selectedTimeframe === 'month') {
          return diffDays <= 30;
        }
        return true;
      });
    }

    // 5. Payment mode filter
    if (selectedPaymentMode !== 'all') {
      result = result.filter(exp => {
        if (selectedPaymentMode === 'other') {
          return exp.payment_mode !== 'upi' && exp.payment_mode !== 'cash';
        }
        return exp.payment_mode === selectedPaymentMode;
      });
    }

    // 6. Who paid filter
    if (selectedPayerFilter !== 'all') {
      result = result.filter(exp => {
        if (selectedPayerFilter === 'me') {
          return exp.isMyExpense;
        }
        return !exp.isMyExpense;
      });
    }

    // 7. Sort
    result.sort((a, b) => {
      switch (selectedSort) {
        case 'date_desc':
          return b.dateObj.getTime() - a.dateObj.getTime();
        case 'date_asc':
          return a.dateObj.getTime() - b.dateObj.getTime();
        case 'amount_desc':
          return b.amount - a.amount;
        case 'amount_asc':
          return a.amount - b.amount;
        case 'name_asc':
          return a.description.localeCompare(b.description);
        default:
          return b.dateObj.getTime() - a.dateObj.getTime();
      }
    });

    return result;
  }, [
    allRawExpenseItems,
    selectedPersonFilter,
    availablePeople,
    searchQuery,
    selectedCategoryFilter,
    selectedTimeframe,
    selectedPaymentMode,
    selectedPayerFilter,
    selectedSort,
  ]);

  // General spending analytics across the currently filtered dataset
  const analytics = useMemo(() => {
    let totalPaise = 0;
    let yourPaidPaise = 0;
    let yourSharePaise = 0;
    let totalExpenseCount = 0;
    let maxExpense: AnalyzedExpenseItem | null = null;

    const categoryTotals: Record<string, { amount: number; count: number }> = {
      Food: { amount: 0, count: 0 },
      Stay: { amount: 0, count: 0 },
      Fuel: { amount: 0, count: 0 },
      Tickets: { amount: 0, count: 0 },
      Groceries: { amount: 0, count: 0 },
      General: { amount: 0, count: 0 },
      Shopping: { amount: 0, count: 0 },
      Entertainment: { amount: 0, count: 0 },
    };

    const paymentModeTotals: Record<string, number> = {
      upi: 0,
      cash: 0,
      other: 0,
    };

    const targetPerson =
      selectedPersonFilter !== 'all'
        ? availablePeople.find(
            p =>
              p.id === selectedPersonFilter ||
              p.name.toLowerCase() === selectedPersonFilter.toLowerCase()
          )
        : null;

    const isCustomPerson = Boolean(targetPerson && !targetPerson.isCurrentUser);

    for (const exp of filteredAndSortedExpenses) {
      totalPaise += exp.amount;
      totalExpenseCount += 1;

      if (!maxExpense || exp.amount > maxExpense.amount) {
        maxExpense = exp;
      }

      // Calculate Paid & Share based on active person filter
      if (isCustomPerson && targetPerson) {
        const isPayer =
          exp.paid_by === targetPerson.id ||
          exp.payerName.toLowerCase() === targetPerson.name.toLowerCase();
        if (isPayer) {
          yourPaidPaise += exp.amount;
        }

        // Person's share in this expense
        let personShareFound = false;
        if (Array.isArray(exp.splits) && exp.splits.length > 0) {
          const split = exp.splits.find(
            (s: any) =>
              s.member_id === targetPerson.id ||
              s.profile_id === targetPerson.id ||
              (targetPerson.phone &&
                s.phone_number &&
                normalizePhone(s.phone_number) === normalizePhone(targetPerson.phone))
          );
          if (split) {
            yourSharePaise += Number(split.amount || split.share_amount || 0);
            personShareFound = true;
          }
        }
        if (
          !personShareFound &&
          exp.involvedMemberNames &&
          exp.involvedMemberNames.includes(targetPerson.name.toLowerCase())
        ) {
          const splitCount = exp.splits && exp.splits.length > 0 ? exp.splits.length : 2;
          yourSharePaise += Math.round(exp.amount / splitCount);
        }
      } else {
        // Current user or overall view
        if (exp.isMyExpense) {
          yourPaidPaise += exp.amount;
        }
        yourSharePaise += exp.mySharePaise;
      }

      const cat = categoryTotals[exp.category] ? exp.category : 'General';
      categoryTotals[cat].amount += exp.amount;
      categoryTotals[cat].count += 1;

      const mode =
        exp.payment_mode === 'cash' || exp.payment_mode === 'upi' ? exp.payment_mode : 'other';
      paymentModeTotals[mode] = (paymentModeTotals[mode] || 0) + exp.amount;
    }

    const sortedCategories = Object.entries(categoryTotals)
      .filter(([_, val]) => val.amount > 0)
      .map(([name, val]) => ({
        name,
        amount: val.amount,
        count: val.count,
        percentage: totalPaise > 0 ? Math.round((val.amount / totalPaise) * 100) : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    const paidLabel =
      isCustomPerson && targetPerson ? `${targetPerson.name} Paid` : 'You Paid';
    const shareLabel =
      isCustomPerson && targetPerson ? `${targetPerson.name}'s Share` : 'Your Share';

    return {
      totalPaise,
      yourPaidPaise,
      yourSharePaise,
      paidLabel,
      shareLabel,
      count: totalExpenseCount,
      maxExpense,
      sortedCategories,
      paymentModeTotals,
    };
  }, [filteredAndSortedExpenses, selectedPersonFilter, availablePeople]);

  // Autocomplete Suggestions for Friends and Trips when searching (triggers after 3 letters)
  const searchSuggestions = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    // User requirement: list friends after typing 3 letters
    if (q.length < 3) return { trips: [], people: [] };

    const matchedTrips = uniqueAllTrips
      .filter(t => t.name.toLowerCase().includes(q))
      .slice(0, 4);

    const matchedPeople = availablePeople
      .filter(p => {
        if (p.isCurrentUser && 'you'.includes(q)) return true;
        const nameMatch = p.name.toLowerCase().includes(q);
        const phoneMatch = p.phone ? normalizePhone(p.phone).includes(q) : false;
        return nameMatch || phoneMatch;
      })
      .slice(0, 8);

    return { trips: matchedTrips, people: matchedPeople };
  }, [searchQuery, uniqueAllTrips, availablePeople]);

  // Daily Spending Analytics & Day-by-Day grouping ("daily expence")
  const dailySpendingData = useMemo(() => {
    const groupsMap = new Map<string, DailySpendGroup>();
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    for (const exp of filteredAndSortedExpenses) {
      const y = exp.dateObj.getFullYear();
      const m = String(exp.dateObj.getMonth() + 1).padStart(2, '0');
      const d = String(exp.dateObj.getDate()).padStart(2, '0');
      const dateKey = `${y}-${m}-${d}`;

      let group = groupsMap.get(dateKey);
      if (!group) {
        let displayLabel = exp.dateObj.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          weekday: 'short',
        });
        if (exp.dateObj.toDateString() === today.toDateString()) {
          displayLabel = 'Today';
        } else if (exp.dateObj.toDateString() === yesterday.toDateString()) {
          displayLabel = 'Yesterday';
        }

        const formattedDate = exp.dateObj.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });

        group = {
          dateKey,
          displayLabel,
          formattedDate,
          totalPaise: 0,
          count: 0,
          expenses: [],
        };
        groupsMap.set(dateKey, group);
      }

      group.totalPaise += exp.amount;
      group.count += 1;
      group.expenses.push(exp);
    }

    const sortedGroups = Array.from(groupsMap.values()).sort((a, b) =>
      b.dateKey.localeCompare(a.dateKey)
    );

    const activeDaysCount = sortedGroups.length;
    const totalFilteredPaise = filteredAndSortedExpenses.reduce((sum, e) => sum + e.amount, 0);
    const dailyAveragePaise =
      activeDaysCount > 0 ? Math.round(totalFilteredPaise / activeDaysCount) : 0;

    let peakDay: DailySpendGroup | null = null;
    for (const g of sortedGroups) {
      if (!peakDay || g.totalPaise > peakDay.totalPaise) {
        peakDay = g;
      }
    }

    const recentBarDays = [...sortedGroups].slice(0, 7).reverse();
    const maxBarSpend = Math.max(...recentBarDays.map(d => d.totalPaise), 1);

    return {
      groups: sortedGroups,
      activeDaysCount,
      dailyAveragePaise,
      peakDay,
      recentBarDays,
      maxBarSpend,
    };
  }, [filteredAndSortedExpenses]);

  const toggleDateExpansion = (dateKey: string) => {
    setExpandedDateKeys(prev => ({
      ...prev,
      [dateKey]: !prev[dateKey],
    }));
  };

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (selectedTripFilter !== 'all') count += 1;
    if (selectedPersonFilter !== 'all') count += 1;
    if (selectedCategoryFilter !== 'all') count += 1;
    if (selectedTimeframe !== 'all') count += 1;
    if (selectedPaymentMode !== 'all') count += 1;
    if (selectedPayerFilter !== 'all') count += 1;
    if (selectedSort !== 'date_desc') count += 1;
    return count;
  }, [
    selectedTripFilter,
    selectedPersonFilter,
    selectedCategoryFilter,
    selectedTimeframe,
    selectedPaymentMode,
    selectedPayerFilter,
    selectedSort,
  ]);

  const resetAllFilters = () => {
    setSelectedTripFilter('all');
    setSelectedPersonFilter('all');
    setSelectedCategoryFilter('all');
    setSelectedTimeframe('all');
    setSelectedPaymentMode('all');
    setSelectedPayerFilter('all');
    setSelectedSort('date_desc');
    setSearchQuery('');
  };

  const handleShareSummary = async () => {
    try {
      const tripTitle =
        selectedTripFilter === 'all'
          ? `All Trips (${uniqueGroupTrips.length})`
          : uniqueGroupTrips.find(t => t.id === selectedTripFilter)?.name || 'Trip';

      let message = `📊 Trip Spending Report: ${tripTitle}\n`;
      if (selectedPersonFilter !== 'all') {
        const pName =
          availablePeople.find(p => p.id === selectedPersonFilter)?.name || 'Member';
        message += `👤 Filtered Person: ${pName}\n`;
      }
      message += `━━━━━━━━━━━━━━━━━━━━━\n`;
      message += `💰 Total Spending: ${formatCurrencyAmount(analytics.totalPaise, userCurrency)}\n`;
      message += `👤 ${analytics.paidLabel}: ${formatCurrencyAmount(analytics.yourPaidPaise, userCurrency)}\n`;
      message += `🤝 ${analytics.shareLabel}: ${formatCurrencyAmount(analytics.yourSharePaise, userCurrency)}\n`;
      message += `🧾 Total Expenses: ${analytics.count}\n`;
      if (dailySpendingData.activeDaysCount > 0) {
        message += `📅 Daily Average: ${formatCurrencyAmount(dailySpendingData.dailyAveragePaise, userCurrency)}/day\n`;
      }
      if (analytics.sortedCategories.length > 0) {
        message += `\n🏷️ Top Categories:\n`;
        analytics.sortedCategories.slice(0, 3).forEach(c => {
          message += ` • ${c.name}: ${formatCurrencyAmount(c.amount, userCurrency)} (${c.percentage}%)\n`;
        });
      }
      if (analytics.maxExpense) {
        message += `\n🔥 Highest Expense: ${analytics.maxExpense.description} (${formatCurrencyAmount(analytics.maxExpense.amount, userCurrency)})\n`;
      }
      message += `━━━━━━━━━━━━━━━━━━━━━\nShared via SplitYourTrip`;

      await Share.share({
        message,
        title: `Spending Analysis - ${tripTitle}`,
      });
    } catch (e) {
      // share cancelled
    }
  };

  // Section visibility flags based on viewMode
  const showDailySection = viewMode === 'all' || viewMode === 'daily';
  const showCategoriesSection = viewMode === 'all' || viewMode === 'categories';
  const showTransactionsSection = viewMode === 'all' || viewMode === 'transactions';

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
        />
      }
    >
      {/* 1. Trip Selector Chips */}
      <View style={styles.filterSection}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
          <TouchableOpacity
            style={[
              styles.filterChip,
              {
                backgroundColor: selectedTripFilter === 'all' ? colors.primary : colors.card,
                borderColor: selectedTripFilter === 'all' ? colors.primary : colors.border,
              },
            ]}
            onPress={() => setSelectedTripFilter('all')}
          >
            <Ionicons
              name="globe-outline"
              size={14}
              color={selectedTripFilter === 'all' ? '#FFFFFF' : colors.textSecondary}
              style={{ marginRight: 5 }}
            />
            <Text
              style={[
                styles.filterChipText,
                { color: selectedTripFilter === 'all' ? '#FFFFFF' : colors.textSecondary },
              ]}
            >
              All ({uniqueGroupTrips.length} Trips)
            </Text>
          </TouchableOpacity>

          {uniqueGroupTrips.slice(0, PAGE_SIZE).map(trip => (
            <TouchableOpacity
              key={trip.id}
              style={[
                styles.filterChip,
                {
                  backgroundColor: selectedTripFilter === trip.id ? colors.primary : colors.card,
                  borderColor: selectedTripFilter === trip.id ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setSelectedTripFilter(trip.id)}
            >
              <Ionicons
                name="airplane-outline"
                size={13}
                color={selectedTripFilter === trip.id ? '#FFFFFF' : colors.textSecondary}
                style={{ marginRight: 4 }}
              />
              <Text
                style={[
                  styles.filterChipText,
                  { color: selectedTripFilter === trip.id ? '#FFFFFF' : colors.textSecondary },
                ]}
                numberOfLines={1}
              >
                {trip.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* 2. Hero Overview Card */}
      <View
        style={[
          styles.heroCard,
          {
            backgroundColor: isDark ? '#1E2738' : '#F0F4FF',
            borderColor: isDark ? 'rgba(120, 149, 183, 0.3)' : '#DDE5F8',
          },
        ]}
      >
        <View style={styles.heroTopBar}>
          <View style={styles.heroTagBadge}>
            <Ionicons name="analytics" size={13} color={colors.primary} />
            <Text style={[styles.heroLabel, { color: colors.primary }]}>
              SPENDING ANALYSER
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.shareHeaderBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#FFFFFF' }]}
            onPress={handleShareSummary}
          >
            <Ionicons name="share-social-outline" size={15} color={colors.primary} />
            <Text style={[styles.shareHeaderText, { color: colors.primary }]}>Share Report</Text>
          </TouchableOpacity>
        </View>

        {/* Active Filter Banner if Person or Trip is filtered */}
        {(selectedPersonFilter !== 'all' || selectedTripFilter !== 'all') && (
          <View
            style={[
              styles.heroActiveFilterBanner,
              { backgroundColor: isDark ? 'rgba(74, 144, 226, 0.15)' : 'rgba(74, 144, 226, 0.12)' },
            ]}
          >
            <Ionicons name="filter" size={12} color={colors.primary} />
            <Text style={[styles.heroActiveFilterText, { color: colors.primary }]} numberOfLines={1}>
              Filtered:{' '}
              {selectedTripFilter !== 'all'
                ? uniqueAllTrips.find(t => t.id === selectedTripFilter)?.name || 'Trip'
                : 'All Trips'}
              {selectedPersonFilter !== 'all'
                ? ` • ${availablePeople.find(p => p.id === selectedPersonFilter)?.name || 'Person'}`
                : ''}
            </Text>
            <TouchableOpacity
              onPress={() => {
                setSelectedPersonFilter('all');
                setSelectedTripFilter('all');
              }}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Ionicons name="close-circle" size={14} color={colors.primary} />
            </TouchableOpacity>
          </View>
        )}

        <Text style={[styles.heroAmount, { color: colors.primary }]}>
          {formatCurrencyAmount(analytics.totalPaise, userCurrency)}
        </Text>

        {/* 4-Stat Hero Matrix */}
        <View style={styles.heroSubRow}>
          <View style={styles.heroStatCol}>
            <Text style={[styles.heroStatLabel, { color: colors.textSecondary }]} numberOfLines={1}>
              {analytics.paidLabel}
            </Text>
            <Text style={[styles.heroStatValue, { color: colors.success }]}>
              {formatCurrencyAmount(analytics.yourPaidPaise, userCurrency)}
            </Text>
          </View>

          <View style={[styles.heroDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : colors.borderLight }]} />

          <View style={styles.heroStatCol}>
            <Text style={[styles.heroStatLabel, { color: colors.textSecondary }]} numberOfLines={1}>
              {analytics.shareLabel}
            </Text>
            <Text style={[styles.heroStatValue, { color: colors.text }]}>
              {formatCurrencyAmount(analytics.yourSharePaise, userCurrency)}
            </Text>
          </View>

          <View style={[styles.heroDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : colors.borderLight }]} />

          <View style={styles.heroStatCol}>
            <Text style={[styles.heroStatLabel, { color: colors.textSecondary }]}>Expenses</Text>
            <Text style={[styles.heroStatValue, { color: colors.text }]}>
              {analytics.count}
            </Text>
          </View>

          <View style={[styles.heroDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : colors.borderLight }]} />

          <View style={styles.heroStatCol}>
            <Text style={[styles.heroStatLabel, { color: colors.textSecondary }]}>Daily Avg</Text>
            <Text style={[styles.heroStatValue, { color: '#F59E0B' }]}>
              {formatCurrencyAmount(dailySpendingData.dailyAveragePaise, userCurrency)}
            </Text>
          </View>
        </View>
      </View>

      {/* 3. Search, Filter & Sort Controls Row ("filter search short") */}
      <View style={styles.controlsRow}>
        <View
          style={[
            styles.searchBar,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <Ionicons name="search" size={17} color={colors.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search expenses, notes, payers..."
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={17} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        {/* Filter Trigger Button */}
        <TouchableOpacity
          style={[
            styles.iconActionBtn,
            {
              backgroundColor: activeFiltersCount > 0 ? colors.primary : colors.card,
              borderColor: activeFiltersCount > 0 ? colors.primary : colors.border,
            },
          ]}
          onPress={() => setFilterModalVisible(true)}
        >
          <Ionicons
            name="filter"
            size={18}
            color={activeFiltersCount > 0 ? '#FFFFFF' : colors.text}
          />
          {activeFiltersCount > 0 && <View style={styles.activeFilterDot} />}
        </TouchableOpacity>

        {/* Sort Trigger Button ("short") */}
        <TouchableOpacity
          style={[
            styles.iconActionBtn,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
          onPress={() => setSortModalVisible(true)}
        >
          <Ionicons name="swap-vertical" size={18} color={colors.text} />
        </TouchableOpacity>
      </View>

      {/* Search Autocomplete Suggestions for Friends & Trips (shows after typing 3 letters) */}
      {searchQuery.trim().length >= 3 && (
        <View
          style={[
            styles.searchSuggestionsCard,
            {
              backgroundColor: isDark ? '#1C2434' : '#FFFFFF',
              borderColor: isDark ? 'rgba(120, 149, 183, 0.25)' : colors.border,
            },
          ]}
        >
          {/* Matching Friends & Members */}
          {searchSuggestions.people.length > 0 && (
            <View style={styles.suggestionSection}>
              <View style={styles.suggestionSectionHeader}>
                <Ionicons name="people" size={14} color="#10B981" />
                <Text style={[styles.suggestionSectionTitle, { color: '#10B981' }]}>
                  SELECT A FRIEND / PERSON ({searchSuggestions.people.length})
                </Text>
              </View>
              {searchSuggestions.people.map(p => {
                const isSelected =
                  selectedPersonFilter === p.id ||
                  selectedPersonFilter.toLowerCase() === p.name.toLowerCase();
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[
                      styles.suggestionRow,
                      {
                        backgroundColor: isSelected
                          ? isDark
                            ? 'rgba(16, 185, 129, 0.18)'
                            : '#ECFDF5'
                          : 'transparent',
                      },
                    ]}
                    onPress={() => {
                      setSelectedPersonFilter(p.id);
                      setSearchQuery('');
                    }}
                  >
                    {p.avatarUrl ? (
                      <Image source={{ uri: p.avatarUrl }} style={styles.suggestionAvatarImg} />
                    ) : (
                      <View
                        style={[
                          styles.suggestionAvatar,
                          { backgroundColor: p.isCurrentUser ? '#E0E7FF' : '#DCFCE7' },
                        ]}
                      >
                        <Text
                          style={[
                            styles.suggestionAvatarText,
                            { color: p.isCurrentUser ? '#4F46E5' : '#059669' },
                          ]}
                        >
                          {p.name.slice(0, 2).toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <View style={styles.suggestionContent}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text
                          style={[
                            styles.suggestionName,
                            {
                              color: colors.text,
                              fontWeight: isSelected ? '700' : '600',
                            },
                          ]}
                          numberOfLines={1}
                        >
                          {p.name} {p.isCurrentUser ? '(You)' : ''}
                        </Text>
                        {p.isFriend && (
                          <View
                            style={[
                              styles.friendBadge,
                              { backgroundColor: isDark ? 'rgba(16, 185, 129, 0.2)' : '#DCFCE7' },
                            ]}
                          >
                            <Text style={styles.friendBadgeText}>Friend</Text>
                          </View>
                        )}
                      </View>
                      <Text
                        style={[styles.suggestionSub, { color: colors.textSecondary }]}
                        numberOfLines={1}
                      >
                        {p.expenseCount > 0
                          ? `${p.expenseCount} ${p.expenseCount === 1 ? 'expense' : 'expenses'}${
                              p.tripNames.length > 0 ? ` • ${p.tripNames.slice(0, 2).join(', ')}` : ''
                            }`
                          : p.isFriend
                          ? 'Friend in contacts • Tap to filter analysis'
                          : 'Tap to filter analysis'}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.filterActionPill,
                        {
                          backgroundColor: isSelected ? '#10B981' : colors.cardSecondary,
                          borderColor: isSelected ? '#10B981' : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.filterActionText,
                          {
                            color: isSelected ? '#FFFFFF' : '#10B981',
                          },
                        ]}
                      >
                        {isSelected ? 'Selected' : 'Select'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Matching Trips */}
          {searchSuggestions.trips.length > 0 && (
            <View
              style={[
                styles.suggestionSection,
                searchSuggestions.people.length > 0 && {
                  borderTopWidth: 1,
                  borderTopColor: isDark ? 'rgba(255,255,255,0.06)' : colors.borderLight,
                  marginTop: 6,
                  paddingTop: 8,
                },
              ]}
            >
              <View style={styles.suggestionSectionHeader}>
                <Ionicons name="airplane-outline" size={13} color={colors.primary} />
                <Text style={[styles.suggestionSectionTitle, { color: colors.primary }]}>
                  SELECT A TRIP ({searchSuggestions.trips.length})
                </Text>
              </View>
              {searchSuggestions.trips.map(t => {
                const isSelected = selectedTripFilter === t.id;
                return (
                  <TouchableOpacity
                    key={t.id}
                    style={[
                      styles.suggestionRow,
                      {
                        backgroundColor: isSelected
                          ? isDark
                            ? 'rgba(74, 144, 226, 0.15)'
                            : '#EEF4FF'
                          : 'transparent',
                      },
                    ]}
                    onPress={() => {
                      setSelectedTripFilter(t.id);
                      setSearchQuery('');
                    }}
                  >
                    <View
                      style={[
                        styles.suggestionAvatar,
                        { backgroundColor: isDark ? '#283449' : '#E6EEFA' },
                      ]}
                    >
                      <Ionicons name="airplane" size={14} color={colors.primary} />
                    </View>
                    <View style={styles.suggestionContent}>
                      <Text
                        style={[
                          styles.suggestionName,
                          {
                            color: colors.text,
                            fontWeight: isSelected ? '700' : '600',
                          },
                        ]}
                        numberOfLines={1}
                      >
                        {t.name}
                      </Text>
                      <Text style={[styles.suggestionSub, { color: colors.textSecondary }]}>
                        Tap to filter analysis for this trip
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.filterActionPill,
                        {
                          backgroundColor: isSelected ? colors.primary : colors.cardSecondary,
                          borderColor: isSelected ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.filterActionText,
                          {
                            color: isSelected ? '#FFFFFF' : colors.primary,
                          },
                        ]}
                      >
                        {isSelected ? 'Selected' : 'Select'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* If 3+ letters typed but no direct friend or trip match */}
          {searchSuggestions.people.length === 0 && searchSuggestions.trips.length === 0 && (
            <View style={styles.noSuggestionRow}>
              <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.noSuggestionText, { color: colors.textSecondary }]}>
                No friends or trips matching "{searchQuery.trim()}". Searching notes, categories & amounts below.
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Quick People Filter Bar */}
      {availablePeople.length > 0 && (
        <View style={styles.peopleQuickBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.peopleQuickScroll}
          >
            <TouchableOpacity
              style={[
                styles.personQuickChip,
                {
                  backgroundColor:
                    selectedPersonFilter === 'all'
                      ? colors.primary
                      : isDark
                      ? '#182132'
                      : colors.card,
                  borderColor: selectedPersonFilter === 'all' ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setSelectedPersonFilter('all')}
            >
              <Ionicons
                name="people"
                size={13}
                color={selectedPersonFilter === 'all' ? '#FFFFFF' : colors.textSecondary}
              />
              <Text
                style={[
                  styles.personQuickText,
                  { color: selectedPersonFilter === 'all' ? '#FFFFFF' : colors.textSecondary },
                ]}
              >
                All People ({availablePeople.length})
              </Text>
            </TouchableOpacity>

            {availablePeople.map(p => {
              const isSelected = selectedPersonFilter === p.id;
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[
                    styles.personQuickChip,
                    {
                      backgroundColor: isSelected
                        ? colors.primary
                        : isDark
                        ? '#182132'
                        : colors.card,
                      borderColor: isSelected ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setSelectedPersonFilter(isSelected ? 'all' : p.id)}
                >
                  <View
                    style={[
                      styles.personMiniAvatar,
                      {
                        backgroundColor: isSelected
                          ? 'rgba(255,255,255,0.25)'
                          : p.isCurrentUser
                          ? '#E0E7FF'
                          : '#DCFCE7',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.personMiniAvatarText,
                        {
                          color: isSelected
                            ? '#FFFFFF'
                            : p.isCurrentUser
                            ? '#4F46E5'
                            : '#059669',
                        },
                      ]}
                    >
                      {p.name.slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.personQuickText,
                      { color: isSelected ? '#FFFFFF' : colors.text },
                    ]}
                    numberOfLines={1}
                  >
                    {p.isCurrentUser ? 'You' : p.name}
                  </Text>
                  {p.expenseCount > 0 && (
                    <View
                      style={[
                        styles.personCountBadge,
                        {
                          backgroundColor: isSelected
                            ? 'rgba(255,255,255,0.22)'
                            : isDark
                            ? 'rgba(255,255,255,0.08)'
                            : colors.inputBackground,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.personCountText,
                          { color: isSelected ? '#FFFFFF' : colors.textMuted },
                        ]}
                      >
                        {p.expenseCount}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Active Filter Pills Bar */}
      {(activeFiltersCount > 0 || searchQuery.length > 0) && (
        <View style={styles.activePillsContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.activePillsScroll}>
            {selectedTripFilter !== 'all' && (
              <View style={[styles.activePill, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
                <Ionicons name="airplane-outline" size={12} color={colors.primary} style={{ marginRight: 3 }} />
                <Text style={[styles.activePillText, { color: colors.primary }]} numberOfLines={1}>
                  Trip: {uniqueAllTrips.find(t => t.id === selectedTripFilter)?.name || 'Trip'}
                </Text>
                <TouchableOpacity onPress={() => setSelectedTripFilter('all')}>
                  <Ionicons name="close" size={14} color={colors.primary} />
                </TouchableOpacity>
              </View>
            )}

            {selectedPersonFilter !== 'all' && (
              <View style={[styles.activePill, { backgroundColor: isDark ? 'rgba(16, 185, 129, 0.2)' : '#DCFCE7', borderColor: '#10B981' }]}>
                <Ionicons name="person-outline" size={12} color="#10B981" style={{ marginRight: 3 }} />
                <Text style={[styles.activePillText, { color: isDark ? '#34D399' : '#059669' }]} numberOfLines={1}>
                  Person: {availablePeople.find(p => p.id === selectedPersonFilter)?.name || 'Person'}
                </Text>
                <TouchableOpacity onPress={() => setSelectedPersonFilter('all')}>
                  <Ionicons name="close" size={14} color={isDark ? '#34D399' : '#059669'} />
                </TouchableOpacity>
              </View>
            )}

            {selectedCategoryFilter !== 'all' && (
              <View style={[styles.activePill, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
                <Text style={[styles.activePillText, { color: colors.primary }]}>
                  Cat: {selectedCategoryFilter}
                </Text>
                <TouchableOpacity onPress={() => setSelectedCategoryFilter('all')}>
                  <Ionicons name="close" size={14} color={colors.primary} />
                </TouchableOpacity>
              </View>
            )}

            {selectedTimeframe !== 'all' && (
              <View style={[styles.activePill, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
                <Text style={[styles.activePillText, { color: colors.primary }]}>
                  {selectedTimeframe === 'today' ? 'Today' : selectedTimeframe === 'week' ? 'Last 7 Days' : 'This Month'}
                </Text>
                <TouchableOpacity onPress={() => setSelectedTimeframe('all')}>
                  <Ionicons name="close" size={14} color={colors.primary} />
                </TouchableOpacity>
              </View>
            )}

            {selectedPaymentMode !== 'all' && (
              <View style={[styles.activePill, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
                <Text style={[styles.activePillText, { color: colors.primary }]}>
                  Mode: {selectedPaymentMode.toUpperCase()}
                </Text>
                <TouchableOpacity onPress={() => setSelectedPaymentMode('all')}>
                  <Ionicons name="close" size={14} color={colors.primary} />
                </TouchableOpacity>
              </View>
            )}

            {selectedPayerFilter !== 'all' && (
              <View style={[styles.activePill, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
                <Text style={[styles.activePillText, { color: colors.primary }]}>
                  {selectedPayerFilter === 'me' ? 'Paid by me' : 'Paid by others'}
                </Text>
                <TouchableOpacity onPress={() => setSelectedPayerFilter('all')}>
                  <Ionicons name="close" size={14} color={colors.primary} />
                </TouchableOpacity>
              </View>
            )}

            {selectedSort !== 'date_desc' && (
              <View style={[styles.activePill, { backgroundColor: colors.cardSecondary, borderColor: colors.border }]}>
                <Text style={[styles.activePillText, { color: colors.textSecondary }]}>
                  Sort: {SORT_OPTIONS.find(s => s.id === selectedSort)?.label}
                </Text>
                <TouchableOpacity onPress={() => setSelectedSort('date_desc')}>
                  <Ionicons name="close" size={14} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity
              style={[styles.resetFiltersBtn, { borderColor: colors.danger }]}
              onPress={resetAllFilters}
            >
              <Ionicons name="trash-outline" size={13} color={colors.danger} />
              <Text style={[styles.resetFiltersText, { color: colors.danger }]}>Clear all</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      {/* View Mode Quick Switcher Pills (Dashboard | Daily | Categories | Transactions) */}
      <View style={styles.viewModeScrollWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.viewModeScroll}>
          <TouchableOpacity
            style={[
              styles.viewModeChip,
              {
                backgroundColor: viewMode === 'all' ? colors.primary : colors.card,
                borderColor: viewMode === 'all' ? colors.primary : colors.border,
              },
            ]}
            onPress={() => setViewMode('all')}
          >
            <Ionicons
              name="grid-outline"
              size={13}
              color={viewMode === 'all' ? '#FFFFFF' : colors.textSecondary}
            />
            <Text
              style={[
                styles.viewModeChipText,
                { color: viewMode === 'all' ? '#FFFFFF' : colors.textSecondary },
              ]}
            >
              All Dashboard
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.viewModeChip,
              {
                backgroundColor: viewMode === 'daily' ? colors.primary : colors.card,
                borderColor: viewMode === 'daily' ? colors.primary : colors.border,
              },
            ]}
            onPress={() => setViewMode('daily')}
          >
            <Ionicons
              name="calendar-outline"
              size={13}
              color={viewMode === 'daily' ? '#FFFFFF' : colors.textSecondary}
            />
            <Text
              style={[
                styles.viewModeChipText,
                { color: viewMode === 'daily' ? '#FFFFFF' : colors.textSecondary },
              ]}
            >
              Daily Expense ({dailySpendingData.activeDaysCount}d)
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.viewModeChip,
              {
                backgroundColor: viewMode === 'categories' ? colors.primary : colors.card,
                borderColor: viewMode === 'categories' ? colors.primary : colors.border,
              },
            ]}
            onPress={() => setViewMode('categories')}
          >
            <Ionicons
              name="pie-chart-outline"
              size={13}
              color={viewMode === 'categories' ? '#FFFFFF' : colors.textSecondary}
            />
            <Text
              style={[
                styles.viewModeChipText,
                { color: viewMode === 'categories' ? '#FFFFFF' : colors.textSecondary },
              ]}
            >
              Categories ({analytics.sortedCategories.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.viewModeChip,
              {
                backgroundColor: viewMode === 'transactions' ? colors.primary : colors.card,
                borderColor: viewMode === 'transactions' ? colors.primary : colors.border,
              },
            ]}
            onPress={() => setViewMode('transactions')}
          >
            <Ionicons
              name="receipt-outline"
              size={13}
              color={viewMode === 'transactions' ? '#FFFFFF' : colors.textSecondary}
            />
            <Text
              style={[
                styles.viewModeChipText,
                { color: viewMode === 'transactions' ? '#FFFFFF' : colors.textSecondary },
              ]}
            >
              Transactions ({filteredAndSortedExpenses.length})
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* 4. DAILY EXPENSE & TRENDS SECTION ("daily expence") */}
      {showDailySection && (
        <View style={styles.sectionBlock}>
          <View style={styles.sectionHeaderWithAction}>
            <View>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Daily Expense & Trends
              </Text>
              <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>
                Spending velocity across {dailySpendingData.activeDaysCount} active {dailySpendingData.activeDaysCount === 1 ? 'day' : 'days'}
              </Text>
            </View>
            <View style={[styles.dailyAvgBadge, { backgroundColor: isDark ? '#2D3748' : '#EEF2FF' }]}>
              <Text style={[styles.dailyAvgBadgeText, { color: colors.primary }]}>
                Avg: {formatCurrencyAmount(dailySpendingData.dailyAveragePaise, userCurrency)}/day
              </Text>
            </View>
          </View>

          {/* Daily Vertical Bar Chart Card */}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {dailySpendingData.recentBarDays.length > 0 ? (
              <View style={styles.barChartWrap}>
                <View style={styles.barChartGrid}>
                  {dailySpendingData.recentBarDays.map(item => {
                    const heightPct = Math.max(
                      Math.round((item.totalPaise / dailySpendingData.maxBarSpend) * 100),
                      10
                    );
                    const isPeak =
                      dailySpendingData.peakDay && item.dateKey === dailySpendingData.peakDay.dateKey;
                    return (
                      <View key={item.dateKey} style={styles.barCol}>
                        <Text style={[styles.barAmtLabel, { color: colors.textMuted }]}>
                          ₹{Math.round(item.totalPaise / 100)}
                        </Text>
                        <View style={styles.barSlot}>
                          <View
                            style={[
                              styles.barFill,
                              {
                                height: `${heightPct}%`,
                                backgroundColor: isPeak ? '#EF4444' : colors.primary,
                              },
                            ]}
                          />
                        </View>
                        <Text
                          style={[
                            styles.barDayLabel,
                            {
                              color: isPeak ? '#EF4444' : colors.textSecondary,
                              fontWeight: isPeak ? '700' : '500',
                            },
                          ]}
                          numberOfLines={1}
                        >
                          {item.displayLabel.split(',')[0]}
                        </Text>
                      </View>
                    );
                  })}
                </View>

                {dailySpendingData.peakDay && (
                  <View style={styles.peakHighlightRow}>
                    <Ionicons name="flame" size={14} color="#EF4444" />
                    <Text style={[styles.peakHighlightText, { color: colors.textSecondary }]}>
                      Peak Spend Day: <Text style={{ color: colors.text, fontWeight: '700' }}>{formatCurrencyAmount(dailySpendingData.peakDay.totalPaise, userCurrency)}</Text> on {dailySpendingData.peakDay.displayLabel}
                    </Text>
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="calendar-outline" size={36} color={colors.textMuted} />
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  No daily spending activity recorded yet.
                </Text>
              </View>
            )}
          </View>

          {/* Day-by-Day Expandable Cards */}
          {dailySpendingData.groups.map(group => {
            const isExpanded = Boolean(expandedDateKeys[group.dateKey]);
            const isPeak =
              dailySpendingData.peakDay && group.dateKey === dailySpendingData.peakDay.dateKey;
            return (
              <View
                key={group.dateKey}
                style={[
                  styles.dayGroupCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: isPeak ? 'rgba(239, 68, 68, 0.35)' : colors.border,
                  },
                ]}
              >
                <TouchableOpacity
                  style={styles.dayGroupHeader}
                  activeOpacity={0.7}
                  onPress={() => toggleDateExpansion(group.dateKey)}
                >
                  <View style={styles.dayGroupHeaderLeft}>
                    <View
                      style={[
                        styles.dayCalendarBadge,
                        { backgroundColor: isPeak ? '#FEE2E2' : colors.primaryLight },
                      ]}
                    >
                      <Ionicons
                        name={isPeak ? 'flame' : 'calendar'}
                        size={16}
                        color={isPeak ? '#EF4444' : colors.primary}
                      />
                    </View>
                    <View>
                      <Text style={[styles.dayGroupTitle, { color: colors.text }]}>
                        {group.displayLabel}
                      </Text>
                      <Text style={[styles.dayGroupSubtitle, { color: colors.textSecondary }]}>
                        {group.formattedDate} • {group.count} {group.count === 1 ? 'expense' : 'expenses'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.dayGroupHeaderRight}>
                    <Text style={[styles.dayGroupTotal, { color: colors.text }]}>
                      {formatCurrencyAmount(group.totalPaise, userCurrency)}
                    </Text>
                    <Ionicons
                      name={isExpanded ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color={colors.textMuted}
                    />
                  </View>
                </TouchableOpacity>

                {isExpanded && (
                  <View style={[styles.dayExpensesContainer, { borderTopColor: colors.borderLight }]}>
                    {group.expenses.map((exp, idx) => {
                      const meta = CATEGORY_ICONS[exp.category] || CATEGORY_ICONS.General;
                      return (
                        <TouchableOpacity
                          key={exp.id || idx}
                          style={[
                            styles.dayExpenseRow,
                            {
                              borderBottomColor:
                                idx === group.expenses.length - 1 ? 'transparent' : colors.borderLight,
                            },
                          ]}
                          onPress={() => handleOpenExpense(exp.trip_id, exp.id)}
                        >
                          <View style={[styles.miniCatIcon, { backgroundColor: meta.bg }]}>
                            <Ionicons name={meta.icon} size={15} color={meta.color} />
                          </View>
                          <View style={{ flex: 1, marginHorizontal: 10 }}>
                            <Text style={[styles.dayExpenseDesc, { color: colors.text }]} numberOfLines={1}>
                              {exp.description}
                            </Text>
                            <Text style={[styles.dayExpenseSub, { color: colors.textSecondary }]}>
                              {exp.payerName} • {exp.trip_name}
                            </Text>
                          </View>
                          <View style={{ alignItems: 'flex-end' }}>
                            <Text style={[styles.dayExpenseAmt, { color: colors.text }]}>
                              {formatCurrencyAmount(exp.amount, exp.currency || userCurrency)}
                            </Text>
                            <Text
                              style={[
                                styles.dayExpenseMode,
                                {
                                  color:
                                    exp.payment_mode === 'upi'
                                      ? colors.primary
                                      : exp.payment_mode === 'cash'
                                      ? colors.success
                                      : colors.textMuted,
                                },
                              ]}
                            >
                              {exp.payment_mode.toUpperCase()}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* 5. CATEGORY BREAKDOWN SECTION */}
      {showCategoriesSection && (
        <View style={styles.sectionBlock}>
          <View style={styles.sectionHeaderWithAction}>
            <View>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Category Breakdown
              </Text>
              <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>
                Where money was spent (Tap to filter)
              </Text>
            </View>
            {selectedCategoryFilter !== 'all' && (
              <TouchableOpacity
                style={[styles.clearCatChip, { backgroundColor: colors.primaryLight }]}
                onPress={() => setSelectedCategoryFilter('all')}
              >
                <Text style={[styles.clearCatText, { color: colors.primary }]}>Reset Cat</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {analytics.sortedCategories.length === 0 || analytics.totalPaise === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="pie-chart-outline" size={40} color={colors.textMuted} />
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  No expenses recorded yet. Add an expense to see category analysis!
                </Text>
              </View>
            ) : (
              analytics.sortedCategories.map(cat => {
                const meta = CATEGORY_ICONS[cat.name] || CATEGORY_ICONS.General;
                const isSelected = selectedCategoryFilter.toLowerCase() === cat.name.toLowerCase();
                return (
                  <TouchableOpacity
                    key={cat.name}
                    activeOpacity={0.7}
                    style={[
                      styles.categoryRow,
                      {
                        borderBottomColor: colors.borderLight,
                        backgroundColor: isSelected
                          ? isDark
                            ? 'rgba(99, 102, 241, 0.15)'
                            : '#EEF2FF'
                          : 'transparent',
                        paddingHorizontal: isSelected ? 8 : 0,
                        borderRadius: isSelected ? 8 : 0,
                      },
                    ]}
                    onPress={() => {
                      if (isSelected) {
                        setSelectedCategoryFilter('all');
                      } else {
                        setSelectedCategoryFilter(cat.name);
                      }
                    }}
                  >
                    <View style={[styles.categoryIconBox, { backgroundColor: meta.bg }]}>
                      <Ionicons name={meta.icon} size={20} color={meta.color} />
                    </View>

                    <View style={{ flex: 1, marginHorizontal: 12 }}>
                      <View style={styles.categoryHeaderLine}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={[styles.categoryName, { color: colors.text }]}>
                            {cat.name}
                          </Text>
                          <Text style={[styles.categoryItemCount, { color: colors.textMuted }]}>
                            ({cat.count})
                          </Text>
                        </View>
                        <Text style={[styles.categoryAmount, { color: colors.text }]}>
                          {formatCurrencyAmount(cat.amount, userCurrency)}
                        </Text>
                      </View>

                      <View style={[styles.progressBarTrack, { backgroundColor: isDark ? '#2D3748' : '#E5E7EB' }]}>
                        <View
                          style={[
                            styles.progressBarFill,
                            {
                              width: `${Math.max(cat.percentage, 2)}%`,
                              backgroundColor: meta.color,
                            },
                          ]}
                        />
                      </View>
                    </View>

                    <View style={[styles.percentageBadge, { backgroundColor: isDark ? '#374151' : '#F3F4F6' }]}>
                      <Text style={[styles.percentageText, { color: colors.textSecondary }]}>
                        {cat.percentage}%
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        </View>
      )}

      {/* 6. SMART FINANCIAL INSIGHTS */}
      {viewMode === 'all' && (
        <View style={styles.sectionBlock}>
          <View style={styles.sectionTitleRow}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Smart Financial Insights
            </Text>
          </View>

          <View style={styles.insightsGrid}>
            <View
              style={[
                styles.insightCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View style={[styles.insightIcon, { backgroundColor: '#FEE2E2' }]}>
                <Ionicons name="flame" size={20} color="#EF4444" />
              </View>
              <Text style={[styles.insightLabel, { color: colors.textSecondary }]}>
                Highest Expense
              </Text>
              {analytics.maxExpense ? (
                <>
                  <Text style={[styles.insightValue, { color: colors.text }]} numberOfLines={1}>
                    {formatCurrencyAmount(analytics.maxExpense.amount, userCurrency)}
                  </Text>
                  <Text style={[styles.insightSub, { color: colors.textSecondary }]} numberOfLines={1}>
                    {analytics.maxExpense.description}
                  </Text>
                  <Text style={[styles.insightMeta, { color: colors.textMuted }]} numberOfLines={1}>
                    {analytics.maxExpense.trip_name}
                  </Text>
                </>
              ) : (
                <Text style={[styles.insightSub, { color: colors.textMuted }]}>No records yet</Text>
              )}
            </View>

            <View
              style={[
                styles.insightCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View style={[styles.insightIcon, { backgroundColor: '#FEF3C7' }]}>
                <Ionicons name="speedometer-outline" size={20} color="#F59E0B" />
              </View>
              <Text style={[styles.insightLabel, { color: colors.textSecondary }]}>
                Spending Pace
              </Text>
              <Text style={[styles.insightValue, { color: colors.text }]} numberOfLines={1}>
                {formatCurrencyAmount(dailySpendingData.dailyAveragePaise, userCurrency)}/day
              </Text>
              <Text style={[styles.insightSub, { color: colors.textSecondary }]}>
                Across {dailySpendingData.activeDaysCount} active days
              </Text>
              {dailySpendingData.peakDay && (
                <Text style={[styles.insightMeta, { color: colors.textMuted }]} numberOfLines={1}>
                  Peak: {dailySpendingData.peakDay.displayLabel}
                </Text>
              )}
            </View>
          </View>

          {/* Payment Modes Grid Card */}
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                marginBottom: 16,
              },
            ]}
          >
            <View style={styles.cardHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={[styles.insightIconSmall, { backgroundColor: '#EEF2FF' }]}>
                  <Ionicons name="wallet-outline" size={16} color={colors.primary} />
                </View>
                <Text style={[styles.cardHeaderTitle, { color: colors.text }]}>
                  Payment Mode Distribution
                </Text>
              </View>
            </View>

            <View style={styles.paymentModesRow}>
              <View style={[styles.paymentBox, { backgroundColor: isDark ? '#1C2432' : '#F9FAFB' }]}>
                <Text style={[styles.paymentLabel, { color: colors.textSecondary }]}>UPI</Text>
                <Text style={[styles.paymentAmount, { color: colors.text }]}>
                  {formatCurrencyAmount(analytics.paymentModeTotals.upi, userCurrency)}
                </Text>
                <Text style={[styles.paymentPct, { color: colors.primary }]}>
                  {analytics.totalPaise > 0
                    ? `${Math.round((analytics.paymentModeTotals.upi / analytics.totalPaise) * 100)}%`
                    : '0%'}
                </Text>
              </View>

              <View style={[styles.paymentBox, { backgroundColor: isDark ? '#1C2432' : '#F9FAFB' }]}>
                <Text style={[styles.paymentLabel, { color: colors.textSecondary }]}>Cash</Text>
                <Text style={[styles.paymentAmount, { color: colors.text }]}>
                  {formatCurrencyAmount(analytics.paymentModeTotals.cash, userCurrency)}
                </Text>
                <Text style={[styles.paymentPct, { color: colors.success }]}>
                  {analytics.totalPaise > 0
                    ? `${Math.round((analytics.paymentModeTotals.cash / analytics.totalPaise) * 100)}%`
                    : '0%'}
                </Text>
              </View>

              <View style={[styles.paymentBox, { backgroundColor: isDark ? '#1C2432' : '#F9FAFB' }]}>
                <Text style={[styles.paymentLabel, { color: colors.textSecondary }]}>Other / Card</Text>
                <Text style={[styles.paymentAmount, { color: colors.text }]}>
                  {formatCurrencyAmount(analytics.paymentModeTotals.other, userCurrency)}
                </Text>
                <Text style={[styles.paymentPct, { color: '#8B5CF6' }]}>
                  {analytics.totalPaise > 0
                    ? `${Math.round((analytics.paymentModeTotals.other / analytics.totalPaise) * 100)}%`
                    : '0%'}
                </Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* 7. ALL EXPENSES TRANSACTIONS EXPLORER */}
      {showTransactionsSection && (
        <View style={styles.sectionBlock}>
          <View style={styles.sectionHeaderWithAction}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Expenses Explorer ({filteredAndSortedExpenses.length})
              </Text>
              <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>
                {filteredAndSortedExpenses.length > INLINE_EXPENSES_LIMIT
                  ? `Showing first 10 • Sorted by ${SORT_OPTIONS.find(s => s.id === selectedSort)?.label}`
                  : `Sorted by ${SORT_OPTIONS.find(s => s.id === selectedSort)?.label}`}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {activeFiltersCount > 0 && (
                <TouchableOpacity
                  style={[styles.clearCatChip, { backgroundColor: colors.dangerBg }]}
                  onPress={resetAllFilters}
                >
                  <Text style={[styles.clearCatText, { color: colors.danger }]}>Clear</Text>
                </TouchableOpacity>
              )}
              {filteredAndSortedExpenses.length > INLINE_EXPENSES_LIMIT && (
                <TouchableOpacity
                  style={[styles.viewMoreTopBtn, { backgroundColor: colors.primaryLight }]}
                  onPress={() =>
                    router.push({
                      pathname: '/all-expenses',
                      params: {
                        search: searchQuery || undefined,
                        category: selectedCategoryFilter !== 'all' ? selectedCategoryFilter : undefined,
                        sort: selectedSort,
                      },
                    })
                  }
                >
                  <Text style={[styles.viewMoreTopText, { color: colors.primary }]}>
                    View All ({filteredAndSortedExpenses.length})
                  </Text>
                  <Ionicons name="arrow-forward" size={14} color={colors.primary} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {filteredAndSortedExpenses.length === 0 ? (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.emptyState}>
                <Ionicons name="search-outline" size={40} color={colors.textMuted} />
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  No expenses match your search or filter criteria.
                </Text>
                <TouchableOpacity
                  style={[styles.resetInEmptyBtn, { backgroundColor: colors.primary }]}
                  onPress={resetAllFilters}
                >
                  <Text style={styles.resetInEmptyText}>Reset All Filters</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {filteredAndSortedExpenses.slice(0, INLINE_EXPENSES_LIMIT).map((exp, idx) => {
                const meta = CATEGORY_ICONS[exp.category] || CATEGORY_ICONS.General;
                const isLast =
                  idx === Math.min(filteredAndSortedExpenses.length, INLINE_EXPENSES_LIMIT) - 1 &&
                  filteredAndSortedExpenses.length <= INLINE_EXPENSES_LIMIT;
                return (
                  <TouchableOpacity
                    key={exp.id || idx}
                    style={[
                      styles.expenseExplorerRow,
                      { borderBottomColor: isLast ? 'transparent' : colors.borderLight },
                    ]}
                    onPress={() => handleOpenExpense(exp.trip_id, exp.id)}
                  >
                    <View style={[styles.categoryIconBox, { backgroundColor: meta.bg }]}>
                      <Ionicons name={meta.icon} size={20} color={meta.color} />
                    </View>

                    <View style={{ flex: 1, marginHorizontal: 12 }}>
                      <View style={styles.expenseExplorerMainLine}>
                        <Text style={[styles.expenseExplorerTitle, { color: colors.text }]} numberOfLines={1}>
                          {exp.description}
                        </Text>
                        <Text style={[styles.expenseExplorerAmount, { color: colors.text }]}>
                          {formatCurrencyAmount(exp.amount, exp.currency || userCurrency)}
                        </Text>
                      </View>

                      <View style={styles.expenseExplorerMetaLine}>
                        <Text
                          style={[
                            styles.expenseExplorerPayer,
                            { color: exp.isMyExpense ? colors.success : colors.textSecondary },
                          ]}
                          numberOfLines={1}
                        >
                          {exp.isMyExpense ? 'Paid by You' : `Paid by ${exp.payerName}`}
                        </Text>
                        <Text style={[styles.expenseExplorerTripBadge, { color: colors.textMuted }]} numberOfLines={1}>
                          • {exp.trip_name}
                        </Text>
                      </View>

                      <View style={styles.expenseExplorerTagRow}>
                        <View style={[styles.miniBadgeTag, { backgroundColor: isDark ? '#2D3748' : '#F3F4F6' }]}>
                          <Text style={[styles.miniBadgeText, { color: colors.textSecondary }]}>
                            {exp.dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.miniBadgeTag,
                            {
                              backgroundColor:
                                exp.payment_mode === 'upi'
                                  ? colors.primaryLight
                                  : exp.payment_mode === 'cash'
                                  ? colors.successBg
                                  : isDark
                                  ? '#2D3748'
                                  : '#F3F4F6',
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.miniBadgeText,
                              {
                                color:
                                  exp.payment_mode === 'upi'
                                    ? colors.primary
                                    : exp.payment_mode === 'cash'
                                    ? colors.success
                                    : colors.textSecondary,
                              },
                            ]}
                          >
                            {exp.payment_mode.toUpperCase()}
                          </Text>
                        </View>
                        {exp.mySharePaise > 0 && !exp.isMyExpense && (
                          <View style={[styles.miniBadgeTag, { backgroundColor: 'rgba(239, 68, 68, 0.12)' }]}>
                            <Text style={[styles.miniBadgeText, { color: colors.danger }]}>
                              Your Share: {formatCurrencyAmount(exp.mySharePaise, userCurrency)}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>

                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                );
              })}

              {filteredAndSortedExpenses.length > INLINE_EXPENSES_LIMIT && (
                <TouchableOpacity
                  style={[
                    styles.viewMoreCardBtn,
                    {
                      backgroundColor: isDark ? 'rgba(99, 102, 241, 0.15)' : '#EEF2FF',
                      borderTopWidth: 1,
                      borderTopColor: colors.borderLight,
                      marginTop: 6,
                    },
                  ]}
                  onPress={() =>
                    router.push({
                      pathname: '/all-expenses',
                      params: {
                        search: searchQuery || undefined,
                        category: selectedCategoryFilter !== 'all' ? selectedCategoryFilter : undefined,
                        sort: selectedSort,
                      },
                    })
                  }
                >
                  <Text style={[styles.viewMoreCardBtnText, { color: colors.primary }]}>
                    View All Expenses ({filteredAndSortedExpenses.length})
                  </Text>
                  <Ionicons name="arrow-forward" size={15} color={colors.primary} />
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      )}

      {/* 8. TRIPS SUMMARY SECTION (Group Trips ONLY, max 5 latest + View More modal) */}
      <View style={styles.sectionHeaderWithAction}>
        <View>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Trips Summary
          </Text>
          <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>
            Latest {Math.min(INLINE_TRIPS_LIMIT, uniqueGroupTrips.length)} of {uniqueGroupTrips.length} group {uniqueGroupTrips.length === 1 ? 'trip' : 'trips'}
          </Text>
        </View>

        {uniqueGroupTrips.length > 0 && (
          <TouchableOpacity
            style={[styles.viewMoreTopBtn, { backgroundColor: colors.primaryLight }]}
            onPress={() => {
              setModalVisibleCount(PAGE_SIZE);
              setTripSearchQuery('');
              setAllTripsModalVisible(true);
            }}
          >
            <Text style={[styles.viewMoreTopText, { color: colors.primary }]}>
              View All ({uniqueGroupTrips.length})
            </Text>
            <Ionicons name="arrow-forward" size={14} color={colors.primary} />
          </TouchableOpacity>
        )}
      </View>

      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            marginBottom: 32,
          },
        ]}
      >
        {loadingAnalytics && uniqueGroupTrips.length === 0 ? (
          <View style={styles.emptyState}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              Loading trips summary...
            </Text>
          </View>
        ) : uniqueGroupTrips.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="airplane-outline" size={36} color={colors.textMuted} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              No group trips yet. Create a trip to see its summary here!
            </Text>
          </View>
        ) : (
          <>
            {latestFiveGroupTrips.map(trip => {
              const tripExps = allTripsData[trip.id]?.expenses || [];
              const tripTotal = tripExps.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
              const isOpeningThisTrip = openingTripId === trip.id;
              return (
                <TouchableOpacity
                  key={trip.id}
                  disabled={Boolean(openingTripId)}
                  style={[styles.tripSummaryRow, { borderBottomColor: colors.borderLight }]}
                  onPress={() => handleOpenTrip(trip.id, false)}
                >
                  <View style={[styles.tripAvatar, { backgroundColor: colors.primaryLight }]}>
                    <Ionicons
                      name="airplane"
                      size={18}
                      color={colors.primary}
                    />
                  </View>
                  <View style={{ flex: 1, marginHorizontal: 12 }}>
                    <Text style={[styles.tripName, { color: colors.text }]}>{trip.name}</Text>
                    <Text style={[styles.tripMeta, { color: colors.textSecondary }]}>
                      {tripExps.length} {tripExps.length === 1 ? 'expense' : 'expenses'}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    {isOpeningThisTrip ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <ActivityIndicator size="small" color={colors.primary} />
                        <Text style={{ fontSize: 11, fontWeight: '700', color: colors.primary }}>
                          Opening...
                        </Text>
                      </View>
                    ) : (
                      <>
                        <Text style={[styles.tripAmount, { color: colors.text }]}>
                          {formatCurrencyAmount(tripTotal, trip.currency || userCurrency)}
                        </Text>
                        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                      </>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}

            {uniqueGroupTrips.length > INLINE_TRIPS_LIMIT && (
              <TouchableOpacity
                style={[styles.viewMoreCardBtn, { backgroundColor: isDark ? 'rgba(99, 102, 241, 0.15)' : '#EEF2FF' }]}
                onPress={() => {
                  setModalVisibleCount(PAGE_SIZE);
                  setTripSearchQuery('');
                  setAllTripsModalVisible(true);
                }}
              >
                <Text style={[styles.viewMoreCardBtnText, { color: colors.primary }]}>
                  View More Trips ({uniqueGroupTrips.length - INLINE_TRIPS_LIMIT} more)
                </Text>
                <Ionicons name="chevron-down" size={16} color={colors.primary} />
              </TouchableOpacity>
            )}
          </>
        )}
      </View>

      {/* FILTER MODAL */}
      <DraggableBottomSheet
        visible={filterModalVisible}
        onClose={() => setFilterModalVisible(false)}
        maxHeight="85%"
        sheetStyle={{ paddingBottom: 20 }}
      >
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <View>
                <Text style={[styles.modalTitle, { color: colors.text }]}>Filters</Text>
                <Text style={[styles.modalSub, { color: colors.textSecondary }]}>
                  Narrow down analyzed expenses
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.modalCloseBtn, { backgroundColor: colors.inputBackground }]}
                onPress={() => setFilterModalVisible(false)}
              >
                <Ionicons name="close" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ paddingHorizontal: 18, paddingTop: 14 }}>
              {/* Trip Filter */}
              <Text style={[styles.filterGroupHeading, { color: colors.text }]}>Trip</Text>
              <View style={styles.filterChipGroup}>
                <TouchableOpacity
                  style={[
                    styles.modalOptionChip,
                    {
                      backgroundColor: selectedTripFilter === 'all' ? colors.primary : colors.inputBackground,
                      borderColor: selectedTripFilter === 'all' ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setSelectedTripFilter('all')}
                >
                  <Text
                    style={[
                      styles.modalOptionText,
                      { color: selectedTripFilter === 'all' ? '#FFFFFF' : colors.text },
                    ]}
                  >
                    All ({uniqueGroupTrips.length} Trips)
                  </Text>
                </TouchableOpacity>
                {uniqueGroupTrips.map(t => (
                  <TouchableOpacity
                    key={t.id}
                    style={[
                      styles.modalOptionChip,
                      {
                        backgroundColor: selectedTripFilter === t.id ? colors.primary : colors.inputBackground,
                        borderColor: selectedTripFilter === t.id ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => setSelectedTripFilter(t.id)}
                  >
                    <Ionicons
                      name="airplane-outline"
                      size={12}
                      color={selectedTripFilter === t.id ? '#FFFFFF' : colors.textSecondary}
                      style={{ marginRight: 4 }}
                    />
                    <Text
                      style={[
                        styles.modalOptionText,
                        { color: selectedTripFilter === t.id ? '#FFFFFF' : colors.text },
                      ]}
                      numberOfLines={1}
                    >
                      {t.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Person / Member Filter */}
              {availablePeople.length > 0 && (
                <>
                  <Text style={[styles.filterGroupHeading, { color: colors.text }]}>Person / Member</Text>
                  <View style={styles.filterChipGroup}>
                    <TouchableOpacity
                      style={[
                        styles.modalOptionChip,
                        {
                          backgroundColor: selectedPersonFilter === 'all' ? colors.primary : colors.inputBackground,
                          borderColor: selectedPersonFilter === 'all' ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => setSelectedPersonFilter('all')}
                    >
                      <Text
                        style={[
                          styles.modalOptionText,
                          { color: selectedPersonFilter === 'all' ? '#FFFFFF' : colors.text },
                        ]}
                      >
                        All People ({availablePeople.length})
                      </Text>
                    </TouchableOpacity>
                    {availablePeople.map(p => (
                      <TouchableOpacity
                        key={p.id}
                        style={[
                          styles.modalOptionChip,
                          {
                            backgroundColor: selectedPersonFilter === p.id ? '#10B981' : colors.inputBackground,
                            borderColor: selectedPersonFilter === p.id ? '#10B981' : colors.border,
                          },
                        ]}
                        onPress={() => setSelectedPersonFilter(p.id)}
                      >
                        <Ionicons
                          name="person-outline"
                          size={12}
                          color={selectedPersonFilter === p.id ? '#FFFFFF' : colors.textSecondary}
                          style={{ marginRight: 4 }}
                        />
                        <Text
                          style={[
                            styles.modalOptionText,
                            { color: selectedPersonFilter === p.id ? '#FFFFFF' : colors.text },
                          ]}
                          numberOfLines={1}
                        >
                          {p.name} {p.isCurrentUser ? '(You)' : ''}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              <Text style={[styles.filterGroupHeading, { color: colors.text }]}>Category</Text>
              <View style={styles.filterChipGroup}>
                {['all', 'Food', 'Stay', 'Fuel', 'Tickets', 'Groceries', 'General', 'Shopping'].map(cat => (
                  <TouchableOpacity
                    key={cat}
                    style={[
                      styles.modalOptionChip,
                      {
                        backgroundColor: selectedCategoryFilter.toLowerCase() === cat.toLowerCase() ? colors.primary : colors.inputBackground,
                        borderColor: selectedCategoryFilter.toLowerCase() === cat.toLowerCase() ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => setSelectedCategoryFilter(cat)}
                  >
                    <Text
                      style={[
                        styles.modalOptionText,
                        {
                          color: selectedCategoryFilter.toLowerCase() === cat.toLowerCase() ? '#FFFFFF' : colors.text,
                        },
                      ]}
                    >
                      {cat === 'all' ? 'All Categories' : cat}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[styles.filterGroupHeading, { color: colors.text }]}>Timeframe</Text>
              <View style={styles.filterChipGroup}>
                {[
                  { id: 'all', label: 'All Time' },
                  { id: 'today', label: 'Today' },
                  { id: 'week', label: 'Last 7 Days' },
                  { id: 'month', label: 'This Month' },
                ].map(tf => (
                  <TouchableOpacity
                    key={tf.id}
                    style={[
                      styles.modalOptionChip,
                      {
                        backgroundColor: selectedTimeframe === tf.id ? colors.primary : colors.inputBackground,
                        borderColor: selectedTimeframe === tf.id ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => setSelectedTimeframe(tf.id as TimeframeFilter)}
                  >
                    <Text
                      style={[
                        styles.modalOptionText,
                        { color: selectedTimeframe === tf.id ? '#FFFFFF' : colors.text },
                      ]}
                    >
                      {tf.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[styles.filterGroupHeading, { color: colors.text }]}>Payment Method</Text>
              <View style={styles.filterChipGroup}>
                {[
                  { id: 'all', label: 'All Methods' },
                  { id: 'upi', label: 'UPI' },
                  { id: 'cash', label: 'Cash' },
                  { id: 'other', label: 'Card / Other' },
                ].map(pm => (
                  <TouchableOpacity
                    key={pm.id}
                    style={[
                      styles.modalOptionChip,
                      {
                        backgroundColor: selectedPaymentMode === pm.id ? colors.primary : colors.inputBackground,
                        borderColor: selectedPaymentMode === pm.id ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => setSelectedPaymentMode(pm.id as PaymentFilter)}
                  >
                    <Text
                      style={[
                        styles.modalOptionText,
                        { color: selectedPaymentMode === pm.id ? '#FFFFFF' : colors.text },
                      ]}
                    >
                      {pm.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[styles.filterGroupHeading, { color: colors.text }]}>Who Paid</Text>
              <View style={styles.filterChipGroup}>
                {[
                  { id: 'all', label: 'Everyone' },
                  { id: 'me', label: 'Paid by Me' },
                  { id: 'others', label: 'Paid by Others' },
                ].map(pf => (
                  <TouchableOpacity
                    key={pf.id}
                    style={[
                      styles.modalOptionChip,
                      {
                        backgroundColor: selectedPayerFilter === pf.id ? colors.primary : colors.inputBackground,
                        borderColor: selectedPayerFilter === pf.id ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => setSelectedPayerFilter(pf.id as PayerFilter)}
                  >
                    <Text
                      style={[
                        styles.modalOptionText,
                        { color: selectedPayerFilter === pf.id ? '#FFFFFF' : colors.text },
                      ]}
                    >
                      {pf.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={{ height: 20 }} />
            </ScrollView>

            <View style={[styles.modalActionsRow, { borderTopColor: colors.borderLight }]}>
              <TouchableOpacity
                style={[styles.modalResetBtn, { borderColor: colors.border }]}
                onPress={resetAllFilters}
              >
                <Text style={[styles.modalResetBtnText, { color: colors.danger }]}>Reset All</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalApplyBtn, { backgroundColor: colors.primary }]}
                onPress={() => setFilterModalVisible(false)}
              >
                <Text style={styles.modalApplyBtnText}>Apply Filters</Text>
              </TouchableOpacity>
            </View>
      </DraggableBottomSheet>

      {/* SORT MODAL ("short") */}
      <DraggableBottomSheet
        visible={sortModalVisible}
        onClose={() => setSortModalVisible(false)}
        dragEntireSheet={true}
        sheetStyle={{ paddingBottom: 20 }}
      >
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <View>
                <Text style={[styles.modalTitle, { color: colors.text }]}>Sort By</Text>
                <Text style={[styles.modalSub, { color: colors.textSecondary }]}>
                  Choose how expenses are ordered
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.modalCloseBtn, { backgroundColor: colors.inputBackground }]}
                onPress={() => setSortModalVisible(false)}
              >
                <Ionicons name="close" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={{ paddingHorizontal: 18, paddingVertical: 14 }}>
              {SORT_OPTIONS.map(opt => {
                const isSelected = selectedSort === opt.id;
                return (
                  <TouchableOpacity
                    key={opt.id}
                    style={[
                      styles.sortOptionRow,
                      {
                        backgroundColor: isSelected ? (isDark ? 'rgba(99, 102, 241, 0.15)' : '#EEF2FF') : 'transparent',
                        borderColor: isSelected ? colors.primary : colors.borderLight,
                      },
                    ]}
                    onPress={() => {
                      setSelectedSort(opt.id);
                      setSortModalVisible(false);
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <Ionicons
                        name={opt.icon as any}
                        size={20}
                        color={isSelected ? colors.primary : colors.textSecondary}
                      />
                      <Text
                        style={[
                          styles.sortOptionText,
                          {
                            color: isSelected ? colors.primary : colors.text,
                            fontWeight: isSelected ? '700' : '500',
                          },
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </View>
                    {isSelected && (
                      <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
      </DraggableBottomSheet>

      {/* View All Group Trips Modal (Paginated by 10) */}
      {allTripsModalVisible && (
        <DraggableBottomSheet
          visible={allTripsModalVisible}
          onClose={() => setAllTripsModalVisible(false)}
          maxHeight="88%"
          sheetStyle={{ paddingBottom: 20 }}
        >
              <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
                <View>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>
                    All Group Trips ({filteredModalTrips.length})
                  </Text>
                  <Text style={[styles.modalSub, { color: colors.textSecondary }]}>
                    Showing {paginatedModalTrips.length} of {filteredModalTrips.length} trips (Page size: 10)
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.modalCloseBtn, { backgroundColor: colors.inputBackground }]}
                  onPress={() => setAllTripsModalVisible(false)}
                >
                  <Ionicons name="close" size={20} color={colors.text} />
                </TouchableOpacity>
              </View>

              <View style={styles.modalSearchBoxWrap}>
                <View
                  style={[
                    styles.modalSearchBox,
                    {
                      backgroundColor: colors.inputBackground,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Ionicons name="search" size={18} color={colors.textSecondary} />
                  <TextInput
                    style={[styles.modalSearchInput, { color: colors.text }]}
                    placeholder="Search trips..."
                    placeholderTextColor={colors.textMuted}
                    value={tripSearchQuery}
                    onChangeText={setTripSearchQuery}
                  />
                  {tripSearchQuery.length > 0 && (
                    <TouchableOpacity onPress={() => setTripSearchQuery('')}>
                      <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              <FlatList
                data={paginatedModalTrips}
                keyExtractor={item => item.id}
                contentContainerStyle={styles.modalListContent}
                onEndReached={handleLoadMoreModalTrips}
                onEndReachedThreshold={0.3}
                ListEmptyComponent={
                  <View style={styles.emptyState}>
                    <Ionicons name="airplane-outline" size={36} color={colors.textMuted} />
                    <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                      No group trips found matching "{tripSearchQuery}"
                    </Text>
                  </View>
                }
                ListFooterComponent={
                  hasMoreModalTrips ? (
                    <TouchableOpacity
                      style={[styles.loadMoreBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
                      onPress={handleLoadMoreModalTrips}
                      disabled={modalLoadingMore}
                    >
                      {modalLoadingMore ? (
                        <View style={styles.loadMoreSpinnerRow}>
                          <ActivityIndicator size="small" color={colors.primary} />
                          <Text style={[styles.loadMoreText, { color: colors.primary }]}>
                            Loading next 10 trips...
                          </Text>
                        </View>
                      ) : (
                        <Text style={[styles.loadMoreText, { color: colors.primary }]}>
                          Load More ({filteredModalTrips.length - modalVisibleCount} remaining)
                        </Text>
                      )}
                    </TouchableOpacity>
                  ) : filteredModalTrips.length > 0 ? (
                    <Text style={[styles.pageFooterNote, { color: colors.textMuted }]}>
                      Showing all {paginatedModalTrips.length} group trips
                    </Text>
                  ) : null
                }
                renderItem={({ item: trip }) => {
                  const tripExps = allTripsData[trip.id]?.expenses || [];
                  const tripTotal = tripExps.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
                  const isOpeningThisTrip = openingTripId === trip.id;
                  return (
                    <TouchableOpacity
                      disabled={Boolean(openingTripId)}
                      style={[styles.tripSummaryRow, { borderBottomColor: colors.borderLight }]}
                      onPress={() => handleOpenTrip(trip.id, true)}
                    >
                      <View style={[styles.tripAvatar, { backgroundColor: colors.primaryLight }]}>
                        <Ionicons name="airplane" size={18} color={colors.primary} />
                      </View>
                      <View style={{ flex: 1, marginHorizontal: 12 }}>
                        <Text style={[styles.tripName, { color: colors.text }]}>{trip.name}</Text>
                        <Text style={[styles.tripMeta, { color: colors.textSecondary }]}>
                          {tripExps.length} {tripExps.length === 1 ? 'expense' : 'expenses'}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        {isOpeningThisTrip ? (
                          <ActivityIndicator size="small" color={colors.primary} />
                        ) : (
                          <>
                            <Text style={[styles.tripAmount, { color: colors.text }]}>
                              {formatCurrencyAmount(tripTotal, trip.currency || userCurrency)}
                            </Text>
                            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                          </>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />
        </DraggableBottomSheet>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 110,
  },
  filterSection: {
    marginBottom: 12,
  },
  filterScroll: {
    flexDirection: 'row',
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  heroCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    marginBottom: 14,
    alignItems: 'center',
  },
  heroTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 8,
  },
  heroTagBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  heroLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  shareHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  shareHeaderText: {
    fontSize: 12,
    fontWeight: '700',
  },
  heroAmount: {
    fontSize: 34,
    fontWeight: '800',
    marginBottom: 16,
  },
  heroSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.06)',
  },
  heroStatCol: {
    alignItems: 'center',
    flex: 1,
  },
  heroDivider: {
    width: 1,
    height: 26,
  },
  heroStatLabel: {
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 3,
  },
  heroStatValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
  },
  iconActionBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  activeFilterDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#EF4444',
  },
  activePillsContainer: {
    marginBottom: 10,
  },
  activePillsScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    gap: 5,
  },
  activePillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  resetFiltersBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    gap: 4,
  },
  resetFiltersText: {
    fontSize: 11,
    fontWeight: '700',
  },
  viewModeScrollWrap: {
    marginBottom: 14,
  },
  viewModeScroll: {
    flexDirection: 'row',
    gap: 8,
  },
  viewModeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1,
    gap: 5,
  },
  viewModeChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  sectionBlock: {
    marginBottom: 10,
  },
  sectionTitleRow: {
    marginBottom: 10,
    marginTop: 6,
  },
  sectionHeaderWithAction: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    marginTop: 6,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  sectionSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  clearCatChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  clearCatText: {
    fontSize: 11,
    fontWeight: '700',
  },
  viewMoreTopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
  },
  viewMoreTopText: {
    fontSize: 12,
    fontWeight: '700',
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginBottom: 16,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    borderBottomWidth: 1,
  },
  categoryIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryHeaderLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  categoryName: {
    fontSize: 14,
    fontWeight: '600',
  },
  categoryItemCount: {
    fontSize: 12,
  },
  categoryAmount: {
    fontSize: 14,
    fontWeight: '700',
  },
  progressBarTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  percentageBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  percentageText: {
    fontSize: 11,
    fontWeight: '700',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 26,
    paddingHorizontal: 20,
  },
  emptyText: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
  },
  resetInEmptyBtn: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  resetInEmptyText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  insightsGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  insightCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  insightIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  insightIconSmall: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  insightLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 3,
  },
  insightValue: {
    fontSize: 15,
    fontWeight: '700',
  },
  insightSub: {
    fontSize: 11,
    marginTop: 3,
  },
  insightMeta: {
    fontSize: 10,
    marginTop: 2,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cardHeaderTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  paymentModesRow: {
    flexDirection: 'row',
    gap: 8,
  },
  paymentBox: {
    flex: 1,
    padding: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  paymentLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 3,
  },
  paymentAmount: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  paymentPct: {
    fontSize: 11,
    fontWeight: '700',
  },
  dailyAvgBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  dailyAvgBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  barChartWrap: {
    paddingTop: 8,
  },
  barChartGrid: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 120,
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  barCol: {
    alignItems: 'center',
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
  },
  barAmtLabel: {
    fontSize: 9,
    marginBottom: 4,
    fontWeight: '600',
  },
  barSlot: {
    width: 14,
    height: 70,
    justifyContent: 'flex-end',
    borderRadius: 6,
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    borderRadius: 6,
  },
  barDayLabel: {
    fontSize: 10,
    marginTop: 6,
  },
  peakHighlightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.06)',
  },
  peakHighlightText: {
    fontSize: 11,
  },
  dayGroupCard: {
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
    overflow: 'hidden',
  },
  dayGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  dayGroupHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dayCalendarBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayGroupTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  dayGroupSubtitle: {
    fontSize: 11,
    marginTop: 2,
  },
  dayGroupHeaderRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  dayGroupTotal: {
    fontSize: 14,
    fontWeight: '700',
  },
  dayExpensesContainer: {
    borderTopWidth: 1,
    paddingHorizontal: 14,
    paddingBottom: 6,
  },
  dayExpenseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  miniCatIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayExpenseDesc: {
    fontSize: 13,
    fontWeight: '600',
  },
  dayExpenseSub: {
    fontSize: 11,
    marginTop: 2,
  },
  dayExpenseAmt: {
    fontSize: 13,
    fontWeight: '700',
  },
  dayExpenseMode: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 2,
  },
  expenseExplorerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  expenseExplorerMainLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 3,
  },
  expenseExplorerTitle: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  expenseExplorerAmount: {
    fontSize: 14,
    fontWeight: '700',
  },
  expenseExplorerMetaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 5,
  },
  expenseExplorerPayer: {
    fontSize: 12,
    fontWeight: '600',
  },
  expenseExplorerTripBadge: {
    fontSize: 11,
    marginLeft: 4,
    flex: 1,
  },
  expenseExplorerTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  miniBadgeTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  miniBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  tripSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  tripAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tripName: {
    fontSize: 15,
    fontWeight: '600',
  },
  tripMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  tripAmount: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  viewMoreCardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 12,
    gap: 6,
  },
  viewMoreCardBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    minHeight: 420,
    borderTopWidth: 1,
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  modalSub: {
    fontSize: 12,
    marginTop: 2,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterGroupHeading: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  filterChipGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  modalOptionChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
  },
  modalOptionText: {
    fontSize: 12,
    fontWeight: '600',
  },
  modalActionsRow: {
    flexDirection: 'row',
    paddingHorizontal: 18,
    paddingTop: 14,
    gap: 12,
    borderTopWidth: 1,
  },
  modalResetBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalResetBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  modalApplyBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalApplyBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  sortOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  sortOptionText: {
    fontSize: 14,
  },
  modalSearchBoxWrap: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 4,
  },
  modalSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    gap: 8,
  },
  modalSearchInput: {
    flex: 1,
    fontSize: 14,
  },
  modalListContent: {
    paddingHorizontal: 18,
    paddingBottom: 30,
  },
  loadMoreBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  loadMoreSpinnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadMoreText: {
    fontSize: 13,
    fontWeight: '700',
  },
  pageFooterNote: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 12,
  },
  heroActiveFilterBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    marginBottom: 8,
  },
  heroActiveFilterText: {
    fontSize: 11,
    fontWeight: '700',
    flexShrink: 1,
  },
  searchSuggestionsCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 4,
  },
  suggestionSection: {
    paddingVertical: 2,
  },
  suggestionSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  suggestionSectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 12,
    gap: 10,
  },
  suggestionAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionAvatarText: {
    fontSize: 12,
    fontWeight: '800',
  },
  suggestionContent: {
    flex: 1,
  },
  suggestionName: {
    fontSize: 13,
  },
  suggestionSub: {
    fontSize: 11,
    marginTop: 2,
  },
  filterActionPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  filterActionText: {
    fontSize: 11,
    fontWeight: '700',
  },
  peopleQuickBar: {
    marginBottom: 10,
  },
  peopleQuickScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  personQuickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 18,
    borderWidth: 1,
    gap: 6,
  },
  personMiniAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  personMiniAvatarText: {
    fontSize: 9,
    fontWeight: '800',
  },
  personQuickText: {
    fontSize: 12,
    fontWeight: '700',
  },
  personCountBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 8,
  },
  personCountText: {
    fontSize: 10,
    fontWeight: '700',
  },
  suggestionAvatarImg: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  friendBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 6,
  },
  friendBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#059669',
  },
  noSuggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  noSuggestionText: {
    fontSize: 12,
    flex: 1,
    lineHeight: 16,
  },
});

