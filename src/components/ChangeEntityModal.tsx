import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/useThemeStore';
import { useTripStore, Trip } from '../features/trips/useTripStore';
import { useContactsStore, FriendContact } from '../features/contacts/useContactsStore';
import { useResponsive, scaleFont } from '../theme/responsive';
import { DraggableBottomSheet } from './DraggableBottomSheet';
import { formatCurrencyAmount } from '../services/currency';

export interface SelectedEntity {
  type: 'friend' | 'trip';
  id: string;
  name: string;
  friend?: FriendContact;
  trip?: Trip;
}

interface ChangeEntityModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectEntity: (entity: SelectedEntity) => void;
  title?: string;
  subtitle?: string;
  currentEntityId?: string;
}

type TabType = 'friends' | 'trips';

export function ChangeEntityModal({
  visible,
  onClose,
  onSelectEntity,
  title = 'Change Person or Trip',
  subtitle = 'Select who you want to split this expense with',
  currentEntityId,
}: ChangeEntityModalProps) {
  const { colors, isDark } = useTheme();
  const { isSmall } = useResponsive();
  const { trips } = useTripStore();
  const { contacts } = useContactsStore();

  const [activeTab, setActiveTab] = useState<TabType>('friends');
  const [searchQuery, setSearchQuery] = useState('');

  // 1. Filtered Friends
  const filteredContacts = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return contacts;
    return contacts.filter(
      c =>
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.phoneNumber && c.phoneNumber.includes(q))
    );
  }, [contacts, searchQuery]);

  // 2. Filtered Group Trips
  const filteredTrips = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const groupTrips = trips.filter(
      t =>
        t.trip_type !== 'friend_split' &&
        !(t as any).is_friend_split &&
        !t.name.toLowerCase().startsWith('split with ')
    );
    if (!q) return groupTrips;
    return groupTrips.filter(t => t.name.toLowerCase().includes(q));
  }, [trips, searchQuery]);

  const handleSelectFriend = (friend: FriendContact) => {
    onSelectEntity({
      type: 'friend',
      id: friend.id,
      name: friend.name,
      friend,
    });
    onClose();
  };

  const handleSelectTrip = (trip: Trip) => {
    onSelectEntity({
      type: 'trip',
      id: trip.id,
      name: trip.name,
      trip,
    });
    onClose();
  };

  return (
    <DraggableBottomSheet
      visible={visible}
      onClose={onClose}
      defaultHeight="80%"
      sheetStyle={{ maxWidth: 640, alignSelf: 'center', width: '100%', backgroundColor: colors.card }}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
              {title}
            </Text>
            {Boolean(subtitle) && (
              <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                {subtitle}
              </Text>
            )}
          </View>
          <TouchableOpacity
            style={[styles.closeBtn, { backgroundColor: isDark ? '#334155' : '#F1F5F9' }]}
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Tab Switcher */}
        <View style={[styles.tabBar, { backgroundColor: isDark ? '#1E293B' : '#F1F5F9' }]}>
          <TouchableOpacity
            style={[
              styles.tabBtn,
              activeTab === 'friends' && [
                styles.tabBtnActive,
                { backgroundColor: colors.card, shadowColor: '#000' },
              ],
            ]}
            onPress={() => setActiveTab('friends')}
            activeOpacity={0.8}
          >
            <Ionicons
              name="person-outline"
              size={15}
              color={activeTab === 'friends' ? colors.primary : colors.textSecondary}
            />
            <Text
              style={[
                styles.tabBtnText,
                { color: activeTab === 'friends' ? colors.primary : colors.textSecondary },
              ]}
            >
              Friends (1-on-1)
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tabBtn,
              activeTab === 'trips' && [
                styles.tabBtnActive,
                { backgroundColor: colors.card, shadowColor: '#000' },
              ],
            ]}
            onPress={() => setActiveTab('trips')}
            activeOpacity={0.8}
          >
            <Ionicons
              name="people-outline"
              size={15}
              color={activeTab === 'trips' ? colors.primary : colors.textSecondary}
            />
            <Text
              style={[
                styles.tabBtnText,
                { color: activeTab === 'trips' ? colors.primary : colors.textSecondary },
              ]}
            >
              Group Trips
            </Text>
          </TouchableOpacity>
        </View>

        {/* Search Bar */}
        <View
          style={[
            styles.searchBar,
            {
              backgroundColor: isDark ? '#1E293B' : '#F8FAFC',
              borderColor: colors.border,
            },
          ]}
        >
          <Ionicons name="search" size={17} color={colors.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder={
              activeTab === 'friends' ? 'Search friends or contacts...' : 'Search group trips...'
            }
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={17} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Content Lists */}
        {activeTab === 'friends' ? (
          <FlatList
            data={filteredContacts}
            keyExtractor={item => item.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="people-outline" size={38} color={colors.textMuted} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>No contacts found</Text>
                <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                  {searchQuery ? `No results matching "${searchQuery}"` : 'Add friends from the Friends tab'}
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              const isSelected = item.id === currentEntityId;
              const hasBalance = Boolean(item.netBalancePaise && item.netBalancePaise !== 0);
              return (
                <TouchableOpacity
                  style={[
                    styles.itemCard,
                    {
                      backgroundColor: isSelected
                        ? (isDark ? 'rgba(99, 102, 241, 0.15)' : '#EEF2FF')
                        : (isDark ? '#1E293B' : '#FFFFFF'),
                      borderColor: isSelected ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => handleSelectFriend(item)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.avatarBox, { backgroundColor: colors.primaryLight }]}>
                    <Text style={[styles.avatarText, { color: colors.primary }]}>
                      {(item.name || 'F').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {Boolean(item.phoneNumber) && (
                      <Text style={[styles.itemDetail, { color: colors.textSecondary }]} numberOfLines={1}>
                        {item.phoneNumber}
                      </Text>
                    )}
                  </View>
                  {hasBalance && item.netBalancePaise && (
                    <View style={styles.balanceTag}>
                      <Text
                        style={[
                          styles.balanceText,
                          { color: item.netBalancePaise > 0 ? '#10B981' : '#EF4444' },
                        ]}
                        numberOfLines={1}
                        adjustsFontSizeToFit={true}
                        minimumFontScale={0.72}
                      >
                        {item.netBalancePaise > 0 ? 'Owes you ' : 'You owe '}
                        {formatCurrencyAmount(Math.abs(item.netBalancePaise), 'INR')}
                      </Text>
                    </View>
                  )}
                  <Ionicons
                    name={isSelected ? 'checkmark-circle' : 'chevron-forward'}
                    size={18}
                    color={isSelected ? colors.primary : colors.textMuted}
                    style={{ marginLeft: 8 }}
                  />
                </TouchableOpacity>
              );
            }}
          />
        ) : (
          <FlatList
            data={filteredTrips}
            keyExtractor={item => item.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="airplane-outline" size={38} color={colors.textMuted} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>No group trips found</Text>
                <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                  {searchQuery ? `No trips matching "${searchQuery}"` : 'Create a group trip first'}
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              const isSelected = item.id === currentEntityId;
              return (
                <TouchableOpacity
                  style={[
                    styles.itemCard,
                    {
                      backgroundColor: isSelected
                        ? (isDark ? 'rgba(99, 102, 241, 0.15)' : '#EEF2FF')
                        : (isDark ? '#1E293B' : '#FFFFFF'),
                      borderColor: isSelected ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => handleSelectTrip(item)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.avatarBox, { backgroundColor: isDark ? 'rgba(56, 189, 248, 0.18)' : '#E0F2FE' }]}>
                    <Ionicons name="airplane" size={17} color={isDark ? '#38BDF8' : '#0284C7'} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={[styles.itemDetail, { color: colors.textSecondary }]} numberOfLines={1}>
                      {item.currency || 'INR'} • Group Trip
                    </Text>
                  </View>
                  <Ionicons
                    name={isSelected ? 'checkmark-circle' : 'chevron-forward'}
                    size={18}
                    color={isSelected ? colors.primary : colors.textMuted}
                    style={{ marginLeft: 8 }}
                  />
                </TouchableOpacity>
              );
            }}
          />
        )}
      </View>
    </DraggableBottomSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 3,
    marginBottom: 12,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 10,
    gap: 6,
  },
  tabBtnActive: {
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  tabBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 9 : 6,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
  },
  listContent: {
    paddingBottom: 24,
    gap: 8,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  avatarBox: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '800',
  },
  itemName: {
    fontSize: 14,
    fontWeight: '700',
  },
  itemDetail: {
    fontSize: 12,
    marginTop: 2,
  },
  balanceTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.03)',
  },
  balanceText: {
    fontSize: 11,
    fontWeight: '700',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: 'center',
  },
});
