import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Keyboard,
  Switch,
  Alert,
  Platform,
  Image,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useTripStore, findMyMember } from '../../../src/features/trips/useTripStore';
import { useAuthStore } from '../../../src/features/auth/useAuthStore';
import { PaymentMode, SplitType, TripMember } from '../../../src/types/database';
import { theme } from '../../../src/theme/colors';
import { useTheme } from '../../../src/theme/useThemeStore';
import { getCurrencyInfo } from '../../../src/services/currency';
import { extractPaymentFromScreenshot } from '../../../src/services/receiptOcr';

const CATEGORIES = ['Food', 'Stay', 'Fuel', 'Tickets', 'Groceries', 'General'];

export default function AddExpenseScreen() {
  const {
    id,
    expenseId,
    prefillAmount,
    prefillDescription,
    prefillCategory,
    prefillReceiver,
    upiTxnId: paramUpiTxnId,
    paymentApp: paramPaymentApp,
    attachmentUri: paramAttachmentUri,
  } = useLocalSearchParams<{
    id: string;
    expenseId?: string;
    prefillAmount?: string;
    prefillDescription?: string;
    prefillCategory?: string;
    prefillReceiver?: string;
    upiTxnId?: string;
    paymentApp?: string;
    attachmentUri?: string;
    fromShare?: string;
  }>();

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, profile } = useAuthStore();
  const currentUserPhone =
    profile?.phone_number || (user as any)?.phone || (user as any)?.user_metadata?.phone_number;
  const { trips, members: rawMembers, expenses, addExpense, updateExpense, loadTripDetails } = useTripStore();
  const { colors, isDark } = useTheme();

  const [localTripMembers, setLocalTripMembers] = useState<TripMember[]>([]);

  React.useEffect(() => {
    if (id) {
      const { AppStorage } = require('../../../src/lib/storage');
      AppStorage.getItem(`@splityourtrip_local_details_${id}`).then((raw: string | null) => {
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed.members) && parsed.members.length > 0) {
              setLocalTripMembers(parsed.members);
            }
          } catch {}
        }
      });
      loadTripDetails(id);
    }
  }, [id]);

  // Only use members belonging to THIS trip so stale members from a previous trip are never selected
  const members = React.useMemo(() => {
    const fromStore = rawMembers.filter(m => m.trip_id === id);
    if (fromStore.length > 0) return fromStore;
    return localTripMembers;
  }, [rawMembers, localTripMembers, id]);

  const currentTrip = trips.find(t => t.id === id);
  const currencyInfo = getCurrencyInfo(currentTrip?.currency);

  const existingExpense = expenseId ? expenses.find(e => e.id === expenseId) : null;

  const [amountRupees, setAmountRupees] = useState(
    existingExpense
      ? (existingExpense.amount / 100).toString()
      : prefillAmount || ''
  );
  const [description, setDescription] = useState(
    existingExpense?.description || prefillDescription || ''
  );
  const [category, setCategory] = useState(
    existingExpense?.category || prefillCategory || 'Food'
  );
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(
    (existingExpense?.payment_mode as PaymentMode) || (paramPaymentApp || paramUpiTxnId ? 'upi' : 'upi')
  );
  const [upiTxnId, setUpiTxnId] = useState<string>(
    (existingExpense as any)?.upi_txn_id || paramUpiTxnId || ''
  );
  const [detectedApp, setDetectedApp] = useState<string | null>(paramPaymentApp || null);
  const [isScanningReceipt, setIsScanningReceipt] = useState(false);

  const [splitType, setSplitType] = useState<SplitType>(
    (existingExpense?.split_type as SplitType) || 'equal'
  );
  const [paidBy, setPaidBy] = useState<string>(
    existingExpense?.paid_by || members[0]?.id || ''
  );
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>(() => {
    if (existingExpense?.splits && existingExpense.splits.length > 0) {
      const pIds = existingExpense.splits
        .map(s => {
          const m = members.find(
            mem => (s.member_id && mem.id === s.member_id) || (s.profile_id && mem.profile_id === s.profile_id)
          );
          return m?.id || s.member_id || s.profile_id;
        })
        .filter(Boolean) as string[];
      if (pIds.length > 0) return pIds;
    }
    return members.map(m => m.id);
  });
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>(() => {
    if (existingExpense?.splits && existingExpense.splits.length > 0) {
      const savedCustom: Record<string, string> = {};
      existingExpense.splits.forEach(s => {
        const m = members.find(
          mem => (s.member_id && mem.id === s.member_id) || (s.profile_id && mem.profile_id === s.profile_id)
        );
        const mId = m?.id || s.member_id || s.profile_id;
        if (mId) {
          const amt = Number(s.amount !== undefined ? s.amount : s.share_amount) || 0;
          savedCustom[mId] = (amt / 100).toString();
        }
      });
      return savedCustom;
    }
    return {};
  });
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Location attachment state (default: turned off)
  const [useLocation, setUseLocation] = useState(false);
  const [locationName, setLocationName] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [fetchingLocation, setFetchingLocation] = useState(false);

  // Ticket / Receipt / Document attachment state
  const [attachmentUri, setAttachmentUri] = useState<string | null>(
    existingExpense?.attachment_url || paramAttachmentUri || null
  );
  const [attachmentName, setAttachmentName] = useState<string | null>(
    existingExpense?.attachment_name ||
      (paramAttachmentUri
        ? `Payment_Screenshot_${(paramPaymentApp || 'upi').replace(/[^a-zA-Z0-9]/g, '')}.jpg`
        : null)
  );
  const [attachmentType, setAttachmentType] = useState<'image' | 'pdf' | 'doc' | null>(
    (existingExpense?.attachment_type as any) || (paramAttachmentUri ? 'image' : null)
  );

  const handleScanReceipt = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission Denied', 'Please allow camera roll access to scan a payment screenshot.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1.0,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const pickedUri = result.assets[0].uri;
        setIsScanningReceipt(true);
        setAttachmentUri(pickedUri);
        setAttachmentType('image');

        const { parsed } = await extractPaymentFromScreenshot(pickedUri);
        if (parsed.amountPaise) {
          const rupees = parsed.amountPaise / 100;
          setAmountRupees(rupees % 1 === 0 ? rupees.toString() : rupees.toFixed(2));
        }
        if (parsed.receiverName) {
          setDescription(`Payment to ${parsed.receiverName}`);
        }
        if (parsed.suggestedCategory) {
          setCategory(parsed.suggestedCategory);
        }
        if (parsed.upiTxnId) {
          setUpiTxnId(parsed.upiTxnId);
        }
        setPaymentMode('upi');
        setDetectedApp(parsed.app);
        setAttachmentName(`Payment_Screenshot_${(parsed.app || 'upi').replace(/[^a-zA-Z0-9]/g, '')}.jpg`);
      }
    } catch (err: any) {
      Alert.alert('Scan Error', err?.message || 'Could not scan receipt.');
    } finally {
      setIsScanningReceipt(false);
    }
  };

  const handlePickImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission Denied', 'Please allow camera roll access to attach photos or receipts.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.8,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setAttachmentUri(asset.uri);
        setAttachmentName(asset.fileName || 'Receipt Photo.jpg');
        setAttachmentType('image');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not pick photo');
    }
  };

  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'image/*'],
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        setAttachmentUri(file.uri);
        setAttachmentName(file.name || 'Document.pdf');
        const isPdf = file.name?.toLowerCase().endsWith('.pdf') || file.mimeType?.includes('pdf');
        setAttachmentType(isPdf ? 'pdf' : file.mimeType?.startsWith('image') ? 'image' : 'doc');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not pick document');
    }
  };

  const handleRemoveAttachment = () => {
    setAttachmentUri(null);
    setAttachmentName(null);
    setAttachmentType(null);
  };

  React.useEffect(() => {
    if (id) {
      loadTripDetails(id);
    }
  }, [id]);

  React.useEffect(() => {
    if (existingExpense) {
      setAmountRupees((existingExpense.amount / 100).toString());
      setDescription(existingExpense.description);
      setCategory(existingExpense.category || 'Food');
      setPaymentMode((existingExpense.payment_mode as PaymentMode) || 'upi');
      setSplitType((existingExpense.split_type as SplitType) || 'equal');
      if (existingExpense.paid_by) setPaidBy(existingExpense.paid_by);
      if (existingExpense.attachment_url) {
        setAttachmentUri(existingExpense.attachment_url);
        setAttachmentName(existingExpense.attachment_name || 'Attached File');
        setAttachmentType((existingExpense.attachment_type as any) || 'image');
      }
      if (existingExpense.splits && existingExpense.splits.length > 0) {
        const validParticipants: string[] = [];
        const savedCustom: Record<string, string> = {};
        existingExpense.splits.forEach(s => {
          const m = members.find(
            mem => (s.member_id && mem.id === s.member_id) || (s.profile_id && mem.profile_id === s.profile_id)
          );
          const mId = m?.id || s.member_id || s.profile_id;
          if (mId) {
            validParticipants.push(mId);
            const amt = Number(s.amount !== undefined ? s.amount : s.share_amount) || 0;
            savedCustom[mId] = (amt / 100).toString();
          }
        });
        if (validParticipants.length > 0) {
          setSelectedParticipants(validParticipants);
        }
        setCustomAmounts(savedCustom);
      }
      if (existingExpense.location) {
        setUseLocation(true);
        setLocationName(existingExpense.location);
        if (existingExpense.latitude && existingExpense.longitude) {
          setCoords({
            latitude: existingExpense.latitude,
            longitude: existingExpense.longitude,
          });
        }
      }
    }
  }, [expenseId]);

  React.useEffect(() => {
    if (members.length > 0 && !existingExpense) {
      if (!paidBy || !members.some(m => m.id === paidBy)) {
        const myMember = findMyMember(members, user?.id, currentUserPhone) || members[0];
        setPaidBy(myMember.id);
      }
      if (
        selectedParticipants.length === 0 ||
        !selectedParticipants.every(pId => members.some(m => m.id === pId))
      ) {
        setSelectedParticipants(members.map(m => m.id));
      }
    }
  }, [members, id, existingExpense]);

  const toggleParticipant = (memberId: string) => {
    if (selectedParticipants.includes(memberId)) {
      if (selectedParticipants.length === 1) {
        setErrorMsg('At least one participant must be included in the split');
        return;
      }
      setSelectedParticipants(selectedParticipants.filter(pId => pId !== memberId));
    } else {
      setSelectedParticipants([...selectedParticipants, memberId]);
    }
  };

  // Helper calculation for custom splits
  const parsedTotal = parseFloat(amountRupees) || 0;
  const totalAllocatedCustom = selectedParticipants.reduce((sum, memberId) => {
    const amt = parseFloat(customAmounts[memberId] || '0');
    return sum + (isNaN(amt) ? 0 : amt);
  }, 0);
  const remainingCustom = Math.round((parsedTotal - totalAllocatedCustom) * 100) / 100;
  const isCustomBalanced = Math.abs(remainingCustom) <= 0.05;

  const handleAutoDistributeRemaining = () => {
    if (selectedParticipants.length === 0 || parsedTotal <= 0) return;
    const count = selectedParticipants.length;
    const baseShare = Math.floor((parsedTotal / count) * 100) / 100;
    const remainder = Math.round((parsedTotal - baseShare * count) * 100) / 100;

    const newAmounts: Record<string, string> = {};
    selectedParticipants.forEach((mId, idx) => {
      const share = idx === 0 ? baseShare + remainder : baseShare;
      newAmounts[mId] = share.toFixed(2);
    });
    setCustomAmounts(newAmounts);
  };

  const handleCustomAmountChange = (memberId: string, val: string) => {
    // Only allow numbers and decimal point
    const cleaned = val.replace(/[^0-9.]/g, '');
    setCustomAmounts(prev => ({
      ...prev,
      [memberId]: cleaned,
    }));
  };

  const handleSaveExpense = async () => {
    const floatAmount = parseFloat(amountRupees);
    if (isNaN(floatAmount) || floatAmount <= 0) {
      setErrorMsg('Please enter a valid amount');
      return;
    }
    if (!description.trim()) {
      setErrorMsg('Please enter a description');
      return;
    }
    let targetPaidBy = paidBy;
    let targetParticipants = selectedParticipants;

    // Auto-resolve paidBy if empty
    if (!targetPaidBy && members.length > 0) {
      const myMember = findMyMember(members, user?.id, currentUserPhone) || members[0];
      targetPaidBy = myMember?.id || '';
    }

    // Auto-resolve selectedParticipants if empty
    if (targetParticipants.length === 0 && members.length > 0) {
      targetParticipants = members.map(m => m.id);
    }

    if (!targetPaidBy) {
      setErrorMsg('Please select who paid for this expense');
      return;
    }
    if (targetParticipants.length === 0) {
      setErrorMsg('Please select at least one participant');
      return;
    }

    const activeUserId = user?.id || 'local_user';

    const amountPaise = Math.round(floatAmount * 100);

    // Validate custom split if selected
    let computedCustomSplits: Array<{ memberId: string; shareAmount: number }> | undefined = undefined;
    if (splitType === 'custom') {
      if (!isCustomBalanced) {
        setErrorMsg(
          `The custom split total (${currencyInfo.symbol}${totalAllocatedCustom.toFixed(2)}) must equal total expense (${currencyInfo.symbol}${floatAmount.toFixed(2)}). Difference: ${currencyInfo.symbol}${Math.abs(remainingCustom).toFixed(2)}`
        );
        return;
      }
      computedCustomSplits = targetParticipants.map(memberId => ({
        memberId,
        shareAmount: Math.round((parseFloat(customAmounts[memberId] || '0') || 0) * 100),
      }));
    }

    Keyboard.dismiss();
    setSaving(true);
    setErrorMsg(null);

    let success = false;
    if (expenseId) {
      success = await updateExpense({
        tripId: id as string,
        expenseId,
        amountPaise,
        description: description.trim(),
        category,
        paidByMemberId: targetPaidBy,
        paymentMode,
        splitType,
        participantMemberIds: targetParticipants,
        customSplits: computedCustomSplits,
        location: useLocation ? locationName : null,
        latitude: useLocation ? coords?.latitude : null,
        longitude: useLocation ? coords?.longitude : null,
        attachmentUrl: attachmentUri,
        attachmentName: attachmentName,
        attachmentType: attachmentType,
        userId: activeUserId,
        editorName:
          profile?.full_name || profile?.name || user?.email?.split('@')[0] || 'You',
      });
    } else {
      success = await addExpense({
        tripId: id as string,
        paidByMemberId: targetPaidBy,
        amountPaise,
        description: description.trim(),
        category,
        paymentMode,
        splitType,
        participantMemberIds: targetParticipants,
        customSplits: computedCustomSplits,
        location: useLocation ? locationName : null,
        latitude: useLocation ? coords?.latitude : null,
        longitude: useLocation ? coords?.longitude : null,
        attachmentUrl: attachmentUri,
        attachmentName: attachmentName,
        attachmentType: attachmentType,
        upiTxnId: upiTxnId || undefined,
        userId: activeUserId,
      });
    }

    setSaving(false);
    if (success) {
      setTimeout(() => {
        const trip = currentTrip || trips.find(t => t.id === id);
        const isSingleSplit =
          trip?.trip_type === 'friend_split' ||
          trip?.name?.toLowerCase().startsWith('split with ');

        if (isSingleSplit) {
          const otherMember =
            members.find(m => !user?.id || (m.profile_id !== user.id && m.user_id !== user.id)) ||
            members.find(m => m.role !== 'admin') ||
            members[0];

          const friendDisplayName =
            otherMember?.display_name ||
            (trip?.name ? trip.name.replace(/^split with\s+/i, '').trim() : prefillReceiver || 'Friend');

          router.replace({
            pathname: '/chat/[id]',
            params: {
              id: id as string,
              friendName: friendDisplayName,
              friendPhone: otherMember?.phone_number || '',
              friendId: otherMember?.id || trip?.friend_id,
            },
          });
        } else {
          // Group trip chat / details
          router.replace(`/trip/${id}`);
        }
      }, 80);
    } else {
      setErrorMsg('Failed to save expense. Please try again.');
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 24) + 120 }]}
        automaticallyAdjustKeyboardInsets={true}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
      <Stack.Screen options={{ title: expenseId ? 'Edit Expense' : 'Add Expense' }} />

      {errorMsg && (
        <View style={[styles.errorBanner, { backgroundColor: colors.dangerBg }]}>
          <Text style={[styles.errorText, { color: colors.danger }]}>{errorMsg}</Text>
        </View>
      )}

      {/* Auto-detected Receipt Banner if Scanned */}
      {attachmentUri && (detectedApp || paramPaymentApp || upiTxnId) && (
        <View
          style={[
            styles.ocrBannerCard,
            {
              backgroundColor: isDark ? 'rgba(99, 102, 241, 0.15)' : '#EEF2FF',
              borderColor: isDark ? 'rgba(99, 102, 241, 0.4)' : '#C7D2FE',
            },
          ]}
        >
          <View style={styles.ocrBannerLeft}>
            <Image source={{ uri: attachmentUri }} style={styles.ocrThumb} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="sparkles" size={14} color={colors.primary} />
                <Text style={[styles.ocrBadgeTitle, { color: colors.primary }]}>
                  Payment Screenshot Linked
                </Text>
              </View>
              {prefillReceiver ? (
                <Text style={[styles.ocrReceiverText, { color: colors.text }]} numberOfLines={1}>
                  Paid to {prefillReceiver}
                </Text>
              ) : null}
              {upiTxnId ? (
                <Text style={[styles.ocrUpiText, { color: colors.textSecondary }]} numberOfLines={1}>
                  UPI Ref: {upiTxnId}
                </Text>
              ) : null}
            </View>
          </View>
        </View>
      )}

      {/* Quick Button to Scan a Payment Screenshot directly */}
      {!expenseId && (
        <TouchableOpacity
          style={[
            styles.quickOcrBtn,
            {
              backgroundColor: isDark ? 'rgba(234, 179, 8, 0.12)' : '#FEFCE8',
              borderColor: isDark ? 'rgba(234, 179, 8, 0.4)' : '#FEF08A',
            },
          ]}
          onPress={handleScanReceipt}
          disabled={isScanningReceipt}
        >
          {isScanningReceipt ? (
            <ActivityIndicator size="small" color="#D97706" />
          ) : (
            <Ionicons name="sparkles" size={18} color="#D97706" />
          )}
          <Text style={styles.quickOcrBtnText}>
            {isScanningReceipt ? 'Scanning with AI OCR...' : 'Auto-fill from Payment Screenshot'}
          </Text>
        </TouchableOpacity>
      )}

      {/* Amount Input */}
      <View
        style={[
          styles.amountCard,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.currencySymbol, { color: colors.primary }]}>{currencyInfo.symbol}</Text>
        <TextInput
          style={[styles.amountInput, { color: colors.text }]}
          placeholder="0.00"
          placeholderTextColor={colors.textMuted}
          keyboardType="numeric"
          value={amountRupees}
          onChangeText={val => {
            setAmountRupees(val);
            if (splitType === 'custom' && selectedParticipants.length > 0) {
              const num = parseFloat(val) || 0;
              const per = (num / selectedParticipants.length).toFixed(2);
              const autoMap: Record<string, string> = {};
              selectedParticipants.forEach(pId => {
                autoMap[pId] = per;
              });
              setCustomAmounts(autoMap);
            }
          }}
        />
      </View>

      {/* Description */}
      <View style={styles.fieldGroup}>
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Description</Text>
        <TextInput
          style={[
            styles.textInput,
            {
              backgroundColor: colors.inputBackground,
              borderColor: colors.border,
              color: colors.text,
            },
          ]}
          placeholder="e.g. Dinner, Drinks, Fuel, Hotel"
          placeholderTextColor={colors.textMuted}
          value={description}
          onChangeText={setDescription}
        />
      </View>

      {/* Category Chips */}
      <View style={styles.fieldGroup}>
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Category</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
          {CATEGORIES.map(cat => (
            <TouchableOpacity
              key={cat}
              style={[
                styles.chip,
                {
                  backgroundColor: category === cat ? colors.primaryLight : colors.card,
                  borderColor: category === cat ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setCategory(cat)}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: category === cat ? colors.primary : colors.textSecondary },
                  category === cat && styles.chipTextActive,
                ]}
              >
                {cat}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Payment Mode */}
      <View style={styles.fieldGroup}>
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Payment Mode</Text>
        <View
          style={[
            styles.modeToggle,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          {(['upi', 'cash', 'other'] as PaymentMode[]).map(mode => (
            <TouchableOpacity
              key={mode}
              style={[
                styles.modeBtn,
                paymentMode === mode && [styles.modeBtnActive, { backgroundColor: colors.primary }],
              ]}
              onPress={() => setPaymentMode(mode)}
            >
              <Text
                style={[
                  styles.modeBtnText,
                  { color: paymentMode === mode ? '#FFFFFF' : colors.textSecondary },
                  paymentMode === mode && styles.modeBtnTextActive,
                ]}
              >
                {mode.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Payer Selection */}
      <View style={styles.fieldGroup}>
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Who Paid?</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
          {members.map(m => (
            <TouchableOpacity
              key={m.id}
              style={[
                styles.payerChip,
                {
                  backgroundColor: paidBy === m.id ? colors.primary : colors.card,
                  borderColor: paidBy === m.id ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setPaidBy(m.id)}
            >
              <Text
                style={[
                  styles.payerText,
                  { color: paidBy === m.id ? '#FFFFFF' : colors.text },
                  paidBy === m.id && styles.payerTextActive,
                ]}
              >
                {m.display_name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Location Option Card (Default Off - asks permission when turned on) */}
      <View style={styles.fieldGroup}>
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Location</Text>
        <View
          style={[
            styles.locationCard,
            {
              backgroundColor: colors.card,
              borderColor: useLocation ? colors.primary : colors.border,
            },
          ]}
        >
          <View style={styles.locationTopRow}>
            <View style={[styles.locationIconBox, { backgroundColor: colors.primaryLight }]}>
              <Ionicons name="location" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1, marginRight: 10 }}>
              <Text style={[styles.locationTitle, { color: colors.text }]}>Use this location</Text>
              <Text style={[styles.locationSubtitle, { color: colors.textSecondary }]}>
                {fetchingLocation
                  ? 'Detecting current location...'
                  : useLocation && locationName
                  ? locationName
                  : 'Tag this expense with your current location'}
              </Text>
            </View>
            {fetchingLocation ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Switch
                value={useLocation}
                onValueChange={async (val: boolean) => {
                  if (!val) {
                    setUseLocation(false);
                    setLocationName(null);
                    setCoords(null);
                    return;
                  }

                  setFetchingLocation(true);
                  try {
                    const { status } = await Location.requestForegroundPermissionsAsync();
                    if (status !== 'granted') {
                      Alert.alert(
                        'Location Permission Required',
                        'Please allow location access to tag where this expense occurred.'
                      );
                      setUseLocation(false);
                      setFetchingLocation(false);
                      return;
                    }

                    setUseLocation(true);
                    const loc = await Location.getCurrentPositionAsync({
                      accuracy: Location.Accuracy.Balanced,
                    });

                    const lat = loc.coords.latitude;
                    const lng = loc.coords.longitude;
                    setCoords({ latitude: lat, longitude: lng });

                    try {
                      const reverse = await Location.reverseGeocodeAsync({
                        latitude: lat,
                        longitude: lng,
                      });
                      if (reverse && reverse.length > 0) {
                        const item = reverse[0];
                        const parts = [
                          item.name || item.street,
                          item.district || item.subregion || item.city,
                          item.region || item.country,
                        ].filter(Boolean);
                        setLocationName(
                          parts.length > 0
                            ? parts.join(', ')
                            : `${lat.toFixed(4)}, ${lng.toFixed(4)}`
                        );
                      } else {
                        setLocationName(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
                      }
                    } catch {
                      setLocationName(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
                    }
                  } catch (err: any) {
                    Alert.alert('Location Error', err?.message || 'Could not fetch current location.');
                    setUseLocation(false);
                  } finally {
                    setFetchingLocation(false);
                  }
                }}
                trackColor={{ false: isDark ? '#334155' : '#CBD5E1', true: colors.primary }}
                thumbColor={Platform.OS === 'android' ? '#FFFFFF' : undefined}
              />
            )}
          </View>

          {useLocation && locationName && (
            <View
              style={[
                styles.locationChip,
                { backgroundColor: colors.inputBackground, borderColor: colors.borderLight },
              ]}
            >
              <Ionicons name="navigate-circle" size={15} color={colors.primary} />
              <Text style={[styles.locationChipText, { color: colors.text }]} numberOfLines={1}>
                {locationName}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Attach Ticket, Receipt or Document */}
      <View style={styles.fieldGroup}>
        <View style={styles.labelWithHint}>
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
            Attach Bill, Ticket or Document
          </Text>
          <Text style={[styles.hintText, { color: colors.textMuted }]}>Optional</Text>
        </View>

        {attachmentUri ? (
          <View
            style={[
              styles.attachmentPreviewCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            {attachmentType === 'image' ? (
              <Image source={{ uri: attachmentUri }} style={styles.attachmentThumbImage} />
            ) : (
              <View style={[styles.attachmentDocIcon, { backgroundColor: colors.dangerBg }]}>
                <Ionicons
                  name={attachmentType === 'pdf' ? 'document-text' : 'document-attach'}
                  size={24}
                  color={colors.danger}
                />
              </View>
            )}

            <View style={styles.attachmentInfoCol}>
              <Text style={[styles.attachmentNameText, { color: colors.text }]} numberOfLines={1}>
                {attachmentName || 'Attached Document'}
              </Text>
              <Text style={[styles.attachmentSubText, { color: colors.textMuted }]}>
                {attachmentType === 'image'
                  ? 'Photo / Receipt'
                  : attachmentType === 'pdf'
                  ? 'PDF Ticket / Document'
                  : 'Document file'}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.attachmentRemoveBtn}
              onPress={handleRemoveAttachment}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={22} color={colors.danger} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.attachmentBtnRow}>
            <TouchableOpacity
              style={[
                styles.attachmentActionBtn,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
              onPress={handlePickImage}
            >
              <View style={[styles.attachIconCircle, { backgroundColor: colors.primaryLight }]}>
                <Ionicons name="camera" size={18} color={colors.primary} />
              </View>
              <Text style={[styles.attachmentActionBtnText, { color: colors.text }]}>
                Receipt Photo
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.attachmentActionBtn,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
              onPress={handlePickDocument}
            >
              <View style={[styles.attachIconCircle, { backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : '#FEE2E2' }]}>
                <Ionicons name="document-attach" size={18} color={colors.danger} />
              </View>
              <Text style={[styles.attachmentActionBtnText, { color: colors.text }]}>
                PDF / Ticket
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Split Mode Selector (Equal vs Custom Split) */}
      <View style={styles.fieldGroup}>
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Split Method</Text>
        <View
          style={[
            styles.modeToggle,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <TouchableOpacity
            style={[
              styles.modeBtn,
              splitType === 'equal' && [styles.modeBtnActive, { backgroundColor: colors.primary }],
            ]}
            onPress={() => setSplitType('equal')}
          >
            <Ionicons
              name="git-compare-outline"
              size={15}
              color={splitType === 'equal' ? '#FFFFFF' : colors.textSecondary}
              style={{ marginRight: 6 }}
            />
            <Text
              style={[
                styles.modeBtnText,
                { color: splitType === 'equal' ? '#FFFFFF' : colors.textSecondary },
                splitType === 'equal' && styles.modeBtnTextActive,
              ]}
            >
              Split Equally
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.modeBtn,
              splitType === 'custom' && [styles.modeBtnActive, { backgroundColor: colors.primary }],
            ]}
            onPress={() => {
              setSplitType('custom');
              if (parsedTotal > 0 && selectedParticipants.length > 0) {
                const perPerson = (parsedTotal / selectedParticipants.length).toFixed(2);
                const newAmounts: Record<string, string> = {};
                selectedParticipants.forEach(pId => {
                  newAmounts[pId] = customAmounts[pId] || perPerson;
                });
                setCustomAmounts(newAmounts);
              }
            }}
          >
            <Ionicons
              name="calculator-outline"
              size={15}
              color={splitType === 'custom' ? '#FFFFFF' : colors.textSecondary}
              style={{ marginRight: 6 }}
            />
            <Text
              style={[
                styles.modeBtnText,
                { color: splitType === 'custom' ? '#FFFFFF' : colors.textSecondary },
                splitType === 'custom' && styles.modeBtnTextActive,
              ]}
            >
              Custom Amounts
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Split Among Selection */}
      <View style={styles.fieldGroup}>
        <View style={styles.splitHeader}>
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
            Split Among ({selectedParticipants.length} people)
          </Text>
          <TouchableOpacity
            onPress={() => {
              if (selectedParticipants.length === members.length) {
                setSelectedParticipants([members[0]?.id || '']);
              } else {
                setSelectedParticipants(members.map(m => m.id));
              }
            }}
          >
            <Text style={[styles.selectAllText, { color: colors.primary }]}>
              {selectedParticipants.length === members.length ? 'Clear' : 'Select All'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Custom Split Helper & Live Allocation Status */}
        {splitType === 'custom' && (
          <View
            style={[
              styles.customSummaryBox,
              {
                backgroundColor: isCustomBalanced
                  ? colors.successBg
                  : isDark
                  ? 'rgba(239, 68, 68, 0.12)'
                  : '#FFF1F2',
                borderColor: isCustomBalanced ? colors.success : colors.danger,
              },
            ]}
          >
            <View style={styles.customSummaryRow}>
              <Ionicons
                name={isCustomBalanced ? 'checkmark-circle' : 'alert-circle'}
                size={18}
                color={isCustomBalanced ? colors.success : colors.danger}
              />
              <Text
                style={[
                  styles.customSummaryText,
                  { color: isCustomBalanced ? colors.success : colors.danger },
                ]}
              >
                {isCustomBalanced
                  ? `✓ All ${currencyInfo.symbol}${parsedTotal.toFixed(2)} allocated accurately`
                  : remainingCustom > 0
                  ? `${currencyInfo.symbol}${remainingCustom.toFixed(2)} remaining to allocate`
                  : `${currencyInfo.symbol}${Math.abs(remainingCustom).toFixed(2)} over total expense`}
              </Text>
            </View>

            {!isCustomBalanced && parsedTotal > 0 && (
              <TouchableOpacity
                style={[styles.autoDistributeBtn, { backgroundColor: colors.primary }]}
                onPress={handleAutoDistributeRemaining}
              >
                <Text style={styles.autoDistributeText}>Distribute Remaining Evenly</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <View
          style={[
            styles.participantsList,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          {members.map(m => {
            const isSelected = selectedParticipants.includes(m.id);
            const equalShare =
              isSelected && selectedParticipants.length > 0 && parsedTotal > 0
                ? (parsedTotal / selectedParticipants.length).toFixed(2)
                : '0.00';

            return (
              <View
                key={m.id}
                style={[
                  styles.participantRow,
                  { borderBottomColor: colors.borderLight },
                  isSelected && {
                    backgroundColor: isDark ? 'rgba(99, 102, 241, 0.12)' : '#FAFBFF',
                  },
                ]}
              >
                <TouchableOpacity
                  style={styles.participantSelectArea}
                  onPress={() => toggleParticipant(m.id)}
                >
                  <Ionicons
                    name={isSelected ? 'checkbox' : 'square-outline'}
                    size={20}
                    color={isSelected ? colors.primary : colors.textMuted}
                  />
                  <Text style={[styles.participantName, { color: colors.text }]}>
                    {m.display_name}
                  </Text>
                  {m.is_guest && (
                    <Text
                      style={[
                        styles.guestTag,
                        {
                          backgroundColor: colors.borderLight,
                          color: colors.textMuted,
                        },
                      ]}
                    >
                      Guest
                    </Text>
                  )}
                </TouchableOpacity>

                {/* Display either Equal Share or Custom Amount Input */}
                {isSelected && (
                  <View style={styles.shareContainer}>
                    {splitType === 'equal' ? (
                      <Text style={[styles.equalShareText, { color: colors.textSecondary }]}>
                        {currencyInfo.symbol}{equalShare}
                      </Text>
                    ) : (
                      <View
                        style={[
                          styles.customInputContainer,
                          {
                            backgroundColor: colors.inputBackground,
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <Text style={[styles.customCurrencyPrefix, { color: colors.primary }]}>
                          {currencyInfo.symbol}
                        </Text>
                        <TextInput
                          style={[styles.customShareInput, { color: colors.text }]}
                          placeholder="0.00"
                          placeholderTextColor={colors.textMuted}
                          keyboardType="decimal-pad"
                          value={customAmounts[m.id] ?? ''}
                          onChangeText={val => handleCustomAmountChange(m.id, val)}
                        />
                      </View>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </View>

      {/* Save Button */}
      <TouchableOpacity
        style={[
          styles.saveBtn,
          { backgroundColor: colors.primary },
          saving && styles.btnDisabled,
        ]}
        onPress={handleSaveExpense}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.saveBtnText}>
            {expenseId ? 'Update Expense' : 'Save Expense'}
          </Text>
        )}
      </TouchableOpacity>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: theme.spacing.md,
  },
  errorBanner: {
    backgroundColor: theme.colors.dangerBg,
    borderRadius: theme.borderRadius.sm,
    padding: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  errorText: {
    color: theme.colors.danger,
    fontSize: 13,
    fontWeight: '600',
  },
  amountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  currencySymbol: {
    fontSize: 32,
    fontWeight: '700',
    color: theme.colors.primary,
    marginRight: 6,
  },
  amountInput: {
    fontSize: 36,
    fontWeight: '800',
    color: theme.colors.text,
    minWidth: 120,
  },
  fieldGroup: {
    marginBottom: theme.spacing.md,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  chipsScroll: {
    flexDirection: 'row',
  },
  chip: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: theme.borderRadius.full,
    marginRight: 8,
  },
  chipActive: {
    backgroundColor: theme.colors.primaryLight,
    borderColor: theme.colors.primary,
  },
  chipText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    fontWeight: '600',
  },
  chipTextActive: {
    color: theme.colors.primary,
    fontWeight: '700',
  },
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 4,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: theme.borderRadius.sm,
  },
  modeBtnActive: {
    backgroundColor: theme.colors.primary,
  },
  modeBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.textSecondary,
  },
  modeBtnTextActive: {
    color: '#FFFFFF',
  },
  payerChip: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: theme.borderRadius.full,
    marginRight: 8,
  },
  payerChipActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  payerText: {
    fontSize: 13,
    color: theme.colors.text,
    fontWeight: '600',
  },
  payerTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  splitHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  selectAllText: {
    fontSize: 12,
    color: theme.colors.primary,
    fontWeight: '700',
  },
  customSummaryBox: {
    padding: 10,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    marginBottom: 8,
  },
  customSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  customSummaryText: {
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  autoDistributeBtn: {
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  autoDistributeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  participantsList: {
    backgroundColor: '#FFFFFF',
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderLight,
  },
  participantSelectArea: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
  },
  participantName: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text,
  },
  guestTag: {
    fontSize: 11,
    color: theme.colors.textMuted,
    backgroundColor: theme.colors.borderLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  shareContainer: {
    marginLeft: 8,
    alignItems: 'flex-end',
  },
  equalShareText: {
    fontSize: 14,
    fontWeight: '600',
  },
  customInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    height: 36,
    width: 110,
  },
  customCurrencyPrefix: {
    fontSize: 13,
    fontWeight: '700',
    marginRight: 4,
  },
  customShareInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    paddingVertical: 0,
  },
  saveBtn: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.xl,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
  },
  locationCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  locationTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  locationTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  locationSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  locationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  locationChipText: {
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  labelWithHint: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  hintText: {
    fontSize: 12,
    fontWeight: '500',
  },
  attachmentBtnRow: {
    flexDirection: 'row',
    gap: 12,
  },
  attachmentActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
  },
  attachIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentActionBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  attachmentPreviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  attachmentThumbImage: {
    width: 48,
    height: 48,
    borderRadius: 8,
  },
  attachmentDocIcon: {
    width: 48,
    height: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentInfoCol: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  attachmentNameText: {
    fontSize: 14,
    fontWeight: '600',
  },
  attachmentSubText: {
    fontSize: 12,
    marginTop: 2,
  },
  attachmentRemoveBtn: {
    padding: 4,
  },
  ocrBannerCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 16,
  },
  ocrBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ocrThumb: {
    width: 44,
    height: 56,
    borderRadius: 6,
    backgroundColor: '#E2E8F0',
  },
  ocrBadgeTitle: {
    fontSize: 12,
    fontWeight: '700',
  },
  ocrReceiverText: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  ocrUpiText: {
    fontSize: 11,
    marginTop: 2,
  },
  quickOcrBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  quickOcrBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#D97706',
  },
});
