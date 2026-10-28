import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  StatusBar,
  ScrollView,
  Image,
  Keyboard,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../src/theme/useThemeStore';
import { useResponsive } from '../src/theme/responsive';
import { useAuthStore } from '../src/features/auth/useAuthStore';
import { useTripStore, findMyMember, normalizePhone } from '../src/features/trips/useTripStore';
import { useContactsStore } from '../src/features/contacts/useContactsStore';
import { formatCurrencyAmount, getUserCurrencyPreference } from '../src/services/currency';
import {
  AnalyzedExpenseItem,
  CATEGORY_ICONS,
  SORT_OPTIONS,
  SortOptionId,
  fetchAllTripsExpenses,
} from '../src/services/expenseAggregator';
import { DraggableBottomSheet } from '../src/components/DraggableBottomSheet';
import { Trip } from '../src/types/database';

const PAGE_SIZE = 20;

const CATEGORIES = [
  'all',
  'Food',
  'Stay',
  'Fuel',
  'Tickets',
  'Groceries',
  'General',
  'Shopping',
  'Entertainment',
] as const;

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

type TimeframeFilter = 'all' | 'today' | 'week' | 'month';
type PaymentFilter = 'all' | 'upi' | 'cash' | 'other';
type PayerFilter = 'all' | 'me' | 'others';

export default function AllExpensesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    search?: string;
    category?: string;
    sort?: string;
    tripId?: string;
    personId?: string;
  }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { width, isSmall, isTablet, scaleFont: sf } = useResponsive();
  const { user, profile } = useAuthStore();
  const currentUserPhone =
    profile?.phone_number || (user as any)?.phone || (user as any)?.user_metadata?.phone_number;
  const { trips, expenses, members, initTrips } = useTripStore();
  const contacts = useContactsStore(s => s.contacts);
  const fetchFriendsSummary = useContactsStore(s => s.fetchFriendsSummary);

  const [allExpenses, setAllExpenses] = useState<AnalyzedExpenseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userCurrency, setUserCurrency] = useState('INR');

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [appliedExpenseSearch, setAppliedExpenseSearch] = useState(params.search || '');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>(params.category || 'all');
  const [selectedTripFilter, setSelectedTripFilter] = useState<string>(params.tripId || 'all');
  const [selectedPersonFilter, setSelectedPersonFilter] = useState<string>(params.personId || 'all');
  const [selectedTimeframe, setSelectedTimeframe] = useState<TimeframeFilter>('all');
  const [selectedPaymentMode, setSelectedPaymentMode] = useState<PaymentFilter>('all');
  const [selectedPayerFilter, setSelectedPayerFilter] = useState<PayerFilter>('all');
  const [selectedSort, setSelectedSort] = useState<SortOptionId>(
    (params.sort as SortOptionId) || 'date_desc'
  );
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [sortModalVisible, setSortModalVisible] = useState(false);

  // Pagination state
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const prefCurr = await getUserCurrencyPreference();
      setUserCurrency(prefCurr);
      const items = await fetchAllTripsExpenses(user?.id, currentUserPhone, prefCurr);
      setAllExpenses(items);
    } catch (err) {
      console.warn('[AllExpenses] Failed to load expenses:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id, currentUserPhone]);

  useEffect(() => {
    loadData();
    if (user?.id) {
      fetchFriendsSummary(user.id);
    }
  }, [loadData, trips, expenses, members, user?.id, fetchFriendsSummary]);

  const onRefresh = async () => {
    setRefreshing(true);
    await initTrips();
    await loadData();
    if (user?.id) {
      await fetchFriendsSummary(user.id);
    }
    setRefreshing(false);
  };

  // Unique Group Trips ONLY (matching analyser screen)
  const uniqueGroupTrips = useMemo(() => {
    const groupOnly = trips.filter(
      t =>
        t &&
        t.trip_type !== 'friend_split' &&
        !(t as any).is_friend_split &&
        !(typeof t.name === 'string' && t.name.toLowerCase().trim().startsWith('split with '))
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
      }
    }

    return Array.from(byNameMap.values());
  }, [trips]);

  // Extract all distinct people (members + friends from contacts + payers) matching analyser screen
  const availablePeople = useMemo<PersonFilterItem[]>(() => {
    const peopleMap = new Map<string, PersonFilterItem>();
    const currentUserId = user?.id || profile?.id;

    for (const t of trips) {
      const tMembers = members.filter(m => m.trip_id === t.id);
      const myMember = findMyMember(tMembers, user?.id, currentUserPhone);

      for (const m of tMembers) {
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

    // Explicit payers from allExpenses
    for (const exp of allExpenses) {
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

    // Tally matching expenses
    for (const exp of allExpenses) {
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
  }, [trips, members, contacts, allExpenses, user?.id, profile?.id, currentUserPhone]);

  // Autocomplete suggestions matching analyser screen
  const searchSuggestions = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (q.length < 3) return { trips: [], people: [] };

    const matchedTrips = uniqueGroupTrips
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
  }, [searchQuery, uniqueGroupTrips, availablePeople]);

  // Filter & Sort
  const filteredAndSortedExpenses = useMemo(() => {
    let result = [...allExpenses];

    // 1. Trip filter
    if (selectedTripFilter !== 'all') {
      result = result.filter(exp => exp.trip_id === selectedTripFilter);
    }

    // 2. Person filter
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

    // 3. Search query
    if (appliedExpenseSearch.trim()) {
      const q = appliedExpenseSearch.toLowerCase().trim();
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

    // 4. Category filter
    if (selectedCategory !== 'all') {
      result = result.filter(
        exp => exp.category.toLowerCase() === selectedCategory.toLowerCase()
      );
    }

    // 5. Timeframe filter
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

    // 6. Payment mode filter
    if (selectedPaymentMode !== 'all') {
      result = result.filter(exp => {
        if (selectedPaymentMode === 'other') {
          return exp.payment_mode !== 'upi' && exp.payment_mode !== 'cash';
        }
        return exp.payment_mode === selectedPaymentMode;
      });
    }

    // 7. Payer filter
    if (selectedPayerFilter !== 'all') {
      result = result.filter(exp => {
        if (selectedPayerFilter === 'me') {
          return exp.isMyExpense;
        }
        return !exp.isMyExpense;
      });
    }

    // 8. Sort
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
    allExpenses,
    selectedTripFilter,
    selectedPersonFilter,
    availablePeople,
    appliedExpenseSearch,
    selectedCategory,
    selectedTimeframe,
    selectedPaymentMode,
    selectedPayerFilter,
    selectedSort,
  ]);

  // Reset pagination visibleCount when search or filter changes
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [
    appliedExpenseSearch,
    selectedCategory,
    selectedTripFilter,
    selectedPersonFilter,
    selectedTimeframe,
    selectedPaymentMode,
    selectedPayerFilter,
    selectedSort,
  ]);

  // Active filter label helpers
  const selectedPersonName = useMemo(() => {
    if (selectedPersonFilter === 'all') return null;
    return (
      availablePeople.find(
        p => p.id === selectedPersonFilter || p.name.toLowerCase() === selectedPersonFilter.toLowerCase()
      )?.name || 'Friend'
    );
  }, [selectedPersonFilter, availablePeople]);

  const selectedTripName = useMemo(() => {
    if (selectedTripFilter === 'all') return null;
    return uniqueGroupTrips.find(t => t.id === selectedTripFilter)?.name || 'Trip';
  }, [selectedTripFilter, uniqueGroupTrips]);

  const activeModalFiltersCount = useMemo(() => {
    let count = 0;
    if (selectedCategory !== 'all') count += 1;
    if (selectedTimeframe !== 'all') count += 1;
    if (selectedPaymentMode !== 'all') count += 1;
    if (selectedPayerFilter !== 'all') count += 1;
    return count;
  }, [selectedCategory, selectedTimeframe, selectedPaymentMode, selectedPayerFilter]);

  const activeFiltersCount = useMemo(() => {
    let count = activeModalFiltersCount;
    if (selectedTripFilter !== 'all') count += 1;
    if (selectedPersonFilter !== 'all') count += 1;
    if (appliedExpenseSearch.trim().length > 0) count += 1;
    if (selectedSort !== 'date_desc') count += 1;
    return count;
  }, [activeModalFiltersCount, selectedTripFilter, selectedPersonFilter, appliedExpenseSearch, selectedSort]);

  const resetAllFilters = () => {
    setSearchQuery('');
    setAppliedExpenseSearch('');
    setSelectedCategory('all');
    setSelectedTripFilter('all');
    setSelectedPersonFilter('all');
    setSelectedTimeframe('all');
    setSelectedPaymentMode('all');
    setSelectedPayerFilter('all');
    setSelectedSort('date_desc');
  };

  const resetModalFilters = () => {
    setSelectedCategory('all');
    setSelectedTimeframe('all');
    setSelectedPaymentMode('all');
    setSelectedPayerFilter('all');
  };

  // Paginated items
  const displayedExpenses = useMemo(() => {
    return filteredAndSortedExpenses.slice(0, visibleCount);
  }, [filteredAndSortedExpenses, visibleCount]);

  const totalPaise = useMemo(() => {
    return filteredAndSortedExpenses.reduce((sum, e) => sum + e.amount, 0);
  }, [filteredAndSortedExpenses]);

  const handleEndReached = () => {
    if (loadingMore || visibleCount >= filteredAndSortedExpenses.length) return;
    setLoadingMore(true);
    setTimeout(() => {
      setVisibleCount(prev => Math.min(prev + PAGE_SIZE, filteredAndSortedExpenses.length));
      setLoadingMore(false);
    }, 200);
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/analyser');
    }
  };

  const handleOpenExpense = (tripId: string, expenseId: string) => {
    router.push(`/trip/${tripId}/expense/${expenseId}`);
  };

  const renderExpenseItem = ({ item, index }: { item: AnalyzedExpenseItem; index: number }) => {
    const meta = CATEGORY_ICONS[item.category] || CATEGORY_ICONS.General;
    const isLast = index === displayedExpenses.length - 1;

    return (
      <TouchableOpacity
        style={[
          styles.expenseRow,
          {
            backgroundColor: colors.card,
            borderBottomColor: isLast ? 'transparent' : colors.borderLight,
          },
        ]}
        activeOpacity={0.7}
        onPress={() => handleOpenExpense(item.trip_id, item.id)}
      >
        {/* Category Icon Box */}
        <View style={[styles.categoryIconBox, { backgroundColor: meta.bg }]}>
          <Ionicons name={meta.icon} size={sf(20)} color={meta.color} />
        </View>

        {/* Center Details */}
        <View style={{ flex: 1, marginHorizontal: 12 }}>
          <View style={styles.expenseMainLine}>
            <Text style={[styles.expenseTitle, { color: colors.text, fontSize: sf(14) }]} numberOfLines={1}>
              {item.description}
            </Text>
            <Text
              style={[styles.expenseAmount, { color: colors.text, fontSize: sf(14) }]}
              numberOfLines={1}
              adjustsFontSizeToFit={true}
              minimumFontScale={0.72}
            >
              {formatCurrencyAmount(item.amount, item.currency || userCurrency)}
            </Text>
          </View>

          <View style={styles.expenseMetaLine}>
            <Text
              style={[
                styles.expensePayer,
                { color: item.isMyExpense ? colors.success : colors.textSecondary, fontSize: sf(11.5) },
              ]}
              numberOfLines={1}
            >
              {item.isMyExpense ? 'Paid by You' : `Paid by ${item.payerName}`}
            </Text>
            <Text style={[styles.expenseTripBadge, { color: colors.textMuted, fontSize: sf(11) }]} numberOfLines={1}>
              • {item.trip_name}
            </Text>
          </View>

          <View style={[styles.expenseTagRow, { flexWrap: 'wrap', gap: 5 }]}>
            {/* Date Tag */}
            <View style={[styles.miniBadgeTag, { backgroundColor: isDark ? '#2D3748' : '#F3F4F6' }]}>
              <Text style={[styles.miniBadgeText, { color: colors.textSecondary, fontSize: sf(10) }]}>
                {item.dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </Text>
            </View>

            {/* Payment Mode Tag */}
            <View
              style={[
                styles.miniBadgeTag,
                {
                  backgroundColor:
                    item.payment_mode === 'upi'
                      ? colors.primaryLight
                      : item.payment_mode === 'cash'
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
                    fontSize: sf(10),
                    color:
                      item.payment_mode === 'upi'
                        ? colors.primary
                        : item.payment_mode === 'cash'
                        ? colors.success
                        : colors.textSecondary,
                  },
                ]}
              >
                {item.payment_mode.toUpperCase()}
              </Text>
            </View>

            {/* My Share Tag */}
            {item.mySharePaise > 0 && !item.isMyExpense && (
              <View style={[styles.miniBadgeTag, { backgroundColor: 'rgba(239, 68, 68, 0.12)' }]}>
                <Text style={[styles.miniBadgeText, { color: colors.danger, fontSize: sf(10) }]}>
                  Your Share: {formatCurrencyAmount(item.mySharePaise, userCurrency)}
                </Text>
              </View>
            )}
          </View>
        </View>

        <Ionicons name="chevron-forward" size={sf(16)} color={colors.textMuted} />
      </TouchableOpacity>
    );
  };

  const renderFooter = () => {
    if (loadingMore) {
      return (
        <View style={styles.footerLoader}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.footerText, { color: colors.textSecondary, fontSize: sf(12) }]}>
            Loading next {Math.min(PAGE_SIZE, filteredAndSortedExpenses.length - visibleCount)} expenses...
          </Text>
        </View>
      );
    }

    if (displayedExpenses.length > 0 && visibleCount >= filteredAndSortedExpenses.length) {
      return (
        <View style={styles.footerEnd}>
          <Text style={[styles.footerEndText, { color: colors.textMuted, fontSize: sf(11.5) }]}>
            All {filteredAndSortedExpenses.length} expenses loaded
          </Text>
        </View>
      );
    }

    return null;
  };

  const currentSortLabel = SORT_OPTIONS.find(s => s.id === selectedSort)?.label || 'Newest First';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* Top Header Section */}
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.card,
            paddingTop: insets.top + 8,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <View style={[styles.headerContainer, { maxWidth: 840, width: '100%', alignSelf: 'center' }]}>
          {/* Back Button & Title Row */}
          <View style={styles.headerRow}>
            <TouchableOpacity
              style={[styles.backButton, { backgroundColor: isDark ? '#2D3748' : '#F3F4F6' }]}
              onPress={handleBack}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-back" size={22} color={colors.text} />
            </TouchableOpacity>

            <View style={styles.headerTitleWrap}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={[styles.headerTitle, { color: colors.text, fontSize: sf(19) }]} numberOfLines={1}>
                  All Expenses
                </Text>
                <View style={[styles.countBadge, { backgroundColor: colors.primaryLight }]}>
                  <Text style={[styles.countBadgeText, { color: colors.primary, fontSize: sf(11.5) }]}>
                    {filteredAndSortedExpenses.length}
                  </Text>
                </View>
              </View>
              <Text style={[styles.headerSubtitle, { color: colors.textSecondary, fontSize: sf(11.5) }]} numberOfLines={1}>
                {displayedExpenses.length < filteredAndSortedExpenses.length
                  ? `Showing ${displayedExpenses.length} of ${filteredAndSortedExpenses.length} • Sorted by ${currentSortLabel}`
                  : `Sorted by ${currentSortLabel}`}
              </Text>
            </View>

            {activeFiltersCount > 0 && (
              <TouchableOpacity
                style={[styles.clearAllBtn, { backgroundColor: colors.dangerBg }]}
                onPress={resetAllFilters}
                activeOpacity={0.7}
              >
                <Text style={[styles.clearAllBtnText, { color: colors.danger, fontSize: sf(11) }]}>
                  Clear All
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* 1. TOP CONTROLS ROW (Search Bar + Filter Button + Sort Button) matching Analyser */}
          <View style={styles.controlsRow}>
            <View
              style={[
                styles.searchBar,
                {
                  backgroundColor: colors.cardSecondary || (isDark ? '#1F2937' : '#F3F4F6'),
                  borderColor: isSearchFocused ? colors.primary : colors.border,
                },
              ]}
            >
              <Ionicons
                name="search"
                size={sf(16)}
                color={isSearchFocused ? colors.primary : colors.textSecondary}
              />
              <TextInput
                style={[styles.searchInput, { color: colors.text, fontSize: sf(13) }]}
                placeholder={width < 360 ? 'Search friends, trips...' : 'Search friends, trips, expenses...'}
                placeholderTextColor={colors.textMuted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setIsSearchFocused(false)}
                returnKeyType="search"
                autoCorrect={false}
                autoCapitalize="none"
                onSubmitEditing={() => {
                  if (searchQuery.trim().length > 0) {
                    setAppliedExpenseSearch(searchQuery.trim());
                    setSearchQuery('');
                    Keyboard.dismiss();
                  }
                }}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity
                  onPress={() => setSearchQuery('')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close-circle" size={sf(16)} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>

            {/* Filter Trigger Button */}
            <TouchableOpacity
              style={[
                styles.iconActionBtn,
                {
                  backgroundColor: activeModalFiltersCount > 0 ? colors.primary : colors.card,
                  borderColor: activeModalFiltersCount > 0 ? colors.primary : colors.border,
                  width: isSmall ? 38 : 42,
                  height: isSmall ? 38 : 42,
                },
              ]}
              onPress={() => setFilterModalVisible(true)}
              activeOpacity={0.7}
            >
              <Ionicons
                name="filter"
                size={sf(17)}
                color={activeModalFiltersCount > 0 ? '#FFFFFF' : colors.text}
              />
              {activeModalFiltersCount > 0 && <View style={styles.activeFilterDot} />}
            </TouchableOpacity>

            {/* Sort Trigger Button */}
            <TouchableOpacity
              style={[
                styles.iconActionBtn,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  width: isSmall ? 38 : 42,
                  height: isSmall ? 38 : 42,
                },
              ]}
              onPress={() => setSortModalVisible(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="swap-vertical" size={sf(17)} color={colors.text} />
            </TouchableOpacity>
          </View>

          {/* 3-letter threshold hint when typing 1 or 2 characters */}
          {searchQuery.trim().length > 0 && searchQuery.trim().length < 3 && (
            <View style={styles.searchHintRow}>
              <Ionicons name="information-circle-outline" size={13} color={colors.textMuted} />
              <Text style={[styles.searchHintText, { color: colors.textMuted, fontSize: sf(11) }]}>
                Type {3 - searchQuery.trim().length} more {3 - searchQuery.trim().length === 1 ? 'letter' : 'letters'} to see matching friends & trips
              </Text>
            </View>
          )}

          {/* Autocomplete Suggestions for Friends & Trips (shows after typing 3 letters) */}
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
                    <Ionicons name="people" size={14} color={colors.primary} />
                    <Text style={[styles.suggestionSectionTitle, { color: colors.primary, fontSize: sf(11) }]}>
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
                            backgroundColor: isSelected ? colors.primaryLight : 'transparent',
                          },
                        ]}
                        onPress={() => {
                          setSelectedPersonFilter(p.id);
                          setSearchQuery('');
                          Keyboard.dismiss();
                        }}
                      >
                        {p.avatarUrl ? (
                          <Image source={{ uri: p.avatarUrl }} style={styles.suggestionAvatarImg} />
                        ) : (
                          <View
                            style={[
                              styles.suggestionAvatar,
                              { backgroundColor: p.isCurrentUser ? colors.primaryLight : isDark ? '#283449' : '#E6EEFA' },
                            ]}
                          >
                            <Text style={[styles.suggestionAvatarText, { color: colors.primary, fontSize: sf(12) }]}>
                              {p.name.slice(0, 2).toUpperCase()}
                            </Text>
                          </View>
                        )}
                        <View style={styles.suggestionContent}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, marginRight: 6 }}>
                            <Text
                              style={[
                                styles.suggestionName,
                                {
                                  color: colors.text,
                                  fontWeight: isSelected ? '700' : '600',
                                  fontSize: sf(13),
                                },
                              ]}
                              numberOfLines={1}
                            >
                              {p.name} {p.isCurrentUser ? '(You)' : ''}
                            </Text>
                            {p.isFriend && (
                              <View style={[styles.friendBadge, { backgroundColor: colors.primaryLight }]}>
                                <Text style={[styles.friendBadgeText, { color: colors.primary }]}>Friend</Text>
                              </View>
                            )}
                          </View>
                          <Text style={[styles.suggestionSub, { color: colors.textSecondary, fontSize: sf(11) }]} numberOfLines={1}>
                            {p.expenseCount > 0
                              ? `${p.expenseCount} ${p.expenseCount === 1 ? 'expense' : 'expenses'}${
                                  p.tripNames.length > 0 ? ` • ${p.tripNames.slice(0, 2).join(', ')}` : ''
                                }`
                              : p.isFriend
                              ? 'Friend in contacts • Tap to filter'
                              : 'Tap to filter expenses'}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.filterActionPill,
                            {
                              backgroundColor: isSelected ? colors.primary : colors.cardSecondary || (isDark ? '#2D3748' : '#F3F4F6'),
                              borderColor: isSelected ? colors.primary : colors.border,
                            },
                          ]}
                        >
                          <Text style={[styles.filterActionText, { color: isSelected ? '#FFFFFF' : colors.primary, fontSize: sf(11) }]}>
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
                    <Text style={[styles.suggestionSectionTitle, { color: colors.primary, fontSize: sf(11) }]}>
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
                            backgroundColor: isSelected ? colors.primaryLight : 'transparent',
                          },
                        ]}
                        onPress={() => {
                          setSelectedTripFilter(t.id);
                          setSearchQuery('');
                          Keyboard.dismiss();
                        }}
                      >
                        <View style={[styles.suggestionAvatar, { backgroundColor: isDark ? '#283449' : '#E6EEFA' }]}>
                          <Ionicons name="airplane" size={14} color={colors.primary} />
                        </View>
                        <View style={styles.suggestionContent}>
                          <Text
                            style={[
                              styles.suggestionName,
                              {
                                color: colors.text,
                                fontWeight: isSelected ? '700' : '600',
                                fontSize: sf(13),
                              },
                            ]}
                            numberOfLines={1}
                          >
                            {t.name}
                          </Text>
                          <Text style={[styles.suggestionSub, { color: colors.textSecondary, fontSize: sf(11) }]}>
                            Tap to filter expenses for this trip
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.filterActionPill,
                            {
                              backgroundColor: isSelected ? colors.primary : colors.cardSecondary || (isDark ? '#2D3748' : '#F3F4F6'),
                              borderColor: isSelected ? colors.primary : colors.border,
                            },
                          ]}
                        >
                          <Text style={[styles.filterActionText, { color: isSelected ? '#FFFFFF' : colors.primary, fontSize: sf(11) }]}>
                            {isSelected ? 'Selected' : 'Select'}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {/* Option to search notes & descriptions for typed query */}
              <TouchableOpacity
                style={[
                  styles.suggestionSearchExpenseRow,
                  (searchSuggestions.people.length > 0 || searchSuggestions.trips.length > 0) && {
                    borderTopWidth: 1,
                    borderTopColor: isDark ? 'rgba(255,255,255,0.06)' : colors.borderLight,
                    marginTop: 6,
                    paddingTop: 8,
                  },
                ]}
                onPress={() => {
                  setAppliedExpenseSearch(searchQuery.trim());
                  setSearchQuery('');
                  Keyboard.dismiss();
                }}
              >
                <Ionicons name="search-outline" size={15} color={colors.primary} />
                <Text style={[styles.suggestionSearchExpenseText, { color: colors.text, fontSize: sf(12.5) }]} numberOfLines={1}>
                  Search all expenses & notes for "{searchQuery.trim()}"
                </Text>
                <View style={[styles.filterActionPill, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
                  <Text style={[styles.filterActionText, { color: colors.primary, fontSize: sf(11) }]}>Search</Text>
                </View>
              </TouchableOpacity>
            </View>
          )}

          {/* 2. ACTIVE SELECTED FILTER PILLS (Friend, Trip, Search text, Category, etc.) */}
          {(selectedPersonFilter !== 'all' ||
            selectedTripFilter !== 'all' ||
            appliedExpenseSearch.length > 0 ||
            selectedCategory !== 'all' ||
            selectedPaymentMode !== 'all' ||
            selectedTimeframe !== 'all' ||
            selectedPayerFilter !== 'all') && (
            <View style={styles.topSelectedFilterRow}>
              {selectedPersonFilter !== 'all' && (
                <View style={[styles.topSelectedFilterPill, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
                  <Ionicons name="person" size={sf(12)} color={colors.primary} />
                  <Text style={[styles.topSelectedFilterPillText, { color: colors.text, fontSize: sf(11.5) }]} numberOfLines={1}>
                    Friend: <Text style={{ fontWeight: '700', color: colors.primary }}>{selectedPersonName}</Text>
                  </Text>
                  <TouchableOpacity
                    onPress={() => setSelectedPersonFilter('all')}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close-circle" size={sf(14)} color={colors.primary} />
                  </TouchableOpacity>
                </View>
              )}

              {selectedTripFilter !== 'all' && (
                <View style={[styles.topSelectedFilterPill, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
                  <Ionicons name="airplane" size={sf(12)} color={colors.primary} />
                  <Text style={[styles.topSelectedFilterPillText, { color: colors.text, fontSize: sf(11.5) }]} numberOfLines={1}>
                    Trip: <Text style={{ fontWeight: '700', color: colors.primary }}>{selectedTripName}</Text>
                  </Text>
                  <TouchableOpacity
                    onPress={() => setSelectedTripFilter('all')}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close-circle" size={sf(14)} color={colors.primary} />
                  </TouchableOpacity>
                </View>
              )}

              {appliedExpenseSearch.length > 0 && (
                <View style={[styles.topSelectedFilterPill, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
                  <Ionicons name="search" size={sf(12)} color={colors.primary} />
                  <Text style={[styles.topSelectedFilterPillText, { color: colors.text, fontSize: sf(11.5) }]} numberOfLines={1}>
                    Search: <Text style={{ fontWeight: '700', color: colors.primary }}>"{appliedExpenseSearch}"</Text>
                  </Text>
                  <TouchableOpacity
                    onPress={() => setAppliedExpenseSearch('')}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close-circle" size={sf(14)} color={colors.primary} />
                  </TouchableOpacity>
                </View>
              )}

              {selectedCategory !== 'all' && (
                <View style={[styles.topSelectedFilterPill, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
                  <Ionicons name="pricetag" size={sf(12)} color={colors.primary} />
                  <Text style={[styles.topSelectedFilterPillText, { color: colors.text, fontSize: sf(11.5) }]} numberOfLines={1}>
                    Category: <Text style={{ fontWeight: '700', color: colors.primary }}>{selectedCategory}</Text>
                  </Text>
                  <TouchableOpacity
                    onPress={() => setSelectedCategory('all')}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close-circle" size={sf(14)} color={colors.primary} />
                  </TouchableOpacity>
                </View>
              )}

              {selectedPaymentMode !== 'all' && (
                <View style={[styles.topSelectedFilterPill, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
                  <Ionicons name="card" size={sf(12)} color={colors.primary} />
                  <Text style={[styles.topSelectedFilterPillText, { color: colors.text, fontSize: sf(11.5) }]} numberOfLines={1}>
                    Payment: <Text style={{ fontWeight: '700', color: colors.primary }}>{selectedPaymentMode.toUpperCase()}</Text>
                  </Text>
                  <TouchableOpacity
                    onPress={() => setSelectedPaymentMode('all')}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close-circle" size={sf(14)} color={colors.primary} />
                  </TouchableOpacity>
                </View>
              )}

              {selectedTimeframe !== 'all' && (
                <View style={[styles.topSelectedFilterPill, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
                  <Ionicons name="time" size={sf(12)} color={colors.primary} />
                  <Text style={[styles.topSelectedFilterPillText, { color: colors.text, fontSize: sf(11.5) }]} numberOfLines={1}>
                    Time: <Text style={{ fontWeight: '700', color: colors.primary }}>{selectedTimeframe}</Text>
                  </Text>
                  <TouchableOpacity
                    onPress={() => setSelectedTimeframe('all')}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close-circle" size={sf(14)} color={colors.primary} />
                  </TouchableOpacity>
                </View>
              )}

              {selectedPayerFilter !== 'all' && (
                <View style={[styles.topSelectedFilterPill, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
                  <Ionicons name="wallet" size={sf(12)} color={colors.primary} />
                  <Text style={[styles.topSelectedFilterPillText, { color: colors.text, fontSize: sf(11.5) }]} numberOfLines={1}>
                    Paid by: <Text style={{ fontWeight: '700', color: colors.primary }}>{selectedPayerFilter === 'me' ? 'You' : 'Others'}</Text>
                  </Text>
                  <TouchableOpacity
                    onPress={() => setSelectedPayerFilter('all')}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close-circle" size={sf(14)} color={colors.primary} />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {/* 3. Horizontal Trip Filter Chips */}
          {uniqueGroupTrips.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterScroll}
              style={{ marginBottom: 6 }}
            >
              <TouchableOpacity
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: selectedTripFilter === 'all' ? colors.primary : colors.card,
                    borderColor: selectedTripFilter === 'all' ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => setSelectedTripFilter('all')}
                activeOpacity={0.7}
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
                    { color: selectedTripFilter === 'all' ? '#FFFFFF' : colors.textSecondary, fontSize: sf(12) },
                  ]}
                >
                  All ({uniqueGroupTrips.length} Trips)
                </Text>
              </TouchableOpacity>

              {uniqueGroupTrips.map(trip => (
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
                  activeOpacity={0.7}
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
                      { color: selectedTripFilter === trip.id ? '#FFFFFF' : colors.textSecondary, fontSize: sf(12) },
                    ]}
                    numberOfLines={1}
                  >
                    {trip.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* 4. Horizontal Category Filter Chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryScroll}
          >
            {CATEGORIES.map(cat => {
              const isSelected = selectedCategory === cat;
              const meta = cat === 'all' ? null : CATEGORY_ICONS[cat] || CATEGORY_ICONS.General;
              return (
                <TouchableOpacity
                  key={cat}
                  style={[
                    styles.categoryChip,
                    {
                      backgroundColor: isSelected
                        ? colors.primary
                        : isDark
                        ? '#2D3748'
                        : '#F3F4F6',
                      borderColor: isSelected ? colors.primary : 'transparent',
                    },
                  ]}
                  onPress={() => setSelectedCategory(cat)}
                  activeOpacity={0.7}
                >
                  {meta && (
                    <Ionicons
                      name={meta.icon}
                      size={13}
                      color={isSelected ? '#FFFFFF' : meta.color}
                      style={{ marginRight: 4 }}
                    />
                  )}
                  <Text
                    style={[
                      styles.categoryChipText,
                      { color: isSelected ? '#FFFFFF' : colors.textSecondary, fontSize: sf(12) },
                    ]}
                  >
                    {cat === 'all' ? 'All' : cat}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>

      {/* Summary Strip */}
      <View
        style={[
          styles.summaryStrip,
          {
            backgroundColor: isDark ? '#1E293B' : '#F8FAFC',
            borderBottomColor: colors.borderLight,
          },
        ]}
      >
        <View style={{ maxWidth: 840, width: '100%', alignSelf: 'center', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary, fontSize: sf(10.5) }]}>
              Total Filtered Spend
            </Text>
            <Text
              style={[styles.summaryValue, { color: colors.text, fontSize: sf(15) }]}
              numberOfLines={1}
              adjustsFontSizeToFit={true}
              minimumFontScale={0.72}
            >
              {formatCurrencyAmount(totalPaise, userCurrency)}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary, fontSize: sf(10.5) }]}>
              Loaded
            </Text>
            <Text style={[styles.summaryValue, { color: colors.primary, fontSize: sf(14) }]}>
              {displayedExpenses.length} / {filteredAndSortedExpenses.length}
            </Text>
          </View>
        </View>
      </View>

      {/* Main List */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary, fontSize: sf(13.5) }]}>
            Loading expenses...
          </Text>
        </View>
      ) : filteredAndSortedExpenses.length === 0 ? (
        <View style={styles.centerContainer}>
          <View
            style={[
              styles.emptyIconBox,
              { backgroundColor: isDark ? '#2D3748' : '#F3F4F6' },
            ]}
          >
            <Ionicons name="receipt-outline" size={48} color={colors.textMuted} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text, fontSize: sf(17) }]}>No expenses found</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary, fontSize: sf(12.5) }]}>
            {activeFiltersCount > 0
              ? 'Try modifying your search query or active filters'
              : 'Add expenses in your trips to explore them here'}
          </Text>
          {activeFiltersCount > 0 && (
            <TouchableOpacity
              style={[styles.resetButton, { backgroundColor: colors.primary }]}
              onPress={resetAllFilters}
              activeOpacity={0.7}
            >
              <Text style={[styles.resetButtonText, { fontSize: sf(12.5) }]}>Reset All Filters</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          data={displayedExpenses}
          renderItem={renderExpenseItem}
          keyExtractor={item => item.id}
          contentContainerStyle={[
            styles.listContent,
            {
              maxWidth: 840,
              width: '100%',
              alignSelf: 'center',
              paddingBottom: Math.max(insets.bottom, 24) + 20,
            },
          ]}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.4}
          ListFooterComponent={renderFooter}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        />
      )}

      {/* FILTER BOTTOM SHEET MODAL (DraggableBottomSheet) */}
      <DraggableBottomSheet
        visible={filterModalVisible}
        onClose={() => setFilterModalVisible(false)}
        maxHeight="85%"
        sheetStyle={{ maxWidth: 640, alignSelf: 'center', width: '100%', paddingBottom: 20 }}
      >
        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
          <View>
            <Text style={[styles.modalTitle, { color: colors.text, fontSize: sf(17) }]}>Filters</Text>
            <Text style={[styles.modalSub, { color: colors.textSecondary, fontSize: sf(11.5) }]}>
              Narrow down all expenses
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
          {/* Category */}
          <Text style={[styles.filterGroupHeading, { color: colors.text, fontSize: sf(12) }]}>Category</Text>
          <View style={styles.filterChipGroup}>
            {['all', 'Food', 'Stay', 'Fuel', 'Tickets', 'Groceries', 'General', 'Shopping', 'Entertainment'].map(cat => (
              <TouchableOpacity
                key={cat}
                style={[
                  styles.modalOptionChip,
                  {
                    backgroundColor:
                      selectedCategory.toLowerCase() === cat.toLowerCase()
                        ? colors.primary
                        : colors.inputBackground,
                    borderColor:
                      selectedCategory.toLowerCase() === cat.toLowerCase()
                        ? colors.primary
                        : colors.border,
                  },
                ]}
                onPress={() => setSelectedCategory(cat)}
              >
                <Text
                  style={[
                    styles.modalOptionText,
                    {
                      color:
                        selectedCategory.toLowerCase() === cat.toLowerCase() ? '#FFFFFF' : colors.text,
                      fontSize: sf(11.5),
                    },
                  ]}
                >
                  {cat === 'all' ? 'All Categories' : cat}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Timeframe */}
          <Text style={[styles.filterGroupHeading, { color: colors.text, fontSize: sf(12) }]}>Timeframe</Text>
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
                    { color: selectedTimeframe === tf.id ? '#FFFFFF' : colors.text, fontSize: sf(11.5) },
                  ]}
                >
                  {tf.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Payment Method */}
          <Text style={[styles.filterGroupHeading, { color: colors.text, fontSize: sf(12) }]}>Payment Method</Text>
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
                    { color: selectedPaymentMode === pm.id ? '#FFFFFF' : colors.text, fontSize: sf(11.5) },
                  ]}
                >
                  {pm.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Who Paid */}
          <Text style={[styles.filterGroupHeading, { color: colors.text, fontSize: sf(12) }]}>Who Paid</Text>
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
                    { color: selectedPayerFilter === pf.id ? '#FFFFFF' : colors.text, fontSize: sf(11.5) },
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
            onPress={resetModalFilters}
          >
            <Text style={[styles.modalResetBtnText, { color: colors.danger, fontSize: sf(12.5) }]}>Reset All</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modalApplyBtn, { backgroundColor: colors.primary }]}
            onPress={() => setFilterModalVisible(false)}
          >
            <Text style={[styles.modalApplyBtnText, { fontSize: sf(12.5) }]}>Apply Filters</Text>
          </TouchableOpacity>
        </View>
      </DraggableBottomSheet>

      {/* SORT BOTTOM SHEET MODAL (DraggableBottomSheet) */}
      <DraggableBottomSheet
        visible={sortModalVisible}
        onClose={() => setSortModalVisible(false)}
        dragEntireSheet={true}
        sheetStyle={{ maxWidth: 640, alignSelf: 'center', width: '100%', paddingBottom: 20 }}
      >
        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
          <View>
            <Text style={[styles.modalTitle, { color: colors.text, fontSize: sf(17) }]}>Sort By</Text>
            <Text style={[styles.modalSub, { color: colors.textSecondary, fontSize: sf(11.5) }]}>
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
                    backgroundColor: isSelected
                      ? isDark
                        ? 'rgba(99, 102, 241, 0.15)'
                        : '#EEF2FF'
                      : 'transparent',
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
                        fontSize: sf(13.5),
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  headerContainer: {
    width: '100%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  headerTitleWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 11.5,
    marginTop: 2,
    fontWeight: '500',
  },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  countBadgeText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  clearAllBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  clearAllBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
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
    height: '100%',
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
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
  searchHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
    marginTop: -2,
    marginBottom: 8,
  },
  searchHintText: {
    fontSize: 11,
    fontWeight: '500',
  },
  searchSuggestionsCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
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
  suggestionAvatarImg: {
    width: 32,
    height: 32,
    borderRadius: 16,
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
  friendBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 6,
  },
  friendBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#7895B7',
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
  suggestionSearchExpenseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    gap: 10,
  },
  suggestionSearchExpenseText: {
    fontSize: 12.5,
    fontWeight: '600',
    flex: 1,
  },
  topSelectedFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  topSelectedFilterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
    maxWidth: '100%',
    flexShrink: 1,
  },
  topSelectedFilterPillText: {
    fontSize: 11.5,
    fontWeight: '500',
    flexShrink: 1,
  },
  filterScroll: {
    flexDirection: 'row',
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  categoryScroll: {
    paddingVertical: 4,
    gap: 8,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  summaryStrip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  summaryLabel: {
    fontSize: 10.5,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryValue: {
    fontSize: 15,
    fontWeight: '700',
    marginTop: 2,
  },
  listContent: {
    padding: 16,
  },
  expenseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    marginBottom: 10,
    borderBottomWidth: 1,
  },
  categoryIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expenseMainLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  expenseTitle: {
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  expenseAmount: {
    fontSize: 14,
    fontWeight: '800',
  },
  expenseMetaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  expensePayer: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  expenseTripBadge: {
    fontSize: 11,
    marginLeft: 4,
    flex: 1,
  },
  expenseTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  miniBadgeTag: {
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
  },
  miniBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  footerLoader: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 18,
    gap: 8,
  },
  footerText: {
    fontSize: 12,
    fontWeight: '600',
  },
  footerEnd: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  footerEndText: {
    fontSize: 11.5,
    fontWeight: '500',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 13.5,
    fontWeight: '600',
  },
  emptyIconBox: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 12.5,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  resetButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  resetButtonText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '700',
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
    fontSize: 17,
    fontWeight: '700',
  },
  modalSub: {
    fontSize: 11.5,
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
    fontSize: 12,
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
    fontSize: 11.5,
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
    fontSize: 12.5,
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
    fontSize: 12.5,
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
    fontSize: 13.5,
  },
});
