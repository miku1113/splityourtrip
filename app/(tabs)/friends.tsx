import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  Modal,
  InteractionManager,
  Image,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/useThemeStore';
import { useAuthStore } from '../../src/features/auth/useAuthStore';
import { useTripStore } from '../../src/features/trips/useTripStore';
import { useContactsStore, FriendContact, getEffectiveContactName } from '../../src/features/contacts/useContactsStore';
import { formatCurrencyAmount, getUserCurrencyPreference } from '../../src/services/currency';
import { scaleFont, moderateScale, isSmallDevice } from '../../src/theme/responsive';

type FilterType = 'all' | 'owes_you' | 'you_owe' | 'registered';

const PAGE_SIZE = 10;

interface FriendRowItemProps {
  item: FriendContact;
  index: number;
  totalCount: number;
  userCurrency: string;
  isOpening: boolean;
  openingFriendId: string | null;
  colors: any;
  isDark: boolean;
  currentUserId?: string;
  userAvatarUrl?: string | null;
  onOpen: (item: FriendContact) => void;
  onInvite: (name: string, phone?: string) => void;
}

const FriendRowItem = React.memo(function FriendRowItem({
  item,
  index,
  totalCount,
  userCurrency,
  isOpening,
  openingFriendId,
  colors,
  isDark,
  currentUserId,
  userAvatarUrl,
  onOpen,
  onInvite,
}: FriendRowItemProps) {
  const isFirst = index === 0;
  const isLast = index === totalCount - 1;

  const bal = item.netBalancePaise || 0;
  const toGet =
    item.owedToYouPaise !== undefined
      ? item.owedToYouPaise
      : (bal > 0 ? bal : 0);
  const toGive =
    item.youOwePaise !== undefined
      ? item.youOwePaise
      : (bal < 0 ? Math.abs(bal) : 0);
  const net =
    item.netBalancePaise !== undefined
      ? item.netBalancePaise
      : (toGet - toGive);
  const isSettled = toGet === 0 && toGive === 0 && net === 0;
  const isGuest = Boolean(item.isGuest && !item.isRegistered && !item.phoneNumber);

  const isOpeningThisFriend = isOpening;

  const displayName = getEffectiveContactName({
    phoneNumber: item.phoneNumber || item.cleanPhone,
    contactName: item.name,
    displayName: item.name,
    fallback: item.name,
  });

  return (
    <View
      style={[
        styles.friendRowContainer,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderTopLeftRadius: isFirst ? 14 : 0,
          borderTopRightRadius: isFirst ? 14 : 0,
          borderBottomLeftRadius: isLast ? 14 : 0,
          borderBottomRightRadius: isLast ? 14 : 0,
          borderTopWidth: isFirst ? 1 : 0,
          borderBottomWidth: isLast ? 1 : 0,
          borderLeftWidth: 1,
          borderRightWidth: 1,
        },
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.7}
        disabled={Boolean(openingFriendId)}
        style={[
          styles.friendRow,
          {
            opacity: openingFriendId && !isOpeningThisFriend ? 0.6 : 1,
          },
        ]}
        onPress={() => onOpen(item)}
      >
        {/* Avatar with Status Indicator Dot */}
        <View style={styles.avatarWrapper}>
          <View
            style={[
              styles.avatar,
              {
                backgroundColor: item.isRegistered
                  ? colors.primaryLight
                  : isDark
                  ? '#334155'
                  : '#E2E8F0',
                overflow: 'hidden',
              },
            ]}
          >
            {item.avatarUrl || (item.profileId === currentUserId && userAvatarUrl) ? (
              <Image
                source={{ uri: (item.avatarUrl || userAvatarUrl) as string }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
              />
            ) : (
              <Text
                style={[
                  styles.avatarText,
                  { color: item.isRegistered ? colors.primaryDark : colors.text },
                ]}
              >
                {displayName ? displayName.charAt(0).toUpperCase() : '?'}
              </Text>
            )}
          </View>
          {toGet > 0 && toGive === 0 && (
            <View style={[styles.avatarStatusDot, { backgroundColor: colors.success, borderColor: colors.card }]} />
          )}
          {toGive > 0 && toGet === 0 && (
            <View style={[styles.avatarStatusDot, { backgroundColor: colors.danger, borderColor: colors.card }]} />
          )}
          {toGet > 0 && toGive > 0 && (
            <View style={[styles.avatarStatusDot, { backgroundColor: '#8B5CF6', borderColor: colors.card }]} />
          )}
        </View>

        {/* Friend Info */}
        <View style={styles.friendDetails}>
          <View style={styles.nameRow}>
            <Text style={[styles.friendName, { color: colors.text }]} numberOfLines={1}>
              {displayName}
            </Text>
            {item.isRegistered ? (
              <View
                style={[
                  styles.appBadge,
                  { backgroundColor: isDark ? 'rgba(99, 102, 241, 0.2)' : '#EEF2FF' },
                ]}
              >
                <Text
                  style={[
                    styles.appBadgeText,
                    { color: isDark ? '#A5B4FC' : '#4F46E5' },
                  ]}
                >
                  ✨ On App
                </Text>
              </View>
            ) : isGuest ? (
              <View
                style={[
                  styles.appBadge,
                  { backgroundColor: isDark ? 'rgba(245, 158, 11, 0.2)' : '#FEF3C7' },
                ]}
              >
                <Text
                  style={[
                    styles.appBadgeText,
                    { color: isDark ? '#FBBF24' : '#D97706' },
                  ]}
                >
                  Guest
                </Text>
              </View>
            ) : null}
          </View>

          <Text
            style={[
              styles.friendPhone,
              { color: item.phoneNumber ? colors.textSecondary : colors.textMuted },
            ]}
            numberOfLines={1}
          >
            {item.phoneNumber || 'Tap to chat & link contact'}
          </Text>
        </View>

        {/* Right Side: Aligned Balance showing BOTH amounts + Chevron */}
        <View style={styles.rightActionCol}>
          {isOpeningThisFriend ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <View style={styles.balanceChevronRow}>
              <View style={styles.balancePillCol}>
                {isSettled ? (
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[styles.balSettledText, { color: colors.textMuted }]}>
                      Settled
                    </Text>
                    <Text style={[styles.balZeroSub, { color: colors.textMuted }]}>
                      ₹0 pending
                    </Text>
                  </View>
                ) : (
                  <View style={styles.dualBalanceWrapper}>
                    {/* Amount we will get from that friend */}
                    <View style={styles.amountLineItem}>
                      <Text
                        style={[
                          styles.amountTypeTag,
                          { color: toGet > 0 ? colors.success : colors.textMuted },
                        ]}
                      >
                        You'll get:
                      </Text>
                      <Text
                        style={[
                          styles.amountValText,
                          { color: toGet > 0 ? colors.success : colors.textMuted },
                        ]}
                      >
                        {toGet > 0
                          ? `+${formatCurrencyAmount(toGet, userCurrency)}`
                          : formatCurrencyAmount(0, userCurrency)}
                      </Text>
                    </View>

                    {/* Amount we need to give to friend */}
                    <View style={[styles.amountLineItem, { marginTop: 2 }]}>
                      <Text
                        style={[
                          styles.amountTypeTag,
                          { color: toGive > 0 ? colors.danger : colors.textMuted },
                        ]}
                      >
                        You'll give:
                      </Text>
                      <Text
                        style={[
                          styles.amountValText,
                          { color: toGive > 0 ? colors.danger : colors.textMuted },
                        ]}
                      >
                        {toGive > 0
                          ? `-${formatCurrencyAmount(toGive, userCurrency)}`
                          : formatCurrencyAmount(0, userCurrency)}
                      </Text>
                    </View>

                    {/* Net badge when both toGet and toGive are present */}
                    {toGet > 0 && toGive > 0 && (
                      <View
                        style={[
                          styles.netMiniPill,
                          {
                            backgroundColor:
                              net >= 0
                                ? isDark
                                  ? 'rgba(34, 197, 94, 0.15)'
                                  : '#DCFCE7'
                                : isDark
                                ? 'rgba(239, 68, 68, 0.15)'
                                : '#FEE2E2',
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.netMiniPillText,
                            { color: net >= 0 ? colors.success : colors.danger },
                          ]}
                        >
                          Net: {net >= 0 ? '+' : '-'} {formatCurrencyAmount(Math.abs(net), userCurrency)}
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </View>

              {!item.isRegistered && item.phoneNumber ? (
                <TouchableOpacity
                  style={[styles.inviteMiniBtn, { backgroundColor: '#25D366' }]}
                  onPress={() => onInvite(item.name, item.phoneNumber)}
                >
                  <Ionicons name="logo-whatsapp" size={13} color="#FFFFFF" />
                </TouchableOpacity>
              ) : (
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={{ marginLeft: 6 }} />
              )}
            </View>
          )}
        </View>
      </TouchableOpacity>
      {!isLast && (
        <View style={[styles.rowDivider, { backgroundColor: colors.borderLight }]} />
      )}
    </View>
  );
});

export default function FriendsScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const user = useAuthStore(s => s.user);
  const profile = useAuthStore(s => s.profile);
  const findOrCreateFriendSplitTrip = useTripStore(s => s.findOrCreateFriendSplitTrip);
  const contacts = useContactsStore(s => s.contacts);
  const friendsSummary = useContactsStore(s => s.friendsSummary);
  const fetchFriendsSummary = useContactsStore(s => s.fetchFriendsSummary);
  const isLoading = useContactsStore(s => s.isLoading);
  const inviteFriend = useContactsStore(s => s.inviteFriend);

  const [initialLoading, setInitialLoading] = useState(contacts.length === 0);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [userCurrency, setUserCurrency] = useState('INR');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  const [openingFriendId, setOpeningFriendId] = useState<string | null>(null);
  const navLockRef = React.useRef(false);
  const lastFetchRef = React.useRef<number>(0);

  useEffect(() => {
    lastFetchRef.current = Date.now();
    getUserCurrencyPreference().then(c => setUserCurrency(c));
    if (contacts.length === 0) {
      setInitialLoading(true);
    }
    fetchFriendsSummary(user?.id).finally(() => {
      setInitialLoading(false);
    });
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      navLockRef.current = false;
      setOpeningFriendId(null);

      // Only refetch if more than 4 seconds elapsed since last fetch to eliminate rapid-fire flickering
      if (Date.now() - lastFetchRef.current > 4000) {
        lastFetchRef.current = Date.now();
        const task = InteractionManager.runAfterInteractions(() => {
          getUserCurrencyPreference().then(c => setUserCurrency(c));
          fetchFriendsSummary(user?.id);
        });
        return () => task.cancel();
      }
    }, [user?.id, fetchFriendsSummary])
  );

  // Reset pagination to 10 whenever filter or search changes
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchQuery, activeFilter]);

  const onRefresh = async () => {
    setRefreshing(true);
    setVisibleCount(PAGE_SIZE);
    lastFetchRef.current = Date.now();
    await fetchFriendsSummary(user?.id);
    setRefreshing(false);
  };

  // Friends list with pending settlements guaranteed at the very top
  const activeFriends = useMemo(() => {
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    const pendingList: FriendContact[] = [];
    const otherList: FriendContact[] = [];

    for (const c of contacts) {
      const cleanName = c.name.trim().toLowerCase();
      if (seenIds.has(c.id) || seenNames.has(cleanName)) continue;
      seenIds.add(c.id);
      seenNames.add(cleanName);

      const toGet = c.owedToYouPaise || 0;
      const toGive = c.youOwePaise || 0;
      const isPending =
        toGet > 0 ||
        toGive > 0 ||
        (c.netBalancePaise !== undefined && c.netBalancePaise !== 0);

      if (isPending) {
        pendingList.push(c);
      } else {
        otherList.push(c);
      }
    }

    // Sort pending settlements by highest pending amount first
    pendingList.sort((a, b) => {
      const aAmt = Math.abs(a.netBalancePaise || (a.owedToYouPaise || 0) - (a.youOwePaise || 0));
      const bAmt = Math.abs(b.netBalancePaise || (b.owedToYouPaise || 0) - (b.youOwePaise || 0));
      return bAmt - aAmt;
    });

    return [...pendingList, ...otherList];
  }, [contacts]);

  // Aggregate totals calculated accurately from entire database via dedicated API
  const totalOwedToYou = friendsSummary.totalOwedToYouPaise;
  const totalYouOwe = friendsSummary.totalYouOwePaise;
  const netOverall = friendsSummary.netOverallPaise;

  // Filter transacted friends for list display
  const filteredContacts = useMemo(() => {
    return activeFriends.filter(c => {
      const matchesSearch =
        c.name.toLowerCase().includes(searchQuery.toLowerCase().trim()) ||
        (c.phoneNumber && c.phoneNumber.includes(searchQuery.trim()));

      if (!matchesSearch) return false;

      const toGet =
        c.owedToYouPaise !== undefined
          ? c.owedToYouPaise
          : (c.netBalancePaise && c.netBalancePaise > 0 ? c.netBalancePaise : 0);
      const toGive =
        c.youOwePaise !== undefined
          ? c.youOwePaise
          : (c.netBalancePaise && c.netBalancePaise < 0 ? Math.abs(c.netBalancePaise) : 0);

      if (activeFilter === 'owes_you') return toGet > 0;
      if (activeFilter === 'you_owe') return toGive > 0;
      if (activeFilter === 'registered') return c.isRegistered;
      return true;
    });
  }, [activeFriends, searchQuery, activeFilter]);

  const paginatedContacts = useMemo(() => {
    return filteredContacts.slice(0, visibleCount);
  }, [filteredContacts, visibleCount]);

  const hasMore = visibleCount < filteredContacts.length;

  const handleLoadMore = useCallback(() => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    setTimeout(() => {
      setVisibleCount(prev => prev + PAGE_SIZE);
      setLoadingMore(false);
    }, 250);
  }, [hasMore, loadingMore]);

  const handleOpenFriendChat = useCallback(async (friend: FriendContact) => {
    if (navLockRef.current || openingFriendId) return;
    navLockRef.current = true;
    setOpeningFriendId(friend.id);

    try {
      // Allow UI to paint the loading spinner immediately before work/navigation
      await new Promise(resolve => setTimeout(resolve, 25));

      // Use canonical friend split trip finder (guarantees both users share the SAME trip!)
      const targetTrip = await findOrCreateFriendSplitTrip(friend);

      if (targetTrip) {
        const targetFriendName = getEffectiveContactName({
          phoneNumber: friend.phoneNumber || friend.cleanPhone,
          contactName: friend.name,
          displayName: friend.name,
          fallback: friend.name.trim(),
        });

        router.push({
          pathname: '/chat/[id]',
          params: {
            id: targetTrip.id,
            friendName: targetFriendName,
            friendPhone: friend.phoneNumber || '',
            friendId: friend.id,
          },
        });
      } else {
        navLockRef.current = false;
        setOpeningFriendId(null);
      }
    } catch (e) {
      console.log('Error opening friend chat:', e);
      navLockRef.current = false;
      setOpeningFriendId(null);
    } finally {
      setTimeout(() => {
        navLockRef.current = false;
        setOpeningFriendId(null);
      }, 1000);
    }
  }, [openingFriendId, findOrCreateFriendSplitTrip, router]);

  const renderItem = useCallback(
    ({ item, index }: { item: FriendContact; index: number }) => (
      <FriendRowItem
        item={item}
        index={index}
        totalCount={paginatedContacts.length}
        userCurrency={userCurrency}
        isOpening={openingFriendId === item.id}
        openingFriendId={openingFriendId}
        colors={colors}
        isDark={isDark}
        currentUserId={user?.id}
        userAvatarUrl={profile?.avatar_url}
        onOpen={handleOpenFriendChat}
        onInvite={inviteFriend}
      />
    ),
    [
      paginatedContacts.length,
      userCurrency,
      openingFriendId,
      colors,
      isDark,
      user?.id,
      profile?.avatar_url,
      handleOpenFriendChat,
      inviteFriend,
    ]
  );

  const keyExtractor = useCallback(
    (item: FriendContact) => item.id || `contact_${item.name}_${item.cleanPhone || ''}`,
    []
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Top Balances Summary Header */}
      <View
        style={[
          styles.summaryHeader,
          {
            backgroundColor: colors.card,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <View style={styles.summaryRow}>
          <View style={styles.summaryCol}>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
              You are owed
            </Text>
            <Text style={[styles.summaryAmount, { color: colors.success }]}>
              {formatCurrencyAmount(totalOwedToYou, userCurrency)}
            </Text>
          </View>

          <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />

          <View style={styles.summaryCol}>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
              You owe
            </Text>
            <Text style={[styles.summaryAmount, { color: colors.danger }]}>
              {formatCurrencyAmount(totalYouOwe, userCurrency)}
            </Text>
          </View>
        </View>

        <View style={[styles.netPill, { backgroundColor: netOverall >= 0 ? colors.successBg : colors.dangerBg }]}>
          <Text
            style={[
              styles.netPillText,
              { color: netOverall >= 0 ? colors.success : colors.danger },
            ]}
          >
            Net: {netOverall >= 0 ? '+' : '-'} {formatCurrencyAmount(Math.abs(netOverall), userCurrency)}
          </Text>
        </View>
      </View>

      {/* Search Input */}
      <View style={styles.searchSection}>
        <View
          style={[
            styles.searchBar,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <Ionicons name="search" size={18} color={colors.textSecondary} style={{ marginRight: 8 }} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search friends or chats..."
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Filter Tabs */}
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[
            styles.filterPill,
            activeFilter === 'all' && [styles.filterPillActive, { backgroundColor: colors.primary }],
          ]}
          onPress={() => setActiveFilter('all')}
        >
          <Text
            style={[
              styles.filterPillText,
              { color: activeFilter === 'all' ? '#FFFFFF' : colors.textSecondary },
            ]}
          >
            All ({activeFriends.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.filterPill,
            activeFilter === 'owes_you' && [styles.filterPillActive, { backgroundColor: colors.success }],
          ]}
          onPress={() => setActiveFilter('owes_you')}
        >
          <Text
            style={[
              styles.filterPillText,
              { color: activeFilter === 'owes_you' ? '#FFFFFF' : colors.textSecondary },
            ]}
          >
            Owes You
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.filterPill,
            activeFilter === 'you_owe' && [styles.filterPillActive, { backgroundColor: colors.danger }],
          ]}
          onPress={() => setActiveFilter('you_owe')}
        >
          <Text
            style={[
              styles.filterPillText,
              { color: activeFilter === 'you_owe' ? '#FFFFFF' : colors.textSecondary },
            ]}
          >
            You Owe
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.filterPill,
            activeFilter === 'registered' && [styles.filterPillActive, { backgroundColor: colors.primaryDark }],
          ]}
          onPress={() => setActiveFilter('registered')}
        >
          <Text
            style={[
              styles.filterPillText,
              { color: activeFilter === 'registered' ? '#FFFFFF' : colors.textSecondary },
            ]}
          >
            ✨ On App
          </Text>
        </TouchableOpacity>
      </View>

      {/* Friends List (Paginated 10 at a time, smooth un-flickering list) */}
      <FlatList
        data={paginatedContacts}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.3}
        removeClippedSubviews={true}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={5}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
        ListEmptyComponent={
          initialLoading || (isLoading && contacts.length === 0) ? (
            <View style={styles.emptyView}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.emptyTitle, { color: colors.text, marginTop: 12 }]}>
                Loading Friends...
              </Text>
            </View>
          ) : (
            <View style={styles.emptyView}>
              <Text style={{ fontSize: 44, marginBottom: 8 }}>👥</Text>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No Chats or Transactions Yet</Text>
              <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
                Friends you share trips, chats, or split expenses with will appear here. Tap the + button to start a split or chat!
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          hasMore ? (
            <TouchableOpacity
              style={[styles.loadMoreBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
              onPress={handleLoadMore}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <View style={styles.loadMoreSpinnerRow}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={[styles.loadMoreText, { color: colors.primary }]}>Loading more...</Text>
                </View>
              ) : (
                <Text style={[styles.loadMoreText, { color: colors.primary }]}>
                  Load More ({filteredContacts.length - visibleCount} remaining)
                </Text>
              )}
            </TouchableOpacity>
          ) : filteredContacts.length > 0 ? (
            <Text style={[styles.pageInfoFooter, { color: colors.textMuted }]}>
              Showing {paginatedContacts.length} of {filteredContacts.length} friends
            </Text>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  summaryHeader: {
    padding: moderateScale(16),
    borderBottomWidth: 1,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: moderateScale(10),
  },
  summaryCol: {
    flex: 1,
    alignItems: 'center',
  },
  summaryDivider: {
    width: 1,
    height: moderateScale(36),
  },
  summaryLabel: {
    fontSize: scaleFont(12),
    fontWeight: '600',
    marginBottom: 4,
  },
  summaryAmount: {
    fontSize: scaleFont(18),
    fontWeight: '800',
  },
  netPill: {
    alignSelf: 'center',
    paddingHorizontal: moderateScale(12),
    paddingVertical: moderateScale(5),
    borderRadius: 20,
  },
  netPillText: {
    fontSize: scaleFont(12),
    fontWeight: '700',
  },
  searchSection: {
    paddingHorizontal: moderateScale(16),
    paddingTop: moderateScale(12),
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 25,
    paddingHorizontal: moderateScale(14),
    paddingVertical: moderateScale(9),
  },
  searchInput: {
    flex: 1,
    fontSize: scaleFont(14),
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: moderateScale(16),
    paddingVertical: moderateScale(10),
    gap: moderateScale(8),
  },
  filterPill: {
    paddingHorizontal: moderateScale(12),
    paddingVertical: moderateScale(6),
    borderRadius: 20,
    backgroundColor: 'rgba(150, 150, 150, 0.1)',
  },
  filterPillActive: {
    backgroundColor: '#6366F1',
  },
  filterPillText: {
    fontSize: scaleFont(12),
    fontWeight: '700',
  },
  inlineLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    gap: 8,
  },
  inlineLoadingText: {
    fontSize: scaleFont(12),
    fontWeight: '600',
  },
  listContent: {
    padding: moderateScale(16),
    paddingTop: 4,
    paddingBottom: moderateScale(100),
  },
  friendRowContainer: {
    overflow: 'hidden',
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: moderateScale(12),
    paddingHorizontal: moderateScale(14),
  },
  avatarWrapper: {
    position: 'relative',
    marginRight: moderateScale(12),
  },
  avatar: {
    width: moderateScale(44),
    height: moderateScale(44),
    borderRadius: moderateScale(22),
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarStatusDot: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: moderateScale(12),
    height: moderateScale(12),
    borderRadius: moderateScale(6),
    borderWidth: 2,
  },
  avatarText: {
    fontSize: scaleFont(17),
    fontWeight: '700',
  },
  friendDetails: {
    flex: 1,
    justifyContent: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  friendName: {
    fontSize: scaleFont(15),
    fontWeight: '700',
  },
  appBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  appBadgeText: {
    fontSize: scaleFont(10),
    fontWeight: '700',
  },
  friendPhone: {
    fontSize: scaleFont(12),
    marginTop: 3,
  },
  rightActionCol: {
    marginLeft: moderateScale(8),
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  balanceChevronRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  balancePillCol: {
    alignItems: 'flex-end',
    marginRight: 4,
  },
  dualBalanceWrapper: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  amountLineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  amountTypeTag: {
    fontSize: scaleFont(10.5),
    fontWeight: '600',
  },
  amountValText: {
    fontSize: scaleFont(12.5),
    fontWeight: '700',
  },
  balZeroSub: {
    fontSize: scaleFont(10),
    marginTop: 1,
  },
  netMiniPill: {
    marginTop: 3,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 8,
  },
  netMiniPillText: {
    fontSize: scaleFont(10),
    fontWeight: '700',
  },
  balAmountText: {
    fontSize: scaleFont(14),
    fontWeight: '700',
  },
  balSubLabel: {
    fontSize: scaleFont(10),
    fontWeight: '600',
    marginTop: 1,
  },
  balSettledText: {
    fontSize: scaleFont(12),
    fontWeight: '600',
  },
  inviteMiniBtn: {
    width: moderateScale(26),
    height: moderateScale(26),
    borderRadius: moderateScale(13),
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: moderateScale(70),
  },
  emptyView: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: moderateScale(60),
    paddingHorizontal: moderateScale(20),
  },
  emptyTitle: {
    fontSize: scaleFont(17),
    fontWeight: '700',
  },
  emptySub: {
    fontSize: scaleFont(13),
    textAlign: 'center',
    marginTop: 6,
    lineHeight: scaleFont(18),
  },
  loadMoreBtn: {
    paddingVertical: moderateScale(12),
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    marginBottom: moderateScale(16),
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
  pageInfoFooter: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
});
