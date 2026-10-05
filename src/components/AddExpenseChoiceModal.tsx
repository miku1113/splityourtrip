import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  FlatList,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../theme/useThemeStore';
import { useTripStore } from '../features/trips/useTripStore';
import { useContactsStore, FriendContact } from '../features/contacts/useContactsStore';
import { useAuthStore } from '../features/auth/useAuthStore';
import { scaleFont, moderateScale } from '../theme/responsive';

const PAGE_SIZE = 10;

interface AddExpenseChoiceModalProps {
  visible: boolean;
  onClose: () => void;
}

type StepMode = 'choose_type' | 'select_trip' | 'select_friend';

export default function AddExpenseChoiceModal({ visible, onClose }: AddExpenseChoiceModalProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { trips, createTrip, addMember, findOrCreateFriendSplitTrip, isLoading: tripsLoading } = useTripStore();
  const { contacts, deviceContacts, isLoading: contactsLoading, initContacts, addManualFriend } = useContactsStore();
  const { user, profile } = useAuthStore();

  const [step, setStep] = useState<StepMode>('choose_type');
  const [searchQuery, setSearchQuery] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  // Inline Add Contact State
  const [showInlineAddContact, setShowInlineAddContact] = useState(false);
  const [newContactName, setNewContactName] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [isSavingContact, setIsSavingContact] = useState(false);

  // Pagination state (10 per page)
  const [tripsVisibleCount, setTripsVisibleCount] = useState(PAGE_SIZE);
  const [loadingMoreTrips, setLoadingMoreTrips] = useState(false);

  const [friendsVisibleCount, setFriendsVisibleCount] = useState(PAGE_SIZE);
  const [loadingMoreFriends, setLoadingMoreFriends] = useState(false);

  useEffect(() => {
    setTripsVisibleCount(PAGE_SIZE);
    setFriendsVisibleCount(PAGE_SIZE);
    if (step === 'select_friend' && (!deviceContacts || deviceContacts.length === 0)) {
      initContacts();
    }
  }, [searchQuery, step]);

  // Reset state when closing or opening
  const handleClose = () => {
    setStep('choose_type');
    setSearchQuery('');
    setIsProcessing(false);
    setSelectedItemId(null);
    setTripsVisibleCount(PAGE_SIZE);
    setFriendsVisibleCount(PAGE_SIZE);
    setShowInlineAddContact(false);
    setNewContactName('');
    setNewContactPhone('');
    onClose();
  };

  // Filtered trips for picker (ONLY deduplicated group trips, not friend splits)
  const groupTripsOnly = useMemo(() => {
    const seenIds = new Set<string>();
    return trips.filter(t => {
      if (
        t.trip_type === 'friend_split' ||
        (t as any).is_friend_split ||
        t.name.toLowerCase().startsWith('split with ')
      ) {
        return false;
      }
      if (seenIds.has(t.id)) return false;
      seenIds.add(t.id);
      return true;
    });
  }, [trips]);

  const filteredTrips = useMemo(() => {
    if (!searchQuery.trim()) return groupTripsOnly;
    return groupTripsOnly.filter(t =>
      t.name.toLowerCase().includes(searchQuery.toLowerCase().trim())
    );
  }, [groupTripsOnly, searchQuery]);

  const paginatedTrips = useMemo(
    () => filteredTrips.slice(0, tripsVisibleCount),
    [filteredTrips, tripsVisibleCount]
  );

  const handleLoadMoreTrips = useCallback(() => {
    if (loadingMoreTrips || tripsVisibleCount >= filteredTrips.length) return;
    setLoadingMoreTrips(true);
    setTimeout(() => {
      setTripsVisibleCount(prev => Math.min(prev + PAGE_SIZE, filteredTrips.length));
      setLoadingMoreTrips(false);
    }, 250);
  }, [loadingMoreTrips, tripsVisibleCount, filteredTrips.length]);

  // Filtered friends for picker
  const filteredFriends = useMemo(() => {
    if (!searchQuery.trim()) return contacts;
    const q = searchQuery.toLowerCase().trim();
    const chatMatches = contacts.filter(
      c =>
        c.name.toLowerCase().includes(q) ||
        (c.phoneNumber && c.phoneNumber.includes(q))
    );
    const seenPhones = new Set<string>();
    const seenNames = new Set<string>();
    chatMatches.forEach(c => {
      seenNames.add(c.name.trim().toLowerCase());
      if (c.cleanPhone) seenPhones.add(c.cleanPhone);
    });

    const deviceMatches = (deviceContacts || []).filter(dc => {
      const name = dc.name.trim().toLowerCase();
      if (seenNames.has(name)) return false;
      if (dc.cleanPhone && seenPhones.has(dc.cleanPhone)) return false;
      return name.includes(q) || (dc.phoneNumber && dc.phoneNumber.includes(q));
    });

    return [...chatMatches, ...deviceMatches];
  }, [contacts, deviceContacts, searchQuery]);

  const paginatedFriends = useMemo(
    () => filteredFriends.slice(0, friendsVisibleCount),
    [filteredFriends, friendsVisibleCount]
  );

  const handleLoadMoreFriends = useCallback(() => {
    if (loadingMoreFriends || friendsVisibleCount >= filteredFriends.length) return;
    setLoadingMoreFriends(true);
    setTimeout(() => {
      setFriendsVisibleCount(prev => Math.min(prev + PAGE_SIZE, filteredFriends.length));
      setLoadingMoreFriends(false);
    }, 250);
  }, [loadingMoreFriends, friendsVisibleCount, filteredFriends.length]);

  // Handle selecting an existing trip
  const handleSelectTrip = (tripId: string) => {
    if (isProcessing || selectedItemId) return;
    setSelectedItemId(tripId);
    setIsProcessing(true);
    setTimeout(() => {
      handleClose();
      setTimeout(() => {
        router.push({
          pathname: '/trip/[id]/add',
          params: { id: tripId },
        });
      }, 100);
    }, 60);
  };

  // Handle selecting a single friend / contact
  const handleSelectFriend = async (friend: FriendContact) => {
    if (isProcessing || selectedItemId) return;
    setSelectedItemId(friend.id);
    setIsProcessing(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 40));
      // Use canonical friend split trip finder (guarantees both users share the SAME trip!)
      const targetTrip = await findOrCreateFriendSplitTrip(friend);

      handleClose();

      if (targetTrip) {
        const destTripId = targetTrip.id;
        setTimeout(() => {
          router.push({
            pathname: '/trip/[id]/add',
            params: { id: destTripId },
          });
        }, 100);
      }
    } catch (e) {
      console.log('Error creating/opening friend trip:', e);
    } finally {
      setIsProcessing(false);
      setSelectedItemId(null);
    }
  };

  const handleInlineCreateContact = async () => {
    if (!newContactName.trim() || isSavingContact) return;
    setIsSavingContact(true);
    try {
      const friend = await addManualFriend(
        newContactName.trim(),
        newContactPhone.trim() || undefined
      );
      setShowInlineAddContact(false);
      setNewContactName('');
      setNewContactPhone('');
      await handleSelectFriend(friend);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not save contact.');
    } finally {
      setIsSavingContact(false);
    }
  };

  const handleScanScreenshot = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission Denied', 'Please grant photo library access to pick a payment screenshot.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1.0,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const pickedUri = result.assets[0].uri;
        handleClose();
        setTimeout(() => {
          router.push({
            pathname: '/shared-payment',
            params: { imageUri: pickedUri },
          });
        }, 120);
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not pick image');
    }
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.modalOverlay}
      >
        <TouchableOpacity
          style={styles.backdropTouch}
          activeOpacity={1}
          onPress={handleClose}
        />

        <View
          style={[
            styles.sheetContainer,
            {
              backgroundColor: colors.card,
              borderTopColor: colors.border,
              paddingBottom: Math.max(insets.bottom, 20) + 16,
            },
          ]}
        >
          {/* Header Bar */}
          <View style={styles.headerRow}>
            {step !== 'choose_type' ? (
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => {
                  setStep('choose_type');
                  setSearchQuery('');
                }}
              >
                <Ionicons name="arrow-back" size={22} color={colors.text} />
              </TouchableOpacity>
            ) : (
              <View style={{ width: 22 }} />
            )}

            <Text style={[styles.headerTitle, { color: colors.text }]}>
              {step === 'choose_type'
                ? 'Add Expense'
                : step === 'select_trip'
                ? 'Select a Trip'
                : 'Split with a Friend'}
            </Text>

            <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* STEP 1: Two Options (Add to Trip OR Split with a Single Friend) */}
          {step === 'choose_type' && (
            <View style={styles.optionsContainer}>
              <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>
                Choose how you want to split this expense:
              </Text>

              {/* Option 1: In a Trip */}
              <TouchableOpacity
                style={[
                  styles.choiceCard,
                  {
                    backgroundColor: isDark ? 'rgba(99, 102, 241, 0.12)' : '#F5F7FF',
                    borderColor: isDark ? colors.border : '#E0E7FF',
                  },
                ]}
                onPress={() => setStep('select_trip')}
                activeOpacity={0.8}
              >
                <View style={[styles.iconCircle, { backgroundColor: colors.primary }]}>
                  <Ionicons name="airplane" size={24} color="#FFFFFF" />
                </View>
                <View style={styles.choiceTextContainer}>
                  <Text style={[styles.choiceTitle, { color: colors.text }]}>
                    Add to a Trip
                  </Text>
                  <Text style={[styles.choiceDesc, { color: colors.textSecondary }]}>
                    Split among members of a group trip ({groupTripsOnly.length} active {groupTripsOnly.length === 1 ? 'trip' : 'trips'})
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
              </TouchableOpacity>

              {/* Option 2: Single User / Friend */}
              <TouchableOpacity
                style={[
                  styles.choiceCard,
                  {
                    backgroundColor: isDark ? 'rgba(16, 185, 129, 0.12)' : '#F0FDF4',
                    borderColor: isDark ? colors.border : '#DCFCE7',
                  },
                ]}
                onPress={() => {
                  setStep('select_friend');
                  if (contacts.length === 0) {
                    initContacts();
                  }
                }}
                activeOpacity={0.8}
              >
                <View style={[styles.iconCircle, { backgroundColor: colors.success }]}>
                  <Ionicons name="person-add" size={24} color="#FFFFFF" />
                </View>
                <View style={styles.choiceTextContainer}>
                  <Text style={[styles.choiceTitle, { color: colors.text }]}>
                    Split with a Friend / Single User
                  </Text>
                  <Text style={[styles.choiceDesc, { color: colors.textSecondary }]}>
                    Direct 1-on-1 split with a contact or friend
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
              </TouchableOpacity>

              {/* Option 3: Scan Payment Screenshot (AI Auto-detect) */}
              <TouchableOpacity
                style={[
                  styles.choiceCard,
                  {
                    backgroundColor: isDark ? 'rgba(234, 179, 8, 0.12)' : '#FEFCE8',
                    borderColor: isDark ? colors.border : '#FEF08A',
                  },
                ]}
                onPress={handleScanScreenshot}
                activeOpacity={0.8}
              >
                <View style={[styles.iconCircle, { backgroundColor: '#EAB308' }]}>
                  <Ionicons name="sparkles" size={24} color="#FFFFFF" />
                </View>
                <View style={styles.choiceTextContainer}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[styles.choiceTitle, { color: colors.text }]}>
                      Scan Payment Screenshot
                    </Text>
                    <View style={styles.ocrChoiceBadge}>
                      <Text style={styles.ocrChoiceBadgeText}>AI OCR</Text>
                    </View>
                  </View>
                  <Text style={[styles.choiceDesc, { color: colors.textSecondary }]}>
                    Auto-detect amount, receiver & UPI from GPay, PhonePe, Paytm
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          )}

          {/* STEP 2A: Trip Selector (Paginated by 10) */}
          {step === 'select_trip' && (
            <View style={styles.listSection}>
              {/* Direct "+ Create New Trip" Action Button */}
              <TouchableOpacity
                style={[
                  styles.directCreateTripBtn,
                  {
                    backgroundColor: isDark ? 'rgba(99, 102, 241, 0.15)' : '#EEF2FF',
                    borderColor: colors.primary,
                  },
                ]}
                onPress={() => {
                  handleClose();
                  router.push('/(tabs)?openCreate=true');
                }}
                activeOpacity={0.8}
              >
                <View style={[styles.directCreateIcon, { backgroundColor: colors.primary }]}>
                  <Ionicons name="add" size={18} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={[styles.directCreateTitle, { color: colors.primary }]}>
                    + Create New Trip
                  </Text>
                  <Text style={[styles.directCreateSub, { color: colors.textSecondary }]}>
                    Plan a new group trip and add members
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.primary} />
              </TouchableOpacity>

              {/* Search trips */}
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
                  placeholder="Search your trips..."
                  placeholderTextColor={colors.textMuted}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
              </View>

              {tripsLoading && paginatedTrips.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Text style={[styles.emptyText, { color: colors.textSecondary, marginTop: 12 }]}>
                    Loading trips...
                  </Text>
                </View>
              ) : (
                <FlatList
                  data={paginatedTrips}
                  keyExtractor={item => item.id}
                  style={styles.scrollList}
                  showsVerticalScrollIndicator={false}
                  onEndReached={handleLoadMoreTrips}
                  onEndReachedThreshold={0.3}
                  ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                      <Ionicons name="airplane-outline" size={40} color={colors.textMuted} />
                      <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                        No trips found.
                      </Text>
                      <TouchableOpacity
                        style={[styles.createNewBtn, { backgroundColor: colors.primary }]}
                        onPress={() => {
                          handleClose();
                          router.push('/(tabs)?openCreate=true');
                        }}
                      >
                        <Ionicons name="add" size={16} color="#FFFFFF" />
                        <Text style={styles.createNewBtnText}>Create New Trip</Text>
                      </TouchableOpacity>
                    </View>
                  }
                  ListFooterComponent={
                    tripsVisibleCount < filteredTrips.length ? (
                      <View style={styles.paginationFooter}>
                        {loadingMoreTrips ? (
                          <View style={styles.footerLoadingRow}>
                            <ActivityIndicator size="small" color={colors.primary} />
                            <Text style={[styles.footerLoadingText, { color: colors.textSecondary }]}>
                              Loading more trips...
                            </Text>
                          </View>
                        ) : (
                          <TouchableOpacity
                            style={[
                              styles.loadMoreBtn,
                              { backgroundColor: colors.inputBackground, borderColor: colors.border },
                            ]}
                            onPress={handleLoadMoreTrips}
                          >
                            <Text style={[styles.loadMoreBtnText, { color: colors.primary }]}>
                              Load More Trips ({paginatedTrips.length} of {filteredTrips.length})
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ) : null
                  }
                  renderItem={({ item: trip }) => (
                    <TouchableOpacity
                      disabled={Boolean(selectedItemId)}
                      style={[
                        styles.listItemRow,
                        { borderBottomColor: colors.borderLight },
                      ]}
                      onPress={() => handleSelectTrip(trip.id)}
                    >
                      <View
                        style={[
                          styles.listAvatar,
                          { backgroundColor: colors.primaryLight },
                        ]}
                      >
                        <Ionicons name="airplane" size={18} color={colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.itemTitle, { color: colors.text }]}>
                          {trip.name}
                        </Text>
                        <Text style={[styles.itemSubtitle, { color: colors.textSecondary }]}>
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
              )}
            </View>
          )}

          {/* STEP 2B: Friend / Single User Selector (Paginated by 10) */}
          {step === 'select_friend' && (
            <View style={styles.listSection}>
              {/* Direct "+ Add New Contact" Action Button */}
              <TouchableOpacity
                style={[
                  styles.directCreateTripBtn,
                  {
                    backgroundColor: isDark ? 'rgba(124, 58, 237, 0.15)' : '#F3E8FF',
                    borderColor: '#7C3AED',
                  },
                ]}
                onPress={() => setShowInlineAddContact(!showInlineAddContact)}
                activeOpacity={0.8}
              >
                <View style={[styles.directCreateIcon, { backgroundColor: '#7C3AED' }]}>
                  <Ionicons name="person-add" size={18} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={[styles.directCreateTitle, { color: isDark ? '#A78BFA' : '#7C3AED' }]}>
                    + Add New Contact
                  </Text>
                  <Text style={[styles.directCreateSub, { color: colors.textSecondary }]}>
                    Enter friend's name and split an expense 1-on-1
                  </Text>
                </View>
                <Ionicons name={showInlineAddContact ? "chevron-up" : "chevron-down"} size={18} color="#7C3AED" />
              </TouchableOpacity>

              {/* Inline Add Contact Form when expanded */}
              {showInlineAddContact && (
                <View
                  style={{
                    backgroundColor: isDark ? '#1F2937' : '#F9FAFB',
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 14,
                    padding: 12,
                    marginBottom: 12,
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textSecondary, marginBottom: 4, textTransform: 'uppercase' }}>
                    Friend Name *
                  </Text>
                  <TextInput
                    style={{
                      height: 40,
                      backgroundColor: colors.inputBackground,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: 10,
                      paddingHorizontal: 10,
                      color: colors.text,
                      fontSize: 14,
                      marginBottom: 8,
                    }}
                    placeholder="e.g. Rahul Sharma"
                    placeholderTextColor={colors.textMuted}
                    value={newContactName}
                    onChangeText={setNewContactName}
                    autoFocus
                  />
                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textSecondary, marginBottom: 4, textTransform: 'uppercase' }}>
                    Phone (Optional)
                  </Text>
                  <TextInput
                    style={{
                      height: 40,
                      backgroundColor: colors.inputBackground,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: 10,
                      paddingHorizontal: 10,
                      color: colors.text,
                      fontSize: 14,
                      marginBottom: 10,
                    }}
                    placeholder="e.g. 9876543210"
                    placeholderTextColor={colors.textMuted}
                    value={newContactPhone}
                    onChangeText={setNewContactPhone}
                    keyboardType="phone-pad"
                  />
                  <TouchableOpacity
                    style={{
                      height: 40,
                      backgroundColor: '#7C3AED',
                      borderRadius: 10,
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexDirection: 'row',
                      gap: 6,
                      opacity: newContactName.trim() && !isSavingContact ? 1 : 0.6,
                    }}
                    onPress={handleInlineCreateContact}
                    disabled={!newContactName.trim() || isSavingContact}
                  >
                    {isSavingContact ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <>
                        <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
                        <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 13 }}>
                          Save &amp; Start Split
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              )}

              {/* Search friends */}
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
                  placeholder="Search contacts by name or phone..."
                  placeholderTextColor={colors.textMuted}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
              </View>

              {isProcessing || (contactsLoading && paginatedFriends.length === 0) ? (
                <View style={styles.emptyContainer}>
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Text style={[styles.emptyText, { color: colors.textSecondary, marginTop: 12 }]}>
                    {isProcessing ? 'Preparing 1-on-1 split window...' : 'Loading contacts...'}
                  </Text>
                </View>
              ) : (
                <FlatList
                  data={paginatedFriends}
                  keyExtractor={item => item.id}
                  style={styles.scrollList}
                  showsVerticalScrollIndicator={false}
                  onEndReached={handleLoadMoreFriends}
                  onEndReachedThreshold={0.3}
                  ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                      <Ionicons name="people-outline" size={40} color={colors.textMuted} />
                      <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                        No contacts found matching "{searchQuery}"
                      </Text>
                    </View>
                  }
                  ListFooterComponent={
                    friendsVisibleCount < filteredFriends.length ? (
                      <View style={styles.paginationFooter}>
                        {loadingMoreFriends ? (
                          <View style={styles.footerLoadingRow}>
                            <ActivityIndicator size="small" color={colors.primary} />
                            <Text style={[styles.footerLoadingText, { color: colors.textSecondary }]}>
                              Loading more contacts...
                            </Text>
                          </View>
                        ) : (
                          <TouchableOpacity
                            style={[
                              styles.loadMoreBtn,
                              { backgroundColor: colors.inputBackground, borderColor: colors.border },
                            ]}
                            onPress={handleLoadMoreFriends}
                          >
                            <Text style={[styles.loadMoreBtnText, { color: colors.primary }]}>
                              Load More Contacts ({paginatedFriends.length} of {filteredFriends.length})
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ) : null
                  }
                  renderItem={({ item: friend }) => (
                    <TouchableOpacity
                      style={[
                        styles.listItemRow,
                        { borderBottomColor: colors.borderLight },
                      ]}
                      onPress={() => handleSelectFriend(friend)}
                    >
                      <View
                        style={[
                          styles.listAvatar,
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
                            styles.listAvatarText,
                            {
                              color: friend.isRegistered
                                ? colors.primary
                                : colors.textSecondary,
                            },
                          ]}
                        >
                          {friend.name.charAt(0).toUpperCase()}
                        </Text>
                      </View>

                      <View style={{ flex: 1 }}>
                        <View style={styles.nameRow}>
                          <Text style={[styles.itemTitle, { color: colors.text }]}>
                            {friend.name}
                          </Text>
                          {friend.isRegistered && (
                            <View
                              style={[
                                styles.onAppBadge,
                                { backgroundColor: colors.successBg },
                              ]}
                            >
                              <Text
                                style={[styles.onAppBadgeText, { color: colors.success }]}
                              >
                                ✨ On App
                              </Text>
                            </View>
                          )}
                        </View>
                        <Text style={[styles.itemSubtitle, { color: colors.textSecondary }]}>
                          {friend.phoneNumber || 'Contact'}
                        </Text>
                      </View>

                      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                    </TouchableOpacity>
                  )}
                />
              )}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  backdropTouch: {
    flex: 1,
  },
  sheetContainer: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: moderateScale(16),
    paddingBottom: moderateScale(36),
    paddingHorizontal: moderateScale(20),
    maxHeight: '80%',
    borderTopWidth: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: moderateScale(14),
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: scaleFont(18),
    fontWeight: '700',
  },
  closeButton: {
    padding: 4,
  },
  optionsContainer: {
    paddingVertical: moderateScale(12),
  },
  sectionSubtitle: {
    fontSize: scaleFont(14),
    marginBottom: moderateScale(16),
  },
  choiceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: moderateScale(16),
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: moderateScale(14),
  },
  iconCircle: {
    width: moderateScale(48),
    height: moderateScale(48),
    borderRadius: moderateScale(24),
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: moderateScale(14),
  },
  choiceTextContainer: {
    flex: 1,
  },
  choiceTitle: {
    fontSize: scaleFont(16),
    fontWeight: '700',
    marginBottom: 4,
  },
  choiceDesc: {
    fontSize: scaleFont(13),
  },
  listSection: {
    paddingVertical: moderateScale(10),
    maxHeight: moderateScale(440),
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: moderateScale(12),
    height: moderateScale(44),
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: moderateScale(12),
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: scaleFont(14),
  },
  scrollList: {
    maxHeight: moderateScale(380),
  },
  listItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: moderateScale(12),
    borderBottomWidth: 1,
    gap: moderateScale(12),
  },
  listAvatar: {
    width: moderateScale(42),
    height: moderateScale(42),
    borderRadius: moderateScale(21),
    alignItems: 'center',
    justifyContent: 'center',
  },
  listAvatarText: {
    fontSize: scaleFont(16),
    fontWeight: '700',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  itemTitle: {
    fontSize: scaleFont(15),
    fontWeight: '600',
  },
  itemSubtitle: {
    fontSize: scaleFont(12),
    marginTop: 2,
  },
  onAppBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  onAppBadgeText: {
    fontSize: scaleFont(10),
    fontWeight: '700',
  },
  paginationFooter: {
    paddingVertical: moderateScale(12),
    alignItems: 'center',
  },
  footerLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  footerLoadingText: {
    fontSize: scaleFont(12),
    fontWeight: '600',
  },
  loadMoreBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  loadMoreBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 36,
  },
  emptyText: {
    fontSize: 14,
    marginTop: 8,
    marginBottom: 16,
    textAlign: 'center',
  },
  createNewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    gap: 6,
  },
  createNewBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  directCreateTripBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
  },
  directCreateIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  directCreateTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  directCreateSub: {
    fontSize: 12,
    marginTop: 1,
  },
  ocrChoiceBadge: {
    backgroundColor: '#FEF08A',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  ocrChoiceBadgeText: {
    color: '#854D0E',
    fontSize: 10,
    fontWeight: '800',
  },
});
