import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  Linking,
  Switch,
  Image,
  Modal,
  StatusBar,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import {
  useTripStore,
  normalizeExpensesForTrip,
  findMyMember,
} from '../../../../src/features/trips/useTripStore';
import { useAuthStore } from '../../../../src/features/auth/useAuthStore';
import { useTheme } from '../../../../src/theme/useThemeStore';
import { AppStorage } from '../../../../src/lib/storage';
import { formatCurrencyAmount, getCurrencyInfo } from '../../../../src/services/currency';
import { PaymentMode, SplitType, TripMember } from '../../../../src/types/database';

const PAGE_SIZE = 10;
const CATEGORIES = ['Food', 'Stay', 'Fuel', 'Tickets', 'Groceries', 'General'];

const CATEGORY_META: Record<string, { emoji: string; color: string; bg: string }> = {
  Food: { emoji: '🍕', color: '#F59E0B', bg: '#FEF3C7' },
  Stay: { emoji: '🏨', color: '#6366F1', bg: '#EEF2FF' },
  Fuel: { emoji: '⛽', color: '#EF4444', bg: '#FEE2E2' },
  Tickets: { emoji: '🎟️', color: '#8B5CF6', bg: '#F3E8FF' },
  Groceries: { emoji: '🛒', color: '#10B981', bg: '#ECFDF5' },
  General: { emoji: '🧾', color: '#3B82F6', bg: '#EFF6FF' },
};

export default function BillDetailScreen() {
  const { id: tripId, expenseId } = useLocalSearchParams<{ id: string; expenseId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { user, profile } = useAuthStore();
  const currentUserPhone =
    profile?.phone_number || (user as any)?.phone || (user as any)?.user_metadata?.phone_number;
  const {
    trips,
    members: storeMembers,
    expenses: storeExpenses,
    loadTripDetails,
    updateExpense,
    deleteExpense,
  } = useTripStore();

  const [localMembers, setLocalMembers] = useState<TripMember[]>([]);
  const [localExpenses, setLocalExpenses] = useState<any[]>([]);
  const [loadingBill, setLoadingBill] = useState(true);

  // Edit mode state (only available to creator of the expense)
  const [isEditing, setIsEditing] = useState(false);
  const [editDescription, setEditDescription] = useState('');
  const [editAmountRupees, setEditAmountRupees] = useState('');
  const [editCategory, setEditCategory] = useState('General');
  const [editPaymentMode, setEditPaymentMode] = useState<PaymentMode>('upi');
  const [editPaidBy, setEditPaidBy] = useState('');
  const [editSplitType, setEditSplitType] = useState<SplitType>('equal');
  const [editParticipants, setEditParticipants] = useState<string[]>([]);
  const [editCustomAmounts, setEditCustomAmounts] = useState<Record<string, string>>({});
  const [editUseLocation, setEditUseLocation] = useState(false);
  const [editLocationName, setEditLocationName] = useState<string | null>(null);
  const [editCoords, setEditCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [editFetchingLocation, setEditFetchingLocation] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Attachment state for editing
  const [editAttachmentUrl, setEditAttachmentUrl] = useState<string | null>(null);
  const [editAttachmentName, setEditAttachmentName] = useState<string | null>(null);
  const [editAttachmentType, setEditAttachmentType] = useState<'image' | 'pdf' | 'doc' | null>(null);
  const [selectedImagePreview, setSelectedImagePreview] = useState<string | null>(null);

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
        setEditAttachmentUrl(asset.uri);
        setEditAttachmentName(asset.fileName || 'Receipt Photo.jpg');
        setEditAttachmentType('image');
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
        setEditAttachmentUrl(file.uri);
        setEditAttachmentName(file.name || 'Document.pdf');
        const isPdf = file.name?.toLowerCase().endsWith('.pdf') || file.mimeType?.includes('pdf');
        setEditAttachmentType(isPdf ? 'pdf' : file.mimeType?.startsWith('image') ? 'image' : 'doc');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not pick document');
    }
  };

  const handleRemoveAttachment = () => {
    setEditAttachmentUrl(null);
    setEditAttachmentName(null);
    setEditAttachmentType(null);
  };

  const handleOpenAttachment = (url: string) => {
    Linking.openURL(url).catch(() => {
      Alert.alert('File', 'Unable to open file preview on this device.');
    });
  };

  // Pagination for split breakdown list (page size 10)
  const [splitsVisibleCount, setSplitsVisibleCount] = useState(PAGE_SIZE);
  const [loadingMoreSplits, setLoadingMoreSplits] = useState(false);

  const currentTrip = trips.find(t => t.id === tripId);
  const currencyCode = currentTrip?.currency || 'INR';
  const currencyInfo = getCurrencyInfo(currencyCode);

  const loadBillFromStorageAndStore = useCallback(async () => {
    if (!tripId) {
      setLoadingBill(false);
      return;
    }
    try {
      const raw = await AppStorage.getItem(`@splityourtrip_local_details_${tripId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        const mList: TripMember[] = Array.isArray(parsed.members) ? parsed.members : [];
        const eList: any[] = Array.isArray(parsed.expenses)
          ? normalizeExpensesForTrip(parsed.expenses, mList)
          : [];
        setLocalMembers(mList);
        setLocalExpenses(eList);
      }
    } catch {}
    setLoadingBill(false);
  }, [tripId]);

  useEffect(() => {
    loadBillFromStorageAndStore();
    if (tripId) {
      loadTripDetails(tripId);
    }
  }, [tripId, loadBillFromStorageAndStore]);

  // Combine store and local storage members & expenses for this trip
  const tripMembers = useMemo(() => {
    const fromStore = storeMembers.filter(m => m.trip_id === tripId);
    return fromStore.length >= localMembers.length ? fromStore : localMembers;
  }, [storeMembers, localMembers, tripId]);

  const tripExpenses = useMemo(() => {
    const fromStore = storeExpenses.filter(e => e.trip_id === tripId);
    const base = fromStore.length >= localExpenses.length ? fromStore : localExpenses;
    return normalizeExpensesForTrip(base, tripMembers);
  }, [storeExpenses, localExpenses, tripId, tripMembers]);

  const expense = useMemo(() => {
    return (
      tripExpenses.find(e => e.id === expenseId) ||
      storeExpenses.find(e => e.id === expenseId) ||
      localExpenses.find(e => e.id === expenseId)
    );
  }, [tripExpenses, storeExpenses, localExpenses, expenseId]);

  // Identify current user's member in this trip
  const myMember = useMemo(() => {
    return findMyMember(tripMembers, user?.id, currentUserPhone) || tripMembers[0];
  }, [tripMembers, user?.id, currentUserPhone]);

  // Determine if current user created this expense (only creator can edit; others view only)
  const canEdit = useMemo(() => {
    if (!expense) return false;
    const currentUserId = user?.id || 'local_user';
    if (myMember?.role === 'admin') return true;

    // If created_by is explicitly stored on the expense
    if (expense.created_by) {
      if (expense.created_by === currentUserId) return true;
      if (myMember && (expense.created_by === myMember.id || expense.created_by === myMember.profile_id)) {
        return true;
      }
    }

    // Fallback: check if paid_by matches current user's member
    if (myMember && (expense.paid_by === myMember.id || expense.paid_by === myMember.profile_id)) {
      return true;
    }
    if (user?.id && expense.paid_by === user.id) {
      return true;
    }
    return false;
  }, [expense, user?.id, myMember]);

  // Populate edit form fields when expense loads
  useEffect(() => {
    if (expense) {
      setEditDescription(expense.description || '');
      setEditAmountRupees(((Number(expense.amount) || 0) / 100).toString());
      setEditCategory(expense.category || 'General');
      setEditPaymentMode((expense.payment_mode as PaymentMode) || 'upi');
      setEditPaidBy(expense.paid_by || myMember?.id || '');
      setEditSplitType((expense.split_type as SplitType) || 'equal');

      const splits = Array.isArray(expense.splits) ? expense.splits : [];
      if (splits.length > 0) {
        setEditParticipants(splits.map((s: any) => s.member_id).filter(Boolean));
        const customMap: Record<string, string> = {};
        splits.forEach((s: any) => {
          if (s.member_id) {
            customMap[s.member_id] = ((Number(s.amount) || 0) / 100).toFixed(2);
          }
        });
        setEditCustomAmounts(customMap);
      } else {
        setEditParticipants(tripMembers.map(m => m.id));
      }

      if (expense.attachment_url) {
        setEditAttachmentUrl(expense.attachment_url);
        setEditAttachmentName(expense.attachment_name || 'Attached File');
        setEditAttachmentType((expense.attachment_type as any) || 'image');
      } else {
        setEditAttachmentUrl(null);
        setEditAttachmentName(null);
        setEditAttachmentType(null);
      }

      if (expense.location) {
        setEditUseLocation(true);
        setEditLocationName(expense.location);
        if (expense.latitude && expense.longitude) {
          setEditCoords({
            latitude: Number(expense.latitude),
            longitude: Number(expense.longitude),
          });
        }
      } else {
        setEditUseLocation(false);
        setEditLocationName(null);
        setEditCoords(null);
      }
    }
  }, [expense, myMember?.id, tripMembers]);

  const payerMember = useMemo(() => {
    if (!expense) return null;
    // 1. If explicit payerName exists, match member by display name
    if (expense.payerName) {
      const pLower = expense.payerName.trim().toLowerCase();
      const byName = tripMembers.find(m => m.display_name.trim().toLowerCase() === pLower);
      if (byName) return byName;
    }
    // 2. Direct ID match
    const byId = tripMembers.find(m => m.id === expense.paid_by);
    if (byId) return byId;
    // 3. Profile ID match
    return tripMembers.find(m => m.profile_id && m.profile_id === expense.paid_by) || null;
  }, [expense, tripMembers]);

  const creatorName = useMemo(() => {
    if (!expense) return 'Member';
    if (expense.created_by_name) return expense.created_by_name;
    const creatorMember = tripMembers.find(
      m =>
        expense.created_by &&
        (m.id === expense.created_by ||
          m.profile_id === expense.created_by ||
          m.user_id === expense.created_by)
    );
    if (creatorMember?.display_name) return creatorMember.display_name;
    return 'Creator';
  }, [expense, tripMembers]);

  const expenseSplits = useMemo(() => {
    if (!expense) return [];
    const rawSplits = Array.isArray(expense.splits) ? expense.splits : [];
    return rawSplits.map((s: any) => {
      const m = tripMembers.find(
        mem => mem.id === s.member_id || (mem.profile_id && mem.profile_id === s.member_id)
      );
      return {
        ...s,
        memberName: m?.display_name || 'Member',
        isGuest: Boolean(m?.is_guest && !m?.phone_number && !m?.profile_id),
        isPayer: m?.id === payerMember?.id,
      };
    });
  }, [expense, tripMembers, payerMember]);

  const paginatedSplits = useMemo(
    () => expenseSplits.slice(0, splitsVisibleCount),
    [expenseSplits, splitsVisibleCount]
  );

  const handleLoadMoreSplits = () => {
    if (loadingMoreSplits || splitsVisibleCount >= expenseSplits.length) return;
    setLoadingMoreSplits(true);
    setTimeout(() => {
      setSplitsVisibleCount(prev => Math.min(prev + PAGE_SIZE, expenseSplits.length));
      setLoadingMoreSplits(false);
    }, 200);
  };

  const toggleEditParticipant = (memberId: string) => {
    if (editParticipants.includes(memberId)) {
      if (editParticipants.length === 1) {
        setErrorMsg('At least one participant must be included in the split.');
        return;
      }
      setEditParticipants(editParticipants.filter(id => id !== memberId));
    } else {
      setEditParticipants([...editParticipants, memberId]);
    }
  };

  const handleSaveChanges = async () => {
    if (!canEdit || !expense || !tripId) return;
    Keyboard.dismiss();

    const floatAmount = parseFloat(editAmountRupees);
    if (isNaN(floatAmount) || floatAmount <= 0) {
      setErrorMsg('Please enter a valid amount greater than 0.');
      return;
    }
    if (!editDescription.trim()) {
      setErrorMsg('Please enter a description.');
      return;
    }
    if (editParticipants.length === 0) {
      setErrorMsg('Please select at least one participant.');
      return;
    }

    const amountPaise = Math.round(floatAmount * 100);
    let customSplitsPayload: Array<{ memberId: string; shareAmount: number }> | undefined;

    if (editSplitType === 'custom') {
      const totalAllocated = editParticipants.reduce((sum, mId) => {
        const val = parseFloat(editCustomAmounts[mId] || '0');
        return sum + (isNaN(val) ? 0 : val);
      }, 0);
      if (Math.abs(totalAllocated - floatAmount) > 0.05) {
        setErrorMsg(
          `Custom split total (${currencyInfo.symbol}${totalAllocated.toFixed(2)}) must equal bill total (${currencyInfo.symbol}${floatAmount.toFixed(2)}).`
        );
        return;
      }
      customSplitsPayload = editParticipants.map(mId => ({
        memberId: mId,
        shareAmount: Math.round((parseFloat(editCustomAmounts[mId] || '0') || 0) * 100),
      }));
    }

    setSaving(true);
    setErrorMsg(null);

    const editorName =
      profile?.full_name || profile?.name || user?.email?.split('@')[0] || 'You';

    const ok = await updateExpense({
      tripId,
      expenseId: expense.id,
      amountPaise,
      description: editDescription.trim(),
      category: editCategory,
      paidByMemberId: editPaidBy || expense.paid_by,
      paymentMode: editPaymentMode,
      splitType: editSplitType,
      participantMemberIds: editParticipants,
      customSplits: customSplitsPayload,
      location: editUseLocation ? editLocationName : null,
      latitude: editUseLocation ? editCoords?.latitude : null,
      longitude: editUseLocation ? editCoords?.longitude : null,
      attachmentUrl: editAttachmentUrl,
      attachmentName: editAttachmentName,
      attachmentType: editAttachmentType,
      userId: user?.id || 'local_user',
      editorName,
    });

    await loadBillFromStorageAndStore();
    setSaving(false);

    if (ok) {
      setIsEditing(false);
      Alert.alert('Bill Updated', 'The bill details and member balances have been updated.');
    } else {
      setErrorMsg('Could not update bill. Please try again.');
    }
  };

  const handleDeleteExpense = () => {
    if (!canEdit || !expense || !tripId || deleting) return;

    Alert.alert(
      'Delete Bill',
      `Are you sure you want to delete "${expense.description}"? This will recalculate all member balances and remove this bill from the chat.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              const currentUserName = profile?.full_name || profile?.name || 'Member';
              await deleteExpense(tripId, expense.id, currentUserName);
              Alert.alert('Bill Deleted', 'The bill has been deleted.');
              router.back();
            } catch (e: any) {
              Alert.alert('Error', e?.message || 'Could not delete bill.');
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  if (loadingBill && !expense) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View
          style={[
            styles.headerBar,
            {
              backgroundColor: colors.card,
              borderBottomColor: colors.border,
              borderBottomWidth: 1,
              paddingTop: Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 44) + 6,
            },
          ]}
        >
          <TouchableOpacity style={styles.headerBackBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerTitleCol}>
            <Text style={[styles.headerTitleText, { color: colors.text }]}>Bill Details</Text>
          </View>
        </View>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Loading bill details...
          </Text>
        </View>
      </View>
    );
  }

  if (!expense) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View
          style={[
            styles.headerBar,
            {
              backgroundColor: colors.card,
              borderBottomColor: colors.border,
              borderBottomWidth: 1,
              paddingTop: Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 44) + 6,
            },
          ]}
        >
          <TouchableOpacity style={styles.headerBackBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerTitleCol}>
            <Text style={[styles.headerTitleText, { color: colors.text }]}>Bill Details</Text>
          </View>
        </View>
        <View style={styles.centerContainer}>
          <Ionicons name="receipt-outline" size={48} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Bill Not Found</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            This bill may have been removed or belongs to another trip.
          </Text>
          <TouchableOpacity
            style={[styles.backBtn, { backgroundColor: colors.primary }]}
            onPress={() => router.back()}
          >
            <Text style={styles.backBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const catMeta = CATEGORY_META[expense.category || 'General'] || CATEGORY_META.General;
  const formattedDate = expense.created_at || expense.date
    ? new Date(expense.created_at || expense.date).toLocaleString([], {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Recent';

  const isFriendSplitTrip =
    currentTrip?.trip_type === 'friend_split' ||
    currentTrip?.name?.toLowerCase().startsWith('split with ');

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Top Header Bar matching ChatView & Info headers */}
      <View
        style={[
          styles.headerBar,
          {
            backgroundColor: colors.card,
            borderBottomColor: colors.border,
            borderBottomWidth: 1,
            paddingTop: Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 44) + 6,
          },
        ]}
      >
        <TouchableOpacity
          style={styles.headerBackBtn}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>

        <View style={styles.headerTitleCol}>
          <Text style={[styles.headerTitleText, { color: colors.text }]} numberOfLines={1}>
            {isEditing ? 'Edit Bill' : 'Bill Details'}
          </Text>
          <Text style={[styles.headerSubtitleText, { color: colors.textSecondary }]} numberOfLines={1}>
            {isFriendSplitTrip ? 'Direct Split' : currentTrip?.name || 'Trip Expense'} • {expense.category || 'General'}
          </Text>
        </View>

        {canEdit && (
          <View style={styles.headerActionsRow}>
            <TouchableOpacity
              style={[
                styles.headerDeleteBtn,
                { backgroundColor: colors.dangerBg },
              ]}
              onPress={handleDeleteExpense}
              disabled={deleting}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="trash-outline" size={17} color={colors.danger} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.headerEditBtn,
                { backgroundColor: isEditing ? (isDark ? '#334155' : '#E2E8F0') : colors.primaryLight },
              ]}
              onPress={() => {
                setErrorMsg(null);
                setIsEditing(!isEditing);
              }}
            >
              <Ionicons
                name={isEditing ? 'close' : 'pencil'}
                size={15}
                color={isEditing ? colors.text : colors.primary}
              />
              <Text
                style={[
                  styles.headerEditBtnText,
                  { color: isEditing ? colors.text : colors.primary },
                ]}
              >
                {isEditing ? 'Cancel' : 'Edit'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.content, { paddingBottom: 140 }]}
          automaticallyAdjustKeyboardInsets={true}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >

      {/* Top Ownership & Permission Banner */}
      <View
        style={[
          styles.permissionBanner,
          {
            backgroundColor: canEdit
              ? isDark
                ? 'rgba(99, 102, 241, 0.16)'
                : '#EEF2FF'
              : isDark
              ? '#1E293B'
              : '#F1F5F9',
            borderColor: canEdit ? colors.primary : colors.border,
          },
        ]}
      >
        <View style={styles.permissionBannerLeft}>
          <Ionicons
            name={canEdit ? 'create-outline' : 'eye-outline'}
            size={18}
            color={canEdit ? colors.primary : colors.textSecondary}
          />
          <Text
            style={[
              styles.permissionBannerText,
              { color: canEdit ? colors.primary : colors.textSecondary },
            ]}
          >
            {canEdit
              ? 'Created by you • You can edit this bill'
              : `Created by ${creatorName} • View Only`}
          </Text>
        </View>

        {canEdit && (
          <TouchableOpacity
            style={[
              styles.editToggleBtn,
              { backgroundColor: isEditing ? colors.border : colors.primary },
            ]}
            onPress={() => {
              setErrorMsg(null);
              setIsEditing(!isEditing);
            }}
          >
            <Ionicons
              name={isEditing ? 'close' : 'pencil'}
              size={14}
              color={isEditing ? colors.text : '#FFFFFF'}
            />
            <Text
              style={[
                styles.editToggleBtnText,
                { color: isEditing ? colors.text : '#FFFFFF' },
              ]}
            >
              {isEditing ? 'Cancel' : 'Edit Bill'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {errorMsg && (
        <View style={[styles.errorBanner, { backgroundColor: colors.dangerBg }]}>
          <Text style={[styles.errorText, { color: colors.danger }]}>{errorMsg}</Text>
        </View>
      )}

      {/* VIEW MODE */}
      {!isEditing ? (
        <>
          {/* Hero Bill Summary Card */}
          <View
            style={[
              styles.heroCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.heroTopRow}>
              <View style={[styles.categoryIconCircle, { backgroundColor: catMeta.bg }]}>
                <Text style={styles.categoryEmoji}>{catMeta.emoji}</Text>
              </View>
              <View style={styles.badgesRow}>
                <View style={[styles.pillBadge, { backgroundColor: catMeta.bg }]}>
                  <Text style={[styles.pillBadgeText, { color: catMeta.color }]}>
                    {expense.category || 'General'}
                  </Text>
                </View>
                <View
                  style={[
                    styles.pillBadge,
                    { backgroundColor: isDark ? '#334155' : '#F1F5F9' },
                  ]}
                >
                  <Text style={[styles.pillBadgeText, { color: colors.textSecondary }]}>
                    {(expense.payment_mode || 'upi').toUpperCase()}
                  </Text>
                </View>
              </View>
            </View>

            <Text style={[styles.billTitle, { color: colors.text }]}>
              {expense.description}
            </Text>

            <Text style={[styles.billAmount, { color: colors.primary }]}>
              {formatCurrencyAmount(expense.amount, currencyCode)}
            </Text>

            <View style={[styles.metaDivider, { backgroundColor: colors.borderLight }]} />

            <View style={styles.metaGrid}>
              <View style={styles.metaItem}>
                <Ionicons name="calendar-outline" size={15} color={colors.textMuted} />
                <Text style={[styles.metaItemText, { color: colors.textSecondary }]}>
                  {formattedDate}
                </Text>
              </View>

              <View style={styles.metaItem}>
                <Ionicons
                  name={isFriendSplitTrip ? 'people-outline' : 'airplane-outline'}
                  size={15}
                  color={colors.textMuted}
                />
                <Text style={[styles.metaItemText, { color: colors.textSecondary }]}>
                  {isFriendSplitTrip ? 'Direct Split' : currentTrip?.name || 'Trip Expense'}
                </Text>
              </View>
            </View>
          </View>

          {/* Expense Location Card if attached */}
          {Boolean(expense.location || (expense.latitude && expense.longitude)) && (
            <>
              <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>
                EXPENSE LOCATION
              </Text>
              <View
                style={[
                  styles.infoCard,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <View style={styles.locationViewRow}>
                  <View style={[styles.locationDetailIconBox, { backgroundColor: colors.primaryLight }]}>
                    <Ionicons name="location" size={20} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={[styles.locationDetailTitle, { color: colors.text }]}>
                      {expense.location || 'Tagged Location'}
                    </Text>
                    {expense.latitude && expense.longitude && (
                      <Text style={[styles.locationDetailCoords, { color: colors.textMuted }]}>
                        GPS: {Number(expense.latitude).toFixed(4)}, {Number(expense.longitude).toFixed(4)}
                      </Text>
                    )}
                  </View>
                  {expense.latitude && expense.longitude && (
                    <TouchableOpacity
                      style={[styles.mapOpenBtn, { backgroundColor: colors.primary }]}
                      onPress={() => {
                        const lat = expense.latitude;
                        const lng = expense.longitude;
                        const label = encodeURIComponent(expense.description || 'Expense Location');
                        const url = Platform.select({
                          ios: `maps:0,0?q=${label}@${lat},${lng}`,
                          android: `geo:0,0?q=${lat},${lng}(${label})`,
                          default: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
                        });
                        if (url) Linking.openURL(url).catch(() => {});
                      }}
                    >
                      <Ionicons name="map-outline" size={14} color="#FFFFFF" />
                      <Text style={styles.mapOpenBtnText}>View Map</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </>
          )}

          {/* Attached Bill / Ticket / Document */}
          {Boolean(expense.attachment_url) && (
            <>
              <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>
                ATTACHED BILL / TICKET / DOCUMENT
              </Text>
              <View
                style={[
                  styles.infoCard,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                {expense.attachment_type === 'image' || expense.attachment_url?.match(/\.(jpeg|jpg|gif|png|webp)($|\?)/i) ? (
                  <View style={styles.attachmentViewWrapper}>
                    <TouchableOpacity
                      activeOpacity={0.9}
                      onPress={() => setSelectedImagePreview(expense.attachment_url)}
                      style={styles.attachmentImageContainer}
                    >
                      <Image
                        source={{ uri: expense.attachment_url }}
                        style={styles.attachmentViewImage}
                        resizeMode="cover"
                      />
                      <View style={styles.imageEnlargeOverlay}>
                        <Ionicons name="expand-outline" size={15} color="#FFFFFF" />
                        <Text style={styles.imageEnlargeText}>Tap to preview</Text>
                      </View>
                    </TouchableOpacity>
                    <View style={styles.attachmentMetaRow}>
                      <View style={{ flex: 1, marginRight: 8 }}>
                        <Text style={[styles.attachmentViewTitle, { color: colors.text }]} numberOfLines={1}>
                          {expense.attachment_name || 'Receipt Photo'}
                        </Text>
                        <Text style={[styles.attachmentViewSubtitle, { color: colors.textMuted }]}>
                          Receipt / Bill Photo
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.attachmentOpenBtn, { backgroundColor: colors.primaryLight }]}
                        onPress={() => handleOpenAttachment(expense.attachment_url)}
                      >
                        <Ionicons name="open-outline" size={15} color={colors.primary} />
                        <Text style={[styles.attachmentOpenBtnText, { color: colors.primary }]}>Open</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View style={styles.attachmentDocRow}>
                    <View style={[styles.attachmentDocIconBig, { backgroundColor: colors.dangerBg }]}>
                      <Ionicons
                        name={expense.attachment_type === 'pdf' ? 'document-text' : 'document-attach'}
                        size={26}
                        color={colors.danger}
                      />
                    </View>
                    <View style={{ flex: 1, marginHorizontal: 10 }}>
                      <Text style={[styles.attachmentViewTitle, { color: colors.text }]} numberOfLines={1}>
                        {expense.attachment_name || 'Attached Ticket / Document'}
                      </Text>
                      <Text style={[styles.attachmentViewSubtitle, { color: colors.textMuted }]}>
                        {expense.attachment_type === 'pdf' ? 'PDF Ticket / Document' : 'Document File'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.attachmentOpenBtn, { backgroundColor: colors.primary }]}
                      onPress={() => handleOpenAttachment(expense.attachment_url)}
                    >
                      <Ionicons name="download-outline" size={15} color="#FFFFFF" />
                      <Text style={[styles.attachmentOpenBtnText, { color: '#FFFFFF' }]}>Open</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </>
          )}

          {/* Paid By Section */}
          <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>
            PAID BY
          </Text>
          <View
            style={[
              styles.infoCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.payerRow}>
              <View style={[styles.memberAvatar, { backgroundColor: colors.primaryLight }]}>
                <Text style={[styles.memberAvatarText, { color: colors.primary }]}>
                  {(payerMember?.display_name || expense.payerName || 'M')
                    .charAt(0)
                    .toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.payerName, { color: colors.text }]}>
                  {payerMember?.display_name || expense.payerName || 'Member'}
                </Text>
                <Text style={[styles.payerSub, { color: colors.textSecondary }]}>
                  Paid full bill via {(expense.payment_mode || 'UPI').toUpperCase()}
                </Text>
              </View>
              <Text style={[styles.payerAmount, { color: colors.success }]}>
                {formatCurrencyAmount(expense.amount, currencyCode)}
              </Text>
            </View>
          </View>

          {/* Split Breakdown Section (Paginated by 10) */}
          <View style={styles.splitSectionHeaderRow}>
            <Text style={[styles.sectionHeader, { color: colors.textSecondary, marginBottom: 0 }]}>
              SPLIT BREAKDOWN ({expenseSplits.length} {expenseSplits.length === 1 ? 'MEMBER' : 'MEMBERS'})
            </Text>
            <Text style={[styles.splitMethodTag, { color: colors.primary }]}>
              {(expense.split_type || 'equal').toUpperCase()} SPLIT
            </Text>
          </View>

          <View
            style={[
              styles.infoCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            {paginatedSplits.map((sp: any, idx: number) => (
              <View
                key={sp.id || `${sp.member_id}_${idx}`}
                style={[
                  styles.splitRow,
                  idx < paginatedSplits.length - 1 && {
                    borderBottomWidth: 1,
                    borderBottomColor: colors.borderLight,
                  },
                ]}
              >
                <View
                  style={[
                    styles.splitAvatar,
                    {
                      backgroundColor: sp.isPayer
                        ? colors.primaryLight
                        : isDark
                        ? '#334155'
                        : '#F1F5F9',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.splitAvatarText,
                      { color: sp.isPayer ? colors.primary : colors.text },
                    ]}
                  >
                    {sp.memberName.charAt(0).toUpperCase()}
                  </Text>
                </View>

                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[styles.splitMemberName, { color: colors.text }]}>
                      {sp.memberName}
                    </Text>
                    {sp.isPayer && (
                      <View style={[styles.payerMiniPill, { backgroundColor: colors.successBg }]}>
                        <Text style={[styles.payerMiniPillText, { color: colors.success }]}>
                          Payer
                        </Text>
                      </View>
                    )}
                    {sp.isGuest && (
                      <View
                        style={[
                          styles.payerMiniPill,
                          { backgroundColor: isDark ? 'rgba(245,158,11,0.2)' : '#FEF3C7' },
                        ]}
                      >
                        <Text style={[styles.payerMiniPillText, { color: '#D97706' }]}>
                          Guest
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.splitShareSub, { color: colors.textSecondary }]}>
                    {sp.isPayer ? 'Included in bill' : `Owes share to ${payerMember?.display_name || expense.payerName || 'Payer'}`}
                  </Text>
                </View>

                <Text style={[styles.splitShareAmount, { color: colors.text }]}>
                  {formatCurrencyAmount(sp.amount, currencyCode)}
                </Text>
              </View>
            ))}

            {splitsVisibleCount < expenseSplits.length && (
              <TouchableOpacity
                style={[styles.loadMoreBtn, { borderColor: colors.border }]}
                onPress={handleLoadMoreSplits}
                disabled={loadingMoreSplits}
              >
                {loadingMoreSplits ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={[styles.loadMoreText, { color: colors.primary }]}>
                    Load More ({expenseSplits.length - splitsVisibleCount} remaining)
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        </>
      ) : (
        /* EDIT MODE (Only accessible if canEdit === true) */
        <View
          style={[
            styles.editCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
            Amount ({currencyInfo.symbol})
          </Text>
          <TextInput
            style={[
              styles.inputField,
              {
                backgroundColor: colors.inputBackground,
                borderColor: colors.border,
                color: colors.text,
                fontSize: 22,
                fontWeight: '800',
              },
            ]}
            keyboardType="decimal-pad"
            value={editAmountRupees}
            onChangeText={val => {
              setEditAmountRupees(val);
              if (editSplitType === 'custom' && editParticipants.length > 0) {
                const num = parseFloat(val) || 0;
                const per = (num / editParticipants.length).toFixed(2);
                const nextMap: Record<string, string> = {};
                editParticipants.forEach(pId => {
                  nextMap[pId] = per;
                });
                setEditCustomAmounts(nextMap);
              }
            }}
            placeholder="0.00"
            placeholderTextColor={colors.textMuted}
          />

          <Text style={[styles.fieldLabel, { color: colors.textSecondary, marginTop: 14 }]}>
            Description
          </Text>
          <TextInput
            style={[
              styles.inputField,
              {
                backgroundColor: colors.inputBackground,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            value={editDescription}
            onChangeText={setEditDescription}
            placeholder="e.g. Dinner, Cab, Hotel"
            placeholderTextColor={colors.textMuted}
          />

          <Text style={[styles.fieldLabel, { color: colors.textSecondary, marginTop: 14 }]}>
            Category
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 6 }}>
            {CATEGORIES.map(cat => (
              <TouchableOpacity
                key={cat}
                style={[
                  styles.chip,
                  {
                    backgroundColor: editCategory === cat ? colors.primary : colors.inputBackground,
                    borderColor: editCategory === cat ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => setEditCategory(cat)}
              >
                <Text
                  style={{
                    color: editCategory === cat ? '#FFFFFF' : colors.textSecondary,
                    fontWeight: '700',
                    fontSize: 12,
                  }}
                >
                  {cat}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={[styles.fieldLabel, { color: colors.textSecondary, marginTop: 14 }]}>
            Payment Mode
          </Text>
          <View style={styles.rowGap}>
            {(['upi', 'cash', 'other'] as PaymentMode[]).map(mode => (
              <TouchableOpacity
                key={mode}
                style={[
                  styles.modeBtn,
                  {
                    backgroundColor:
                      editPaymentMode === mode ? colors.primary : colors.inputBackground,
                    borderColor: editPaymentMode === mode ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => setEditPaymentMode(mode)}
              >
                <Text
                  style={{
                    color: editPaymentMode === mode ? '#FFFFFF' : colors.textSecondary,
                    fontWeight: '700',
                    fontSize: 12,
                  }}
                >
                  {mode.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.fieldLabel, { color: colors.textSecondary, marginTop: 14 }]}>
            Who Paid?
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 6 }}>
            {tripMembers.map(m => (
              <TouchableOpacity
                key={m.id}
                style={[
                  styles.chip,
                  {
                    backgroundColor: editPaidBy === m.id ? colors.primary : colors.inputBackground,
                    borderColor: editPaidBy === m.id ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => setEditPaidBy(m.id)}
              >
                <Text
                  style={{
                    color: editPaidBy === m.id ? '#FFFFFF' : colors.text,
                    fontWeight: '700',
                    fontSize: 12,
                  }}
                >
                  {m.display_name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Location in Edit Mode */}
          <Text style={[styles.fieldLabel, { color: colors.textSecondary, marginTop: 14 }]}>
            Location
          </Text>
          <View
            style={[
              styles.locationEditCard,
              {
                backgroundColor: colors.inputBackground,
                borderColor: editUseLocation ? colors.primary : colors.border,
              },
            ]}
          >
            <View style={styles.locationTopRow}>
              <View style={[styles.locationIconBox, { backgroundColor: colors.primaryLight }]}>
                <Ionicons name="location" size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={[styles.locationTitle, { color: colors.text }]}>Use this location</Text>
                <Text style={[styles.locationSubtitle, { color: colors.textSecondary }]}>
                  {editFetchingLocation
                    ? 'Detecting location...'
                    : editUseLocation && editLocationName
                    ? editLocationName
                    : 'Attach current GPS location to this bill'}
                </Text>
              </View>
              {editFetchingLocation ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Switch
                  value={editUseLocation}
                  onValueChange={async val => {
                    if (!val) {
                      setEditUseLocation(false);
                      setEditLocationName(null);
                      setEditCoords(null);
                      return;
                    }

                    setEditFetchingLocation(true);
                    try {
                      const { status } = await Location.requestForegroundPermissionsAsync();
                      if (status !== 'granted') {
                        Alert.alert(
                          'Location Permission Required',
                          'Please allow location access to tag where this expense occurred.'
                        );
                        setEditUseLocation(false);
                        setEditFetchingLocation(false);
                        return;
                      }

                      setEditUseLocation(true);
                      const loc = await Location.getCurrentPositionAsync({
                        accuracy: Location.Accuracy.Balanced,
                      });

                      const lat = loc.coords.latitude;
                      const lng = loc.coords.longitude;
                      setEditCoords({ latitude: lat, longitude: lng });

                      try {
                        const reverse = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
                        if (reverse && reverse.length > 0) {
                          const item = reverse[0];
                          const parts = [
                            item.name || item.street,
                            item.district || item.subregion || item.city,
                            item.region || item.country,
                          ].filter(Boolean);
                          setEditLocationName(
                            parts.length > 0
                              ? parts.join(', ')
                              : `${lat.toFixed(4)}, ${lng.toFixed(4)}`
                          );
                        } else {
                          setEditLocationName(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
                        }
                      } catch {
                        setEditLocationName(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
                      }
                    } catch (err: any) {
                      Alert.alert('Location Error', err?.message || 'Could not fetch current location.');
                      setEditUseLocation(false);
                    } finally {
                      setEditFetchingLocation(false);
                    }
                  }}
                  trackColor={{ false: isDark ? '#334155' : '#CBD5E1', true: colors.primary }}
                  thumbColor={Platform.OS === 'android' ? '#FFFFFF' : undefined}
                />
              )}
            </View>

            {editUseLocation && editLocationName && (
              <View
                style={[
                  styles.locationChip,
                  { backgroundColor: colors.card, borderColor: colors.borderLight },
                ]}
              >
                <Ionicons name="navigate-circle" size={14} color={colors.primary} />
                <Text style={[styles.locationChipText, { color: colors.text }]} numberOfLines={1}>
                  {editLocationName}
                </Text>
              </View>
            )}
          </View>

          {/* Attach Ticket, Receipt or Document */}
          <Text style={[styles.fieldLabel, { color: colors.textSecondary, marginTop: 14 }]}>
            Attach Bill, Ticket or Document
          </Text>
          {editAttachmentUrl ? (
            <View
              style={[
                styles.attachmentPreviewCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              {editAttachmentType === 'image' ? (
                <Image source={{ uri: editAttachmentUrl }} style={styles.attachmentThumbImage} />
              ) : (
                <View style={[styles.attachmentDocIcon, { backgroundColor: colors.dangerBg }]}>
                  <Ionicons
                    name={editAttachmentType === 'pdf' ? 'document-text' : 'document-attach'}
                    size={24}
                    color={colors.danger}
                  />
                </View>
              )}

              <View style={styles.attachmentInfoCol}>
                <Text style={[styles.attachmentNameText, { color: colors.text }]} numberOfLines={1}>
                  {editAttachmentName || 'Attached Document'}
                </Text>
                <Text style={[styles.attachmentSubText, { color: colors.textMuted }]}>
                  {editAttachmentType === 'image'
                    ? 'Photo / Receipt'
                    : editAttachmentType === 'pdf'
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

          <Text style={[styles.fieldLabel, { color: colors.textSecondary, marginTop: 14 }]}>
            Split Method
          </Text>
          <View style={styles.rowGap}>
            {(['equal', 'custom'] as SplitType[]).map(st => (
              <TouchableOpacity
                key={st}
                style={[
                  styles.modeBtn,
                  {
                    backgroundColor: editSplitType === st ? colors.primary : colors.inputBackground,
                    borderColor: editSplitType === st ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => setEditSplitType(st)}
              >
                <Text
                  style={{
                    color: editSplitType === st ? '#FFFFFF' : colors.textSecondary,
                    fontWeight: '700',
                    fontSize: 12,
                  }}
                >
                  {st === 'equal' ? 'Split Equally' : 'Custom Amounts'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.fieldLabel, { color: colors.textSecondary, marginTop: 14 }]}>
            Participants ({editParticipants.length})
          </Text>
          <View style={{ marginTop: 6 }}>
            {tripMembers.map(m => {
              const selected = editParticipants.includes(m.id);
              const parsedTotal = parseFloat(editAmountRupees) || 0;
              const eqShare =
                selected && editParticipants.length > 0 && parsedTotal > 0
                  ? (parsedTotal / editParticipants.length).toFixed(2)
                  : '0.00';

              return (
                <View
                  key={m.id}
                  style={[
                    styles.editParticipantRow,
                    { borderBottomColor: colors.borderLight },
                  ]}
                >
                  <TouchableOpacity
                    style={styles.editParticipantLeft}
                    onPress={() => toggleEditParticipant(m.id)}
                  >
                    <Ionicons
                      name={selected ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={selected ? colors.primary : colors.textMuted}
                    />
                    <Text style={[styles.splitMemberName, { color: colors.text }]}>
                      {m.display_name}
                    </Text>
                  </TouchableOpacity>

                  {selected && (
                    editSplitType === 'equal' ? (
                      <Text style={{ color: colors.textSecondary, fontWeight: '700' }}>
                        {currencyInfo.symbol}{eqShare}
                      </Text>
                    ) : (
                      <TextInput
                        style={[
                          styles.customAmountInput,
                          {
                            backgroundColor: colors.inputBackground,
                            borderColor: colors.border,
                            color: colors.text,
                          },
                        ]}
                        keyboardType="decimal-pad"
                        value={editCustomAmounts[m.id] ?? ''}
                        onChangeText={v =>
                          setEditCustomAmounts(prev => ({
                            ...prev,
                            [m.id]: v.replace(/[^0-9.]/g, ''),
                          }))
                        }
                        placeholder="0.00"
                        placeholderTextColor={colors.textMuted}
                      />
                    )
                  )}
                </View>
              );
            })}
          </View>

          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: colors.primary }]}
            onPress={handleSaveChanges}
            disabled={saving || deleting}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.saveBtnText}>Save Updated Bill</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.deleteExpenseBtn,
              { backgroundColor: colors.dangerBg, borderColor: colors.danger },
            ]}
            onPress={handleDeleteExpense}
            disabled={saving || deleting}
          >
            {deleting ? (
              <ActivityIndicator color={colors.danger} />
            ) : (
              <View style={styles.deleteExpenseBtnContent}>
                <Ionicons name="trash-outline" size={17} color={colors.danger} />
                <Text style={[styles.deleteExpenseBtnText, { color: colors.danger }]}>
                  Delete This Bill
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      )}
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Fullscreen Image Preview Modal */}
      {selectedImagePreview && (
        <Modal
          visible={Boolean(selectedImagePreview)}
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedImagePreview(null)}
        >
          <View style={styles.imageModalOverlay}>
            <TouchableOpacity
              style={styles.imageModalCloseBtn}
              onPress={() => setSelectedImagePreview(null)}
            >
              <Ionicons name="close" size={26} color="#FFFFFF" />
            </TouchableOpacity>
            <Image
              source={{ uri: selectedImagePreview }}
              style={styles.fullscreenModalImage}
              resizeMode="contain"
            />
          </View>
        </Modal>
      )}
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
    paddingHorizontal: 12,
  },
  headerBackBtn: {
    padding: 6,
    marginRight: 4,
  },
  headerTitleCol: {
    flex: 1,
  },
  headerTitleText: {
    fontSize: 16,
    fontWeight: '700',
  },
  headerSubtitleText: {
    fontSize: 11,
    marginTop: 1,
  },
  headerActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerDeleteBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  headerEditBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  deleteExpenseBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  deleteExpenseBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  deleteExpenseBtnText: {
    fontWeight: '700',
    fontSize: 14,
  },
  content: {
    padding: 14,
    paddingBottom: 72,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: '600',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 20,
  },
  backBtn: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  backBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  permissionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 14,
    gap: 10,
  },
  permissionBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  permissionBannerText: {
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  editToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    gap: 5,
  },
  editToggleBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  errorBanner: {
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '600',
  },
  heroCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    marginBottom: 20,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  categoryIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryEmoji: {
    fontSize: 24,
  },
  badgesRow: {
    flexDirection: 'row',
    gap: 8,
  },
  pillBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  pillBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  billTitle: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 6,
  },
  billAmount: {
    fontSize: 32,
    fontWeight: '900',
  },
  metaDivider: {
    height: 1,
    marginVertical: 14,
  },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaItemText: {
    fontSize: 12,
    fontWeight: '600',
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
  },
  infoCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
  },
  payerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  memberAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarText: {
    fontSize: 17,
    fontWeight: '800',
  },
  payerName: {
    fontSize: 16,
    fontWeight: '700',
  },
  payerSub: {
    fontSize: 12,
    marginTop: 2,
  },
  payerAmount: {
    fontSize: 17,
    fontWeight: '800',
  },
  splitSectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  splitMethodTag: {
    fontSize: 11,
    fontWeight: '800',
  },
  splitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  splitAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splitAvatarText: {
    fontSize: 15,
    fontWeight: '700',
  },
  splitMemberName: {
    fontSize: 15,
    fontWeight: '700',
  },
  payerMiniPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  payerMiniPillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  splitShareSub: {
    fontSize: 12,
    marginTop: 2,
  },
  splitShareAmount: {
    fontSize: 15,
    fontWeight: '800',
  },
  loadMoreBtn: {
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  loadMoreText: {
    fontSize: 12,
    fontWeight: '700',
  },
  editCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  inputField: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
  },
  rowGap: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  editParticipantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  editParticipantLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  customAmountInput: {
    width: 90,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'right',
  },
  saveBtn: {
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  locationViewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  locationDetailIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  locationDetailTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  locationDetailCoords: {
    fontSize: 12,
    marginTop: 2,
  },
  mapOpenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  mapOpenBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  locationEditCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginVertical: 4,
  },
  locationTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationIconBox: {
    width: 34,
    height: 34,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  locationTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  locationSubtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  locationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
  locationChipText: {
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  attachmentViewWrapper: {
    width: '100%',
  },
  attachmentImageContainer: {
    width: '100%',
    height: 180,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#000',
  },
  attachmentViewImage: {
    width: '100%',
    height: '100%',
  },
  imageEnlargeOverlay: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  imageEnlargeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  attachmentMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  attachmentViewTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  attachmentViewSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  attachmentOpenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  attachmentOpenBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  attachmentDocRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  attachmentDocIconBig: {
    width: 48,
    height: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentBtnRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
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
    marginTop: 6,
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
  imageModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageModalCloseBtn: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 54 : 24,
    right: 20,
    zIndex: 10,
    padding: 8,
  },
  fullscreenModalImage: {
    width: '92%',
    height: '80%',
  },
});
