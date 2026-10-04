import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTripStore } from '../src/features/trips/useTripStore';
import { useContactsStore, FriendContact } from '../src/features/contacts/useContactsStore';
import { useAuthStore } from '../src/features/auth/useAuthStore';
import { extractPaymentFromScreenshot, getNativeSharedImageUri } from '../src/services/receiptOcr';
import { theme } from '../src/theme/colors';
import { useTheme } from '../src/theme/useThemeStore';

type FilterTab = 'all' | 'chats' | 'trips';

export default function SharedPaymentScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { trips, createTrip, addMember, findOrCreateFriendSplitTrip } = useTripStore();
  const { contacts, initContacts, isLoading: contactsLoading } = useContactsStore();
  const { user, profile } = useAuthStore();

  const params = useLocalSearchParams<{ imageUri?: string; sharedText?: string }>();
  const [imageUri, setImageUri] = useState<string | null>(params.imageUri || null);
  const [sharedText, setSharedText] = useState<string | null>(params.sharedText || null);

  // Scanning & OCR state
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // Extracted values
  const [detectedApp, setDetectedApp] = useState<
    'super.money' | 'gpay' | 'phonepe' | 'paytm' | 'cred' | 'bhim' | 'navi' | 'amazon_pay' | 'whatsapp' | 'unknown'
  >('unknown');
  const [amountRupees, setAmountRupees] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [description, setDescription] = useState('');
  const [upiTxnId, setUpiTxnId] = useState('');
  const [suggestedCategory, setSuggestedCategory] = useState<string>('General');

  // UI state
  const [showEditFields, setShowEditFields] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [isNavigating, setIsNavigating] = useState(false);
  const [selectedDestinationId, setSelectedDestinationId] = useState<string | null>(null);

  // Initialize contacts if empty
  useEffect(() => {
    if (contacts.length === 0) {
      initContacts();
    }
  }, []);

  // Check for shared image or text from Android SEND Intent or route params
  useEffect(() => {
    async function checkIncoming() {
      let currentUri = params.imageUri || null;
      let currentText = params.sharedText || null;

      if (!currentUri && !currentText) {
        const { getNativeSharedData } = await import('../src/services/receiptOcr');
        const nativeData = await getNativeSharedData();
        if (nativeData.imageUri) currentUri = nativeData.imageUri;
        if (nativeData.sharedText) currentText = nativeData.sharedText;
      }

      if (currentUri) {
        setImageUri(currentUri);
      }
      if (currentText) {
        setSharedText(currentText);
      }

      if (currentUri) {
        runOcrOnUri(currentUri, currentText);
      } else if (currentText) {
        runParsingOnText(currentText);
      }
    }
    checkIncoming();
  }, [params.imageUri, params.sharedText]);

  const applyParsedPayment = (parsed: any) => {
    setDetectedApp(parsed.app);
    if (parsed.amountPaise) {
      const rupees = parsed.amountPaise / 100;
      setAmountRupees(rupees % 1 === 0 ? rupees.toString() : rupees.toFixed(2));
    }
    if (parsed.receiverName) {
      setReceiverName(parsed.receiverName);
      setDescription(`Payment to ${parsed.receiverName}`);
    } else if (parsed.app === 'super.money') {
      setDescription('Payment via super.money');
    } else {
      setDescription('UPI Payment');
    }
    if (parsed.upiTxnId) {
      setUpiTxnId(parsed.upiTxnId);
    }
    if (parsed.suggestedCategory) {
      setSuggestedCategory(parsed.suggestedCategory);
    }
  };

  // Run OCR on the selected/shared image (combined with sharedText if available)
  const runOcrOnUri = async (uri: string, extraText?: string | null) => {
    try {
      setIsScanning(true);
      setScanError(null);
      const result = await extractPaymentFromScreenshot(uri, extraText || sharedText);
      applyParsedPayment(result.parsed);
    } catch (e: any) {
      console.log('Error scanning receipt:', e);
      setScanError('Could not auto-read receipt text. You can still fill in the details.');
    } finally {
      setIsScanning(false);
    }
  };

  // Run parser on plain text message/link
  const runParsingOnText = (text: string) => {
    try {
      setIsScanning(true);
      setScanError(null);
      const { extractPaymentFromText } = require('../src/services/receiptOcr');
      const parsed = extractPaymentFromText(text);
      applyParsedPayment(parsed);
    } catch (e: any) {
      console.log('Error parsing text:', e);
    } finally {
      setIsScanning(false);
    }
  };

  // Pick another screenshot
  const handlePickScreenshot = async () => {
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
        setImageUri(pickedUri);
        runOcrOnUri(pickedUri);
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not pick image');
    }
  };

  // Deduplicated group trips (excluding 1-on-1 friend splits)
  const groupTrips = useMemo(() => {
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

  // Filtered lists based on search
  const filteredContacts = useMemo(() => {
    if (!searchQuery.trim()) return contacts;
    const q = searchQuery.toLowerCase().trim();
    return contacts.filter(
      c =>
        c.name.toLowerCase().includes(q) ||
        (c.phoneNumber && c.phoneNumber.includes(q))
    );
  }, [contacts, searchQuery]);

  const filteredTrips = useMemo(() => {
    if (!searchQuery.trim()) return groupTrips;
    const q = searchQuery.toLowerCase().trim();
    return groupTrips.filter(t => t.name.toLowerCase().includes(q));
  }, [groupTrips, searchQuery]);

  // Route to add expense for a 1-on-1 friend split
  const handleSelectFriend = async (friend: FriendContact) => {
    if (isNavigating) return;
    setIsNavigating(true);
    setSelectedDestinationId(friend.id);

    try {
      // Use canonical friend split trip finder (guarantees both users share the SAME trip!)
      const targetTrip = await findOrCreateFriendSplitTrip(friend);

      if (targetTrip) {
        router.replace({
          pathname: '/trip/[id]/add',
          params: {
            id: targetTrip.id,
            prefillAmount: amountRupees,
            prefillDescription: description || `Payment to ${receiverName || friend.name}`,
            prefillReceiver: receiverName || friend.name,
            prefillCategory: suggestedCategory,
            upiTxnId: upiTxnId,
            paymentApp: detectedApp,
            attachmentUri: imageUri || '',
            fromShare: 'true',
          },
        });
      }
    } catch (e) {
      console.log('Error routing to friend trip:', e);
      Alert.alert('Error', 'Could not open expense screen for this friend.');
    } finally {
      setIsNavigating(false);
      setSelectedDestinationId(null);
    }
  };

  // Route to add expense for a group trip
  const handleSelectTrip = (tripId: string) => {
    if (isNavigating) return;
    setIsNavigating(true);
    setSelectedDestinationId(tripId);

    router.replace({
      pathname: '/trip/[id]/add',
      params: {
        id: tripId,
        prefillAmount: amountRupees,
        prefillDescription: description || (receiverName ? `Payment to ${receiverName}` : 'UPI Payment'),
        prefillReceiver: receiverName,
        prefillCategory: suggestedCategory,
        upiTxnId: upiTxnId,
        paymentApp: detectedApp,
        attachmentUri: imageUri || '',
        fromShare: 'true',
      },
    });
    setTimeout(() => {
      setIsNavigating(false);
      setSelectedDestinationId(null);
    }, 500);
  };

  const getAppBadgeColor = (app: string) => {
    switch (app) {
      case 'super.money':
        return { bg: '#ECFDF5', text: '#059669', border: '#10B981', label: 'super.money' };
      case 'gpay':
        return { bg: '#E8F0FE', text: '#1A73E8', border: '#4285F4', label: 'Google Pay' };
      case 'phonepe':
        return { bg: '#F3E8FF', text: '#6739B7', border: '#9C27B0', label: 'PhonePe' };
      case 'paytm':
        return { bg: '#E0F7FA', text: '#0082CA', border: '#00BAF2', label: 'Paytm' };
      case 'cred':
        return { bg: '#FEE2E2', text: '#B91C1C', border: '#EF4444', label: 'CRED' };
      case 'bhim':
        return { bg: '#FEF3C7', text: '#B45309', border: '#F59E0B', label: 'BHIM UPI' };
      case 'navi':
        return { bg: '#FFF7ED', text: '#C2410C', border: '#FB923C', label: 'Navi UPI' };
      case 'amazon_pay':
        return { bg: '#FFFBEB', text: '#D97706', border: '#F59E0B', label: 'Amazon Pay' };
      case 'whatsapp':
        return { bg: '#F0FDF4', text: '#15803D', border: '#22C55E', label: 'WhatsApp Pay' };
      default:
        return { bg: colors.primaryLight, text: colors.primaryDark, border: colors.primary, label: 'UPI Receipt' };
    }
  };

  const badge = getAppBadgeColor(detectedApp);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <Stack.Screen
        options={{
          title: 'Link Payment Expense',
          headerStyle: { backgroundColor: colors.card },
          headerTintColor: colors.text,
          headerShadowVisible: false,
        }}
      />

      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, 24) + 60 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/* TOP RECEIPT SUMMARY CARD */}
        <View
          style={[
            styles.receiptCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          {isScanning ? (
            <View style={styles.scanningBox}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.scanningTitle, { color: colors.text }]}>
                Scanning Receipt with AI OCR...
              </Text>
              <Text style={[styles.scanningSub, { color: colors.textSecondary }]}>
                Auto-detecting amount, receiver, and UPI transaction ID
              </Text>
            </View>
          ) : (
            <View>
              {/* Top Row: Thumbnail + App Badge + Amount */}
              <View style={styles.receiptTopRow}>
                {imageUri ? (
                  <Image source={{ uri: imageUri }} style={styles.thumbnail} />
                ) : (
                  <View style={[styles.thumbnailPlaceholder, { backgroundColor: colors.inputBackground }]}>
                    <Ionicons name="receipt-outline" size={32} color={colors.textSecondary} />
                  </View>
                )}

                <View style={styles.receiptDetails}>
                  <View style={styles.badgeRow}>
                    <View
                      style={[
                        styles.appBadge,
                        { backgroundColor: badge.bg, borderColor: badge.border },
                      ]}
                    >
                      <Ionicons name="sparkles" size={12} color={badge.text} />
                      <Text style={[styles.appBadgeText, { color: badge.text }]}>
                        {badge.label}
                      </Text>
                    </View>

                    <TouchableOpacity
                      onPress={handlePickScreenshot}
                      style={[styles.changeBtn, { backgroundColor: colors.inputBackground }]}
                    >
                      <Ionicons name="image-outline" size={14} color={colors.primary} />
                      <Text style={[styles.changeBtnText, { color: colors.primary }]}>Change</Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={[styles.detectedAmount, { color: colors.text }]}>
                    {amountRupees ? `₹${amountRupees}` : '₹ --'}
                  </Text>

                  {receiverName ? (
                    <Text style={[styles.detectedReceiver, { color: colors.textSecondary }]} numberOfLines={1}>
                      Paid to <Text style={{ fontWeight: '700', color: colors.text }}>{receiverName}</Text>
                    </Text>
                  ) : (
                    <Text style={[styles.detectedReceiver, { color: colors.textSecondary }]}>
                      UPI Payment
                    </Text>
                  )}

                  {upiTxnId ? (
                    <Text style={[styles.detectedUpi, { color: colors.textMuted }]} numberOfLines={1}>
                      UPI Ref: {upiTxnId}
                    </Text>
                  ) : null}
                </View>
              </View>

              {sharedText ? (
                <View
                  style={{
                    marginTop: 10,
                    padding: 8,
                    borderRadius: 8,
                    backgroundColor: colors.inputBackground,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Ionicons name="chatbox-ellipses-outline" size={14} color={colors.textSecondary} />
                  <Text
                    style={{ fontSize: 12, color: colors.textSecondary, flex: 1 }}
                    numberOfLines={2}
                  >
                    {sharedText}
                  </Text>
                </View>
              ) : null}

              {/* Action row: Toggle edit fields */}
              <View style={[styles.cardDivider, { backgroundColor: colors.border }]} />
              <View style={styles.cardActionRow}>
                <View style={styles.detectedTag}>
                  <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                  <Text style={[styles.detectedTagText, { color: colors.success }]}>
                    Auto-detected & Ready to Link
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={() => setShowEditFields(!showEditFields)}
                  style={styles.editToggleBtn}
                >
                  <Ionicons
                    name={showEditFields ? 'chevron-up' : 'create-outline'}
                    size={16}
                    color={colors.primary}
                  />
                  <Text style={[styles.editToggleText, { color: colors.primary }]}>
                    {showEditFields ? 'Hide Details' : 'Edit Fields'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Expandable Manual Edit Inputs */}
              {showEditFields && (
                <View style={styles.editInputsContainer}>
                  <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Amount (₹)</Text>
                  <TextInput
                    style={[
                      styles.input,
                      { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.text },
                    ]}
                    value={amountRupees}
                    onChangeText={setAmountRupees}
                    keyboardType="numeric"
                  />

                  <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Paid To / Receiver</Text>
                  <TextInput
                    style={[
                      styles.input,
                      { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.text },
                    ]}
                    value={receiverName}
                    onChangeText={text => {
                      setReceiverName(text);
                      setDescription(`Payment to ${text}`);
                    }}
                  />

                  <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>UPI Transaction ID</Text>
                  <TextInput
                    style={[
                      styles.input,
                      { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.text },
                    ]}
                    value={upiTxnId}
                    onChangeText={setUpiTxnId}
                  />
                </View>
              )}
            </View>
          )}
        </View>

        {/* SECTION HEADER: WHATSAPP-STYLE DESTINATION PICKER */}
        <View style={styles.destinationHeader}>
          <Text style={[styles.destinationTitle, { color: colors.text }]}>
            Send / Link Expense To
          </Text>
          <Text style={[styles.destinationSubtitle, { color: colors.textSecondary }]}>
            Select a contact chat for 1-on-1 split or a group trip
          </Text>
        </View>

        {/* SEARCH BAR */}
        <View
          style={[
            styles.searchBar,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Ionicons name="search" size={20} color={colors.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search contacts or trips..."
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

        {/* FILTER CHIPS (All / Chats / Trips) */}
        <View style={styles.filterChipsRow}>
          <TouchableOpacity
            style={[
              styles.filterChip,
              {
                backgroundColor: activeTab === 'all' ? colors.primary : colors.card,
                borderColor: activeTab === 'all' ? colors.primary : colors.border,
              },
            ]}
            onPress={() => setActiveTab('all')}
          >
            <Text
              style={[
                styles.filterChipText,
                { color: activeTab === 'all' ? '#FFFFFF' : colors.text },
              ]}
            >
              All Destinations
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterChip,
              {
                backgroundColor: activeTab === 'chats' ? colors.primary : colors.card,
                borderColor: activeTab === 'chats' ? colors.primary : colors.border,
              },
            ]}
            onPress={() => setActiveTab('chats')}
          >
            <Ionicons
              name="chatbubble-ellipses"
              size={14}
              color={activeTab === 'chats' ? '#FFFFFF' : colors.primary}
            />
            <Text
              style={[
                styles.filterChipText,
                { color: activeTab === 'chats' ? '#FFFFFF' : colors.text },
              ]}
            >
              Recent Chats ({filteredContacts.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterChip,
              {
                backgroundColor: activeTab === 'trips' ? colors.primary : colors.card,
                borderColor: activeTab === 'trips' ? colors.primary : colors.border,
              },
            ]}
            onPress={() => setActiveTab('trips')}
          >
            <Ionicons
              name="people"
              size={14}
              color={activeTab === 'trips' ? '#FFFFFF' : colors.primary}
            />
            <Text
              style={[
                styles.filterChipText,
                { color: activeTab === 'trips' ? '#FFFFFF' : colors.text },
              ]}
            >
              Trips ({filteredTrips.length})
            </Text>
          </TouchableOpacity>
        </View>

        {/* SECTION 1: RECENT INDIVIDUAL SPLITS / CHATS (WhatsApp Style) */}
        {(activeTab === 'all' || activeTab === 'chats') && (
          <View style={styles.listSection}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.primary} />
              <Text style={[styles.sectionTitleText, { color: colors.text }]}>
                Recent Chats (1-on-1 Splits)
              </Text>
            </View>

            {filteredContacts.length === 0 ? (
              <View style={[styles.emptyBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="person-outline" size={28} color={colors.textMuted} />
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  {searchQuery ? 'No contacts match your search' : 'No recent chats yet'}
                </Text>
              </View>
            ) : (
              <View style={[styles.cardGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {filteredContacts.map((contact, idx) => {
                  const isSelected = selectedDestinationId === contact.id;
                  const initials = (contact.name || '?')
                    .split(' ')
                    .map(w => w[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2);

                  return (
                    <TouchableOpacity
                      key={contact.id}
                      style={[
                        styles.itemRow,
                        idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                        isSelected && { backgroundColor: isDark ? 'rgba(99, 102, 241, 0.2)' : '#EEF2FF' },
                      ]}
                      onPress={() => handleSelectFriend(contact)}
                      disabled={isNavigating}
                      activeOpacity={0.7}
                    >
                      {/* Avatar */}
                      <View style={[styles.avatarCircle, { backgroundColor: getAvatarColor(contact.name) }]}>
                        <Text style={styles.avatarInitials}>{initials}</Text>
                      </View>

                      {/* Info */}
                      <View style={styles.itemDetails}>
                        <View style={styles.itemNameRow}>
                          <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={1}>
                            {contact.name}
                          </Text>
                          <View style={[styles.chatBadge, { backgroundColor: isDark ? '#1E293B' : '#F1F5F9' }]}>
                            <Text style={[styles.chatBadgeText, { color: colors.textSecondary }]}>
                              Single Split
                            </Text>
                          </View>
                        </View>
                        <Text style={[styles.itemSub, { color: colors.textSecondary }]} numberOfLines={1}>
                          {contact.phoneNumber || 'Tap to link and split 50/50'}
                        </Text>
                      </View>

                      {/* Trailing arrow / spinner */}
                      {isSelected ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : (
                        <View style={[styles.sendCircle, { backgroundColor: colors.primaryLight }]}>
                          <Ionicons name="arrow-forward" size={16} color={colors.primary} />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* SECTION 2: GROUP TRIPS */}
        {(activeTab === 'all' || activeTab === 'trips') && (
          <View style={[styles.listSection, { marginTop: 24 }]}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="people-outline" size={18} color={colors.primary} />
              <Text style={[styles.sectionTitleText, { color: colors.text }]}>
                Trips & Groups
              </Text>
            </View>

            {filteredTrips.length === 0 ? (
              <View style={[styles.emptyBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="airplane-outline" size={28} color={colors.textMuted} />
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  {searchQuery ? 'No trips match your search' : 'No active trips found'}
                </Text>
              </View>
            ) : (
              <View style={[styles.cardGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {filteredTrips.map((trip, idx) => {
                  const isSelected = selectedDestinationId === trip.id;
                  return (
                    <TouchableOpacity
                      key={trip.id}
                      style={[
                        styles.itemRow,
                        idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                        isSelected && { backgroundColor: isDark ? 'rgba(99, 102, 241, 0.2)' : '#EEF2FF' },
                      ]}
                      onPress={() => handleSelectTrip(trip.id)}
                      disabled={isNavigating}
                      activeOpacity={0.7}
                    >
                      {/* Trip Icon */}
                      <View style={[styles.tripIconCircle, { backgroundColor: colors.primaryLight }]}>
                        <Ionicons name="airplane" size={20} color={colors.primary} />
                      </View>

                      {/* Info */}
                      <View style={styles.itemDetails}>
                        <View style={styles.itemNameRow}>
                          <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={1}>
                            {trip.name}
                          </Text>
                          <View style={[styles.tripBadge, { backgroundColor: isDark ? '#1E293B' : '#EFF6FF' }]}>
                            <Text style={[styles.tripBadgeText, { color: colors.primary }]}>
                              Group Trip
                            </Text>
                          </View>
                        </View>
                        <Text style={[styles.itemSub, { color: colors.textSecondary }]} numberOfLines={1}>
                          {trip.description ? `${trip.description} • ` : ''}Split among trip members
                        </Text>
                      </View>

                      {/* Trailing arrow / spinner */}
                      {isSelected ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : (
                        <View style={[styles.sendCircle, { backgroundColor: colors.primaryLight }]}>
                          <Ionicons name="arrow-forward" size={16} color={colors.primary} />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Generate consistent avatar colors
function getAvatarColor(name: string): string {
  const palette = [
    '#6366F1',
    '#EC4899',
    '#10B981',
    '#F59E0B',
    '#8B5CF6',
    '#3B82F6',
    '#14B8A6',
    '#F97316',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return palette[Math.abs(hash) % palette.length];
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  receiptCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  scanningBox: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanningTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 12,
  },
  scanningSub: {
    fontSize: 13,
    marginTop: 4,
    textAlign: 'center',
  },
  receiptTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  thumbnail: {
    width: 76,
    height: 96,
    borderRadius: 10,
    backgroundColor: '#E2E8F0',
  },
  thumbnailPlaceholder: {
    width: 76,
    height: 96,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiptDetails: {
    flex: 1,
    marginLeft: 14,
    justifyContent: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  appBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
  },
  appBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  changeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  changeBtnText: {
    fontSize: 11,
    fontWeight: '600',
  },
  detectedAmount: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  detectedReceiver: {
    fontSize: 13,
    marginTop: 2,
  },
  detectedUpi: {
    fontSize: 11,
    marginTop: 2,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 12,
  },
  cardActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detectedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  detectedTagText: {
    fontSize: 12,
    fontWeight: '600',
  },
  editToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  editToggleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  editInputsContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#CBD5E1',
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
    marginTop: 8,
  },
  input: {
    height: 42,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  destinationHeader: {
    marginBottom: 12,
  },
  destinationTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  destinationSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 14,
  },
  filterChipsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  listSection: {
    marginBottom: 8,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  sectionTitleText: {
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardGroup: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  tripIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemDetails: {
    flex: 1,
    marginLeft: 12,
  },
  itemNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginRight: 8,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  chatBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    marginLeft: 6,
  },
  chatBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  tripBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    marginLeft: 6,
  },
  tripBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  itemSub: {
    fontSize: 12,
    marginTop: 2,
  },
  sendCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyBox: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  emptyText: {
    fontSize: 13,
  },
});
