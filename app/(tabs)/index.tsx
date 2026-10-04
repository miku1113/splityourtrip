import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Image,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '../../src/features/auth/useAuthStore';
import { useTripStore, Trip } from '../../src/features/trips/useTripStore';
import { useContactsStore, normalizePhone } from '../../src/features/contacts/useContactsStore';
import { useTheme } from '../../src/theme/useThemeStore';

const PAGE_SIZE = 10;

const TRIP_PRESET_EMOJIS = ['🏖️', '🏔️', '⛺', '✈️', '🚗', '🌆', '🌴', '🍕'];

export default function MyTripsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, profile } = useAuthStore();
  const { trips, fetchTrips, createTrip, addMember, joinTripByCode, isLoading } = useTripStore();
  const { contacts, isLoading: contactsLoading, initContacts } = useContactsStore();
  const { colors, isDark } = useTheme();

  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [joinModalVisible, setJoinModalVisible] = useState(false);
  const [createStep, setCreateStep] = useState<'details' | 'members'>('details');
  const [createdTrip, setCreatedTrip] = useState<Trip | null>(null);
  const [createdTripMembers, setCreatedTripMembers] = useState<{ id: string; name: string; phone?: string | null; isGuest?: boolean }[]>([]);
  const [newTripName, setNewTripName] = useState('');
  const [newTripImage, setNewTripImage] = useState<string | null>(null);
  const [newTripDescription, setNewTripDescription] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);

  // Step 2 Add Members drawer state
  const [contactSearch, setContactSearch] = useState('');
  const [addingMemberId, setAddingMemberId] = useState<string | null>(null);
  const [guestNameInput, setGuestNameInput] = useState('');
  const [guestPhoneInput, setGuestPhoneInput] = useState('');
  const [guestSuccessMsg, setGuestSuccessMsg] = useState<string | null>(null);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { openCreate } = useLocalSearchParams<{ openCreate?: string }>();

  useEffect(() => {
    if (openCreate === 'true') {
      setCreateStep('details');
      setCreateModalVisible(true);
    }
  }, [openCreate]);

  // Pagination state (10 per page)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [openingTripId, setOpeningTripId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      setOpeningTripId(null);
      if (user?.id) {
        fetchTrips(user.id);
      }
    }, [user?.id])
  );

  const handleOpenTrip = (tripId: string) => {
    router.push(`/trip/${tripId}`);
  };

  const handlePickTripImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setNewTripImage(result.assets[0].uri);
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not pick image.');
    }
  };

  const handleCreateTripStep1 = async () => {
    if (!newTripName.trim() || creating) return;
    setCreating(true);
    setErrorMsg(null);

    const activeUser = user || useAuthStore.getState().user;
    const userId = activeUser?.id || '';
    const userName =
      profile?.full_name ||
      profile?.name ||
      activeUser?.email?.split('@')[0] ||
      'Traveler';

    const trip = await createTrip(
      newTripName.trim(),
      userId,
      userName,
      'group',
      undefined,
      newTripImage,
      newTripDescription,
      []
    );
    setCreating(false);

    if (trip) {
      setCreatedTrip(trip);
      setCreatedTripMembers([
        {
          id: userId || 'admin',
          name: `${userName} (You)`,
          phone: profile?.phone_number || null,
          isGuest: false,
        },
      ]);
      setCreateStep('members');
      // Proactively load phonebook contacts for step 2
      initContacts().catch(() => {});
    } else {
      setErrorMsg('Failed to create trip. Please try again.');
    }
  };

  const handleAddGuestMember = async () => {
    if (!createdTrip) return;
    const name = guestNameInput.trim();
    if (!name) return;
    setAddingMemberId('guest_manual');
    try {
      const added = await addMember({
        tripId: createdTrip.id,
        displayName: name,
        phoneNumber: guestPhoneInput.trim() || undefined,
        isGuest: true,
      });
      if (added) {
        setCreatedTripMembers(prev => [
          ...prev,
          {
            id: added.id,
            name: added.display_name,
            phone: added.phone_number,
            isGuest: true,
          },
        ]);
        setGuestSuccessMsg(`Added "${name}"`);
        setGuestNameInput('');
        setGuestPhoneInput('');
        setTimeout(() => setGuestSuccessMsg(null), 2500);
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not add guest.');
    } finally {
      setAddingMemberId(null);
    }
  };

  const handleAddContactMember = async (contact: any) => {
    if (!createdTrip) return;
    setAddingMemberId(contact.id);
    try {
      const added = await addMember({
        tripId: createdTrip.id,
        displayName: contact.name,
        phoneNumber: contact.phoneNumber || undefined,
        profileId: contact.profileId || undefined,
        isGuest: !contact.profileId,
      });
      if (added) {
        setCreatedTripMembers(prev => [
          ...prev,
          {
            id: added.id,
            name: added.display_name,
            phone: added.phone_number,
            isGuest: added.is_guest,
          },
        ]);
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not add contact to trip.');
    } finally {
      setAddingMemberId(null);
    }
  };

  const handleFinishCreateTrip = () => {
    const tripToOpen = createdTrip;
    setCreateModalVisible(false);
    setCreateStep('details');
    setCreatedTrip(null);
    setNewTripName('');
    setNewTripImage(null);
    setNewTripDescription('');
    setContactSearch('');
    setGuestNameInput('');
    setGuestPhoneInput('');
    if (tripToOpen) {
      router.push(`/trip/${tripToOpen.id}`);
    }
  };

  const filteredContacts = useMemo(() => {
    if (!contactSearch.trim()) return contacts.slice(0, 30);
    const query = contactSearch.toLowerCase().trim();
    const cleanQ = normalizePhone(query);
    return contacts
      .filter(c => {
        const nameMatch = c.name.toLowerCase().includes(query);
        const phoneMatch = Boolean(cleanQ && c.cleanPhone && c.cleanPhone.includes(cleanQ));
        return nameMatch || phoneMatch;
      })
      .slice(0, 30);
  }, [contacts, contactSearch]);

  const handleJoinTrip = async () => {
    if (!inviteCode.trim()) return;
    if (!user) {
      router.replace('/(auth)/login');
      return;
    }
    setJoining(true);
    const success = await joinTripByCode(
      inviteCode.trim(),
      user.id,
      profile?.full_name || profile?.name || 'Traveler'
    );
    setJoining(false);
    setInviteCode('');
    setJoinModalVisible(false);
    if (success) {
      fetchTrips(user.id);
    }
  };

  // Only show deduplicated group trips here; 1-on-1 friend splits are managed in Friends tab
  const groupTrips = useMemo(() => {
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

  const paginatedTrips = useMemo(
    () => groupTrips.slice(0, visibleCount),
    [groupTrips, visibleCount]
  );

  const handleLoadMore = useCallback(() => {
    if (loadingMore || visibleCount >= groupTrips.length) return;
    setLoadingMore(true);
    setTimeout(() => {
      setVisibleCount(prev => Math.min(prev + PAGE_SIZE, groupTrips.length));
      setLoadingMore(false);
    }, 250);
  }, [loadingMore, visibleCount, groupTrips.length]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* User Greeting Header */}
      <View style={styles.userGreetingHeader}>
        <View>
          <Text style={[styles.greetingSub, { color: colors.textSecondary }]}>Welcome back,</Text>
          <Text style={[styles.greetingName, { color: colors.text }]}>
            {profile?.full_name || profile?.name || user?.email?.split('@')[0] || 'Traveler'} 👋
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.profileAvatarMini, { backgroundColor: colors.primary, overflow: 'hidden' }]}
          onPress={() => router.push('/(tabs)/profile')}
        >
          {profile?.avatar_url ? (
            <Image
              source={{ uri: profile.avatar_url }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
            />
          ) : (
            <Text style={styles.avatarMiniText}>
              {(profile?.full_name || profile?.name || user?.email || 'U').charAt(0).toUpperCase()}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Top Banner / Actions */}
      <View style={styles.topActions}>
        <TouchableOpacity
          style={[styles.createBtn, { backgroundColor: colors.primary }]}
          onPress={() => {
            setCreateStep('details');
            setCreatedTrip(null);
            setNewTripName('');
            setNewTripImage(null);
            setNewTripDescription('');
            setContactSearch('');
            setGuestNameInput('');
            setGuestPhoneInput('');
            setGuestSuccessMsg(null);
            setErrorMsg(null);
            setCreateModalVisible(true);
          }}
        >
          <Ionicons name="add-circle" size={20} color="#FFFFFF" />
          <Text style={styles.createBtnText}>New Trip</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.joinBtn,
            { backgroundColor: colors.card, borderColor: colors.primary },
          ]}
          onPress={() => setJoinModalVisible(true)}
        >
          <Ionicons name="link" size={18} color={colors.primary} />
          <Text style={[styles.joinBtnText, { color: colors.primary }]}>Join via Code</Text>
        </TouchableOpacity>
      </View>

      {!user && (
        <TouchableOpacity
          style={[
            styles.offlineBanner,
            { backgroundColor: colors.primaryLight, borderColor: colors.primary },
          ]}
          onPress={() => router.push('/(auth)/login')}
        >
          <Ionicons name="cloud-offline-outline" size={18} color={colors.primary} />
          <Text style={[styles.offlineBannerText, { color: colors.primaryDark }]}>
            Offline Mode: Trips saved locally. Tap to Sign In and sync.
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.primary} />
        </TouchableOpacity>
      )}

      {/* Trips List (Paginated by 10, single loading indicator) */}
      <FlatList
        data={paginatedTrips}
        keyExtractor={item => item.id}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.3}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.primary}
            colors={[colors.primary]}
            onRefresh={async () => {
              setRefreshing(true);
              setVisibleCount(PAGE_SIZE);
              await fetchTrips(user?.id);
              setRefreshing(false);
            }}
          />
        }
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.emptyContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.emptyTitle, { color: colors.text, marginTop: 12 }]}>
                Loading your trips...
              </Text>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>🏖️</Text>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No trips created yet</Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                Tap "New Trip" to start tracking group expenses and splitting UPI bills.
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          visibleCount < groupTrips.length ? (
            <View style={styles.paginationFooter}>
              {loadingMore ? (
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
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                  onPress={handleLoadMore}
                >
                  <Text style={[styles.loadMoreBtnText, { color: colors.primary }]}>
                    Load More Trips ({paginatedTrips.length} of {groupTrips.length})
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ) : groupTrips.length > 0 ? (
            <View style={styles.paginationFooter}>
              <Text style={{ fontSize: 12, color: colors.textMuted }}>
                Showing {paginatedTrips.length} of {groupTrips.length} trips
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item, index }) => {
          const isOpeningThisTrip = openingTripId === item.id;
          const isFirst = index === 0;
          const isLast = index === paginatedTrips.length - 1;

          return (
            <View
              style={[
                styles.tripRowContainer,
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
                disabled={Boolean(openingTripId)}
                style={[
                  styles.tripRow,
                  {
                    opacity: openingTripId && !isOpeningThisTrip ? 0.6 : 1,
                  },
                ]}
                onPress={() => handleOpenTrip(item.id)}
              >
                <View style={[styles.tripBadge, { backgroundColor: colors.primaryLight }]}>
                  {item.image_url ? (
                    item.image_url.startsWith('emoji:') ? (
                      <Text style={styles.tripBadgeText}>{item.image_url.replace('emoji:', '')}</Text>
                    ) : (
                      <Image source={{ uri: item.image_url }} style={styles.tripBadgeImage} />
                    )
                  ) : (
                    <Text style={styles.tripBadgeText}>🌴</Text>
                  )}
                </View>

                <View style={styles.tripInfo}>
                  <Text style={[styles.tripName, { color: colors.text }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <View style={styles.tripSubRow}>
                    <Ionicons name="calendar-outline" size={11} color={colors.textMuted} style={{ marginRight: 4 }} />
                    <Text style={[styles.tripDates, { color: colors.textSecondary }]} numberOfLines={1}>
                      {item.start_date ? `${item.start_date}${item.end_date ? ` • ${item.end_date}` : ''}` : 'Ongoing Group Trip'}
                    </Text>
                  </View>
                </View>

                <View style={styles.tripRightCol}>
                  {isOpeningThisTrip ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <View style={styles.tripStatusChevronRow}>
                      <View
                        style={[
                          styles.statusTag,
                          {
                            backgroundColor:
                              (item.status || 'active') === 'active'
                                ? isDark
                                  ? 'rgba(34, 197, 94, 0.15)'
                                  : '#DCFCE7'
                                : isDark
                                ? 'rgba(148, 163, 184, 0.15)'
                                : '#F1F5F9',
                          },
                        ]}
                      >
                        <View
                          style={[
                            styles.statusDot,
                            {
                              backgroundColor:
                                (item.status || 'active') === 'active'
                                  ? colors.success
                                  : colors.textMuted,
                            },
                          ]}
                        />
                        <Text
                          style={[
                            styles.statusTagText,
                            {
                              color:
                                (item.status || 'active') === 'active'
                                  ? colors.success
                                  : colors.textSecondary,
                            },
                          ]}
                        >
                          {(item.status || 'active').toUpperCase()}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={{ marginLeft: 6 }} />
                    </View>
                  )}
                </View>
              </TouchableOpacity>
              {!isLast && (
                <View style={[styles.rowDivider, { backgroundColor: colors.borderLight }]} />
              )}
            </View>
          );
        }}
      />

      {/* Create Trip Stepper Modal */}
      {createModalVisible && (
        <Modal visible={createModalVisible} transparent animationType="slide">
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalOverlay}
          >
            <View
              style={[
                styles.modalContent,
                {
                  backgroundColor: colors.card,
                  borderTopColor: colors.border,
                  height: createStep === 'members' ? '88%' : undefined,
                  minHeight: createStep === 'members' ? 520 : undefined,
                  maxHeight: '94%',
                  paddingBottom: Math.max(insets.bottom, 20) + 12,
                },
              ]}
            >
              {/* Stepper Progress Bar Header */}
              <View style={styles.stepperHeader}>
                <View style={styles.stepIndicatorRow}>
                  <View
                    style={[
                      styles.stepBadge,
                      createStep === 'details'
                        ? { backgroundColor: colors.primary }
                        : { backgroundColor: colors.success },
                    ]}
                  >
                    <Text style={styles.stepBadgeText}>
                      {createStep === 'members' ? '✓' : '1'}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.stepLine,
                      {
                        backgroundColor:
                          createStep === 'members' ? colors.primary : colors.border,
                      },
                    ]}
                  />
                  <View
                    style={[
                      styles.stepBadge,
                      createStep === 'members'
                        ? { backgroundColor: colors.primary }
                        : {
                            backgroundColor: colors.inputBackground,
                            borderWidth: 1,
                            borderColor: colors.border,
                          },
                    ]}
                  >
                    <Text
                      style={[
                        styles.stepBadgeText,
                        createStep !== 'members' && { color: colors.textSecondary },
                      ]}
                    >
                      2
                    </Text>
                  </View>
                </View>

                <View style={styles.stepperTitlesRow}>
                  <Text
                    style={[
                      styles.stepTitleLabel,
                      createStep === 'details' && { color: colors.primary, fontWeight: '700' },
                    ]}
                  >
                    1. Trip Details
                  </Text>
                  <Text
                    style={[
                      styles.stepTitleLabel,
                      createStep === 'members' && { color: colors.primary, fontWeight: '700' },
                    ]}
                  >
                    2. Add Members
                  </Text>
                </View>
              </View>

              {createStep === 'details' ? (
                /* STEP 1: TRIP DETAILS */
                <ScrollView
                  bounces={false}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{ paddingBottom: 16 }}
                >
                  <Text style={[styles.modalTitle, { color: colors.text }]}>Create New Trip</Text>
                  <Text style={[styles.modalDesc, { color: colors.textSecondary }]}>
                    Enter a trip name (e.g. "Goa Vacation", "Manali Roadtrip"). In the next step, you can add members from your contacts!
                  </Text>

                  {errorMsg && (
                    <View style={[styles.errorModalBanner, { backgroundColor: colors.dangerBg }]}>
                      <Text style={[styles.errorModalText, { color: colors.danger }]}>{errorMsg}</Text>
                    </View>
                  )}

                  <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Trip Name *</Text>
                  <TextInput
                    style={[
                      styles.modalInput,
                      {
                        backgroundColor: colors.inputBackground,
                        borderColor: colors.border,
                        color: colors.text,
                      },
                    ]}
                    placeholder="e.g. Manali 2026"
                    placeholderTextColor={colors.textMuted}
                    value={newTripName}
                    onChangeText={text => {
                      setNewTripName(text);
                      if (errorMsg) setErrorMsg(null);
                    }}
                  />

                  <Text style={[styles.modalLabel, { color: colors.textSecondary, marginTop: 8 }]}>
                    Trip Cover Image / Icon (Optional)
                  </Text>

                  {newTripImage ? (
                    <View
                      style={[
                        styles.newTripImagePreview,
                        { backgroundColor: colors.inputBackground, borderColor: colors.border },
                      ]}
                    >
                      {newTripImage.startsWith('emoji:') ? (
                        <Text style={{ fontSize: 32 }}>{newTripImage.replace('emoji:', '')}</Text>
                      ) : (
                        <Image source={{ uri: newTripImage }} style={styles.previewThumb} />
                      )}
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={[styles.previewLabel, { color: colors.text }]}>Selected Trip Cover</Text>
                        <Text style={[styles.previewSub, { color: colors.textSecondary }]}>
                          Will appear on trip & chat headers
                        </Text>
                      </View>
                      <TouchableOpacity onPress={() => setNewTripImage(null)}>
                        <Ionicons name="close-circle" size={22} color={colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={{ marginBottom: 6 }}>
                      <TouchableOpacity
                        style={[
                          styles.uploadImageBtn,
                          { backgroundColor: colors.inputBackground, borderColor: colors.border },
                        ]}
                        onPress={handlePickTripImage}
                      >
                        <Ionicons name="image-outline" size={18} color={colors.primary} />
                        <Text style={[styles.uploadImageText, { color: colors.primary }]}>
                          Upload Cover Photo
                        </Text>
                      </TouchableOpacity>

                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        style={styles.emojiRow}
                      >
                        {TRIP_PRESET_EMOJIS.map((emoji, idx) => (
                          <TouchableOpacity
                            key={idx}
                            style={[
                              styles.emojiBtn,
                              { backgroundColor: colors.inputBackground, borderColor: colors.border },
                            ]}
                            onPress={() => setNewTripImage(`emoji:${emoji}`)}
                          >
                            <Text style={{ fontSize: 20 }}>{emoji}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}

                  <Text style={[styles.modalLabel, { color: colors.textSecondary, marginTop: 8 }]}>
                    Description / Notes (Optional)
                  </Text>
                  <TextInput
                    style={[
                      styles.modalInput,
                      {
                        backgroundColor: colors.inputBackground,
                        borderColor: colors.border,
                        color: colors.text,
                      },
                    ]}
                    placeholder="e.g. Flight booked, staying in Calangute"
                    placeholderTextColor={colors.textMuted}
                    value={newTripDescription}
                    onChangeText={setNewTripDescription}
                  />

                  <View style={styles.modalActions}>
                    <TouchableOpacity
                      style={[styles.cancelBtn, { borderColor: colors.border }]}
                      onPress={() => setCreateModalVisible(false)}
                    >
                      <Text style={[styles.cancelBtnText, { color: colors.textSecondary }]}>Cancel</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.submitBtn,
                        {
                          backgroundColor: newTripName.trim() ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={handleCreateTripStep1}
                      disabled={!newTripName.trim() || creating}
                    >
                      {creating ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={styles.submitBtnText}>Next: Add Members</Text>
                          <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
                        </View>
                      )}
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              ) : (
                /* STEP 2: ADD MEMBERS (DRAWER REUSED) */
                <View style={{ flex: 1 }}>
                  <View style={styles.step2HeaderRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.modalTitle, { color: colors.text }]}>Add Members</Text>
                      <Text style={[styles.modalDesc, { color: colors.textSecondary }]} numberOfLines={1}>
                        Trip "{createdTrip?.name}" created! Add companions from contacts.
                      </Text>
                    </View>
                  </View>

                  <ScrollView
                    style={{ flex: 1 }}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                  >
                    {/* Add Member as Guest Card */}
                    <View
                      style={[
                        styles.manualAddCard,
                        {
                          backgroundColor: isDark ? 'rgba(99, 102, 241, 0.12)' : '#F5F7FF',
                          borderColor: isDark ? colors.border : '#E0E7FF',
                          marginBottom: 12,
                        },
                      ]}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Ionicons name="person-add" size={16} color={colors.primary} />
                        <Text style={[styles.manualAddTitle, { color: colors.text }]}>
                          Add Member as Guest
                        </Text>
                      </View>
                      <Text style={[styles.manualAddDesc, { color: colors.textSecondary }]}>
                        Add by name if they are not in your phone contacts.
                      </Text>

                      {guestSuccessMsg && (
                        <View
                          style={{
                            backgroundColor: colors.successBg,
                            paddingVertical: 5,
                            paddingHorizontal: 10,
                            borderRadius: 8,
                            marginTop: 6,
                          }}
                        >
                          <Text style={{ color: colors.success, fontWeight: '700', fontSize: 12 }}>
                            ✓ {guestSuccessMsg}
                          </Text>
                        </View>
                      )}

                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
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
                          value={guestPhoneInput}
                          onChangeText={setGuestPhoneInput}
                        />
                      </View>

                      <TouchableOpacity
                        style={[
                          styles.manualAddBtn,
                          {
                            backgroundColor: guestNameInput.trim() ? colors.primary : colors.border,
                            marginTop: 8,
                          },
                        ]}
                        disabled={!guestNameInput.trim() || addingMemberId === 'guest_manual'}
                        onPress={handleAddGuestMember}
                      >
                        {addingMemberId === 'guest_manual' ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                            <Ionicons name="add" size={16} color="#FFFFFF" />
                            <Text style={styles.manualAddBtnText}>
                              {guestNameInput.trim()
                                ? `+ Add "${guestNameInput.trim()}"`
                                : '+ Add Guest Member'}
                            </Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    </View>

                    {/* Added Members Chips Row */}
                    <View style={{ marginBottom: 12 }}>
                      <Text style={[styles.sectionHeading, { color: colors.primary, marginBottom: 8 }]}>
                        TRIP MEMBERS ({createdTripMembers.length})
                      </Text>
                      <View style={styles.membersChipContainer}>
                        {createdTripMembers.map((m, idx) => (
                          <View
                            key={idx}
                            style={[
                              styles.memberChip,
                              idx === 0
                                ? { backgroundColor: colors.primary + '18', borderColor: colors.primary }
                                : { backgroundColor: colors.inputBackground, borderColor: colors.border },
                            ]}
                          >
                            <Ionicons
                              name={idx === 0 ? 'person' : 'person-outline'}
                              size={13}
                              color={idx === 0 ? colors.primary : colors.textSecondary}
                              style={{ marginRight: 4 }}
                            />
                            <Text
                              style={[
                                styles.memberChipText,
                                idx === 0 && { color: colors.primary, fontWeight: '700' },
                              ]}
                            >
                              {m.name}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>

                    {/* Search Phone Contacts */}
                    <Text style={[styles.sectionHeading, { color: colors.textSecondary, marginBottom: 6 }]}>
                      ADD FROM CONTACTS
                    </Text>

                    <View
                      style={[
                        styles.searchBar,
                        {
                          backgroundColor: colors.inputBackground,
                          borderColor: colors.border,
                          marginBottom: 10,
                        },
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
                        placeholder="Search phone contacts..."
                        placeholderTextColor={colors.textMuted}
                        value={contactSearch}
                        onChangeText={setContactSearch}
                        autoCorrect={false}
                      />
                      {contactSearch.length > 0 && (
                        <TouchableOpacity onPress={() => setContactSearch('')}>
                          <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                        </TouchableOpacity>
                      )}
                    </View>

                    {contacts.length === 0 && !contactsLoading && (
                      <TouchableOpacity
                        style={[
                          styles.importContactsBtn,
                          {
                            borderColor: colors.primary,
                            backgroundColor: isDark ? 'rgba(99, 102, 241, 0.15)' : '#EEF2FF',
                            marginBottom: 12,
                          },
                        ]}
                        onPress={() => initContacts()}
                      >
                        <Ionicons name="book-outline" size={18} color={colors.primary} />
                        <Text style={[styles.importContactsText, { color: colors.primary }]}>
                          Sync Phone Contacts
                        </Text>
                      </TouchableOpacity>
                    )}

                    {contactsLoading && (
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                          paddingVertical: 12,
                          gap: 8,
                        }}
                      >
                        <ActivityIndicator size="small" color={colors.primary} />
                        <Text style={{ fontSize: 12, color: colors.textSecondary }}>
                          Loading contacts...
                        </Text>
                      </View>
                    )}

                    {/* Contact Rows */}
                    {filteredContacts.map(contact => {
                      const isAlreadyAdded = createdTripMembers.some(
                        m =>
                          m.name.toLowerCase() === contact.name.toLowerCase() ||
                          (contact.cleanPhone &&
                            m.phone &&
                            normalizePhone(m.phone) === contact.cleanPhone)
                      );
                      const isAddingThis = addingMemberId === contact.id;

                      return (
                        <View
                          key={contact.id}
                          style={[
                            styles.contactRowItem,
                            {
                              backgroundColor: colors.card,
                              borderColor: colors.border,
                            },
                          ]}
                        >
                          <View
                            style={[
                              styles.contactAvatarCircle,
                              { backgroundColor: colors.primaryLight },
                            ]}
                          >
                            <Text style={[styles.contactAvatarText, { color: colors.primary }]}>
                              {contact.name.charAt(0).toUpperCase()}
                            </Text>
                          </View>

                          <View style={{ flex: 1, marginHorizontal: 10 }}>
                            <Text
                              style={[styles.contactRowName, { color: colors.text }]}
                              numberOfLines={1}
                            >
                              {contact.name}
                            </Text>
                            <Text
                              style={[styles.contactRowPhone, { color: colors.textSecondary }]}
                              numberOfLines={1}
                            >
                              {contact.phoneNumber || 'Phone contact'}
                            </Text>
                          </View>

                          {isAlreadyAdded ? (
                            <View
                              style={[styles.addedBadge, { backgroundColor: colors.successBg }]}
                            >
                              <Ionicons name="checkmark" size={13} color={colors.success} />
                              <Text style={[styles.addedBadgeText, { color: colors.success }]}>
                                Added
                              </Text>
                            </View>
                          ) : (
                            <TouchableOpacity
                              style={[
                                styles.addContactBtn,
                                { backgroundColor: colors.primary },
                              ]}
                              disabled={isAddingThis}
                              onPress={() => handleAddContactMember(contact)}
                            >
                              {isAddingThis ? (
                                <ActivityIndicator size="small" color="#FFFFFF" />
                              ) : (
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                  <Ionicons name="add" size={14} color="#FFFFFF" />
                                  <Text style={styles.addContactBtnText}>Add</Text>
                                </View>
                              )}
                            </TouchableOpacity>
                          )}
                        </View>
                      );
                    })}
                  </ScrollView>

                  {/* Bottom Completion Actions */}
                  <View
                    style={[
                      styles.modalActions,
                      {
                        marginTop: 12,
                        borderTopWidth: 1,
                        borderTopColor: colors.border,
                        paddingTop: 12,
                      },
                    ]}
                  >
                    <TouchableOpacity
                      style={[styles.cancelBtn, { borderColor: colors.border }]}
                      onPress={handleFinishCreateTrip}
                    >
                      <Text style={[styles.cancelBtnText, { color: colors.textSecondary }]}>
                        Skip for now
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.submitBtn, { backgroundColor: colors.primary }]}
                      onPress={handleFinishCreateTrip}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                        <Text style={styles.submitBtnText}>Done & Open Trip</Text>
                      </View>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          </KeyboardAvoidingView>
        </Modal>
      )}

      {/* Join Trip Modal */}
      {joinModalVisible && (
      <Modal visible={joinModalVisible} transparent animationType="slide">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}
          >
            <View
              style={[
                styles.modalContent,
                {
                  backgroundColor: colors.card,
                  borderTopColor: colors.border,
                  paddingBottom: Math.max(insets.bottom, 24) + 16,
                },
              ]}
            >
              <Text style={[styles.modalTitle, { color: colors.text }]}>Join a Trip</Text>
              <Text style={[styles.modalDesc, { color: colors.textSecondary }]}>
                Paste the 6-character invite code shared by your trip admin.
              </Text>

              <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Invite Code</Text>
              <TextInput
                style={[
                  styles.modalInput,
                  styles.codeText,
                  {
                    backgroundColor: colors.inputBackground,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
                placeholder="e.g. GOA420"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="characters"
                value={inviteCode}
                onChangeText={setInviteCode}
              />

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.cancelBtn, { borderColor: colors.border }]}
                  onPress={() => setJoinModalVisible(false)}
                >
                  <Text style={[styles.cancelBtnText, { color: colors.textSecondary }]}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.submitBtn, { backgroundColor: colors.primary }]}
                  onPress={handleJoinTrip}
                  disabled={joining}
                >
                  {joining ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.submitBtnText}>Join Trip</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  userGreetingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  greetingSub: {
    fontSize: 13,
    fontWeight: '500',
  },
  greetingName: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  profileAvatarMini: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  avatarMiniText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  topActions: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  createBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    gap: 6,
  },
  createBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  joinBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 6,
  },
  joinBtnText: {
    fontWeight: '700',
    fontSize: 14,
  },
  loadingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 8,
  },
  loadingBannerText: {
    fontSize: 12,
    fontWeight: '600',
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  tripRowContainer: {
    overflow: 'hidden',
  },
  tripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  tripBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  tripBadgeImage: {
    width: '100%',
    height: '100%',
  },
  tripBadgeText: {
    fontSize: 22,
  },
  tripInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  tripName: {
    fontSize: 15,
    fontWeight: '700',
  },
  tripSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
  },
  tripDates: {
    fontSize: 12,
  },
  tripRightCol: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  tripStatusChevronRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusTagText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 70,
  },
  paginationFooter: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  footerLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  footerLoadingText: {
    fontSize: 13,
    fontWeight: '600',
  },
  loadMoreBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  loadMoreBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 280,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    borderTopWidth: 1,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  modalDesc: {
    fontSize: 13,
    marginTop: 4,
    marginBottom: 16,
  },
  modalLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 24,
  },
  codeText: {
    letterSpacing: 2,
    fontWeight: '700',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
  },
  cancelBtnText: {
    fontWeight: '600',
  },
  submitBtn: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 12,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  errorModalBanner: {
    borderRadius: 6,
    padding: 10,
    marginBottom: 8,
  },
  errorModalText: {
    fontSize: 13,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  offlineBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },
  newTripImagePreview: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  previewThumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
  },
  previewLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  previewSub: {
    fontSize: 11,
    marginTop: 2,
  },
  uploadImageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  uploadImageText: {
    fontSize: 13,
    fontWeight: '600',
  },
  emojiRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  emojiBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    marginRight: 8,
  },
  memberInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  memberInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
  addMemberChipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 12,
    gap: 4,
  },
  addMemberChipBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  membersChipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  memberChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  memberChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  stepperHeader: {
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(150, 150, 150, 0.15)',
  },
  stepIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  stepLine: {
    width: 80,
    height: 3,
    borderRadius: 2,
    marginHorizontal: 8,
  },
  stepperTitlesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 36,
  },
  stepTitleLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8E8E93',
  },
  step2HeaderRow: {
    marginBottom: 10,
  },
  manualAddCard: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  manualAddTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  manualAddDesc: {
    fontSize: 12,
    marginTop: 2,
  },
  manualPhoneInput: {
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    fontSize: 13,
  },
  manualAddBtn: {
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualAddBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  sectionHeading: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    padding: 0,
  },
  importContactsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  importContactsText: {
    fontSize: 13,
    fontWeight: '700',
  },
  contactRowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 6,
  },
  contactAvatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contactAvatarText: {
    fontSize: 15,
    fontWeight: '700',
  },
  contactRowName: {
    fontSize: 14,
    fontWeight: '600',
  },
  contactRowPhone: {
    fontSize: 12,
    marginTop: 1,
  },
  addedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 3,
  },
  addedBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  addContactBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addContactBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
});
