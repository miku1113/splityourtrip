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
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/useThemeStore';
import {
  useTripStore,
  computeBalances,
  normalizeExpensesForTrip,
} from '../../src/features/trips/useTripStore';
import { useAuthStore } from '../../src/features/auth/useAuthStore';
import { AppStorage } from '../../src/lib/storage';
import { Trip, TripMember, TripBalanceRow } from '../../src/types/database';
import { formatCurrencyAmount, getUserCurrencyPreference } from '../../src/services/currency';

const PAGE_SIZE = 10;
const INLINE_TRIPS_LIMIT = 5;

const CATEGORY_ICONS: Record<string, { icon: any; color: string; bg: string }> = {
  Food: { icon: 'fast-food', color: '#F59E0B', bg: '#FEF3C7' },
  Stay: { icon: 'bed', color: '#6366F1', bg: '#EEF2FF' },
  Fuel: { icon: 'car', color: '#EF4444', bg: '#FEE2E2' },
  Tickets: { icon: 'ticket', color: '#8B5CF6', bg: '#F3E8FF' },
  Groceries: { icon: 'cart', color: '#10B981', bg: '#ECFDF5' },
  General: { icon: 'pricetag', color: '#3B82F6', bg: '#EFF6FF' },
};

interface TripCachedAnalytics {
  members: TripMember[];
  expenses: any[];
  balances: TripBalanceRow[];
}

export default function AnalyserScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const { user } = useAuthStore();
  const { trips, expenses, members, initTrips, isLoading: storeLoading } = useTripStore();

  const [selectedTripFilter, setSelectedTripFilter] = useState<string>('all');
  const [userCurrency, setUserCurrency] = useState('INR');
  const [refreshing, setRefreshing] = useState(false);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [allTripsData, setAllTripsData] = useState<Record<string, TripCachedAnalytics>>({});

  // View More All Trips Modal state (with pagination of 10)
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

        // Fallback to store state if this trip is currently active in memory
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
  }, [trips, expenses, members, loadAllTripsAnalytics]);

  useFocusEffect(
    useCallback(() => {
      navLockRef.current = false;
      setOpeningTripId(null);
      const task = InteractionManager.runAfterInteractions(() => {
        getUserCurrencyPreference().then(c => setUserCurrency(c));
        loadAllTripsAnalytics();
      });
      return () => task.cancel();
    }, [loadAllTripsAnalytics])
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

  const onRefresh = async () => {
    setRefreshing(true);
    await initTrips();
    await loadAllTripsAnalytics();
    setRefreshing(false);
  };

  // Deduplicated Group Trips ONLY (excludes all 1-on-1 friend splits & prevents any duplicate trip rows)
  const uniqueGroupTrips = useMemo(() => {
    const groupOnly = trips.filter(
      t =>
        t.trip_type !== 'friend_split' &&
        !(t as any).is_friend_split &&
        !t.name.toLowerCase().startsWith('split with ')
    );

    // Sort newest first
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
        // If two trips have the exact same name, keep the one that has expenses or newer date
        const existingExpCount = allTripsData[existing.id]?.expenses?.length || 0;
        const currentExpCount = allTripsData[t.id]?.expenses?.length || 0;
        if (currentExpCount > existingExpCount) {
          byNameMap.set(cleanName, t);
        }
      }
    }

    return Array.from(byNameMap.values());
  }, [trips, allTripsData]);

  // Only the 5 latest group trips for inline display
  const latestFiveGroupTrips = useMemo(() => {
    return uniqueGroupTrips.slice(0, INLINE_TRIPS_LIMIT);
  }, [uniqueGroupTrips]);

  // Filtered group trips for the "View More" modal
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

  // Deduplicated all trips for overall spending calculation
  const uniqueAllTrips = useMemo(() => {
    const seen = new Set<string>();
    return trips.filter(t => {
      if (!t?.id || seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  }, [trips]);

  // Aggregate statistics across all trips or the selected trip
  const analytics = useMemo(() => {
    let totalPaise = 0;
    let yourPaidPaise = 0;
    let yourSharePaise = 0;
    let totalExpenseCount = 0;
    let maxExpense: any = null;

    const categoryTotals: Record<string, number> = {
      Food: 0,
      Stay: 0,
      Fuel: 0,
      Tickets: 0,
      Groceries: 0,
      General: 0,
    };
    const paymentModeTotals: Record<string, number> = {
      upi: 0,
      cash: 0,
      other: 0,
    };

    const targetTrips =
      selectedTripFilter === 'all'
        ? uniqueAllTrips
        : uniqueAllTrips.filter(t => t.id === selectedTripFilter);

    for (const t of targetTrips) {
      const data = allTripsData[t.id];
      if (!data) continue;

      const myMember =
        data.members.find(
          m =>
            (user?.id && (m.profile_id === user.id || m.user_id === user.id)) ||
            m.role === 'admin'
        ) || data.members[0];

      const myBalanceRow = data.balances.find(b => b.member_id === myMember?.id);
      if (myBalanceRow) {
        yourPaidPaise += Number(myBalanceRow.total_paid) || 0;
        yourSharePaise += Number(myBalanceRow.total_share) || 0;
      }

      for (const exp of data.expenses) {
        const amt = Number(exp.amount) || 0;
        totalPaise += amt;
        totalExpenseCount += 1;

        if (!maxExpense || amt > Number(maxExpense.amount || 0)) {
          maxExpense = exp;
        }

        const cat =
          exp.category && categoryTotals[exp.category] !== undefined
            ? exp.category
            : 'General';
        categoryTotals[cat] = (categoryTotals[cat] || 0) + amt;

        const mode = exp.payment_mode || 'other';
        paymentModeTotals[mode] = (paymentModeTotals[mode] || 0) + amt;
      }
    }

    // Sort categories descending by amount
    const sortedCategories = Object.entries(categoryTotals)
      .map(([name, amount]) => ({
        name,
        amount,
        percentage: totalPaise > 0 ? Math.round((amount / totalPaise) * 100) : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    return {
      totalPaise,
      yourPaidPaise,
      yourSharePaise,
      count: totalExpenseCount,
      maxExpense,
      sortedCategories,
      paymentModeTotals,
    };
  }, [uniqueAllTrips, allTripsData, selectedTripFilter, user?.id]);

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
      {/* Trip Filter Bar (Group Trips) */}
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

      {/* Main Total Spending Hero Card */}
      <View
        style={[
          styles.heroCard,
          {
            backgroundColor: isDark ? 'rgba(99, 102, 241, 0.15)' : '#F0F4FF',
            borderColor: isDark ? colors.border : '#E0E7FF',
          },
        ]}
      >
        <Text style={[styles.heroLabel, { color: colors.textSecondary }]}>
          TOTAL SPENDING ANALYSED
        </Text>
        <Text style={[styles.heroAmount, { color: colors.primary }]}>
          {formatCurrencyAmount(analytics.totalPaise, userCurrency)}
        </Text>

        <View style={styles.heroSubRow}>
          <View style={styles.heroStatCol}>
            <Text style={[styles.heroStatLabel, { color: colors.textSecondary }]}>You Paid</Text>
            <Text style={[styles.heroStatValue, { color: colors.success }]}>
              {formatCurrencyAmount(analytics.yourPaidPaise, userCurrency)}
            </Text>
          </View>

          <View style={[styles.heroDivider, { backgroundColor: colors.border }]} />

          <View style={styles.heroStatCol}>
            <Text style={[styles.heroStatLabel, { color: colors.textSecondary }]}>Your Share</Text>
            <Text style={[styles.heroStatValue, { color: colors.text }]}>
              {formatCurrencyAmount(analytics.yourSharePaise, userCurrency)}
            </Text>
          </View>

          <View style={[styles.heroDivider, { backgroundColor: colors.border }]} />

          <View style={styles.heroStatCol}>
            <Text style={[styles.heroStatLabel, { color: colors.textSecondary }]}>Expenses</Text>
            <Text style={[styles.heroStatValue, { color: colors.text }]}>
              {analytics.count}
            </Text>
          </View>
        </View>
      </View>

      {/* Category Breakdown Section */}
      <View style={styles.sectionTitleRow}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          Category Breakdown
        </Text>
        <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>
          Where money was spent
        </Text>
      </View>

      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      >
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
            return (
              <View
                key={cat.name}
                style={[styles.categoryRow, { borderBottomColor: colors.borderLight }]}
              >
                <View style={[styles.categoryIconBox, { backgroundColor: meta.bg }]}>
                  <Ionicons name={meta.icon} size={20} color={meta.color} />
                </View>

                <View style={{ flex: 1, marginHorizontal: 12 }}>
                  <View style={styles.categoryHeaderLine}>
                    <Text style={[styles.categoryName, { color: colors.text }]}>
                      {cat.name}
                    </Text>
                    <Text style={[styles.categoryAmount, { color: colors.text }]}>
                      {formatCurrencyAmount(cat.amount, userCurrency)}
                    </Text>
                  </View>

                  {/* Progress Bar */}
                  <View style={[styles.progressBarTrack, { backgroundColor: colors.borderLight }]}>
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
              </View>
            );
          })
        )}
      </View>

      {/* Insights Cards */}
      <View style={styles.sectionTitleRow}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          Smart Insights
        </Text>
      </View>

      <View style={styles.insightsGrid}>
        {/* Biggest Expense Card */}
        <View
          style={[
            styles.insightCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
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
            </>
          ) : (
            <Text style={[styles.insightSub, { color: colors.textMuted }]}>No records yet</Text>
          )}
        </View>

        {/* Top Payment Mode */}
        <View
          style={[
            styles.insightCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={[styles.insightIcon, { backgroundColor: '#EEF2FF' }]}>
            <Ionicons name="card" size={20} color={colors.primary} />
          </View>
          <Text style={[styles.insightLabel, { color: colors.textSecondary }]}>
            Payment Modes
          </Text>
          <Text style={[styles.insightValue, { color: colors.text }]}>
            UPI: {formatCurrencyAmount(analytics.paymentModeTotals.upi, userCurrency)}
          </Text>
          <Text style={[styles.insightSub, { color: colors.textSecondary }]}>
            Cash: {formatCurrencyAmount(analytics.paymentModeTotals.cash, userCurrency)}
          </Text>
        </View>
      </View>

      {/* Trips Summary Card (Group Trips ONLY, max 5 latest + View More modal with pagination of 10) */}
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

      {/* View All Group Trips Modal (Paginated by 10) */}
      {allTripsModalVisible && (
      <Modal
        visible={allTripsModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAllTripsModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View
            style={[
              styles.modalSheet,
              {
                backgroundColor: colors.card,
                borderTopColor: colors.border,
              },
            ]}
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
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
    paddingBottom: 100,
  },
  loadingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    marginBottom: 8,
    gap: 8,
  },
  loadingBannerText: {
    fontSize: 12,
    fontWeight: '600',
  },
  filterSection: {
    marginBottom: 14,
  },
  filterScroll: {
    flexDirection: 'row',
  },
  filterChip: {
    paddingHorizontal: 14,
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
    padding: 20,
    marginBottom: 20,
    alignItems: 'center',
  },
  heroLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 6,
  },
  heroAmount: {
    fontSize: 34,
    fontWeight: '800',
    marginBottom: 16,
  },
  heroSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
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
    height: 28,
  },
  heroStatLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 3,
  },
  heroStatValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  sectionTitleRow: {
    marginBottom: 10,
    marginTop: 4,
  },
  sectionHeaderWithAction: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  sectionSubtitle: {
    fontSize: 12,
    marginTop: 2,
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
    marginBottom: 18,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  categoryIconBox: {
    width: 40,
    height: 40,
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
    paddingVertical: 28,
    paddingHorizontal: 20,
  },
  emptyText: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 10,
  },
  insightsGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 18,
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
  insightLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  insightValue: {
    fontSize: 15,
    fontWeight: '700',
  },
  insightSub: {
    fontSize: 11,
    marginTop: 2,
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
});
