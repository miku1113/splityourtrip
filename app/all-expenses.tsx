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
  Modal,
  ScrollView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../src/theme/useThemeStore';
import { useAuthStore } from '../src/features/auth/useAuthStore';
import { useTripStore } from '../src/features/trips/useTripStore';
import { formatCurrencyAmount, getUserCurrencyPreference } from '../src/services/currency';
import {
  AnalyzedExpenseItem,
  CATEGORY_ICONS,
  SORT_OPTIONS,
  SortOptionId,
  fetchAllTripsExpenses,
} from '../src/services/expenseAggregator';

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

export default function AllExpensesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    search?: string;
    category?: string;
    sort?: string;
  }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { user, profile } = useAuthStore();
  const currentUserPhone =
    profile?.phone_number || (user as any)?.phone || (user as any)?.user_metadata?.phone_number;
  const { trips, expenses, members, initTrips } = useTripStore();

  const [allExpenses, setAllExpenses] = useState<AnalyzedExpenseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userCurrency, setUserCurrency] = useState('INR');

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState(params.search || '');
  const [selectedCategory, setSelectedCategory] = useState<string>(params.category || 'all');
  const [selectedSort, setSelectedSort] = useState<SortOptionId>(
    (params.sort as SortOptionId) || 'date_desc'
  );
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
  }, [loadData, trips, expenses, members]);

  const onRefresh = async () => {
    setRefreshing(true);
    await initTrips();
    await loadData();
    setRefreshing(false);
  };

  // Filter & Sort
  const filteredAndSortedExpenses = useMemo(() => {
    let result = [...allExpenses];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(exp => {
        const descMatch = exp.description.toLowerCase().includes(q);
        const tripMatch = exp.trip_name.toLowerCase().includes(q);
        const payerMatch = exp.payerName.toLowerCase().includes(q);
        const catMatch = exp.category.toLowerCase().includes(q);
        const amtStr = (exp.amount / 100).toString();
        const amtMatch = amtStr.includes(q);
        return descMatch || tripMatch || payerMatch || catMatch || amtMatch;
      });
    }

    if (selectedCategory !== 'all') {
      result = result.filter(
        exp => exp.category.toLowerCase() === selectedCategory.toLowerCase()
      );
    }

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
  }, [allExpenses, searchQuery, selectedCategory, selectedSort]);

  // Reset pagination visibleCount when search or filter changes
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchQuery, selectedCategory, selectedSort]);

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

  const resetFilters = () => {
    setSearchQuery('');
    setSelectedCategory('all');
    setSelectedSort('date_desc');
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
          <Ionicons name={meta.icon} size={22} color={meta.color} />
        </View>

        {/* Center Details */}
        <View style={{ flex: 1, marginHorizontal: 12 }}>
          <View style={styles.expenseMainLine}>
            <Text style={[styles.expenseTitle, { color: colors.text }]} numberOfLines={1}>
              {item.description}
            </Text>
            <Text style={[styles.expenseAmount, { color: colors.text }]}>
              {formatCurrencyAmount(item.amount, item.currency || userCurrency)}
            </Text>
          </View>

          <View style={styles.expenseMetaLine}>
            <Text
              style={[
                styles.expensePayer,
                { color: item.isMyExpense ? colors.success : colors.textSecondary },
              ]}
              numberOfLines={1}
            >
              {item.isMyExpense ? 'Paid by You' : `Paid by ${item.payerName}`}
            </Text>
            <Text style={[styles.expenseTripBadge, { color: colors.textMuted }]} numberOfLines={1}>
              • {item.trip_name}
            </Text>
          </View>

          <View style={styles.expenseTagRow}>
            {/* Date Tag */}
            <View style={[styles.miniBadgeTag, { backgroundColor: isDark ? '#2D3748' : '#F3F4F6' }]}>
              <Text style={[styles.miniBadgeText, { color: colors.textSecondary }]}>
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
                <Text style={[styles.miniBadgeText, { color: colors.danger }]}>
                  Your Share: {formatCurrencyAmount(item.mySharePaise, userCurrency)}
                </Text>
              </View>
            )}
          </View>
        </View>

        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </TouchableOpacity>
    );
  };

  const renderFooter = () => {
    if (loadingMore) {
      return (
        <View style={styles.footerLoader}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.footerText, { color: colors.textSecondary }]}>
            Loading next {Math.min(PAGE_SIZE, filteredAndSortedExpenses.length - visibleCount)} expenses...
          </Text>
        </View>
      );
    }

    if (displayedExpenses.length > 0 && visibleCount >= filteredAndSortedExpenses.length) {
      return (
        <View style={styles.footerEnd}>
          <Text style={[styles.footerEndText, { color: colors.textMuted }]}>
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

      {/* Top Header */}
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
              <Text style={[styles.headerTitle, { color: colors.text }]}>All Expenses</Text>
              <View style={[styles.countBadge, { backgroundColor: colors.primaryLight }]}>
                <Text style={[styles.countBadgeText, { color: colors.primary }]}>
                  {filteredAndSortedExpenses.length}
                </Text>
              </View>
            </View>
            <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
              {displayedExpenses.length < filteredAndSortedExpenses.length
                ? `Showing ${displayedExpenses.length} of ${filteredAndSortedExpenses.length} • Sorted by ${currentSortLabel}`
                : `Sorted by ${currentSortLabel}`}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.sortButton, { backgroundColor: isDark ? '#2D3748' : '#F3F4F6' }]}
            onPress={() => setSortModalVisible(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="swap-vertical" size={20} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {/* Search Bar */}
        <View style={[styles.searchBar, { backgroundColor: isDark ? '#1F2937' : '#F3F4F6' }]}>
          <Ionicons name="search-outline" size={18} color={colors.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search expense, trip, payer, amount..."
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            clearButtonMode="while-editing"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Category Horizontal Filter Chips */}
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
                    { color: isSelected ? '#FFFFFF' : colors.textSecondary },
                  ]}
                >
                  {cat === 'all' ? 'All' : cat}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
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
        <View>
          <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Total Filtered Spend</Text>
          <Text style={[styles.summaryValue, { color: colors.text }]}>
            {formatCurrencyAmount(totalPaise, userCurrency)}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Loaded</Text>
          <Text style={[styles.summaryValue, { color: colors.primary }]}>
            {displayedExpenses.length} / {filteredAndSortedExpenses.length}
          </Text>
        </View>
      </View>

      {/* Main List */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
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
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No expenses found</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            {searchQuery || selectedCategory !== 'all'
              ? 'Try modifying your search query or filters'
              : 'Add expenses in your trips to explore them here'}
          </Text>
          {(searchQuery !== '' || selectedCategory !== 'all') && (
            <TouchableOpacity
              style={[styles.resetButton, { backgroundColor: colors.primary }]}
              onPress={resetFilters}
            >
              <Text style={styles.resetButtonText}>Reset Filters</Text>
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
            { paddingBottom: Math.max(insets.bottom, 24) + 20 },
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

      {/* Sort Options Modal */}
      <Modal
        visible={sortModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSortModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setSortModalVisible(false)}
        >
          <View
            style={[
              styles.sortModalSheet,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.sortModalHeader}>
              <Text style={[styles.sortModalTitle, { color: colors.text }]}>Sort Expenses</Text>
              <TouchableOpacity onPress={() => setSortModalVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

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
                    },
                  ]}
                  onPress={() => {
                    setSelectedSort(opt.id);
                    setSortModalVisible(false);
                  }}
                >
                  <Ionicons
                    name={opt.icon as any}
                    size={20}
                    color={isSelected ? colors.primary : colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.sortOptionLabel,
                      {
                        color: isSelected ? colors.primary : colors.text,
                        fontWeight: isSelected ? '700' : '500',
                      },
                    ]}
                  >
                    {opt.label}
                  </Text>
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerTitleWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 2,
    fontWeight: '500',
  },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  sortButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    marginLeft: 8,
    height: '100%',
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '500',
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
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  expenseAmount: {
    fontSize: 15,
    fontWeight: '800',
  },
  expenseMetaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  expensePayer: {
    fontSize: 12,
    fontWeight: '600',
  },
  expenseTripBadge: {
    fontSize: 12,
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
    fontSize: 13,
    fontWeight: '600',
  },
  footerEnd: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  footerEndText: {
    fontSize: 12,
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
    fontSize: 14,
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
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
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
    fontSize: 13,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sortModalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    borderWidth: 1,
  },
  sortModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sortModalTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  sortOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 4,
    gap: 12,
  },
  sortOptionLabel: {
    fontSize: 14,
    flex: 1,
  },
});
