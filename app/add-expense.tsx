import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../src/theme/useThemeStore';
import { useTripStore } from '../src/features/trips/useTripStore';
import { useContactsStore, FriendContact } from '../src/features/contacts/useContactsStore';
import { useAuthStore } from '../src/features/auth/useAuthStore';
import { formatCurrencyAmount } from '../src/services/currency';

const PAGE_SIZE = 12;

type ActiveTab = 'trips' | 'friends';

export default function AddExpenseScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { user, profile } = useAuthStore();
  const { trips, createTrip, findOrCreateFriendSplitTrip, isLoading: tripsLoading, fetchTrips, initTrips } = useTripStore();
  const { contacts, isLoading: contactsLoading, initContacts, addManualFriend } = useContactsStore();

  const { action, tripId, friendId } = useLocalSearchParams<{
    action?: string;
    tripId?: string;
    friendId?: string;
  }>();

  const [activeTab, setActiveTab] = useState<ActiveTab>('trips');
  const [searchQuery, setSearchQuery] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  // Pagination
  const [tripsVisibleCount, setTripsVisibleCount] = useState(PAGE_SIZE);
  const [friendsVisibleCount, setFriendsVisibleCount] = useState(PAGE_SIZE);

  // Inline "Create New Trip" Modal
  const [showCreateTripModal, setShowCreateTripModal] = useState(false);
  const [newTripName, setNewTripName] = useState('');
  const [creatingTrip, setCreatingTrip] = useState(false);

  // Inline "Add Contact" Modal
  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [newContactName, setNewContactName] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [creatingContact, setCreatingContact] = useState(false);

  // Ensure stores are initialized
  useEffect(() => {
    initTrips();
    initContacts();
    if (user?.id) {
      fetchTrips(user.id);
    }
  }, [user?.id]);

  // Handle direct query parameters (e.g. ?tripId=... or ?action=new-trip)
  const handledActionRef = useRef(false);
  useEffect(() => {
    if (handledActionRef.current) return;

    if (tripId) {
      handledActionRef.current = true;
      router.replace({
        pathname: '/trip/[id]/add',
        params: { id: tripId },
      });
      return;
    }

    if (action === 'new-trip') {
      handledActionRef.current = true;
      setActiveTab('trips');
      setShowCreateTripModal(true);
    } else if (action === 'new-contact') {
      handledActionRef.current = true;
      setActiveTab('friends');
      setShowAddContactModal(true);
    }
  }, [action, tripId]);

  // Filtered group trips
  const groupTripsOnly = useMemo(() => {
    const seen = new Set<string>();
    return trips.filter(t => {
      if (
        t.trip_type === 'friend_split' ||
        (t as any).is_friend_split ||
        t.name.toLowerCase().startsWith('split with ')
      ) {
        return false;
      }
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  }, [trips]);

  const filteredTrips = useMemo(() => {
    if (!searchQuery.trim()) return groupTripsOnly;
    const q = searchQuery.toLowerCase().trim();
    return groupTripsOnly.filter(t => t.name.toLowerCase().includes(q));
  }, [groupTripsOnly, searchQuery]);

  const paginatedTrips = useMemo(
    () => filteredTrips.slice(0, tripsVisibleCount),
    [filteredTrips, tripsVisibleCount]
  );

  // Deduplicated contacts with pending settlements prioritized
  const sortedContacts = useMemo(() => {
    const seen = new Set<string>();
    const pendingList: FriendContact[] = [];
    const regularList: FriendContact[] = [];

    for (const c of contacts) {
      const cleanPhone = (c.cleanPhone || c.phoneNumber || '').trim();
      const key = cleanPhone || c.name.toLowerCase().trim();
      if (seen.has(key)) continue;
      seen.add(key);

      const net = c.netBalancePaise || 0;
      if (net !== 0) {
        pendingList.push(c);
      } else {
        regularList.push(c);
      }
    }

    pendingList.sort((a, b) => Math.abs(b.netBalancePaise || 0) - Math.abs(a.netBalancePaise || 0));
    return [...pendingList, ...regularList];
  }, [contacts]);

  const filteredContacts = useMemo(() => {
    if (!searchQuery.trim()) return sortedContacts;
    const q = searchQuery.toLowerCase().trim();
    return sortedContacts.filter(
      c =>
        c.name.toLowerCase().includes(q) ||
        (c.phoneNumber && c.phoneNumber.includes(q))
    );
  }, [sortedContacts, searchQuery]);

  const paginatedContacts = useMemo(
    () => filteredContacts.slice(0, friendsVisibleCount),
    [filteredContacts, friendsVisibleCount]
  );

  // Select Trip Handler
  const handleSelectTrip = (id: string) => {
    if (isProcessing) return;
    setIsProcessing(true);
    setSelectedItemId(id);
    setTimeout(() => {
      router.push({
        pathname: '/trip/[id]/add',
        params: { id },
      });
    }, 50);
  };

  // Select Friend Handler (resolves canonical 1-on-1 split trip)
  const handleSelectFriend = async (friend: FriendContact) => {
    if (isProcessing) return;
    setIsProcessing(true);
    setSelectedItemId(friend.id);
    try {
      const targetTrip = await findOrCreateFriendSplitTrip(friend);
      if (targetTrip) {
        router.push({
          pathname: '/trip/[id]/add',
          params: { id: targetTrip.id },
        });
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not open friend split window.');
    } finally {
      setIsProcessing(false);
      setSelectedItemId(null);
    }
  };

  // Create Trip & Immediately Redirect to Add Expense
  const handleCreateTripSubmit = async () => {
    if (!newTripName.trim() || creatingTrip) return;
    setCreatingTrip(true);
    try {
      const activeUser = user || useAuthStore.getState().user;
      const created = await createTrip(
        newTripName.trim(),
        activeUser?.id,
        profile?.full_name || 'Me',
        'group'
      );
      if (created) {
        setShowCreateTripModal(false);
        setNewTripName('');
        router.replace({
          pathname: '/trip/[id]/add',
          params: { id: created.id },
        });
      } else {
        Alert.alert('Error', 'Failed to create trip. Please try again.');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to create trip.');
    } finally {
      setCreatingTrip(false);
    }
  };

  // Add Contact & Immediately Redirect to Add Expense
  const handleAddContactSubmit = async () => {
    if (!newContactName.trim() || creatingContact) return;
    setCreatingContact(true);
    try {
      const friend = await addManualFriend(
        newContactName.trim(),
        newContactPhone.trim() || undefined
      );
      const targetTrip = await findOrCreateFriendSplitTrip(friend);
      if (targetTrip) {
        setShowAddContactModal(false);
        setNewContactName('');
        setNewContactPhone('');
        router.replace({
          pathname: '/trip/[id]/add',
          params: { id: targetTrip.id },
        });
      } else {
        Alert.alert('Error', 'Failed to set up 1-on-1 split. Please try again.');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to add contact.');
    } finally {
      setCreatingContact(false);
    }
  };

  // Scan AI Receipt
  const handleScanReceipt = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission Needed', 'Photo access is required to scan receipt screenshots.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1.0,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        router.push({
          pathname: '/shared-payment',
          params: { imageUri: result.assets[0].uri },
        });
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not pick image');
    }
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent
      />

      {/* Top Header Bar */}
      <View
        style={[
          styles.headerBar,
          {
            paddingTop: Math.max(insets.top, 12),
            backgroundColor: colors.card,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          onPress={handleBack}
          style={[styles.headerIconBtn, { backgroundColor: isDark ? '#1F2937' : '#F3F4F6' }]}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </TouchableOpacity>

        <View style={styles.headerTitleWrap}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Add Expense</Text>
          <Text style={[styles.headerSub, { color: colors.textSecondary }]}>
            Select where to add this expense
          </Text>
        </View>

        <TouchableOpacity
          onPress={handleScanReceipt}
          style={[styles.headerScanBtn, { backgroundColor: isDark ? 'rgba(245, 158, 11, 0.15)' : '#FEF3C7' }]}
          activeOpacity={0.7}
        >
          <Ionicons name="sparkles" size={17} color="#D97706" />
        </TouchableOpacity>
      </View>

      {/* Mode Switcher Tabs */}
      <View style={[styles.tabsRow, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={[
            styles.tabBtn,
            activeTab === 'trips' && [styles.activeTabBtn, { borderBottomColor: colors.primary }],
          ]}
          onPress={() => {
            setActiveTab('trips');
            setSearchQuery('');
          }}
          activeOpacity={0.7}
        >
          <Ionicons
            name="airplane"
            size={18}
            color={activeTab === 'trips' ? colors.primary : colors.textMuted}
          />
          <Text
            style={[
              styles.tabBtnText,
              { color: activeTab === 'trips' ? colors.primary : colors.textSecondary },
            ]}
          >
            In a Trip ({groupTripsOnly.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.tabBtn,
            activeTab === 'friends' && [styles.activeTabBtn, { borderBottomColor: colors.primary }],
          ]}
          onPress={() => {
            setActiveTab('friends');
            setSearchQuery('');
          }}
          activeOpacity={0.7}
        >
          <Ionicons
            name="people"
            size={18}
            color={activeTab === 'friends' ? colors.primary : colors.textMuted}
          />
          <Text
            style={[
              styles.tabBtnText,
              { color: activeTab === 'friends' ? colors.primary : colors.textSecondary },
            ]}
          >
            With a Friend ({contacts.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Search Input Bar */}
      <View style={[styles.searchWrap, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.searchBox,
            {
              backgroundColor: colors.inputBackground,
              borderColor: colors.border,
            },
          ]}
        >
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder={
              activeTab === 'trips' ? 'Search group trips...' : 'Search friends by name or phone...'
            }
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
      </View>

      {/* Main Content Area */}
      {activeTab === 'trips' ? (
        <FlatList
          data={paginatedTrips}
          keyExtractor={item => item.id}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            /* "+ Create New Trip" Quick Action Banner */
            <TouchableOpacity
              style={[
                styles.actionBanner,
                {
                  backgroundColor: isDark ? 'rgba(2, 132, 199, 0.12)' : '#E0F2FE',
                  borderColor: isDark ? '#0369A1' : '#BAE6FD',
                },
              ]}
              onPress={() => setShowCreateTripModal(true)}
              activeOpacity={0.8}
            >
              <View style={[styles.bannerIcon, { backgroundColor: '#0284C7' }]}>
                <Ionicons name="add" size={20} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.bannerTitle, { color: isDark ? '#38BDF8' : '#0369A1' }]}>
                  + Create New Trip
                </Text>
                <Text style={[styles.bannerSub, { color: colors.textSecondary }]}>
                  Start a new group trip and add expenses immediately
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={isDark ? '#38BDF8' : '#0369A1'} />
            </TouchableOpacity>
          }
          ListEmptyComponent={
            tripsLoading ? (
              <View style={styles.centerEmpty}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[styles.emptyText, { color: colors.textSecondary, marginTop: 12 }]}>
                  Loading trips...
                </Text>
              </View>
            ) : (
              <View style={styles.centerEmpty}>
                <Ionicons name="airplane-outline" size={44} color={colors.textMuted} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>No trips found</Text>
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  {searchQuery ? `No trips matching "${searchQuery}"` : 'Create your first trip to get started!'}
                </Text>
              </View>
            )
          }
          renderItem={({ item: trip }) => (
            <TouchableOpacity
              style={[
                styles.itemCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
              onPress={() => handleSelectTrip(trip.id)}
              activeOpacity={0.7}
              disabled={Boolean(selectedItemId)}
            >
              <View style={[styles.itemAvatar, { backgroundColor: colors.primaryLight }]}>
                <Ionicons name="airplane" size={19} color={colors.primary} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={1}>
                  {trip.name}
                </Text>
                <Text style={[styles.itemDetail, { color: colors.textSecondary }]}>
                  {trip.currency || 'INR'} • {new Date(trip.created_at).toLocaleDateString()}
                </Text>
              </View>
              {selectedItemId === trip.id ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              )}
            </TouchableOpacity>
          )}
        />
      ) : (
        <FlatList
          data={paginatedContacts}
          keyExtractor={item => item.id}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            /* "+ Add New Contact" Quick Action Banner */
            <TouchableOpacity
              style={[
                styles.actionBanner,
                {
                  backgroundColor: isDark ? 'rgba(124, 58, 237, 0.12)' : '#F3E8FF',
                  borderColor: isDark ? '#7C3AED' : '#E9D5FF',
                },
              ]}
              onPress={() => setShowAddContactModal(true)}
              activeOpacity={0.8}
            >
              <View style={[styles.bannerIcon, { backgroundColor: '#7C3AED' }]}>
                <Ionicons name="person-add" size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.bannerTitle, { color: isDark ? '#A78BFA' : '#7C3AED' }]}>
                  + Add New Contact
                </Text>
                <Text style={[styles.bannerSub, { color: colors.textSecondary }]}>
                  Enter friend's name and split an expense 1-on-1
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={isDark ? '#A78BFA' : '#7C3AED'} />
            </TouchableOpacity>
          }
          ListEmptyComponent={
            contactsLoading ? (
              <View style={styles.centerEmpty}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[styles.emptyText, { color: colors.textSecondary, marginTop: 12 }]}>
                  Loading contacts...
                </Text>
              </View>
            ) : (
              <View style={styles.centerEmpty}>
                <Ionicons name="people-outline" size={44} color={colors.textMuted} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>No contacts found</Text>
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  {searchQuery ? `No contacts matching "${searchQuery}"` : 'Add your first contact to start splitting!'}
                </Text>
              </View>
            )
          }
          renderItem={({ item: friend }) => {
            const net = friend.netBalancePaise || 0;
            return (
              <TouchableOpacity
                style={[
                  styles.itemCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => handleSelectFriend(friend)}
                activeOpacity={0.7}
                disabled={Boolean(selectedItemId)}
              >
                <View
                  style={[
                    styles.itemAvatar,
                    {
                      backgroundColor: friend.isRegistered
                        ? colors.primaryLight
                        : isDark
                        ? '#374151'
                        : '#F3F4F6',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.avatarInitial,
                      { color: friend.isRegistered ? colors.primary : colors.textSecondary },
                    ]}
                  >
                    {(friend.name[0] || '?').toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={1}>
                    {friend.name}
                  </Text>
                  <Text style={[styles.itemDetail, { color: colors.textSecondary }]}>
                    {friend.phoneNumber || 'Contact'}
                  </Text>
                </View>

                {net !== 0 && (
                  <View
                    style={[
                      styles.netBadge,
                      {
                        backgroundColor: net > 0 ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.netBadgeText,
                        { color: net > 0 ? '#10B981' : '#EF4444' },
                      ]}
                    >
                      {net > 0 ? `+${formatCurrencyAmount(net, 'INR')}` : formatCurrencyAmount(net, 'INR')}
                    </Text>
                  </View>
                )}

                {selectedItemId === friend.id ? (
                  <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: 8 }} />
                ) : (
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} style={{ marginLeft: 6 }} />
                )}
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* CREATE NEW TRIP MODAL */}
      <Modal
        visible={showCreateTripModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCreateTripModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <TouchableOpacity
            style={styles.backdrop}
            activeOpacity={1}
            onPress={() => setShowCreateTripModal(false)}
          />
          <View
            style={[
              styles.dialogSheet,
              {
                backgroundColor: colors.card,
                paddingBottom: Math.max(insets.bottom, 20) + 16,
              },
            ]}
          >
            <View style={styles.dialogHeader}>
              <View style={[styles.dialogIconWrap, { backgroundColor: '#E0F2FE' }]}>
                <Ionicons name="airplane" size={22} color="#0284C7" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.dialogTitle, { color: colors.text }]}>Create New Trip</Text>
                <Text style={[styles.dialogSub, { color: colors.textSecondary }]}>
                  Enter trip name to add expense right away
                </Text>
              </View>
              <TouchableOpacity onPress={() => setShowCreateTripModal(false)}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={styles.dialogBody}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Trip Name</Text>
              <TextInput
                style={[
                  styles.dialogInput,
                  {
                    backgroundColor: colors.inputBackground,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
                placeholder="e.g. Goa Vacation, Weekend Getaway"
                placeholderTextColor={colors.textMuted}
                value={newTripName}
                onChangeText={setNewTripName}
                autoFocus
              />

              <TouchableOpacity
                style={[
                  styles.dialogSubmitBtn,
                  {
                    backgroundColor: colors.primary,
                    opacity: newTripName.trim() && !creatingTrip ? 1 : 0.6,
                  },
                ]}
                onPress={handleCreateTripSubmit}
                disabled={!newTripName.trim() || creatingTrip}
                activeOpacity={0.8}
              >
                {creatingTrip ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
                    <Text style={styles.dialogSubmitText}>Create &amp; Add Expense</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ADD CONTACT MODAL */}
      <Modal
        visible={showAddContactModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddContactModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <TouchableOpacity
            style={styles.backdrop}
            activeOpacity={1}
            onPress={() => setShowAddContactModal(false)}
          />
          <View
            style={[
              styles.dialogSheet,
              {
                backgroundColor: colors.card,
                paddingBottom: Math.max(insets.bottom, 20) + 16,
              },
            ]}
          >
            <View style={styles.dialogHeader}>
              <View style={[styles.dialogIconWrap, { backgroundColor: '#F3E8FF' }]}>
                <Ionicons name="person-add" size={20} color="#7C3AED" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.dialogTitle, { color: colors.text }]}>Add New Contact</Text>
                <Text style={[styles.dialogSub, { color: colors.textSecondary }]}>
                  Split expenses 1-on-1 with this friend
                </Text>
              </View>
              <TouchableOpacity onPress={() => setShowAddContactModal(false)}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={styles.dialogBody}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Friend's Name *</Text>
              <TextInput
                style={[
                  styles.dialogInput,
                  {
                    backgroundColor: colors.inputBackground,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
                placeholder="e.g. Rahul Sharma"
                placeholderTextColor={colors.textMuted}
                value={newContactName}
                onChangeText={setNewContactName}
                autoFocus
              />

              <Text style={[styles.inputLabel, { color: colors.textSecondary, marginTop: 12 }]}>
                Phone Number (Optional)
              </Text>
              <TextInput
                style={[
                  styles.dialogInput,
                  {
                    backgroundColor: colors.inputBackground,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
                placeholder="e.g. 9876543210"
                placeholderTextColor={colors.textMuted}
                value={newContactPhone}
                onChangeText={setNewContactPhone}
                keyboardType="phone-pad"
              />

              <TouchableOpacity
                style={[
                  styles.dialogSubmitBtn,
                  {
                    backgroundColor: '#7C3AED',
                    opacity: newContactName.trim() && !creatingContact ? 1 : 0.6,
                    marginTop: 18,
                  },
                ]}
                onPress={handleAddContactSubmit}
                disabled={!newContactName.trim() || creatingContact}
                activeOpacity={0.8}
              >
                {creatingContact ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
                    <Text style={styles.dialogSubmitText}>Save &amp; Start Split</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  headerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleWrap: {
    flex: 1,
    marginLeft: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  headerSub: {
    fontSize: 12,
    marginTop: 1,
  },
  headerScanBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabsRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTabBtn: {
    borderBottomWidth: 2,
  },
  tabBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  searchWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 14,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  actionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  bannerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  bannerSub: {
    fontSize: 11,
    marginTop: 2,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
  },
  itemAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 16,
    fontWeight: '700',
  },
  itemName: {
    fontSize: 15,
    fontWeight: '600',
  },
  itemDetail: {
    fontSize: 12,
    marginTop: 2,
  },
  netBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  netBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  centerEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 12,
  },
  emptyText: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  dialogSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  dialogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dialogIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialogTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  dialogSub: {
    fontSize: 12,
    marginTop: 2,
  },
  dialogBody: {
    marginTop: 18,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  dialogInput: {
    height: 46,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  dialogSubmitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderRadius: 12,
    gap: 8,
    marginTop: 16,
  },
  dialogSubmitText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
