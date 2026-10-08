import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  FlatList,
  Image,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { useTheme } from '../theme/useThemeStore';
import { useTripStore, Trip, TripMember } from '../features/trips/useTripStore';
import { useContactsStore, FriendContact } from '../features/contacts/useContactsStore';
import { useAuthStore } from '../features/auth/useAuthStore';
import { useNotificationStore } from '../features/notifications/useNotificationStore';
import { formatCurrencyAmount } from '../services/currency';
import { supabase, supabaseAdmin, isSupabaseConfigured } from '../lib/supabase';
import { scaleFont, moderateScale } from '../theme/responsive';
import TripCoverBadge from './TripCoverBadge';

interface SettleUpModalProps {
  visible: boolean;
  onClose: () => void;
  initialTripId?: string;
  initialFriendId?: string;
}

type SettleType = 'trip' | 'friend';
type PaymentMethod = 'cash' | 'upi';

export default function SettleUpModal({
  visible,
  onClose,
  initialTripId,
  initialFriendId,
}: SettleUpModalProps) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { user, profile } = useAuthStore();
  const { trips, sendMessage, findOrCreateFriendSplitTrip, members: allMembers } = useTripStore();
  const { contacts, friendsSummary } = useContactsStore();

  const [step, setStep] = useState<'select_target' | 'select_member' | 'enter_details'>('select_target');
  const [settleType, setSettleType] = useState<SettleType>('trip');
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [tripMembersList, setTripMembersList] = useState<TripMember[]>([]);
  const [selectedReceiver, setSelectedReceiver] = useState<{
    id: string;
    name: string;
    phone?: string | null;
    profileId?: string | null;
    memberId?: string;
  } | null>(null);

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [amountText, setAmountText] = useState('');
  const [noteText, setNoteText] = useState('');
  const [screenshotUri, setScreenshotUri] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Group trips only (not 1-on-1 friend splits)
  const groupTrips = useMemo(() => {
    return trips.filter(
      t =>
        t.trip_type !== 'friend_split' &&
        !(t as any).is_friend_split &&
        !t.name.toLowerCase().startsWith('split with ')
    );
  }, [trips]);

  // Filtered trips
  const filteredTrips = useMemo(() => {
    if (!searchQuery.trim()) return groupTrips;
    const q = searchQuery.toLowerCase().trim();
    return groupTrips.filter(t => t.name.toLowerCase().includes(q));
  }, [groupTrips, searchQuery]);

  // Filtered friends
  const filteredFriends = useMemo(() => {
    if (!searchQuery.trim()) return contacts;
    const q = searchQuery.toLowerCase().trim();
    return contacts.filter(
      c => c.name.toLowerCase().includes(q) || (c.phoneNumber && c.phoneNumber.includes(q))
    );
  }, [contacts, searchQuery]);

  // Reset or pre-fill state on open
  useEffect(() => {
    if (visible) {
      if (initialTripId) {
        const t = trips.find(trip => trip.id === initialTripId);
        if (t) {
          setSelectedTrip(t);
          setSettleType('trip');
          loadMembersForTrip(t.id);
          setStep('select_member');
          return;
        }
      }
      setStep('select_target');
      setSelectedTrip(null);
      setSelectedReceiver(null);
      setAmountText('');
      setNoteText('');
      setScreenshotUri(null);
      setPaymentMethod('cash');
      setSearchQuery('');
    }
  }, [visible, initialTripId]);

  const loadMembersForTrip = async (tripId: string) => {
    const curUserId = user?.id || '';
    const mems = allMembers.filter(m => m.trip_id === tripId);
    // Exclude current user from receiver list
    const otherMembers = mems.filter(
      m => m.profile_id !== curUserId && m.user_id !== curUserId && m.display_name.toLowerCase() !== 'you'
    );
    setTripMembersList(otherMembers.length > 0 ? otherMembers : mems);
  };

  const handleSelectTrip = (trip: Trip) => {
    setSelectedTrip(trip);
    loadMembersForTrip(trip.id);
    setStep('select_member');
  };

  const handleSelectTripMember = (mem: TripMember) => {
    setSelectedReceiver({
      id: mem.id,
      memberId: mem.id,
      name: mem.display_name,
      phone: mem.phone_number,
      profileId: mem.profile_id || mem.user_id,
    });
    setStep('enter_details');
  };

  const handleSelectFriend = async (friend: FriendContact) => {
    setSelectedReceiver({
      id: friend.id,
      name: friend.name,
      phone: friend.phoneNumber,
      profileId: friend.profileId || friend.id,
    });
    setSelectedTrip(null);
    setStep('enter_details');
  };

  const handlePickScreenshot = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.8,
      });
      if (!res.canceled && res.assets && res.assets.length > 0) {
        setScreenshotUri(res.assets[0].uri);
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not pick image');
    }
  };

  const handleSubmit = async () => {
    const numAmt = parseFloat(amountText);
    if (!numAmt || numAmt <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid payment amount.');
      return;
    }
    if (!selectedReceiver) {
      Alert.alert('Missing Receiver', 'Please select who you are paying.');
      return;
    }

    setIsSubmitting(true);
    try {
      const amountPaise = Math.round(numAmt * 100);
      const currentUserId = user?.id || 'local_user';
      const payerName =
        profile?.full_name ||
        profile?.name ||
        user?.email?.split('@')[0] ||
        'You';

      // 1. Upload screenshot if present
      let cloudScreenshotUrl: string | null = null;
      if (screenshotUri && isSupabaseConfigured) {
        try {
          const ext = screenshotUri.split('.').pop()?.split('?')[0] || 'jpg';
          const storagePath = `payment_proofs/proof_${Date.now()}.${ext}`;
          const base64Data = await FileSystem.readAsStringAsync(screenshotUri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          const byteChars = atob(base64Data);
          const byteNums = new Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) {
            byteNums[i] = byteChars.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNums);

          const client = supabaseAdmin || supabase;
          const { data: upData, error: upErr } = await client.storage
            .from('attachments')
            .upload(storagePath, byteArray.buffer, {
              contentType: ext === 'png' ? 'image/png' : 'image/jpeg',
              upsert: true,
            });

          if (!upErr && upData?.path) {
            const { data: pubData } = client.storage
              .from('attachments')
              .getPublicUrl(upData.path);
            cloudScreenshotUrl = pubData?.publicUrl || null;
          }
        } catch (upError) {
          console.warn('Screenshot upload notice:', upError);
        }
      }

      const claimId = `claim_${Date.now()}`;
      const displayText = `💸 ${paymentMethod === 'cash' ? '💵 Cash' : '📱 UPI'} Payment: ${formatCurrencyAmount(amountPaise, 'INR')}`;

      const payload = {
        type: 'payment_claim',
        claimId,
        text: displayText,
        amountPaise,
        status: 'pending',
        paymentMode: paymentMethod,
        note: noteText.trim() || (paymentMethod === 'cash' ? 'Settled in cash' : 'Paid via UPI'),
        payerName,
        payerId: currentUserId,
        payerPhone: (user as any)?.phone || (profile as any)?.phone_number || null,
        receiverName: selectedReceiver.name,
        receiverId: selectedReceiver.profileId || selectedReceiver.id,
        receiverMemberId: selectedReceiver.memberId,
        receiverPhone: selectedReceiver.phone || null,
        screenshotUrl: cloudScreenshotUrl || screenshotUri,
        mediaUrl: cloudScreenshotUrl || screenshotUri,
        isTripRelated: Boolean(selectedTrip),
        tripId: selectedTrip?.id || null,
        tripName: selectedTrip?.name || null,
      };

      // 2. Dispatch to chats
      if (selectedTrip) {
        // Send to group trip chat
        await sendMessage(
          selectedTrip.id,
          currentUserId,
          payerName,
          JSON.stringify(payload),
          undefined,
          'group'
        );

        // Also send to personal chat between the two members
        try {
          const friendObj: any = {
            id: selectedReceiver.profileId || selectedReceiver.id,
            name: selectedReceiver.name,
            phoneNumber: selectedReceiver.phone || undefined,
          };
          const personalTrip = await findOrCreateFriendSplitTrip(friendObj);
          if (personalTrip && personalTrip.id !== selectedTrip.id) {
            await sendMessage(
              personalTrip.id,
              currentUserId,
              payerName,
              JSON.stringify({ ...payload, personalTripId: personalTrip.id }),
              undefined,
              'individual'
            );
          }
        } catch (pErr) {
          console.warn('Notice sending to personal friend split:', pErr);
        }
      } else {
        // Direct personal split
        const friendObj: any = {
          id: selectedReceiver.profileId || selectedReceiver.id,
          name: selectedReceiver.name,
          phoneNumber: selectedReceiver.phone || undefined,
        };
        const personalTrip = await findOrCreateFriendSplitTrip(friendObj);
        if (personalTrip) {
          await sendMessage(
            personalTrip.id,
            currentUserId,
            payerName,
            JSON.stringify(payload),
            undefined,
            'individual'
          );
        }
      }

      // 3. Trigger Notification
      useNotificationStore.getState().addNotification({
        type: 'payment_claim',
        title: `💸 ${paymentMethod.toUpperCase()} Settlement: ${formatCurrencyAmount(amountPaise, 'INR')}`,
        message: `${payerName} paid ${selectedReceiver.name} ${formatCurrencyAmount(amountPaise, 'INR')} via ${paymentMethod.toUpperCase()}. Tap to accept/decline.`,
        tripId: selectedTrip?.id,
        amountPaise,
        senderId: currentUserId,
        senderName: payerName,
      });

      Alert.alert(
        'Payment Recorded! 🎉',
        `A pending ${paymentMethod.toUpperCase()} settlement of ${formatCurrencyAmount(amountPaise, 'INR')} has been sent to ${selectedReceiver.name}. When they accept, it will be deducted from balances automatically.`,
        [{ text: 'OK', onPress: onClose }]
      );
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not record payment.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardContainer}
        >
          <View
            style={[
              styles.sheetContainer,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                paddingBottom: Math.max(insets.bottom, 20),
              },
            ]}
          >
            {/* Header */}
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sheetTitle, { color: colors.text }]}>
                  {step === 'select_target'
                    ? 'Settle Up / Pay'
                    : step === 'select_member'
                    ? `Pay in ${selectedTrip?.name}`
                    : `Pay ${selectedReceiver?.name}`}
                </Text>
                <Text style={[styles.sheetSubtitle, { color: colors.textSecondary }]}>
                  {step === 'enter_details'
                    ? 'Choose Cash or UPI & enter payment amount'
                    : 'Select trip or friend to record settlement'}
                </Text>
              </View>

              {step !== 'select_target' && (
                <TouchableOpacity
                  onPress={() => {
                    if (step === 'enter_details') {
                      setStep(selectedTrip ? 'select_member' : 'select_target');
                    } else {
                      setStep('select_target');
                    }
                  }}
                  style={styles.backBtn}
                >
                  <Ionicons name="arrow-back" size={20} color={colors.text} />
                </TouchableOpacity>
              )}

              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>

            {/* STEP 1: Select Target (Trip or Friend) */}
            {step === 'select_target' && (
              <View style={{ flex: 1 }}>
                <View style={styles.typeTabs}>
                  <TouchableOpacity
                    style={[
                      styles.typeTab,
                      settleType === 'trip' && { backgroundColor: colors.primary },
                    ]}
                    onPress={() => setSettleType('trip')}
                  >
                    <Ionicons
                      name="airplane"
                      size={16}
                      color={settleType === 'trip' ? '#FFFFFF' : colors.textSecondary}
                    />
                    <Text
                      style={[
                        styles.typeTabText,
                        { color: settleType === 'trip' ? '#FFFFFF' : colors.textSecondary },
                      ]}
                    >
                      In a Trip
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.typeTab,
                      settleType === 'friend' && { backgroundColor: colors.primary },
                    ]}
                    onPress={() => setSettleType('friend')}
                  >
                    <Ionicons
                      name="person"
                      size={16}
                      color={settleType === 'friend' ? '#FFFFFF' : colors.textSecondary}
                    />
                    <Text
                      style={[
                        styles.typeTabText,
                        { color: settleType === 'friend' ? '#FFFFFF' : colors.textSecondary },
                      ]}
                    >
                      With a Friend
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Search Box */}
                <View style={[styles.searchBox, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
                  <Ionicons name="search" size={18} color={colors.textMuted} />
                  <TextInput
                    style={[styles.searchInput, { color: colors.text }]}
                    placeholder={settleType === 'trip' ? 'Search group trips...' : 'Search friends...'}
                    placeholderTextColor={colors.textMuted}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                  />
                </View>

                {settleType === 'trip' ? (
                  <FlatList
                    data={filteredTrips}
                    keyExtractor={item => item.id}
                    contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        style={[styles.targetRow, { borderColor: colors.borderLight }]}
                        onPress={() => handleSelectTrip(item)}
                      >
                        <TripCoverBadge imageUrl={item.image_url} size={42} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <Text style={[styles.targetName, { color: colors.text }]}>{item.name}</Text>
                          <Text style={[styles.targetSub, { color: colors.textSecondary }]}>
                            {item.description || 'Group Trip'}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                      </TouchableOpacity>
                    )}
                    ListEmptyComponent={
                      <View style={styles.emptyView}>
                        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                          No group trips found.
                        </Text>
                      </View>
                    }
                  />
                ) : (
                  <FlatList
                    data={filteredFriends}
                    keyExtractor={item => item.id}
                    contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        style={[styles.targetRow, { borderColor: colors.borderLight }]}
                        onPress={() => handleSelectFriend(item)}
                      >
                        <View style={[styles.avatarBox, { backgroundColor: colors.primaryLight }]}>
                          <Text style={[styles.avatarInitial, { color: colors.primary }]}>
                            {item.name.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <Text style={[styles.targetName, { color: colors.text }]}>{item.name}</Text>
                          <Text style={[styles.targetSub, { color: colors.textSecondary }]}>
                            {item.phoneNumber || 'Contact'}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                      </TouchableOpacity>
                    )}
                    ListEmptyComponent={
                      <View style={styles.emptyView}>
                        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                          No friends found.
                        </Text>
                      </View>
                    }
                  />
                )}
              </View>
            )}

            {/* STEP 2: Select Member in Trip */}
            {step === 'select_member' && (
              <View style={{ flex: 1 }}>
                <Text style={[styles.subHeading, { color: colors.textSecondary }]}>
                  Select who received or is receiving your payment:
                </Text>
                <FlatList
                  data={tripMembersList}
                  keyExtractor={item => item.id}
                  contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[styles.targetRow, { borderColor: colors.borderLight }]}
                      onPress={() => handleSelectTripMember(item)}
                    >
                      <View style={[styles.avatarBox, { backgroundColor: colors.primaryLight }]}>
                        <Text style={[styles.avatarInitial, { color: colors.primary }]}>
                          {item.display_name.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={[styles.targetName, { color: colors.text }]}>{item.display_name}</Text>
                        <Text style={[styles.targetSub, { color: colors.textSecondary }]}>
                          {item.role === 'admin' ? 'Admin' : 'Member'}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                    </TouchableOpacity>
                  )}
                />
              </View>
            )}

            {/* STEP 3: Enter Details (Cash / UPI, Amount, Screenshot) */}
            {step === 'enter_details' && (
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
                keyboardShouldPersistTaps="handled"
              >
                {/* Receiver Banner */}
                <View
                  style={[
                    styles.receiverBanner,
                    { backgroundColor: isDark ? 'rgba(99, 102, 241, 0.12)' : '#EEF2FF', borderColor: colors.borderLight },
                  ]}
                >
                  <View style={[styles.avatarBox, { backgroundColor: colors.primaryLight }]}>
                    <Text style={[styles.avatarInitial, { color: colors.primary }]}>
                      {selectedReceiver?.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[styles.bannerPayLabel, { color: colors.textSecondary }]}>
                      You are paying:
                    </Text>
                    <Text style={[styles.bannerReceiverName, { color: colors.text }]}>
                      {selectedReceiver?.name}
                    </Text>
                    {selectedTrip ? (
                      <Text style={[styles.bannerTripTag, { color: colors.primary }]}>
                        Trip: {selectedTrip.name}
                      </Text>
                    ) : null}
                  </View>
                </View>

                {/* Payment Mode Selector */}
                <Text style={[styles.fieldLabel, { color: colors.text }]}>Payment Method</Text>
                <View style={styles.methodCardsRow}>
                  {/* Cash Card */}
                  <TouchableOpacity
                    style={[
                      styles.methodCard,
                      {
                        backgroundColor:
                          paymentMethod === 'cash'
                            ? isDark
                              ? 'rgba(16, 185, 129, 0.15)'
                              : '#ECFDF5'
                            : colors.inputBackground,
                        borderColor: paymentMethod === 'cash' ? colors.success : colors.border,
                      },
                    ]}
                    onPress={() => setPaymentMethod('cash')}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.methodIconBox, { backgroundColor: colors.success }]}>
                      <Ionicons name="cash" size={20} color="#FFFFFF" />
                    </View>
                    <Text style={[styles.methodTitle, { color: colors.text }]}>Cash</Text>
                    <Text style={[styles.methodSub, { color: colors.textSecondary }]}>
                      Hand-to-hand settlement
                    </Text>
                    {paymentMethod === 'cash' && (
                      <View style={[styles.methodCheck, { backgroundColor: colors.success }]}>
                        <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                      </View>
                    )}
                  </TouchableOpacity>

                  {/* UPI Card */}
                  <TouchableOpacity
                    style={[
                      styles.methodCard,
                      {
                        backgroundColor:
                          paymentMethod === 'upi'
                            ? isDark
                              ? 'rgba(99, 102, 241, 0.15)'
                              : '#EEF2FF'
                            : colors.inputBackground,
                        borderColor: paymentMethod === 'upi' ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => setPaymentMethod('upi')}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.methodIconBox, { backgroundColor: colors.primary }]}>
                      <Ionicons name="card" size={20} color="#FFFFFF" />
                    </View>
                    <Text style={[styles.methodTitle, { color: colors.text }]}>UPI / Online</Text>
                    <Text style={[styles.methodSub, { color: colors.textSecondary }]}>
                      GPay, PhonePe, Paytm
                    </Text>
                    {paymentMethod === 'upi' && (
                      <View style={[styles.methodCheck, { backgroundColor: colors.primary }]}>
                        <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                      </View>
                    )}
                  </TouchableOpacity>
                </View>

                {/* Amount Input */}
                <Text style={[styles.fieldLabel, { color: colors.text, marginTop: 16 }]}>
                  Amount (₹)
                </Text>
                <View
                  style={[
                    styles.amountInputRow,
                    { backgroundColor: colors.inputBackground, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.currencyPrefix, { color: colors.primary }]}>₹</Text>
                  <TextInput
                    style={[styles.amountInput, { color: colors.text }]}
                    placeholder="0"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="numeric"
                    value={amountText}
                    onChangeText={setAmountText}
                  />
                </View>

                {/* Quick Amount Chips */}
                <View style={styles.quickChipsRow}>
                  {['100', '250', '500', '1000'].map(val => (
                    <TouchableOpacity
                      key={val}
                      style={[
                        styles.quickChip,
                        { backgroundColor: colors.inputBackground, borderColor: colors.borderLight },
                      ]}
                      onPress={() => setAmountText(val)}
                    >
                      <Text style={[styles.quickChipText, { color: colors.text }]}>₹{val}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Note */}
                <Text style={[styles.fieldLabel, { color: colors.text, marginTop: 16 }]}>
                  Note (Optional)
                </Text>
                <TextInput
                  style={[
                    styles.noteInput,
                    {
                      backgroundColor: colors.inputBackground,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                  placeholder={
                    paymentMethod === 'cash'
                      ? 'e.g. Handed cash at dinner'
                      : 'e.g. Paid via Google Pay / UTR'
                  }
                  placeholderTextColor={colors.textMuted}
                  value={noteText}
                  onChangeText={setNoteText}
                />

                {/* Payment Screenshot (especially useful for UPI) */}
                <Text style={[styles.fieldLabel, { color: colors.text, marginTop: 16 }]}>
                  Payment Screenshot Proof (Optional)
                </Text>

                {screenshotUri ? (
                  <View style={styles.screenshotPreviewContainer}>
                    <Image source={{ uri: screenshotUri }} style={styles.screenshotThumbnail} />
                    <TouchableOpacity
                      style={styles.removeScreenshotBtn}
                      onPress={() => setScreenshotUri(null)}
                    >
                      <Ionicons name="close-circle" size={24} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[
                      styles.uploadBox,
                      { backgroundColor: colors.inputBackground, borderColor: colors.borderLight },
                    ]}
                    onPress={handlePickScreenshot}
                  >
                    <Ionicons name="image-outline" size={22} color={colors.primary} />
                    <Text style={[styles.uploadBoxText, { color: colors.primary }]}>
                      Upload Screenshot / Proof
                    </Text>
                  </TouchableOpacity>
                )}

                {/* Submit Action */}
                <TouchableOpacity
                  style={[
                    styles.submitBtn,
                    {
                      backgroundColor: paymentMethod === 'cash' ? colors.success : colors.primary,
                      opacity: isSubmitting ? 0.7 : 1,
                    },
                  ]}
                  onPress={handleSubmit}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <View style={styles.submitBtnRow}>
                      <Ionicons
                        name={paymentMethod === 'cash' ? 'cash-outline' : 'send-outline'}
                        size={18}
                        color="#FFFFFF"
                      />
                      <Text style={styles.submitBtnText}>
                        Record & Send {paymentMethod.toUpperCase()} Payment
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  keyboardContainer: {
    maxHeight: '92%',
  },
  sheetContainer: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    minHeight: 450,
    maxHeight: '100%',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  sheetTitle: {
    fontSize: scaleFont(18),
    fontWeight: '700',
  },
  sheetSubtitle: {
    fontSize: scaleFont(12),
    marginTop: 2,
  },
  backBtn: {
    padding: 8,
    marginRight: 4,
  },
  closeBtn: {
    padding: 8,
  },
  typeTabs: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 12,
    gap: 10,
  },
  typeTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(148, 163, 184, 0.1)',
  },
  typeTabText: {
    fontWeight: '600',
    fontSize: scaleFont(14),
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: scaleFont(14),
  },
  targetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  targetName: {
    fontSize: scaleFont(15),
    fontWeight: '600',
  },
  targetSub: {
    fontSize: scaleFont(12),
    marginTop: 2,
  },
  avatarBox: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: {
    fontSize: scaleFont(18),
    fontWeight: '700',
  },
  emptyView: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: scaleFont(14),
  },
  subHeading: {
    fontSize: scaleFont(13),
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  receiverBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
  },
  bannerPayLabel: {
    fontSize: scaleFont(11),
    fontWeight: '500',
  },
  bannerReceiverName: {
    fontSize: scaleFont(16),
    fontWeight: '700',
    marginTop: 1,
  },
  bannerTripTag: {
    fontSize: scaleFont(12),
    fontWeight: '600',
    marginTop: 2,
  },
  fieldLabel: {
    fontSize: scaleFont(13),
    fontWeight: '600',
    marginBottom: 8,
  },
  methodCardsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  methodCard: {
    flex: 1,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    position: 'relative',
  },
  methodIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  methodTitle: {
    fontSize: scaleFont(15),
    fontWeight: '700',
  },
  methodSub: {
    fontSize: scaleFont(11),
    marginTop: 2,
  },
  methodCheck: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  amountInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  currencyPrefix: {
    fontSize: scaleFont(24),
    fontWeight: '700',
    marginRight: 6,
  },
  amountInput: {
    flex: 1,
    fontSize: scaleFont(22),
    fontWeight: '700',
  },
  quickChipsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  quickChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  quickChipText: {
    fontSize: scaleFont(13),
    fontWeight: '600',
  },
  noteInput: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    fontSize: scaleFont(14),
  },
  uploadBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  uploadBoxText: {
    fontSize: scaleFont(14),
    fontWeight: '600',
  },
  screenshotPreviewContainer: {
    position: 'relative',
    width: 120,
    height: 120,
    borderRadius: 12,
    overflow: 'hidden',
  },
  screenshotThumbnail: {
    width: '100%',
    height: '100%',
  },
  removeScreenshotBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
  },
  submitBtn: {
    marginTop: 24,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: scaleFont(15),
    fontWeight: '700',
  },
});
