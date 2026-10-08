import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  Modal,
  Image,
  ActivityIndicator,
  Platform,
  Share,
  FlatList,
  StatusBar,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTripStore, TripMember } from '../../../src/features/trips/useTripStore';
import { useAuthStore } from '../../../src/features/auth/useAuthStore';
import { useTheme } from '../../../src/theme/useThemeStore';
import { useContactsStore, FriendContact } from '../../../src/features/contacts/useContactsStore';
import { SUPPORTED_CURRENCIES, CurrencyItem, getCurrencyInfo } from '../../../src/services/currency';
import { uploadTripCoverImage } from '../../../src/services/imageUpload';

const TRAVEL_PRESET_ICONS = [
  { label: 'Beach', icon: '🏖️' },
  { label: 'Mountains', icon: '🏔️' },
  { label: 'Camping', icon: '⛺' },
  { label: 'Flight', icon: '✈️' },
  { label: 'Roadtrip', icon: '🚗' },
  { label: 'City', icon: '🌆' },
  { label: 'Tropical', icon: '🌴' },
  { label: 'Food & Dining', icon: '🍕' },
  { label: 'Party', icon: '🎉' },
];

export default function TripSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { user, profile } = useAuthStore();
  const {
    trips,
    activeTrip,
    members: allMembers,
    updateTrip,
    deleteTrip,
    loadTripDetails,
    generateInviteCode,
    addMember,
    removeMember,
    findContactByPhone,
    linkGuestWithContact,
    searchRegisteredUsers,
  } = useTripStore();

  const { contacts: storeContacts, initContacts } = useContactsStore();

  const trip = trips.find(t => t.id === id) || (activeTrip?.id === id ? activeTrip : null);
  const tripMembers = allMembers.filter(m => m.trip_id === id);

  const currentMember = tripMembers.find(
    m => user?.id && (m.profile_id === user.id || m.user_id === user.id)
  );
  const isAdmin =
    currentMember?.role === 'admin' ||
    trip?.created_by === user?.id ||
    tripMembers.length === 0;

  const [tripName, setTripName] = useState(trip?.name || '');
  const [description, setDescription] = useState(trip?.description || '');
  const [imageUrl, setImageUrl] = useState<string | null>(trip?.image_url || null);
  const [currency, setCurrency] = useState(trip?.currency || 'INR');
  const [status, setStatus] = useState<'active' | 'settled' | 'archived'>(trip?.status || 'active');
  const [inviteCode, setInviteCode] = useState<string | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [photoPickerVisible, setPhotoPickerVisible] = useState(false);
  const [currencyModalVisible, setCurrencyModalVisible] = useState(false);
  const [currencySearch, setCurrencySearch] = useState('');

  // Add Member Modal State
  const [addMemberModalVisible, setAddMemberModalVisible] = useState(false);
  const [addMemberTab, setAddMemberTab] = useState<'contacts' | 'manual'>('contacts');
  const [addMemberSearch, setAddMemberSearch] = useState('');
  const [addManualName, setAddManualName] = useState('');
  const [addManualPhone, setAddManualPhone] = useState('');
  const [addDbResult, setAddDbResult] = useState<{ profileId?: string; name: string; phoneNumber?: string; isAppUser: boolean } | null>(null);
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [registeredUserResults, setRegisteredUserResults] = useState<Array<{ id: string; full_name: string; phone_number: string | null; avatar_url: string | null }>>([]);

  // Link Guest Member Modal State
  const [linkModalVisible, setLinkModalVisible] = useState(false);
  const [linkingMember, setLinkingMember] = useState<TripMember | null>(null);
  const [linkSearchQuery, setLinkSearchQuery] = useState('');
  const [linkManualPhone, setLinkManualPhone] = useState('');
  const [linkDbResult, setLinkDbResult] = useState<{ profileId?: string; name: string; phoneNumber?: string; isAppUser: boolean } | null>(null);
  const [isCheckingPhone, setIsCheckingPhone] = useState(false);
  const [isLinking, setIsLinking] = useState(false);

  useEffect(() => {
    if (id && !trip) {
      loadTripDetails(id);
    }
  }, [id, trip]);

  useEffect(() => {
    if (trip) {
      setTripName(trip.name);
      setDescription(trip.description || '');
      setImageUrl(trip.image_url || null);
      setCurrency(trip.currency || 'INR');
      setStatus(trip.status || 'active');
    }
  }, [trip]);

  useEffect(() => {
    if (id && user?.id) {
      generateInviteCode(id, user.id).then(code => {
        if (code) setInviteCode(code);
      });
    }
  }, [id, user?.id]);

  useEffect(() => {
    if ((addMemberModalVisible || linkModalVisible) && storeContacts.length === 0) {
      initContacts();
    }
  }, [addMemberModalVisible, linkModalVisible, storeContacts.length]);

  // Live DB Lookup for Link Phone Input
  useEffect(() => {
    const raw = linkManualPhone.trim();
    const digits = raw.replace(/[^0-9]/g, '');
    if (digits.length >= 10) {
      let isCurrent = true;
      setIsCheckingPhone(true);
      findContactByPhone(raw).then(res => {
        if (isCurrent) {
          setLinkDbResult(res);
          setIsCheckingPhone(false);
        }
      });
      return () => {
        isCurrent = false;
      };
    } else {
      setLinkDbResult(null);
      setIsCheckingPhone(false);
    }
  }, [linkManualPhone]);

  // Live DB Lookup for Add Manual Guest Phone Input
  useEffect(() => {
    const raw = addManualPhone.trim();
    const digits = raw.replace(/[^0-9]/g, '');
    if (digits.length >= 10) {
      let isCurrent = true;
      findContactByPhone(raw).then(res => {
        if (isCurrent) {
          setAddDbResult(res);
        }
      });
      return () => {
        isCurrent = false;
      };
    } else {
      setAddDbResult(null);
    }
  }, [addManualPhone]);

  // Registered App Users Search for Add Member
  useEffect(() => {
    const q = addMemberSearch.trim();
    if (q.length >= 2) {
      let isCurrent = true;
      searchRegisteredUsers(q).then(results => {
        if (isCurrent) setRegisteredUserResults(results);
      });
      return () => {
        isCurrent = false;
      };
    } else {
      setRegisteredUserResults([]);
    }
  }, [addMemberSearch]);

  const handlePickFromGallery = async () => {
    setPhotoPickerVisible(false);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const localUri = result.assets[0].uri;
        setImageUrl(localUri);
        if (id) {
          uploadTripCoverImage(id, localUri)
            .then(cloudUrl => {
              if (cloudUrl) setImageUrl(cloudUrl);
            })
            .catch(() => {});
        }
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not pick photo from gallery.');
    }
  };

  const handleTakePhoto = async () => {
    setPhotoPickerVisible(false);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Camera Permission Required', 'Please enable camera permissions in device settings.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const localUri = result.assets[0].uri;
        setImageUrl(localUri);
        if (id) {
          uploadTripCoverImage(id, localUri)
            .then(cloudUrl => {
              if (cloudUrl) setImageUrl(cloudUrl);
            })
            .catch(() => {});
        }
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not take photo.');
    }
  };

  const handleSelectPresetIcon = (emoji: string) => {
    setPhotoPickerVisible(false);
    setImageUrl(`emoji:${emoji}`);
  };

  const handleShareInvite = async () => {
    const code = inviteCode || (id ? id.substring(0, 6).toUpperCase() : '');
    try {
      await Share.share({
        message: `Join my trip "${tripName}" on Split Your Trip! Use invite code: ${code}\nOr open the app to join now.`,
      });
    } catch {}
  };

  const handleToggleCompleteTrip = () => {
    if (!id || !isAdmin) return;

    if (status === 'settled') {
      Alert.alert(
        'Reopen Trip',
        `Would you like to reopen "${tripName}"? This will set its status to Active in the database.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Reopen Trip',
            onPress: async () => {
              setIsSaving(true);
              setStatus('active');
              try {
                await updateTrip(id, { status: 'active' });
                Alert.alert('Trip Reopened', `"${tripName}" is now active in the database.`);
              } catch (e: any) {
                Alert.alert('Error', e?.message || 'Could not reopen trip.');
              } finally {
                setIsSaving(false);
              }
            },
          },
        ]
      );
      return;
    }

    Alert.alert(
      'Complete Trip',
      `Are you sure you want to mark "${tripName}" as Completed? This will set its status to Completed & Settled in the database.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Complete Trip',
          onPress: async () => {
            setIsSaving(true);
            setStatus('settled');
            try {
              await updateTrip(id, { status: 'settled' });
              Alert.alert('Trip Completed', `"${tripName}" has been successfully marked as completed in the database.`);
            } catch (e: any) {
              Alert.alert('Error', e?.message || 'Could not complete trip.');
            } finally {
              setIsSaving(false);
            }
          },
        },
      ]
    );
  };

  const handleSave = async () => {
    if (!id || !tripName.trim() || isSaving) return;
    setIsSaving(true);

    try {
      const updated = await updateTrip(id, {
        name: tripName.trim(),
        description: description.trim(),
        image_url: imageUrl,
        currency,
        status,
      });

      setIsSaving(false);

      if (updated) {
        setSavedSuccess(true);
        Alert.alert('Trip Updated', 'Your trip settings have been saved to the database successfully.');
        setTimeout(() => setSavedSuccess(false), 3000);
      } else {
        Alert.alert('Error', 'Failed to update trip. Please try again.');
      }
    } catch (e: any) {
      setIsSaving(false);
      Alert.alert('Error', e?.message || 'Could not save trip changes.');
    }
  };

  const handleDeleteTrip = () => {
    Alert.alert(
      'Delete Trip Permanently',
      `Are you sure you want to permanently delete "${tripName}"? This will delete all associated expenses, splits, messages, and member records from the database. This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Permanently',
          style: 'destructive',
          onPress: async () => {
            if (!id) return;
            setIsDeleting(true);
            try {
              await deleteTrip(id);
              Alert.alert('Trip Deleted', `"${tripName}" has been removed from the database.`);
              router.replace('/(tabs)');
            } catch (e: any) {
              Alert.alert('Error', e?.message || 'Could not delete trip.');
              setIsDeleting(false);
            }
          },
        },
      ]
    );
  };

  const handleRemoveMember = (member: TripMember) => {
    if (!id || !isAdmin) return;
    Alert.alert(
      'Remove Member',
      `Are you sure you want to remove "${member.display_name}" from this trip?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await removeMember(id, member.id);
            Alert.alert('Member Removed', `"${member.display_name}" has been removed from this trip.`);
          },
        },
      ]
    );
  };

  const handleAddMemberFromContact = async (contactItem: { name: string; phoneNumber?: string | null; profileId?: string | null }) => {
    if (!id || !contactItem.name.trim() || isAddingMember) return;
    setIsAddingMember(true);
    try {
      const res = await addMember({
        tripId: id,
        displayName: contactItem.name.trim(),
        phoneNumber: contactItem.phoneNumber || null,
        profileId: contactItem.profileId || null,
        isGuest: !contactItem.profileId,
      });
      if (res) {
        Alert.alert('Member Added', `"${contactItem.name}" has been added to the trip.`);
        setAddMemberModalVisible(false);
        setAddMemberSearch('');
      } else {
        Alert.alert('Notice', 'Member is already in this trip.');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not add member.');
    } finally {
      setIsAddingMember(false);
    }
  };

  const handleAddManualGuest = async () => {
    if (!id || !addManualName.trim() || isAddingMember) return;
    setIsAddingMember(true);
    try {
      const res = await addMember({
        tripId: id,
        displayName: addManualName.trim(),
        phoneNumber: addManualPhone.trim() || null,
        profileId: addDbResult?.profileId || null,
        isGuest: !addDbResult?.profileId,
      });
      if (res) {
        Alert.alert('Guest Added', `"${addManualName}" has been added to the trip.`);
        setAddManualName('');
        setAddManualPhone('');
        setAddDbResult(null);
        setAddMemberModalVisible(false);
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not add guest.');
    } finally {
      setIsAddingMember(false);
    }
  };

  const openLinkModal = (member: TripMember) => {
    setLinkingMember(member);
    setLinkManualPhone(member.phone_number && member.phone_number !== 'Linked Contact' ? member.phone_number : '');
    setLinkSearchQuery('');
    setLinkDbResult(null);
    setLinkModalVisible(true);
  };

  const handleConfirmLink = async (member: TripMember, contactData: { id?: string; name: string; phoneNumber?: string | null; profileId?: string | null }) => {
    if (!id || !member || isLinking) return;
    setIsLinking(true);
    try {
      await linkGuestWithContact({
        tripId: id,
        guestMemberId: member.id,
        guestName: member.display_name,
        contact: {
          id: contactData.id || `phone_${contactData.phoneNumber}`,
          name: contactData.name,
          phoneNumber: contactData.phoneNumber || null,
          profileId: contactData.profileId || null,
        },
      });
      setLinkModalVisible(false);
      setLinkingMember(null);
      setLinkManualPhone('');
      setLinkDbResult(null);
      Alert.alert('Member Linked', `Member "${member.display_name}" is now linked in the database.`);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to link member.');
    } finally {
      setIsLinking(false);
    }
  };

  const isEmojiImage = imageUrl?.startsWith('emoji:');
  const emojiValue = isEmojiImage ? imageUrl?.replace('emoji:', '') : '✈️';

  // Filter contacts for Add Member modal
  const filteredContacts = React.useMemo(() => {
    const q = addMemberSearch.trim().toLowerCase();
    const qDigits = q.replace(/[^0-9]/g, '');
    if (!q) return storeContacts.slice(0, 30);
    return storeContacts
      .filter(c => {
        const nameMatch = c.name.toLowerCase().includes(q);
        const phoneMatch = c.phoneNumber ? c.phoneNumber.includes(qDigits.length > 0 ? qDigits : q) : false;
        return nameMatch || phoneMatch;
      })
      .slice(0, 30);
  }, [storeContacts, addMemberSearch]);

  // Filter contacts for Link modal
  const filteredLinkContacts = React.useMemo(() => {
    const q = linkSearchQuery.trim().toLowerCase();
    const qDigits = q.replace(/[^0-9]/g, '');
    if (!q) return storeContacts.slice(0, 30);
    return storeContacts
      .filter(c => {
        const nameMatch = c.name.toLowerCase().includes(q);
        const phoneMatch = c.phoneNumber ? c.phoneNumber.includes(qDigits.length > 0 ? qDigits : q) : false;
        return nameMatch || phoneMatch;
      })
      .slice(0, 30);
  }, [storeContacts, linkSearchQuery]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header Bar matching Chat & Info screens */}
      <View
        style={[
          styles.headerBar,
          {
            backgroundColor: colors.card,
            borderBottomColor: colors.border,
            paddingTop: Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 44) + 6,
          },
        ]}
      >
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
            Trip Settings
          </Text>
          <Text style={[styles.headerSub, { color: colors.textSecondary }]} numberOfLines={1}>
            {tripName || 'Manage Trip'}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.headerSaveBtn, { backgroundColor: colors.primary }]}
          onPress={handleSave}
          disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.headerSaveBtnText}>Save</Text>
          )}
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: 140 }]}
          automaticallyAdjustKeyboardInsets={true}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
        {/* Cover / Banner Section */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Trip Cover & Photo</Text>
          <Text style={[styles.sectionSub, { color: colors.textSecondary }]}>
            Personalize your trip with a scenic photo or custom travel icon.
          </Text>

          <View style={styles.bannerContainer}>
            {imageUrl && !isEmojiImage ? (
              <Image
                source={{ uri: imageUrl }}
                style={styles.coverImage}
                onError={() => {
                  console.warn('Cover preview failed, resetting image');
                  setImageUrl(null);
                }}
              />
            ) : (
              <View style={[styles.coverFallback, { backgroundColor: colors.primaryLight }]}>
                <Text style={styles.coverEmoji}>{emojiValue}</Text>
                <Text style={[styles.coverFallbackText, { color: colors.primary }]}>
                  {tripName || 'Trip'}
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.editCoverBadge, { backgroundColor: colors.card }]}
              onPress={() => setPhotoPickerVisible(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="camera" size={16} color={colors.primary} />
              <Text style={[styles.editCoverBadgeText, { color: colors.text }]}>
                {imageUrl ? 'Change Photo' : 'Add Cover Photo'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Quick Preset Selector */}
          <Text style={[styles.inputLabel, { color: colors.textSecondary, marginTop: 12 }]}>
            Or Choose a Quick Travel Preset:
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetScroll}>
            {TRAVEL_PRESET_ICONS.map((p, idx) => (
              <TouchableOpacity
                key={idx}
                style={[
                  styles.presetChip,
                  {
                    backgroundColor:
                      isEmojiImage && emojiValue === p.icon
                        ? colors.primaryLight
                        : colors.inputBackground,
                    borderColor:
                      isEmojiImage && emojiValue === p.icon ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => handleSelectPresetIcon(p.icon)}
              >
                <Text style={styles.presetChipEmoji}>{p.icon}</Text>
                <Text
                  style={[
                    styles.presetChipLabel,
                    {
                      color:
                        isEmojiImage && emojiValue === p.icon ? colors.primary : colors.text,
                    },
                  ]}
                >
                  {p.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {imageUrl && (
            <TouchableOpacity
              style={[styles.removeCoverBtn, { borderColor: colors.border }]}
              onPress={() => setImageUrl(null)}
            >
              <Ionicons name="trash-outline" size={16} color={colors.danger} />
              <Text style={[styles.removeCoverText, { color: colors.danger }]}>
                Remove Cover Image
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Trip Details Form */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Trip Details</Text>

          <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Trip Name</Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.inputBackground,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            value={tripName}
            onChangeText={setTripName}
            placeholder="e.g. Goa Trip 2026"
            placeholderTextColor={colors.textMuted}
          />

          <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
            Description / Itinerary Notes
          </Text>
          <TextInput
            style={[
              styles.input,
              styles.textArea,
              {
                backgroundColor: colors.inputBackground,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            value={description}
            onChangeText={setDescription}
            placeholder="Add destinations, hotel bookings, flight details, or packing tips..."
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={3}
          />

          <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Base Currency</Text>
          <TouchableOpacity
            style={[
              styles.currencySelectorBtn,
              {
                backgroundColor: colors.inputBackground,
                borderColor: colors.border,
              },
            ]}
            onPress={() => setCurrencyModalVisible(true)}
          >
            <View style={styles.currencyBtnContent}>
              <Text style={styles.currencyFlag}>{getCurrencyInfo(currency).flag}</Text>
              <Text style={[styles.currencyText, { color: colors.text }]}>
                {getCurrencyInfo(currency).code} ({getCurrencyInfo(currency).name})
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>

          <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Trip Status</Text>
          <View style={styles.statusSegmentRow}>
            {(['active', 'settled', 'archived'] as const).map(s => {
              const isSelected = status === s;
              return (
                <TouchableOpacity
                  key={s}
                  style={[
                    styles.statusSegmentBtn,
                    {
                      backgroundColor: isSelected ? colors.primary : colors.inputBackground,
                      borderColor: isSelected ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setStatus(s)}
                >
                  <Text
                    style={[
                      styles.statusSegmentText,
                      { color: isSelected ? '#FFFFFF' : colors.textSecondary },
                    ]}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Invite & Members Card */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.cardHeaderRow}>
            <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>
              Members ({tripMembers.length})
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <TouchableOpacity
                style={[styles.shareInvitePill, { backgroundColor: colors.primary }]}
                onPress={() => setAddMemberModalVisible(true)}
              >
                <Ionicons name="person-add-outline" size={14} color="#FFFFFF" />
                <Text style={[styles.shareInviteText, { color: '#FFFFFF' }]}>+ Add</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.shareInvitePill, { backgroundColor: colors.primaryLight }]}
                onPress={handleShareInvite}
              >
                <Ionicons name="share-social-outline" size={14} color={colors.primary} />
                <Text style={[styles.shareInviteText, { color: colors.primary }]}>Share Invite</Text>
              </TouchableOpacity>
            </View>
          </View>

          {inviteCode && (
            <View style={[styles.inviteCodeBanner, { backgroundColor: colors.inputBackground }]}>
              <Text style={[styles.inviteCodeLabel, { color: colors.textSecondary }]}>
                Invite Code:
              </Text>
              <Text style={[styles.inviteCodeValue, { color: colors.primary }]}>{inviteCode}</Text>
            </View>
          )}

          {tripMembers.map((m, idx) => {
            const isSelf = user?.id && (m.profile_id === user.id || m.user_id === user.id);
            const isAppUser = Boolean(m.profile_id);
            const isUnlinked = Boolean(m.is_guest && !m.profile_id);

            return (
              <View
                key={m.id || idx}
                style={[
                  styles.memberRow,
                  { borderBottomColor: colors.borderLight },
                  idx === tripMembers.length - 1 && { borderBottomWidth: 0 },
                ]}
              >
                <View
                  style={[
                    styles.memberAvatar,
                    {
                      backgroundColor: isAppUser ? colors.primary : isDark ? '#334155' : '#E2E8F0',
                      overflow: 'hidden',
                    },
                  ]}
                >
                  {(isSelf && profile?.avatar_url) || (m as any).avatar_url ? (
                    <Image
                      source={{
                        uri: (isSelf ? profile?.avatar_url : (m as any).avatar_url) || '',
                      }}
                      style={{ width: '100%', height: '100%' }}
                      resizeMode="cover"
                    />
                  ) : (
                    <Text style={[styles.memberAvatarText, { color: isAppUser ? '#FFFFFF' : colors.text }]}>
                      {(m.display_name || 'U').charAt(0).toUpperCase()}
                    </Text>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.memberName, { color: colors.text }]}>
                    {m.display_name} {isSelf && '(You)'}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
                    {m.phone_number && m.phone_number !== 'Linked Contact' ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                        <Ionicons name="call-outline" size={11} color={colors.textSecondary} />
                        <Text style={{ fontSize: 11, color: colors.textSecondary }}>{m.phone_number}</Text>
                      </View>
                    ) : null}
                    <View
                      style={[
                        styles.memberTypeBadge,
                        {
                          backgroundColor: isAppUser
                            ? (isDark ? 'rgba(99, 102, 241, 0.2)' : '#EEF2FF')
                            : !isUnlinked
                            ? (isDark ? 'rgba(16, 185, 129, 0.2)' : '#ECFDF5')
                            : (isDark ? 'rgba(245, 158, 11, 0.2)' : '#FEF3C7'),
                        },
                      ]}
                    >
                      <Text
                        style={{
                          fontSize: 10,
                          fontWeight: '700',
                          color: isAppUser
                            ? (isDark ? '#818CF8' : '#4F46E5')
                            : !isUnlinked
                            ? (isDark ? '#6EE7B7' : '#059669')
                            : (isDark ? '#FBBF24' : '#D97706'),
                        }}
                      >
                        {isAppUser ? '✨ App User' : !isUnlinked ? '📱 Contact' : '👤 Guest'}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Member action buttons: Link Guest or Remove */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {isUnlinked && (
                    <TouchableOpacity
                      style={[styles.memberActionBtn, { backgroundColor: colors.primary }]}
                      onPress={() => openLinkModal(m)}
                    >
                      <Ionicons name="link-outline" size={13} color="#FFFFFF" />
                      <Text style={styles.memberActionBtnText}>Link</Text>
                    </TouchableOpacity>
                  )}
                  {m.role === 'admin' ? (
                    <View style={[styles.adminBadge, { backgroundColor: colors.warningBg }]}>
                      <Text style={[styles.adminBadgeText, { color: colors.warning }]}>Admin</Text>
                    </View>
                  ) : isAdmin && !isSelf ? (
                    <TouchableOpacity
                      style={[styles.removeMemberIconBtn, { backgroundColor: colors.dangerBg }]}
                      onPress={() => handleRemoveMember(m)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="trash-outline" size={15} color={colors.danger} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>

        {/* Admin Trip Actions / Complete Trip Card */}
        {isAdmin && (
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: status === 'settled' ? colors.success : colors.primary,
                borderWidth: 1.5,
              },
            ]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    backgroundColor: status === 'settled' ? (isDark ? 'rgba(16, 185, 129, 0.2)' : '#D1FAE5') : colors.primaryLight,
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                >
                  <Ionicons
                    name={status === 'settled' ? 'checkmark-done-circle' : 'shield-checkmark-outline'}
                    size={20}
                    color={status === 'settled' ? colors.success : colors.primary}
                  />
                </View>
                <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>
                  Trip Administration
                </Text>
              </View>
              <View style={[styles.adminBadge, { backgroundColor: colors.primaryLight }]}>
                <Text style={[styles.adminBadgeText, { color: colors.primary }]}>Admin Only</Text>
              </View>
            </View>

            <Text style={[styles.sectionSub, { color: colors.textSecondary, marginBottom: 14 }]}>
              {status === 'settled'
                ? 'This trip is currently marked as Completed & Settled in the database. All members can view the finalized balances.'
                : 'As an admin, you can mark this trip as completed once all expenses are settled. This is saved directly to the database.'}
            </Text>

            <TouchableOpacity
              style={[
                styles.adminActionBtn,
                {
                  backgroundColor: status === 'settled'
                    ? (isDark ? '#334155' : '#F1F5F9')
                    : colors.success,
                  borderColor: status === 'settled' ? colors.border : colors.success,
                  borderWidth: 1,
                },
              ]}
              onPress={handleToggleCompleteTrip}
              disabled={isSaving}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color={status === 'settled' ? colors.text : '#FFFFFF'} />
              ) : (
                <View style={styles.btnRow}>
                  <Ionicons
                    name={status === 'settled' ? 'refresh-outline' : 'checkmark-circle-outline'}
                    size={19}
                    color={status === 'settled' ? colors.text : '#FFFFFF'}
                  />
                  <Text
                    style={[
                      styles.adminActionBtnText,
                      { color: status === 'settled' ? colors.text : '#FFFFFF' },
                    ]}
                  >
                    {status === 'settled' ? 'Reopen Trip (Set Active in DB)' : 'Complete Trip (Save to DB)'}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Danger Zone */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.danger,
              borderWidth: 1,
            },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.danger }]}>Danger Zone</Text>
          <Text style={[styles.sectionSub, { color: colors.textSecondary }]}>
            Deleting this trip permanently purges all records, expenses, splits, and messages from the cloud database.
          </Text>

          <TouchableOpacity
            style={[styles.deleteBtn, { backgroundColor: colors.dangerBg }]}
            onPress={handleDeleteTrip}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <ActivityIndicator color={colors.danger} />
            ) : (
              <View style={styles.btnRow}>
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
                <Text style={[styles.deleteBtnText, { color: colors.danger }]}>
                  Delete Trip Permanently (From DB)
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Bottom Save Action */}
        <TouchableOpacity
          style={[
            styles.mainSaveBtn,
            { backgroundColor: savedSuccess ? colors.success : colors.primary },
            isSaving && { opacity: 0.75 },
          ]}
          onPress={handleSave}
          disabled={isSaving}
        >
          {isSaving ? (
            <View style={styles.btnRow}>
              <ActivityIndicator color="#FFFFFF" size="small" />
              <Text style={styles.mainSaveBtnText}>Saving changes to database...</Text>
            </View>
          ) : savedSuccess ? (
            <View style={styles.btnRow}>
              <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
              <Text style={styles.mainSaveBtnText}>Trip Updated in Database!</Text>
            </View>
          ) : (
            <View style={styles.btnRow}>
              <Ionicons name="save-outline" size={18} color="#FFFFFF" />
              <Text style={styles.mainSaveBtnText}>Save Trip Changes to Database</Text>
            </View>
          )}
        </TouchableOpacity>
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Photo Picker Modal */}
      <Modal visible={photoPickerVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.photoModalContent,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.modalHeaderRow}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Trip Cover Photo</Text>
              <TouchableOpacity onPress={() => setPhotoPickerVisible(false)}>
                <Ionicons name="close-circle" size={24} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.actionRow} onPress={handlePickFromGallery}>
              <View style={[styles.actionIconBox, { backgroundColor: colors.primaryLight }]}>
                <Ionicons name="images-outline" size={22} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.actionTitle, { color: colors.text }]}>
                  Choose from Photos
                </Text>
                <Text style={[styles.actionSub, { color: colors.textSecondary }]}>
                  Pick a landscape banner or photo from library
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionRow} onPress={handleTakePhoto}>
              <View style={[styles.actionIconBox, { backgroundColor: colors.cardSecondary }]}>
                <Ionicons name="camera-outline" size={22} color={colors.text} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.actionTitle, { color: colors.text }]}>Take Photo</Text>
                <Text style={[styles.actionSub, { color: colors.textSecondary }]}>
                  Use camera to capture trip surroundings
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Currency Modal */}
      <Modal visible={currencyModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.currencyModalContent,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.modalHeaderRow}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Select Trip Currency
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setCurrencyModalVisible(false);
                  setCurrencySearch('');
                }}
              >
                <Ionicons name="close-circle" size={24} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <TextInput
              style={[
                styles.modalSearchInput,
                {
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.border,
                  color: colors.text,
                },
              ]}
              placeholder="Search country or currency..."
              placeholderTextColor={colors.textMuted}
              value={currencySearch}
              onChangeText={setCurrencySearch}
            />

            <FlatList
              data={SUPPORTED_CURRENCIES.filter(
                c =>
                  c.country.toLowerCase().includes(currencySearch.toLowerCase()) ||
                  c.name.toLowerCase().includes(currencySearch.toLowerCase()) ||
                  c.code.toLowerCase().includes(currencySearch.toLowerCase())
              )}
              keyExtractor={item => item.code}
              contentContainerStyle={{ paddingBottom: 24 }}
              renderItem={({ item }) => {
                const isSelected = currency === item.code;
                return (
                  <TouchableOpacity
                    style={[
                      styles.currencyRow,
                      { borderBottomColor: colors.borderLight },
                      isSelected && { backgroundColor: colors.primaryLight },
                    ]}
                    onPress={() => {
                      setCurrency(item.code);
                      setCurrencyModalVisible(false);
                      setCurrencySearch('');
                    }}
                  >
                    <Text style={styles.currencyRowFlag}>{item.flag}</Text>
                    <View style={styles.currencyRowInfo}>
                      <Text style={[styles.currencyRowCountry, { color: colors.text }]}>
                        {item.country} ({item.name})
                      </Text>
                      <Text style={[styles.currencyRowSub, { color: colors.textSecondary }]}>
                        Symbol: {item.symbol} • Code: {item.code}
                      </Text>
                    </View>
                    {isSelected && (
                      <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>

      {/* Add Member Modal */}
      <Modal visible={addMemberModalVisible} transparent animationType="slide">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View
            style={[
              styles.drawerModalContent,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.modalHeaderRow}>
              <View>
                <Text style={[styles.modalTitle, { color: colors.text }]}>Add Member to Trip</Text>
                <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                  Add from contacts, search app users, or add guest
                </Text>
              </View>
              <TouchableOpacity onPress={() => setAddMemberModalVisible(false)}>
                <Ionicons name="close-circle" size={24} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Segment Controls */}
            <View style={styles.tabSegmentContainer}>
              <TouchableOpacity
                style={[
                  styles.tabSegmentBtn,
                  addMemberTab === 'contacts' && { backgroundColor: colors.primary },
                ]}
                onPress={() => setAddMemberTab('contacts')}
              >
                <Text
                  style={[
                    styles.tabSegmentText,
                    { color: addMemberTab === 'contacts' ? '#FFFFFF' : colors.textSecondary },
                  ]}
                >
                  Contacts & App Users
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.tabSegmentBtn,
                  addMemberTab === 'manual' && { backgroundColor: colors.primary },
                ]}
                onPress={() => setAddMemberTab('manual')}
              >
                <Text
                  style={[
                    styles.tabSegmentText,
                    { color: addMemberTab === 'manual' ? '#FFFFFF' : colors.textSecondary },
                  ]}
                >
                  Manual Guest
                </Text>
              </TouchableOpacity>
            </View>

            {addMemberTab === 'contacts' ? (
              <View style={{ flex: 1 }}>
                <TextInput
                  style={[
                    styles.modalSearchInput,
                    {
                      backgroundColor: colors.inputBackground,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                  placeholder="Search name, phone number, or app user..."
                  placeholderTextColor={colors.textMuted}
                  value={addMemberSearch}
                  onChangeText={setAddMemberSearch}
                />

                <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
                  {/* Registered Users Section */}
                  {registeredUserResults.length > 0 && (
                    <View style={{ marginBottom: 12 }}>
                      <Text style={[styles.subHeadingText, { color: colors.primary }]}>
                        ✨ Registered Users Found in Database:
                      </Text>
                      {registeredUserResults.map(ru => (
                        <View
                          key={ru.id}
                          style={[
                            styles.userResultRow,
                            { backgroundColor: colors.inputBackground, borderColor: colors.border },
                          ]}
                        >
                          <View
                            style={[
                              styles.miniAvatar,
                              { backgroundColor: colors.primary },
                            ]}
                          >
                            <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>
                              {(ru.full_name || 'U').charAt(0).toUpperCase()}
                            </Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.contactRowName, { color: colors.text }]}>
                              {ru.full_name}
                            </Text>
                            <Text style={{ fontSize: 11, color: colors.textSecondary }}>
                              {ru.phone_number || '✨ SplitYourTrip Account'}
                            </Text>
                          </View>
                          <TouchableOpacity
                            style={[styles.smallAddBtn, { backgroundColor: colors.primary }]}
                            onPress={() => handleAddMemberFromContact({
                              name: ru.full_name,
                              phoneNumber: ru.phone_number,
                              profileId: ru.id,
                            })}
                            disabled={isAddingMember}
                          >
                            <Text style={styles.smallAddBtnText}>+ Add</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Device Contacts */}
                  <Text style={[styles.subHeadingText, { color: colors.textSecondary }]}>
                    Phone Contacts ({filteredContacts.length})
                  </Text>
                  {filteredContacts.map(c => {
                    const alreadyAdded = tripMembers.some(
                      m => (c.profileId && m.profile_id === c.profileId) ||
                           (c.phoneNumber && m.phone_number && m.phone_number.includes(c.phoneNumber.replace(/[^0-9]/g, '').slice(-10)))
                    );

                    return (
                      <View
                        key={c.id}
                        style={[
                          styles.contactRow,
                          { borderBottomColor: colors.borderLight },
                        ]}
                      >
                        <View style={[styles.miniAvatar, { backgroundColor: colors.primaryLight }]}>
                          <Text style={{ color: colors.primary, fontWeight: '700' }}>
                            {c.name.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.contactRowName, { color: colors.text }]}>{c.name}</Text>
                          {c.phoneNumber && (
                            <Text style={{ fontSize: 11, color: colors.textSecondary }}>
                              {c.phoneNumber}
                            </Text>
                          )}
                        </View>
                        <TouchableOpacity
                          style={[
                            styles.smallAddBtn,
                            {
                              backgroundColor: alreadyAdded ? (isDark ? '#334155' : '#E2E8F0') : colors.primary,
                            },
                          ]}
                          onPress={() => handleAddMemberFromContact({
                            name: c.name,
                            phoneNumber: c.phoneNumber,
                            profileId: c.profileId,
                          })}
                          disabled={alreadyAdded || isAddingMember}
                        >
                          <Text
                            style={[
                              styles.smallAddBtnText,
                              alreadyAdded && { color: colors.textSecondary },
                            ]}
                          >
                            {alreadyAdded ? 'Added' : '+ Add'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            ) : (
              <View style={{ paddingTop: 8 }}>
                <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Guest Name *</Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.inputBackground,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                  placeholder="e.g. Alex"
                  placeholderTextColor={colors.textMuted}
                  value={addManualName}
                  onChangeText={setAddManualName}
                />

                <Text style={[styles.inputLabel, { color: colors.textSecondary, marginTop: 12 }]}>
                  Phone Number (Optional - Saves to DB)
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.inputBackground,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                  placeholder="e.g. 9876543210"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="phone-pad"
                  value={addManualPhone}
                  onChangeText={setAddManualPhone}
                />

                {/* DB Match Indicator */}
                {addDbResult && (
                  <View
                    style={[
                      styles.foundDbCard,
                      {
                        backgroundColor: isDark ? 'rgba(16, 185, 129, 0.15)' : '#D1FAE5',
                        borderColor: colors.success,
                      },
                    ]}
                  >
                    <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.foundDbName, { color: colors.text }]}>
                        Found in database: "{addDbResult.name}"
                      </Text>
                      <Text style={{ fontSize: 11, color: colors.success, marginTop: 1 }}>
                        {addDbResult.isAppUser ? '✨ Registered User Account' : '📱 Linked Contact'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.smallAddBtn, { backgroundColor: colors.success }]}
                      onPress={() => setAddManualName(addDbResult.name)}
                    >
                      <Text style={styles.smallAddBtnText}>Use Name</Text>
                    </TouchableOpacity>
                  </View>
                )}

                <TouchableOpacity
                  style={[
                    styles.mainSaveBtn,
                    { backgroundColor: colors.primary, marginTop: 20 },
                  ]}
                  onPress={handleAddManualGuest}
                  disabled={!addManualName.trim() || isAddingMember}
                >
                  {isAddingMember ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.mainSaveBtnText}>+ Add to Trip</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Link Guest Member Modal */}
      <Modal visible={linkModalVisible} transparent animationType="slide">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View
            style={[
              styles.drawerModalContent,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.modalHeaderRow}>
              <View>
                <Text style={[styles.modalTitle, { color: colors.text }]}>
                  Link "{linkingMember?.display_name}"
                </Text>
                <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                  Link with a phone number or contact in the database
                </Text>
              </View>
              <TouchableOpacity onPress={() => setLinkModalVisible(false)}>
                <Ionicons name="close-circle" size={24} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Direct Phone Number Input with live DB lookup */}
            <View style={{ marginBottom: 16 }}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                Link by Phone Number:
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  style={[
                    styles.input,
                    {
                      flex: 1,
                      backgroundColor: colors.inputBackground,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                  placeholder="Enter 10-digit phone number..."
                  placeholderTextColor={colors.textMuted}
                  keyboardType="phone-pad"
                  value={linkManualPhone}
                  onChangeText={setLinkManualPhone}
                />
                {isCheckingPhone && (
                  <View style={{ justifyContent: 'center', paddingHorizontal: 8 }}>
                    <ActivityIndicator size="small" color={colors.primary} />
                  </View>
                )}
              </View>

              {/* Found in database card */}
              {linkDbResult ? (
                <View
                  style={[
                    styles.foundDbCard,
                    {
                      backgroundColor: isDark ? 'rgba(16, 185, 129, 0.15)' : '#D1FAE5',
                      borderColor: colors.success,
                      marginTop: 10,
                    },
                  ]}
                >
                  <Ionicons name="checkmark-circle" size={22} color={colors.success} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.foundDbName, { color: colors.text }]}>
                      Found in database: "{linkDbResult.name}"
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.success, marginTop: 1 }}>
                      {linkDbResult.isAppUser ? '✨ Registered User Account' : '📱 Previously Linked'}
                    </Text>
                    {linkDbResult.phoneNumber && (
                      <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 2 }}>
                        {linkDbResult.phoneNumber}
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity
                    style={[styles.smallAddBtn, { backgroundColor: colors.success }]}
                    onPress={() => {
                      if (linkingMember) {
                        handleConfirmLink(linkingMember, {
                          id: linkDbResult.profileId,
                          name: linkDbResult.name,
                          phoneNumber: linkDbResult.phoneNumber || linkManualPhone,
                          profileId: linkDbResult.profileId,
                        });
                      }
                    }}
                    disabled={isLinking}
                  >
                    {isLinking ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.smallAddBtnText}>Link User</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ) : linkManualPhone.trim().replace(/[^0-9]/g, '').length >= 10 ? (
                <TouchableOpacity
                  style={[styles.linkDirectBtn, { backgroundColor: colors.primary, marginTop: 10 }]}
                  onPress={() => {
                    if (linkingMember) {
                      handleConfirmLink(linkingMember, {
                        name: linkingMember.display_name,
                        phoneNumber: linkManualPhone.trim(),
                      });
                    }
                  }}
                  disabled={isLinking}
                >
                  <Ionicons name="link-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.linkDirectBtnText}>
                    Save & Link Phone: {linkManualPhone.trim()}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Device Contacts Selection */}
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
              Or Choose from Contacts:
            </Text>
            <TextInput
              style={[
                styles.modalSearchInput,
                {
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.border,
                  color: colors.text,
                  marginBottom: 8,
                },
              ]}
              placeholder="Search phone contacts..."
              placeholderTextColor={colors.textMuted}
              value={linkSearchQuery}
              onChangeText={setLinkSearchQuery}
            />

            <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
              {filteredLinkContacts.map(c => (
                <TouchableOpacity
                  key={c.id}
                  style={[
                    styles.contactRow,
                    { borderBottomColor: colors.borderLight },
                  ]}
                  onPress={() => {
                    if (linkingMember) {
                      handleConfirmLink(linkingMember, {
                        id: c.id,
                        name: c.name,
                        phoneNumber: c.phoneNumber,
                        profileId: c.profileId,
                      });
                    }
                  }}
                  disabled={isLinking}
                >
                  <View style={[styles.miniAvatar, { backgroundColor: colors.primaryLight }]}>
                    <Text style={{ color: colors.primary, fontWeight: '700' }}>
                      {c.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.contactRowName, { color: colors.text }]}>{c.name}</Text>
                    {c.phoneNumber && (
                      <Text style={{ fontSize: 11, color: colors.textSecondary }}>
                        {c.phoneNumber}
                      </Text>
                    )}
                  </View>
                  <View style={[styles.memberActionBtn, { backgroundColor: colors.primary }]}>
                    <Ionicons name="link-outline" size={12} color="#FFFFFF" />
                    <Text style={styles.memberActionBtnText}>Link</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
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
    paddingTop: Platform.OS === 'ios' ? 54 : 16,
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  backBtn: {
    padding: 4,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  headerSub: {
    fontSize: 12,
    marginTop: 1,
  },
  headerSaveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 8,
  },
  headerSaveBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  content: {
    padding: 16,
    paddingBottom: 72,
  },
  card: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  sectionSub: {
    fontSize: 13,
    marginBottom: 14,
  },
  bannerContainer: {
    position: 'relative',
    height: 140,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 8,
  },
  coverImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  coverFallback: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  coverEmoji: {
    fontSize: 48,
  },
  coverFallbackText: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 4,
  },
  editCoverBadge: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },
  editCoverBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  presetScroll: {
    flexDirection: 'row',
    marginTop: 8,
    marginBottom: 8,
  },
  presetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
  },
  presetChipEmoji: {
    fontSize: 16,
  },
  presetChipLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  removeCoverBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 4,
  },
  removeCoverText: {
    fontSize: 12,
    fontWeight: '600',
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 12,
  },
  textArea: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  currencySelectorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 12,
  },
  currencyBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  currencyFlag: {
    fontSize: 20,
  },
  currencyText: {
    fontSize: 14,
    fontWeight: '600',
  },
  statusSegmentRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statusSegmentBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  statusSegmentText: {
    fontSize: 13,
    fontWeight: '600',
  },
  shareInvitePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  shareInviteText: {
    fontSize: 12,
    fontWeight: '700',
  },
  inviteCodeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  inviteCodeLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  inviteCodeValue: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 2,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  memberAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  memberAvatarText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  memberName: {
    fontSize: 14,
    fontWeight: '600',
  },
  memberTypeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  adminBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  adminBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  memberActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  memberActionBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  removeMemberIconBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  adminActionBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adminActionBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  deleteBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  deleteBtnText: {
    fontWeight: '700',
    fontSize: 14,
  },
  mainSaveBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 30,
  },
  mainSaveBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  photoModalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    borderWidth: 1,
  },
  currencyModalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    borderWidth: 1,
    maxHeight: '75%',
  },
  drawerModalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    borderWidth: 1,
    height: '80%',
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  tabSegmentContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(150, 150, 150, 0.1)',
    borderRadius: 10,
    padding: 3,
    marginBottom: 14,
  },
  tabSegmentBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabSegmentText: {
    fontSize: 12,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actionIconBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  actionSub: {
    fontSize: 12,
    marginTop: 2,
  },
  modalSearchInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 12,
  },
  currencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  currencyRowFlag: {
    fontSize: 24,
    marginRight: 14,
  },
  currencyRowInfo: {
    flex: 1,
  },
  currencyRowCountry: {
    fontSize: 15,
    fontWeight: '700',
  },
  currencyRowSub: {
    fontSize: 12,
    marginTop: 2,
  },
  subHeadingText: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  userResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
    gap: 10,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  contactRowName: {
    fontSize: 14,
    fontWeight: '600',
  },
  miniAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  smallAddBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  smallAddBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  foundDbCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
  },
  foundDbName: {
    fontSize: 14,
    fontWeight: '700',
  },
  linkDirectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  linkDirectBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
});
