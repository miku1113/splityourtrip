import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Image,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Linking,
  ActivityIndicator,
  Keyboard,
  InteractionManager,
  StatusBar,
  Animated,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
// Safely load expo-av if ExponentAV native module is compiled into this binary
let Audio: any = null;
let Video: any = null;
let ResizeMode: any = { CONTAIN: 'contain', COVER: 'cover', STRETCH: 'stretch' };

try {
  const ExpoAV = require('expo-av');
  Audio = ExpoAV.Audio;
  Video = ExpoAV.Video;
  ResizeMode = ExpoAV.ResizeMode || ResizeMode;
} catch (e) {
  // Graceful fallback when running on a native binary without ExponentAV compiled in
}

const SafeVideo = (props: any) => {
  if (Video) {
    return <Video {...props} />;
  }
  return (
    <View style={[props.style, { backgroundColor: '#1E293B', alignItems: 'center', justifyContent: 'center' }]}>
      <Ionicons name="videocam-outline" size={28} color="#94A3B8" />
    </View>
  );
};
import { uploadAudioToSupabase, uploadDocumentToSupabase, uploadVideoToSupabase } from '../services/imageUpload';
import { chatOutbox, OutboxMessageItem } from '../services/chatOutboxService';
import { useTheme } from '../theme/useThemeStore';
import { useAuthStore, decodeBase64ToArrayBuffer } from '../features/auth/useAuthStore';
import { supabase, supabaseAdmin, isSupabaseConfigured } from '../lib/supabase';
import {
  useTripStore,
  computeBalances,
  normalizeExpensesForTrip,
  deletedExpenseIdsSet,
  deletedTripIdsSet,
  findMyMember,
  isValidUUID,
} from '../features/trips/useTripStore';
import {
  useContactsStore,
  normalizePhone,
  FriendContact,
  getContactNameByPhone,
  getEffectiveContactName,
} from '../features/contacts/useContactsStore';
import { AppStorage } from '../lib/storage';
import { calculateSettlement } from '../services/settle';
import { formatCurrencyAmount } from '../services/currency';
import TripCoverBadge from './TripCoverBadge';
import ChatFeedSkeleton from './ChatFeedSkeleton';
import { StandardBottomSheet } from './StandardBottomSheet';
import { getFriendSettings } from '../services/friendSettings';
import { TripMessage, TripMember, PaymentMode } from '../types/database';
import { scaleFont, moderateScale, isSmallDevice } from '../theme/responsive';
import { useNotificationStore } from '../features/notifications/useNotificationStore';

const PAGE_SIZE = 30;

interface FriendSharedDataCacheEntry {
  friendNetPaise: number;
  sharedTripLabels: string[];
  sharedExpenseMessages: TripMessage[];
  timestamp: number;
}
const friendSharedDataCache = new Map<string, FriendSharedDataCacheEntry>();

const getFriendCacheKey = (fId?: string, phone?: string, name?: string) => {
  const normPhone = phone ? normalizePhone(phone) : '';
  const cleanName = name ? name.trim().toLowerCase() : '';
  return fId || normPhone || cleanName || 'unknown_friend';
};

interface ChatViewProps {
  tripId: string;
  title: string;
  subtitle?: string;
  avatarText?: string;
  avatarUrl?: string;
  friendId?: string;
  friendPhone?: string;
  isGroup?: boolean;
  showHeader?: boolean;
  onBack?: () => void;
  onAddExpense?: () => void;
  onSettleUp?: () => void;
}

export default function ChatView({
  tripId,
  title,
  subtitle = 'Online',
  avatarText,
  avatarUrl,
  friendId,
  friendPhone,
  isGroup = false,
  showHeader = true,
  onBack,
  onAddExpense,
  onSettleUp,
}: ChatViewProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { user, profile } = useAuthStore();
  const {
    messages,
    sendMessage,
    loadTripDetails,
    subscribeTripRealtime,
    trips,
    members,
    expenses,
    balances,
    isLoading: tripLoading,
    linkGuestWithContact,
    markTripMessagesAsSeen,
    editTripMessage,
    deleteTripMessage,
    addExpense,
  } = useTripStore();
  const {
    contacts,
    isLoading: contactsLoading,
    initContacts,
  } = useContactsStore();

  const initialResolvedTitle = useMemo(() => {
    if (isGroup) return title;
    return getEffectiveContactName({
      phoneNumber: friendPhone,
      contactName: title,
      displayName: title,
      fallback: title,
    });
  }, [title, isGroup, friendPhone]);

  const [displayTitle, setDisplayTitle] = useState(initialResolvedTitle);
  const [displayPhone, setDisplayPhone] = useState(friendPhone || '');
  const [isLinkedLocal, setIsLinkedLocal] = useState(Boolean(friendPhone && friendPhone.trim().length > 0));
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const navLockRef = useRef(false);

  const runGuardedNav = (actionId: string, fn: () => void) => {
    fn();
  };

  const [isBlocked, setIsBlocked] = useState(false);

  useEffect(() => {
    if (isGroup) {
      setDisplayTitle(title);
    } else {
      const effective = getEffectiveContactName({
        phoneNumber: friendPhone,
        contactName: title,
        displayName: title,
        fallback: title,
      });
      setDisplayTitle(effective);
    }
  }, [title, isGroup, friendPhone]);

  useEffect(() => {
    if (friendPhone && friendPhone.trim().length > 0) {
      setDisplayPhone(friendPhone);
      setIsLinkedLocal(true);
    }
  }, [friendPhone]);

  useFocusEffect(
    useCallback(() => {
      if (!isGroup && (friendId || tripId)) {
        getFriendSettings(friendId || tripId).then(data => {
          if (data.isBlocked !== undefined) {
            setIsBlocked(data.isBlocked);
          }
          if (data.nickname) {
            setDisplayTitle(data.nickname);
          }
        });
      }
    }, [isGroup, friendId, tripId])
  );

  const [inputText, setInputText] = useState('');
  const [editingMessage, setEditingMessage] = useState<{ id: string; text: string } | null>(null);
  const [selectedMessageForAction, setSelectedMessageForAction] = useState<TripMessage | null>(null);
  const [messageActionModalVisible, setMessageActionModalVisible] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const [attachmentModalVisible, setAttachmentModalVisible] = useState(false);
  const [selectedPhotoPreview, setSelectedPhotoPreview] = useState<string | null>(null);
  const [selectedVideoPreview, setSelectedVideoPreview] = useState<string | null>(null);
  const [outboxQueue, setOutboxQueue] = useState<OutboxMessageItem[]>([]);
  const [isNetOnline, setIsNetOnline] = useState(true);

  // Subscribe to persistent Outbox queue & network status (resilient outbox queue)
  useEffect(() => {
    const unsub = chatOutbox.subscribe(q => {
      setOutboxQueue(q.filter(item => !item.tripId || item.tripId === tripId));
    });

    chatOutbox.isOnline().then(online => setIsNetOnline(online));
    const netTimer = setInterval(async () => {
      const online = await chatOutbox.isOnline();
      setIsNetOnline(online);
    }, 4000);

    return () => {
      unsub();
      clearInterval(netTimer);
    };
  }, [tripId]);
  const initialCacheKey = getFriendCacheKey(friendId, friendPhone, title);
  const initialCached = !isGroup ? friendSharedDataCache.get(initialCacheKey) : null;
  const initialMatchedContact = !isGroup
    ? useContactsStore
        .getState()
        .contacts.find(
          c =>
            (friendId && c.id === friendId) ||
            (friendPhone && c.cleanPhone === normalizePhone(friendPhone)) ||
            c.name.trim().toLowerCase() === title.trim().toLowerCase()
        )
    : null;

  const [friendNetPaise, setFriendNetPaise] = useState<number>(
    initialCached?.friendNetPaise ?? initialMatchedContact?.netBalancePaise ?? 0
  );
  const [sharedTripLabels, setSharedTripLabels] = useState<string[]>(
    initialCached?.sharedTripLabels ?? []
  );
  const [sharedExpenseMessages, setSharedExpenseMessages] = useState<TripMessage[]>(
    initialCached?.sharedExpenseMessages ?? []
  );
  const [isFriendDataLoaded, setIsFriendDataLoaded] = useState<boolean>(
    isGroup || Boolean(initialCached)
  );
  const [isTripDataLoaded, setIsTripDataLoaded] = useState<boolean>(!isGroup);
  const bannerPulseAnim = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(bannerPulseAnim, {
          toValue: 0.88,
          duration: 750,
          useNativeDriver: true,
        }),
        Animated.timing(bannerPulseAnim, {
          toValue: 0.35,
          duration: 750,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [bannerPulseAnim]);

  // Pagination state for messages (10 at a time, loaded from the last/newest message)
  const [messagesVisibleCount, setMessagesVisibleCount] = useState(PAGE_SIZE);
  const [loadingEarlierMessages, setLoadingEarlierMessages] = useState(false);
  const [optionsSidebarVisible, setOptionsSidebarVisible] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const isKeyboardActive = isKeyboardVisible || isInputFocused;
  const [isChatLoading, setIsChatLoading] = useState(true);

  useEffect(() => {
    const onShow = () => {
      setIsKeyboardVisible(true);
      setTimeout(() => {
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
      }, 50);
    };

    const onHide = () => {
      setIsKeyboardVisible(false);
    };

    const subscriptions = [
      Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', onShow),
      Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', onHide),
      Keyboard.addListener('keyboardDidShow', onShow),
      Keyboard.addListener('keyboardDidHide', onHide),
    ];

    return () => {
      subscriptions.forEach(sub => sub.remove());
    };
  }, []);

  // Link Guest Friend with Phone Contact Modal state
  const [linkContactModalVisible, setLinkContactModalVisible] = useState(false);
  const [linkSearchQuery, setLinkSearchQuery] = useState('');
  const [linkVisibleCount, setLinkVisibleCount] = useState(PAGE_SIZE);
  const [loadingMoreLinkContacts, setLoadingMoreLinkContacts] = useState(false);
  const [linkingInProgress, setLinkingInProgress] = useState(false);

  // Pay with Screenshot / Confirmation flow
  const [payModalVisible, setPayModalVisible] = useState(false);
  const [payAmountText, setPayAmountText] = useState('');
  const [payTargetMemberId, setPayTargetMemberId] = useState<string>('');
  const [payScreenshotUri, setPayScreenshotUri] = useState<string | null>(null);
  const [payScreenshotBase64, setPayScreenshotBase64] = useState<string | null>(null);
  const [payNote, setPayNote] = useState('');
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);

  // Request Money / Select Amount to Receive flow
  const [requestMoneyModalVisible, setRequestMoneyModalVisible] = useState(false);
  const [requestAmountText, setRequestAmountText] = useState('');
  const [requestTargetMemberId, setRequestTargetMemberId] = useState<string>('');
  const [requestNote, setRequestNote] = useState('');
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);

  // Voice note recording & playback state
  const recordingRef = useRef<any>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isSendingVoice, setIsSendingVoice] = useState(false);
  const recordingBlinkAnim = useRef(new Animated.Value(1)).current;

  const soundRef = useRef<any>(null);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [audioPlaybackPosition, setAudioPlaybackPosition] = useState(0);
  const [audioPlaybackDuration, setAudioPlaybackDuration] = useState(0);

  // Media upload status for live progress animation banner
  const [uploadingAttachment, setUploadingAttachment] = useState<{
    type: 'image' | 'video' | 'document' | 'audio';
    name?: string;
  } | null>(null);

  // Animation for uploading banner pulse & progress bar
  const uploadPulseAnim = useRef(new Animated.Value(0.35)).current;
  const uploadBarAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let pulseAnim: Animated.CompositeAnimation | null = null;
    let barAnim: Animated.CompositeAnimation | null = null;

    if (uploadingAttachment || outboxQueue.length > 0) {
      pulseAnim = Animated.loop(
        Animated.sequence([
          Animated.timing(uploadPulseAnim, {
            toValue: 1,
            duration: 700,
            useNativeDriver: true,
          }),
          Animated.timing(uploadPulseAnim, {
            toValue: 0.35,
            duration: 700,
            useNativeDriver: true,
          }),
        ])
      );
      pulseAnim.start();

      uploadBarAnim.setValue(0);
      barAnim = Animated.loop(
        Animated.sequence([
          Animated.timing(uploadBarAnim, {
            toValue: 0.85,
            duration: 1800,
            useNativeDriver: false,
          }),
          Animated.timing(uploadBarAnim, {
            toValue: 0.98,
            duration: 900,
            useNativeDriver: false,
          }),
          Animated.timing(uploadBarAnim, {
            toValue: 0.05,
            duration: 350,
            useNativeDriver: false,
          }),
        ])
      );
      barAnim.start();
    } else {
      uploadPulseAnim.setValue(0.35);
      uploadBarAnim.setValue(0);
    }

    return () => {
      if (pulseAnim) pulseAnim.stop();
      if (barAnim) barAnim.stop();
    };
  }, [uploadingAttachment, outboxQueue.length, uploadPulseAnim, uploadBarAnim]);

  // Blinking animation for recording red dot
  useEffect(() => {
    let anim: Animated.CompositeAnimation | null = null;
    if (isRecording) {
      anim = Animated.loop(
        Animated.sequence([
          Animated.timing(recordingBlinkAnim, {
            toValue: 0.25,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(recordingBlinkAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ])
      );
      anim.start();
    } else {
      recordingBlinkAnim.setValue(1);
    }
    return () => {
      if (anim) anim.stop();
    };
  }, [isRecording, recordingBlinkAnim]);

  // Cleanup active audio/recording on unmount
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
      }
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
      }
    };
  }, []);

  const flatListRef = useRef<FlatList>(null);
  const prevMsgCountRef = useRef(0);
  const [isChatReady, setIsChatReady] = useState(true);

  const currentTrip = trips.find(t => t.id === tripId);
  const userCurrency = currentTrip?.currency || 'INR';
  const tripMembers = useMemo(
    () => members.filter(m => !m.trip_id || m.trip_id === tripId),
    [members, tripId]
  );
  const tripExpenses = useMemo(
    () => expenses.filter(e => !e.trip_id || e.trip_id === tripId),
    [expenses, tripId]
  );
  const totalGroupSpendPaise = useMemo(
    () => tripExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0),
    [tripExpenses]
  );

  // Reset pagination when switching trips
  useEffect(() => {
    setIsChatReady(true);
    setMessagesVisibleCount(PAGE_SIZE);
  }, [tripId]);

  const currentUserName =
    profile?.full_name || profile?.name || user?.email?.split('@')[0] || 'You';
  const currentUserId = user?.id || 'local_user';
  const currentUserPhone =
    profile?.phone_number || (user as any)?.phone || (user as any)?.user_metadata?.phone_number;

  const myMember = useMemo(() => {
    const found = findMyMember(tripMembers, user?.id, currentUserPhone);
    if (found) return found;
    // In 1-on-1 friend split, if we can identify the friend member, myMember is the other one
    if (!isGroup && tripMembers.length === 2) {
      const friendNorm = friendPhone ? normalizePhone(friendPhone) : '';
      if (friendNorm) {
        const friendMem = tripMembers.find(
          m => m.phone_number && normalizePhone(m.phone_number) === friendNorm
        );
        if (friendMem) {
          return tripMembers.find(m => m.id !== friendMem.id);
        }
      }
      if (friendId) {
        const friendMem = tripMembers.find(
          m => m.id === friendId || m.profile_id === friendId || (m as any).user_id === friendId
        );
        if (friendMem) {
          return tripMembers.find(m => m.id !== friendMem.id);
        }
      }
      // Check by currentTrip.created_by
      if (user?.id && currentTrip?.created_by) {
        if (currentTrip.created_by === user.id) {
          return tripMembers.find(m => m.role === 'admin') || tripMembers[0];
        } else {
          return tripMembers.find(m => m.role !== 'admin') || tripMembers[1];
        }
      }
    }
    // Only if completely offline or unauthenticated
    if (!user?.id) {
      return tripMembers.find(m => m.role === 'admin') || tripMembers[0];
    }
    return undefined;
  }, [tripMembers, user?.id, currentUserPhone, isGroup, friendPhone, friendId, currentTrip?.created_by]);

  const resolvedSenderName = useMemo(() => {
    const pName = (profile?.full_name || profile?.name || '').trim();
    if (pName && pName.toLowerCase() !== 'you') return pName;
    const emailName = user?.email?.split('@')[0];
    if (emailName) return emailName;
    if (myMember?.display_name && myMember.display_name.trim().toLowerCase() !== 'you') {
      return myMember.display_name.trim();
    }
    return 'Member';
  }, [profile?.full_name, profile?.name, user?.email, myMember?.display_name]);

  const otherMember = useMemo(() => {
    if (!tripMembers || tripMembers.length === 0) return undefined;
    if (myMember) {
      const notMe = tripMembers.find(m => m.id !== myMember.id);
      if (notMe) return notMe;
    }
    if (friendPhone) {
      const friendNorm = normalizePhone(friendPhone);
      const byPhone = tripMembers.find(
        m => m.phone_number && normalizePhone(m.phone_number) === friendNorm
      );
      if (byPhone) return byPhone;
    }
    if (friendId) {
      const byId = tripMembers.find(
        m => m.id === friendId || m.profile_id === friendId || (m as any).user_id === friendId
      );
      if (byId) return byId;
    }
    return tripMembers.length > 1 ? (tripMembers[1] || tripMembers[0]) : undefined;
  }, [tripMembers, myMember, friendPhone, friendId]);

  useEffect(() => {
    if (!isGroup && otherMember) {
      const phone = friendPhone || otherMember.phone_number;
      // Guard: Never set title to current user's own phone or name
      const myNorm = currentUserPhone ? normalizePhone(currentUserPhone) : '';
      const otherNorm = phone ? normalizePhone(phone) : '';
      if (myNorm && otherNorm && myNorm === otherNorm) {
        return;
      }
      const effective = getEffectiveContactName({
        phoneNumber: phone,
        contactName: otherMember.display_name,
        displayName: otherMember.display_name,
        fallback: displayTitle,
      });
      const myName = currentUserName?.trim().toLowerCase();
      if (effective && myName && effective.trim().toLowerCase() === myName && myName !== 'you') {
        return;
      }
      if (effective && effective !== displayTitle && effective !== 'Friend' && effective !== 'Member') {
        setDisplayTitle(effective);
      }
    }
  }, [isGroup, otherMember?.phone_number, otherMember?.display_name, friendPhone, currentUserPhone, currentUserName, displayTitle]);

  const resolveSenderName = useCallback(
    (msg: TripMessage) => {
      if (
        msg.sender_id &&
        (msg.sender_id === user?.id ||
          msg.sender_id === currentUserId ||
          (myMember && msg.sender_id === myMember.id))
      ) {
        return 'You';
      }
      const member = tripMembers.find(
        m =>
          msg.sender_id &&
          (m.profile_id === msg.sender_id ||
            m.id === msg.sender_id ||
            (m as any).user_id === msg.sender_id)
      );
      const phone = member?.phone_number;
      return getEffectiveContactName({
        phoneNumber: phone,
        contactName: member?.display_name,
        displayName: msg.sender_name || member?.display_name,
        fallback: msg.sender_name || member?.display_name || 'Member',
      });
    },
    [tripMembers, user?.id, currentUserId, myMember]
  );

  const resolveExpensePayerName = useCallback(
    (exp: any) => {
      if (
        exp.paid_by_id &&
        (exp.paid_by_id === user?.id ||
          exp.paid_by_id === currentUserId ||
          (myMember && exp.paid_by_id === myMember.id))
      ) {
        return 'You';
      }
      const member = tripMembers.find(
        m =>
          exp.paid_by_id &&
          (m.profile_id === exp.paid_by_id ||
            m.id === exp.paid_by_id ||
            (m as any).user_id === exp.paid_by_id)
      );
      const phone = member?.phone_number;
      return getEffectiveContactName({
        phoneNumber: phone,
        contactName: member?.display_name,
        displayName: exp.paid_by_name || member?.display_name,
        fallback: exp.paid_by_name || member?.display_name || 'Member',
      });
    },
    [tripMembers, user?.id, currentUserId, myMember]
  );

  const renderMessageTicks = useCallback((item: TripMessage, isMineBubble: boolean) => {
    if (!isMineBubble) return null;
    if (item.is_seen) {
      return (
        <Ionicons
          name="checkmark-done"
          size={15}
          color="#22C55E"
          style={{ marginLeft: 3 }}
        />
      );
    }
    if (item.is_sent !== false) {
      return (
        <Ionicons
          name="checkmark-done"
          size={15}
          color={isMineBubble ? 'rgba(255,255,255,0.7)' : colors.textMuted}
          style={{ marginLeft: 3 }}
        />
      );
    }
    return (
      <Ionicons
        name="time-outline"
        size={14}
        color={isMineBubble ? 'rgba(255,255,255,0.7)' : colors.textMuted}
        style={{ marginLeft: 3 }}
      />
    );
  }, [colors.textMuted]);

  const handleMessageLongPress = useCallback((item: TripMessage, isMineBubble: boolean) => {
    if (!isMineBubble) return;
    setSelectedMessageForAction(item);
    setMessageActionModalVisible(true);
  }, []);

  // Determine if the current 1-on-1 friend is an unlinked Guest
  const isGuestFriend = useMemo(() => {
    if (isGroup) return false;
    if (isLinkedLocal) return false;
    if (displayPhone && displayPhone.trim().length > 0) return false;

    if (otherMember) {
      if (otherMember.is_guest === false || Boolean(otherMember.phone_number) || Boolean(otherMember.profile_id)) {
        return false;
      }
    }

    const cleanName = displayTitle.trim().toLowerCase();
    const matchedContact = contacts.find(
      c =>
        (friendId && c.id === friendId) ||
        c.name.trim().toLowerCase() === cleanName
    );
    if (matchedContact) {
      if (matchedContact.isGuest === false || Boolean(matchedContact.phoneNumber) || matchedContact.isRegistered) {
        return false;
      }
    }

    return true;
  }, [isGroup, isLinkedLocal, displayTitle, displayPhone, friendId, contacts, otherMember]);

  const currentFriendAvatarUrl = useMemo(() => {
    if (avatarUrl) return avatarUrl;
    const cleanFriendName = displayTitle.trim().toLowerCase();
    const cleanFriendPhone = normalizePhone(displayPhone);
    const mc = contacts.find(
      c =>
        (friendId && c.id === friendId) ||
        (cleanFriendPhone && c.cleanPhone === cleanFriendPhone) ||
        c.name.trim().toLowerCase() === cleanFriendName
    );
    return mc?.avatarUrl;
  }, [avatarUrl, displayTitle, displayPhone, contacts, friendId]);

  // Phone contacts available for linking (exclude purely guest entries that have no phone number)
  const phoneContactsToLink = useMemo(() => {
    const validPhoneContacts = contacts.filter(
      c => Boolean(c.phoneNumber && c.phoneNumber.trim().length > 0)
    );
    if (!linkSearchQuery.trim()) return validPhoneContacts;
    const q = linkSearchQuery.toLowerCase().trim();
    return validPhoneContacts.filter(
      c =>
        c.name.toLowerCase().includes(q) ||
        (c.phoneNumber && c.phoneNumber.toLowerCase().includes(q))
    );
  }, [contacts, linkSearchQuery]);

  const paginatedLinkContacts = useMemo(
    () => phoneContactsToLink.slice(0, linkVisibleCount),
    [phoneContactsToLink, linkVisibleCount]
  );

  useEffect(() => {
    setLinkVisibleCount(PAGE_SIZE);
  }, [linkSearchQuery]);

  const handleLoadMoreLinkContacts = useCallback(() => {
    if (loadingMoreLinkContacts || linkVisibleCount >= phoneContactsToLink.length) return;
    setLoadingMoreLinkContacts(true);
    setTimeout(() => {
      setLinkVisibleCount(prev => Math.min(prev + PAGE_SIZE, phoneContactsToLink.length));
      setLoadingMoreLinkContacts(false);
    }, 250);
  }, [loadingMoreLinkContacts, linkVisibleCount, phoneContactsToLink.length]);

  const openLinkContactModal = () => {
    setLinkSearchQuery('');
    setLinkVisibleCount(PAGE_SIZE);
    setLinkContactModalVisible(true);
    if (contacts.length === 0) {
      initContacts();
    }
  };

  const handleLinkFriendToContact = async (contact: FriendContact) => {
    setLinkingInProgress(true);
    try {
      const myMember = findMyMember(tripMembers, user?.id, currentUserPhone) || tripMembers[0];
      const otherMember = tripMembers.find(m => m.id !== myMember?.id);

      await linkGuestWithContact({
        tripId,
        guestMemberId: otherMember?.id,
        guestName: displayTitle,
        contact: {
          id: contact.id,
          name: contact.name,
          phoneNumber: contact.phoneNumber,
          profileId: contact.profileId,
        },
      });

      setIsLinkedLocal(true);
      setDisplayTitle(contact.name);
      setDisplayPhone(contact.phoneNumber || 'Linked Contact');
      setLinkContactModalVisible(false);
      await computeSharedFriendData();
      Alert.alert(
        'Linked with Contact',
        `${displayTitle} is now linked with ${contact.name}${contact.phoneNumber ? ` (${contact.phoneNumber})` : ''}.`
      );
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not link with contact.');
    } finally {
      setLinkingInProgress(false);
    }
  };

  const computeSharedFriendData = useCallback(async () => {
    if (isGroup) {
      setIsFriendDataLoaded(true);
      return;
    }

    try {
      const cleanFriendName = displayTitle.trim().toLowerCase();
    const cleanFriendPhone = normalizePhone(displayPhone);

    // Also check matched contact from contacts store
    const matchedContact = contacts.find(
      c =>
        (friendId && c.id === friendId) ||
        (cleanFriendPhone && c.cleanPhone === cleanFriendPhone) ||
        c.name.trim().toLowerCase() === cleanFriendName
    );
    const targetProfileId = matchedContact?.profileId;
    const targetPhone = cleanFriendPhone || matchedContact?.cleanPhone || '';

    let totalNet = 0;
    const tripBreakdownLabels: string[] = [];
    const synthesizedExpMsgs: TripMessage[] = [];

    const allTrips = useTripStore.getState().trips;
    const storeMembers = useTripStore.getState().members;
    const storeExpenses = useTripStore.getState().expenses;

    const tripsData = await Promise.all(
      allTrips.map(async t => {
        let tMembers: TripMember[] = [];
        let tExpenses: any[] = [];

        try {
          const raw = await AppStorage.getItem(`@splityourtrip_local_details_${t.id}`);
          if (raw) {
            const parsed = JSON.parse(raw);
            tMembers = Array.isArray(parsed.members) ? parsed.members : [];
            tExpenses = Array.isArray(parsed.expenses) ? parsed.expenses : [];
          }
        } catch {}

        if (tMembers.length === 0) {
          tMembers = storeMembers.filter(m => m.trip_id === t.id);
        }
        if (tExpenses.length === 0) {
          tExpenses = storeExpenses.filter(e => e.trip_id === t.id);
        }

        return { trip: t, members: tMembers, expenses: tExpenses };
      })
    );

    for (const { trip: t, members: tMembers, expenses: tExpenses } of tripsData) {
      if (tMembers.length === 0) continue;

      const myMember = findMyMember(tMembers, user?.id, currentUserPhone);

      // Find if this friend is a member of trip `t`
      const isDirectFriendTrip =
        t.id === tripId ||
        (t.trip_type === 'friend_split' &&
          ((friendId && t.friend_id === friendId) ||
            (targetProfileId && (t.friend_id === targetProfileId || t.created_by === targetProfileId)) ||
            t.name.toLowerCase() === `split with ${cleanFriendName}` ||
            (currentUserName && currentUserName !== 'You' && t.name.toLowerCase() === `split with ${currentUserName.toLowerCase().trim()}`)));

      const friendMember = tMembers.find(m => {
        if (m.id === myMember?.id) return false;
        if (isDirectFriendTrip && tMembers.length === 2) return true;
        if (friendId && m.id === friendId) return true;
        if (targetProfileId && m.profile_id === targetProfileId) return true;
        if (targetPhone && normalizePhone(m.phone_number) === targetPhone) return true;
        return m.display_name.trim().toLowerCase() === cleanFriendName;
      });

      if (!friendMember || !myMember) continue;

      const normalizedExps = normalizeExpensesForTrip(tExpenses, tMembers);
      const tBalances = computeBalances(t.id, tMembers, normalizedExps);
      const netRecord: Record<string, number> = {};
      tBalances.forEach(b => {
        netRecord[b.member_id] = b.net_balance;
      });
      const settlements = calculateSettlement(netRecord);

      let tripNetWithFriend = 0;
      for (const s of settlements) {
        if (s.from === friendMember.id && s.to === myMember.id) {
          tripNetWithFriend += Number(s.amount) || 0;
        } else if (s.from === myMember.id && s.to === friendMember.id) {
          tripNetWithFriend -= Number(s.amount) || 0;
        }
      }

      if (tripNetWithFriend !== 0) {
        totalNet += tripNetWithFriend;
        const isSplit =
          t.trip_type === 'friend_split' || t.name.toLowerCase().startsWith('split with ');
        const labelName = isSplit ? 'Direct Split' : t.name;
        tripBreakdownLabels.push(labelName);
      }

      // Collect expenses from this trip that involve this friend
      for (const exp of normalizedExps) {
        if (deletedExpenseIdsSet.has(exp.id)) continue;
        const amt = Number(exp.amount) || 0;
        const expSplits = exp.splits || [];
        const isPayerMe =
          exp.paid_by === myMember.id ||
          (user?.id && (exp.paid_by === user.id || exp.created_by === user.id));
        const isPayerFriend =
          exp.paid_by === friendMember.id ||
          (targetProfileId && exp.paid_by === targetProfileId);
        const mySplit = expSplits.find(
          (s: any) =>
            s.member_id === myMember.id ||
            (user?.id && (s.profile_id === user.id || s.member_id === user.id))
        );
        const friendSplit = expSplits.find(
          (s: any) =>
            s.member_id === friendMember.id ||
            (targetProfileId && (s.profile_id === targetProfileId || s.member_id === targetProfileId))
        );

        const meInSplit = Boolean(mySplit);
        const friendInSplit = Boolean(friendSplit);

        // Strict mutual involvement: in individual chat, show ONLY expenses where WE BOTH ARE SPLITTING TOGETHER!
        // 1. I paid, and friend is in the split
        // 2. Friend paid, and I am in the split
        // 3. Both of us are in the split together (even if a 3rd party paid)
        const isSplittingTogether =
          (isPayerMe && friendInSplit) ||
          (isPayerFriend && meInSplit) ||
          (meInSplit && friendInSplit);

        if (!isSplittingTogether) continue;

        let impactPaise = 0;
        if (isPayerMe && friendInSplit) {
          impactPaise = Number(friendSplit.amount) || 0; // Friend owes you
        } else if (isPayerFriend && mySplit) {
          impactPaise = -(Number(mySplit.amount) || 0); // You owe friend
        }

        const isSplitTrip =
          t.trip_type === 'friend_split' || t.name.toLowerCase().startsWith('split with ');

        synthesizedExpMsgs.push({
          id: `shared_exp_${exp.id}`,
          trip_id: t.id,
          sender_id: isPayerMe ? currentUserId : friendMember.id,
          sender_name: exp.payerName || (isPayerMe ? currentUserName : friendMember.display_name),
          message: `💰 Added expense: "${exp.description}"`,
          content: '',
          type: 'expense',
          expense_id: exp.id,
          expense_data: {
            id: exp.id,
            trip_id: t.id,
            trip_name: isSplitTrip ? 'Direct Split' : t.name,
            is_group_expense: !isSplitTrip,
            description: exp.description,
            amount: amt,
            currency: t.currency || 'INR',
            paid_by_name: exp.payerName || (isPayerMe ? 'You' : friendMember.display_name),
            paid_by_id: exp.paid_by,
            split_count: expSplits.length || tMembers.length,
            category: exp.category || 'General',
            impact_paise: impactPaise,
            attachment_url: exp.attachment_url || exp.screenshot_path || (exp as any).media_url || null,
            screenshot_path: exp.screenshot_path || exp.attachment_url || (exp as any).media_url || null,
            attachment_name: exp.attachment_name || (exp.attachment_url || exp.screenshot_path ? 'Receipt Photo' : null),
            attachment_type: exp.attachment_type || (exp.attachment_url || exp.screenshot_path ? 'image' : null),
            location: exp.location || null,
            date: exp.created_at || exp.date || new Date().toISOString(),
          },
          created_at: exp.created_at || exp.date || new Date().toISOString(),
        });
      }
    }

    // Fallback to contact store balance ONLY if no shared trips were found or processed
    if (totalNet === 0 && tripBreakdownLabels.length === 0 && matchedContact?.netBalancePaise) {
      totalNet = matchedContact.netBalancePaise;
    }

    setFriendNetPaise(totalNet);
    setSharedTripLabels(Array.from(new Set(tripBreakdownLabels)));
    setSharedExpenseMessages(synthesizedExpMsgs);

    const cacheKey = getFriendCacheKey(friendId, displayPhone, displayTitle);
    friendSharedDataCache.set(cacheKey, {
      friendNetPaise: totalNet,
      sharedTripLabels: Array.from(new Set(tripBreakdownLabels)),
      sharedExpenseMessages: synthesizedExpMsgs,
      timestamp: Date.now(),
    });
  } finally {
    setIsFriendDataLoaded(true);
  }
  }, [isGroup, displayTitle, displayPhone, friendId, contacts, tripId, user?.id, currentUserId, currentUserName]);

  useEffect(() => {
    let isMounted = true;
    prevMsgCountRef.current = 0;
    setIsChatReady(true);
    setMessagesVisibleCount(PAGE_SIZE);

    if (tripId) {
      // Mark trip as read and mark messages seen immediately
      markTripMessagesAsSeen(tripId, currentUserId);
      AppStorage.setItem(`@splityourtrip_last_read_${tripId}`, String(Date.now())).catch(() => {});
      try {
        useContactsStore.setState(s => ({
          contacts: s.contacts.map(c =>
            c.defaultTripId === tripId || (c as any).id === friendId ? { ...c, unseenMessagesCount: 0 } : c
          ),
        }));
      } catch {}

      if (isGroup) {
        const hasLocalTrip = trips.some(t => t.id === tripId);
        const hasLocalTripMessages = messages && messages.some(m => !m.trip_id || m.trip_id === tripId);
        const hasLocalTripExpenses = expenses && expenses.some(e => !e.trip_id || e.trip_id === tripId);
        if (!hasLocalTrip || (!hasLocalTripMessages && !hasLocalTripExpenses)) {
          setIsChatLoading(true);
          setIsTripDataLoaded(false);
        } else {
          setIsChatLoading(false);
          setIsTripDataLoaded(true);
        }
      } else {
        const hasLocalTrip = trips.some(t => t.id === tripId);
        const hasLocalMessages = messages && messages.length > 0;
        if (!hasLocalTrip || !hasLocalMessages) {
          setIsChatLoading(true);
        } else {
          setIsChatLoading(false);
        }
      }

      const safetyTimer = setTimeout(() => {
        if (isMounted) {
          setIsChatLoading(false);
          setIsTripDataLoaded(true);
          setIsFriendDataLoaded(true);
        }
      }, 1200);

      const startTime = Date.now();
      const minAnimationTime = 400; // brief smooth skeleton animation on initial load

      loadTripDetails(tripId)
        .catch(err => console.log('loadTripDetails error in ChatView:', err))
        .finally(() => {
          clearTimeout(safetyTimer);
          const elapsed = Date.now() - startTime;
          const remaining = Math.max(0, minAnimationTime - elapsed);
          setTimeout(() => {
            if (isMounted) {
              setIsChatLoading(false);
              setIsTripDataLoaded(true);
              setIsFriendDataLoaded(true);
              // Re-mark seen once fresh remote messages are loaded
              markTripMessagesAsSeen(tripId, currentUserId);
            }
          }, remaining);
        });

      const unsub = subscribeTripRealtime(tripId);
      // Supabase Realtime delivers messages instantaneously via WebSocket.
      // 30s heartbeat serves as a gentle fallback only for network reconnect resilience.
      const heartbeat = setInterval(() => {
        useTripStore.getState().syncTripMessages(tripId);
      }, 30000);

      return () => {
        isMounted = false;
        clearTimeout(safetyTimer);
        clearInterval(heartbeat);
        unsub();
        // Record final read timestamp upon leaving chat
        AppStorage.setItem(`@splityourtrip_last_read_${tripId}`, String(Date.now())).catch(() => {});
        if (currentUserId) {
          useContactsStore.getState().fetchFriendsSummary(currentUserId);
        }
      };
    } else {
      setIsChatLoading(false);
    }
  }, [tripId, currentUserId, markTripMessagesAsSeen]);

  // If trip was deleted remotely while viewing, exit gracefully
  useEffect(() => {
    if (tripId && deletedTripIdsSet.has(tripId)) {
      onBack ? onBack() : router.back();
    }
  }, [tripId, trips, onBack]);

  // Keep seen status synced whenever messages change while chat is active
  useEffect(() => {
    if (!tripId) return;
    const hasUnseen = messages.some(
      m => (!m.trip_id || m.trip_id === tripId) && m.sender_id !== currentUserId && !m.is_seen
    );
    if (hasUnseen) {
      markTripMessagesAsSeen(tripId, currentUserId);
    }
  }, [messages, tripId, currentUserId, markTripMessagesAsSeen]);

  useEffect(() => {
    if (!isGroup) {
      const cacheKey = getFriendCacheKey(friendId, displayPhone, displayTitle);
      const cached = friendSharedDataCache.get(cacheKey);
      if (cached) {
        setFriendNetPaise(cached.friendNetPaise);
        setSharedTripLabels(cached.sharedTripLabels);
        setSharedExpenseMessages(cached.sharedExpenseMessages);
        setIsFriendDataLoaded(true);
      } else {
        setIsFriendDataLoaded(false);
      }
      computeSharedFriendData();
    } else {
      setIsFriendDataLoaded(true);
    }
  }, [isGroup, friendId, displayTitle, displayPhone, tripId, computeSharedFriendData]);

  useFocusEffect(
    useCallback(() => {
      navLockRef.current = false;
      setActiveActionId(null);
      if (tripId) {
        useTripStore.getState().syncTripMessages(tripId);
      }
      if (!isGroup) {
        computeSharedFriendData();
      }
    }, [isGroup, tripId, computeSharedFriendData])
  );

  // Merge chat messages with expense cards and sort chronologically ascending (oldest -> newest, so last message is at bottom)
  const combinedMessages = useMemo(() => {
    // Strictly isolate messages to this tripId only to eliminate cross-trip message pollution!
    const tripScopedMessages = messages.filter(m => !m.trip_id || m.trip_id === tripId);

    if (isGroup) {
      const validTripExpenseIds = new Set(
        tripExpenses
          .filter(e => (!e.trip_id || e.trip_id === tripId) && !deletedExpenseIdsSet.has(e.id))
          .map(e => e.id)
      );

      // In group chat: retain trip expenses and valid messages
      const validMessages = tripScopedMessages.filter(m => {
        const expId = m.expense_id || m.expense_data?.id;
        if (expId && (deletedExpenseIdsSet.has(expId) || !validTripExpenseIds.has(expId))) {
          return false;
        }
        if (m.type === 'expense') {
          if (!expId || !validTripExpenseIds.has(expId) || deletedExpenseIdsSet.has(expId)) return false;
        }
        return true;
      });

      const existingExpenseIds = new Set<string>();
      validMessages.forEach(m => {
        if (m.expense_id) existingExpenseIds.add(m.expense_id);
        if (m.expense_data?.id) existingExpenseIds.add(m.expense_data.id);
      });

      const missingGroupExpenseMsgs: TripMessage[] = tripExpenses
        .filter(e => (!e.trip_id || e.trip_id === tripId) && !deletedExpenseIdsSet.has(e.id) && !existingExpenseIds.has(e.id))
        .map(exp => ({
          id: `group_exp_${exp.id}`,
          trip_id: tripId,
          sender_id: exp.created_by || exp.paid_by || currentUserId,
          sender_name: exp.payerName || 'Member',
          message: `💰 Added expense: "${exp.description}"`,
          content: '',
          type: 'expense',
          chat_type: 'group',
          expense_id: exp.id,
          expense_data: {
            id: exp.id,
            trip_id: tripId,
            trip_name: displayTitle,
            description: exp.description,
            amount: Number(exp.amount) || 0,
            currency: currentTrip?.currency || 'INR',
            paid_by_name: exp.payerName || 'Member',
            paid_by_id: exp.paid_by,
            split_count: exp.splits?.length || tripMembers.length || 2,
            category: exp.category || 'General',
            attachment_url: exp.attachment_url || exp.screenshot_path || (exp as any).media_url || null,
            screenshot_path: exp.screenshot_path || exp.attachment_url || (exp as any).media_url || null,
            attachment_name: exp.attachment_name || (exp.attachment_url || exp.screenshot_path ? 'Receipt Photo' : null),
            attachment_type: exp.attachment_type || (exp.attachment_url || exp.screenshot_path ? 'image' : null),
            location: exp.location || null,
            date: exp.created_at || exp.date || new Date().toISOString(),
          },
          created_at: exp.created_at || exp.date || new Date().toISOString(),
        }));

      return [...validMessages, ...missingGroupExpenseMsgs].sort(
        (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
      );
    }

    // Individual Chat (!isGroup):
    // Only show shared expenses where we both are splitting together!
    const validSharedExpenseIds = new Set(
      sharedExpenseMessages
        .map(se => se.expense_id || se.expense_data?.id)
        .filter((id): id is string => Boolean(id && !deletedExpenseIdsSet.has(id)))
    );

    // In individual chat: NEVER drop regular chat messages or expenses belonging directly to this trip!
    const validMessages = tripScopedMessages.filter(m => {
      const expId = m.expense_id || m.expense_data?.id;
      if (expId && deletedExpenseIdsSet.has(expId)) {
        return false;
      }
      if (m.type === 'expense') {
        if (m.trip_id === tripId) return true; // Direct trip expense, always valid!
        if (!expId || !validSharedExpenseIds.has(expId)) return false;
      }
      return true;
    });

    const existingExpenseIds = new Set<string>();
    const enrichedExisting = validMessages.map(m => {
      if (m.expense_id) {
        existingExpenseIds.add(m.expense_id);
        const matchShared = sharedExpenseMessages.find(se => se.expense_id === m.expense_id);
        if (matchShared && m.expense_data) {
          return {
            ...m,
            expense_data: {
              ...m.expense_data,
              ...matchShared.expense_data,
            },
          };
        }

        // Direct trip expense enrichment fallback: compute impactPaise & trip_name immediately
        const localExp = tripExpenses.find(e => e.id === m.expense_id);
        if (localExp && m.expense_data) {
          const isDirectSplit =
            currentTrip?.trip_type === 'friend_split' ||
            currentTrip?.name.toLowerCase().startsWith('split with ');
          const myMem = findMyMember(tripMembers, user?.id, currentUserPhone);
          const friendMem = tripMembers.find(mem => mem.id !== myMem?.id);
          const expSplits = localExp.splits || [];
          const isPayerMe =
            localExp.paid_by === myMem?.id ||
            (user?.id && (localExp.paid_by === user.id || localExp.created_by === user.id));
          const isPayerFriend = friendMem && localExp.paid_by === friendMem.id;
          const mySplit = expSplits.find(
            (s: any) =>
              s.member_id === myMem?.id ||
              (user?.id && (s.profile_id === user.id || s.member_id === user.id))
          );
          const friendSplit = friendMem
            ? expSplits.find(
                (s: any) =>
                  s.member_id === friendMem.id ||
                  (friendMem.profile_id &&
                    (s.profile_id === friendMem.profile_id || s.member_id === friendMem.profile_id))
              )
            : null;

          let impactPaise = 0;
          if (isPayerMe && friendSplit) {
            impactPaise = Number(friendSplit.amount) || 0;
          } else if (isPayerFriend && mySplit) {
            impactPaise = -(Number(mySplit.amount) || 0);
          } else if (isPayerFriend && !mySplit) {
            impactPaise = -Math.round((Number(localExp.amount) || 0) / 2);
          } else if (isPayerMe && !friendSplit) {
            impactPaise = Math.round((Number(localExp.amount) || 0) / 2);
          }

          return {
            ...m,
            expense_data: {
              ...m.expense_data,
              trip_name: isDirectSplit ? 'Direct Split' : (currentTrip?.name || 'Direct Split'),
              is_group_expense: !isDirectSplit,
              impact_paise: impactPaise,
              paid_by_name:
                localExp.payerName ||
                (isPayerMe ? 'You' : (friendMem?.display_name || displayTitle)),
              attachment_url:
                localExp.attachment_url ||
                localExp.screenshot_path ||
                (localExp as any).media_url ||
                m.expense_data?.attachment_url ||
                null,
              screenshot_path:
                localExp.screenshot_path ||
                localExp.attachment_url ||
                (localExp as any).media_url ||
                m.expense_data?.screenshot_path ||
                null,
              attachment_name: localExp.attachment_name || m.expense_data?.attachment_name || null,
              attachment_type: localExp.attachment_type || m.expense_data?.attachment_type || null,
            },
          };
        }
      }
      return m;
    });

    const additionalShared = sharedExpenseMessages.filter(
      se => se.expense_id && !deletedExpenseIdsSet.has(se.expense_id) && !existingExpenseIds.has(se.expense_id)
    );

    const finalMessages = [...enrichedExisting, ...additionalShared];
    return finalMessages.sort(
      (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
    );
  }, [
    isGroup,
    messages,
    sharedExpenseMessages,
    tripExpenses,
    tripId,
    currentUserId,
    displayTitle,
    currentTrip?.currency,
    tripMembers.length,
  ]);

  // Turn off loading once messages are populated (e.g. from local storage or cloud)
  useEffect(() => {
    if (combinedMessages.length > 0) {
      setIsChatLoading(false);
      setIsTripDataLoaded(true);
    }
  }, [combinedMessages.length]);

  // Paginate messages from the end (most recent `messagesVisibleCount` messages)
  const paginatedMessages = useMemo(() => {
    if (combinedMessages.length <= messagesVisibleCount) return combinedMessages;
    return combinedMessages.slice(combinedMessages.length - messagesVisibleCount);
  }, [combinedMessages, messagesVisibleCount]);

  // Inverted data for FlatList: newest message at index 0 (renders directly at bottom with NO scroll needed)
  const invertedMessages = useMemo(() => {
    return [...paginatedMessages].reverse();
  }, [paginatedMessages]);

  const scrollToBottom = useCallback((animated = true) => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated });
  }, []);

  // Track incoming messages: only animate scroll if a new message arrives while user is in active chat
  const trackedMsgCountRef = useRef(0);
  useEffect(() => {
    if (trackedMsgCountRef.current > 0 && combinedMessages.length > trackedMsgCountRef.current) {
      scrollToBottom(true);
    }
    trackedMsgCountRef.current = combinedMessages.length;
  }, [combinedMessages.length, scrollToBottom]);

  // Reset tracked message count on trip switch
  useEffect(() => {
    trackedMsgCountRef.current = 0;
  }, [tripId]);

  const handleLoadEarlierMessages = useCallback(() => {
    if (loadingEarlierMessages || messagesVisibleCount >= combinedMessages.length) return;
    setLoadingEarlierMessages(true);
    setTimeout(() => {
      setMessagesVisibleCount(prev => Math.min(prev + PAGE_SIZE, combinedMessages.length));
      setLoadingEarlierMessages(false);
    }, 250);
  }, [loadingEarlierMessages, messagesVisibleCount, combinedMessages.length]);

  // Group trip net balance for current user when isGroup === true
  const groupMyNetPaise = useMemo(() => {
    if (!isGroup) return 0;
    const myMember = findMyMember(tripMembers, user?.id, currentUserPhone) || tripMembers[0];
    if (!myMember) return 0;
    const row = balances.find(b => b.member_id === myMember.id);
    return row ? row.net_balance : 0;
  }, [isGroup, tripMembers, balances, user?.id, currentUserPhone]);

  // Primary creditor name when user owes in a group trip
  const groupPrimaryCreditorName = useMemo(() => {
    if (!isGroup) return displayTitle;
    const myMember = findMyMember(tripMembers, user?.id, currentUserPhone) || tripMembers[0];
    if (!myMember) return displayTitle;
    const netRecord: Record<string, number> = {};
    balances
      .filter(b => !b.trip_id || b.trip_id === tripId)
      .forEach(b => {
        netRecord[b.member_id] = b.net_balance;
      });
    const settlements = calculateSettlement(netRecord);
    const myDebt = settlements.find(s => s.from === myMember.id);
    if (myDebt) {
      const creditor = tripMembers.find(m => m.id === myDebt.to);
      if (creditor) {
        return getEffectiveContactName({
          phoneNumber: creditor.phone_number,
          contactName: creditor.display_name,
          displayName: creditor.display_name,
          fallback: creditor.display_name || 'Member',
        });
      }
    }
    return displayTitle;
  }, [isGroup, tripMembers, balances, tripId, user?.id, displayTitle]);

  const activeBannerNetPaise = isGroup ? groupMyNetPaise : friendNetPaise;
  const isChatContentReady = isGroup
    ? isTripDataLoaded && !isChatLoading
    : isFriendDataLoaded && isTripDataLoaded && !isChatLoading;

  const isBannerLoading = !isChatContentReady;
  const isFeedLoading = !isChatContentReady;

  // Helper to extract date from message or expense
  const getMessageDate = (item?: TripMessage | null): Date | null => {
    if (!item) return null;
    const raw = item.created_at || (item as any).expense_data?.date || (item as any).date;
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  };

  // Format date separators: Today, Yesterday, Tomorrow, or formatted calendar date
  const formatChatDateSeparator = (dateObj: Date): string => {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    if (dateObj.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (dateObj.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    } else if (dateObj.toDateString() === tomorrow.toDateString()) {
      return 'Tomorrow';
    }

    const isCurrentYear = dateObj.getFullYear() === today.getFullYear();
    return dateObj.toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: isCurrentYear ? undefined : 'numeric',
    });
  };

  // Format time (e.g. 10:45 AM)
  const formatTime = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const handleSendText = async () => {
    if (!inputText.trim()) return;
    const textToSend = inputText.trim();

    if (editingMessage) {
      const msgId = editingMessage.id;
      setEditingMessage(null);
      setInputText('');
      await editTripMessage(tripId, msgId, textToSend);
      return;
    }

    setInputText('');
    await sendMessage(
      tripId,
      currentUserId,
      resolvedSenderName,
      textToSend,
      undefined,
      isGroup ? 'group' : 'individual'
    );
    setTimeout(() => {
      scrollToBottom(true);
    }, 100);
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatPlaybackMillis = (millis: number) => {
    const totalSeconds = Math.max(0, Math.floor(millis / 1000));
    return formatDuration(totalSeconds);
  };

  const startVoiceRecording = async () => {
    try {
      if (!Audio?.requestPermissionsAsync) {
        Alert.alert(
          'Microphone / Audio Unavailable',
          'Voice notes require the expo-av native module which is not linked in this simulator binary.'
        );
        return;
      }
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'Microphone Permission',
          'Please enable microphone access in your device settings to record and send voice notes.'
        );
        return;
      }

      // Stop any active audio playback first
      if (soundRef.current) {
        try {
          await soundRef.current.stopAsync();
          await soundRef.current.unloadAsync();
        } catch {}
        soundRef.current = null;
        setPlayingAudioId(null);
        setIsPlayingAudio(false);
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      setIsRecording(true);
      setRecordingDuration(0);

      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.warn('Failed to start voice recording:', err);
      Alert.alert(
        'Microphone Notice',
        err?.message || 'Could not start audio recording. Please verify microphone permissions.'
      );
    }
  };

  const cancelVoiceRecording = async () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecording(false);
    setRecordingDuration(0);
    try {
      if (recordingRef.current) {
        await recordingRef.current.stopAndUnloadAsync();
        recordingRef.current = null;
      }
    } catch (e) {
      console.warn('Error cancelling recording:', e);
      recordingRef.current = null;
    }
  };

  const stopAndSendVoiceRecording = async () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    const currentRecording = recordingRef.current;
    const durationSecs = Math.max(1, recordingDuration);
    setIsRecording(false);
    setRecordingDuration(0);

    if (!currentRecording) return;
    setIsSendingVoice(true);

    try {
      await currentRecording.stopAndUnloadAsync();
      const uri = currentRecording.getURI();
      recordingRef.current = null;

      if (!uri) {
        setIsSendingVoice(false);
        return;
      }

      const durationLabel = formatDuration(durationSecs);

      await sendMessage(
        tripId,
        currentUserId,
        resolvedSenderName,
        `🎙️ Voice note (${durationLabel})`,
        {
          type: 'audio',
          url: uri,
          localUri: uri,
          duration: durationSecs,
        },
        isGroup ? 'group' : 'individual'
      );

      setTimeout(() => {
        scrollToBottom(true);
      }, 60);
    } catch (e: any) {
      console.warn('Failed to send voice note:', e);
      Alert.alert('Voice Note', 'Could not send audio note. Please try again.');
    } finally {
      setIsSendingVoice(false);
    }
  };

  const handleTogglePlayAudio = async (messageId: string, audioUrl?: string, originalDuration?: number) => {
    if (!audioUrl) return;

    if (!Audio?.Sound) {
      Alert.alert(
        'Audio Playback Unavailable',
        'Voice playback requires the expo-av native module which is not linked in this simulator binary.'
      );
      return;
    }

    try {
      if (playingAudioId === messageId && soundRef.current) {
        if (isPlayingAudio) {
          await soundRef.current.pauseAsync();
          setIsPlayingAudio(false);
        } else {
          await soundRef.current.playAsync();
          setIsPlayingAudio(true);
        }
        return;
      }

      if (soundRef.current) {
        try {
          await soundRef.current.stopAsync();
          await soundRef.current.unloadAsync();
        } catch {}
        soundRef.current = null;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      const { sound } = await Audio.Sound.createAsync(
        { uri: audioUrl },
        { shouldPlay: true },
        (status: any) => {
          if (status.isLoaded) {
            setAudioPlaybackPosition(status.positionMillis || 0);
            setAudioPlaybackDuration(status.durationMillis || (originalDuration ? originalDuration * 1000 : 0));
            setIsPlayingAudio(status.isPlaying);
            if (status.didJustFinish) {
              setIsPlayingAudio(false);
              setPlayingAudioId(null);
              setAudioPlaybackPosition(0);
            }
          } else if (status.error) {
            console.warn('Sound playback error:', status.error);
            setIsPlayingAudio(false);
            setPlayingAudioId(null);
          }
        }
      );

      soundRef.current = sound;
      setPlayingAudioId(messageId);
      setIsPlayingAudio(true);
    } catch (err: any) {
      console.warn('Error playing audio note:', err);
      Alert.alert('Audio Playback', 'Could not play voice note.');
      setPlayingAudioId(null);
      setIsPlayingAudio(false);
    }
  };

  const dismissAttachmentModalIfOpen = async () => {
    if (attachmentModalVisible) {
      setAttachmentModalVisible(false);
      await new Promise(resolve => setTimeout(resolve, Platform.OS === 'ios' ? 450 : 350));
    }
  };

  const handleCameraIconPress = () => {
    Keyboard.dismiss();
    Alert.alert(
      'Attach Media',
      'Choose an option:',
      [
        {
          text: 'Take Photo',
          onPress: handleTakePhoto,
        },
        {
          text: 'Choose from Gallery',
          onPress: handlePickImage,
        },
        {
          text: 'Cancel',
          style: 'cancel',
        },
      ]
    );
  };

  const handlePickImage = async () => {
    await dismissAttachmentModalIfOpen();
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission Required', 'Please enable photo & media permissions in your device settings.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        allowsEditing: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const isVideo =
          asset.type === 'video' ||
          Boolean(asset.fileName?.match(/\.(mp4|mov|m4v|3gp|webm)$/i)) ||
          Boolean(asset.uri?.match(/\.(mp4|mov|m4v|3gp|webm)$/i));
        const captionText = inputText.trim() || (isVideo ? '🎥 Video' : '📷 Photo');

        await sendMessage(
          tripId,
          currentUserId,
          resolvedSenderName,
          captionText,
          {
            type: isVideo ? 'video' : 'image',
            url: asset.uri,
            localUri: asset.uri,
            name: asset.fileName || (isVideo ? 'Video.mp4' : 'Photo.jpg'),
            size: asset.fileSize ? `${Math.round(asset.fileSize / 1024)} KB` : undefined,
            duration: asset.duration ? Math.round(asset.duration / 1000) : undefined,
          },
          isGroup ? 'group' : 'individual'
        );
        setInputText('');
        setTimeout(() => {
          scrollToBottom(true);
        }, 60);
      }
    } catch (e: any) {
      console.error('[ChatView] Pick image error:', e);
      Alert.alert('Error', e?.message || 'Could not pick media');
    }
  };

  const handleTakePhoto = async () => {
    await dismissAttachmentModalIfOpen();
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Camera Permission', 'Please enable camera permission in device settings.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const captionText = inputText.trim() || '📷 Photo';

        await sendMessage(
          tripId,
          currentUserId,
          resolvedSenderName,
          captionText,
          {
            type: 'image',
            url: asset.uri,
            localUri: asset.uri,
            name: asset.fileName || 'Photo.jpg',
            size: asset.fileSize ? `${Math.round(asset.fileSize / 1024)} KB` : undefined,
          },
          isGroup ? 'group' : 'individual'
        );
        setInputText('');
        setTimeout(() => {
          scrollToBottom(true);
        }, 60);
      }
    } catch (e: any) {
      console.error('[ChatView] Camera error:', e);
      Alert.alert('Camera Error', e?.message || 'Could not open camera');
    }
  };

  const handlePickDocument = async () => {
    await dismissAttachmentModalIfOpen();
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];

        await sendMessage(
          tripId,
          currentUserId,
          resolvedSenderName,
          file.name || 'Document',
          {
            type: 'document',
            url: file.uri,
            localUri: file.uri,
            name: file.name || 'Document.pdf',
            size: file.size ? `${Math.round(file.size / 1024)} KB` : 'PDF',
          },
          isGroup ? 'group' : 'individual'
        );
        setTimeout(() => {
          scrollToBottom(true);
        }, 60);
      }
    } catch (e: any) {
      console.error('[ChatView] Document error:', e);
      Alert.alert('Document Error', e?.message || 'Could not pick document');
    }
  };

  const handleOpenDoc = (url?: string) => {
    if (url) {
      Linking.openURL(url).catch(() => {
        Alert.alert('Document', 'Unable to open file preview on this device.');
      });
    }
  };

  // Open Pay Modal (with optional prefill amount)
  const handleOpenPayModal = (prefillAmt?: number) => {
    setAttachmentModalVisible(false);
    let defaultAmount = '';
    if (prefillAmt !== undefined && prefillAmt > 0) {
      defaultAmount = (prefillAmt / 100).toString();
    } else if (friendNetPaise < 0) {
      defaultAmount = (Math.abs(friendNetPaise) / 100).toString();
    }
    setPayAmountText(defaultAmount);
    const defaultTargetId = otherMember?.id || tripMembers.find(m => m.id !== myMember?.id)?.id || '';
    setPayTargetMemberId(defaultTargetId);
    setPayScreenshotUri(null);
    setPayScreenshotBase64(null);
    setPayNote('');
    setPayModalVisible(true);
  };

  // Open Request Money Modal (with optional prefill amount)
  const handleOpenRequestMoneyModal = (prefillAmt?: number) => {
    setAttachmentModalVisible(false);
    let defaultAmount = '';
    if (prefillAmt !== undefined && prefillAmt > 0) {
      defaultAmount = (prefillAmt / 100).toString();
    } else if (friendNetPaise > 0) {
      defaultAmount = (friendNetPaise / 100).toString();
    }
    setRequestAmountText(defaultAmount);
    const defaultTargetId = otherMember?.id || tripMembers.find(m => m.id !== myMember?.id)?.id || '';
    setRequestTargetMemberId(defaultTargetId);
    setRequestNote('');
    setRequestMoneyModalVisible(true);
  };

  const handlePickPaymentScreenshot = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission Required', 'Please enable photo permissions in device settings.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
        base64: true,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setPayScreenshotUri(result.assets[0].uri);
        setPayScreenshotBase64(result.assets[0].base64 || null);
      }
    } catch (e: any) {
      console.error('[ChatView] Payment screenshot error:', e);
      Alert.alert('Error', e?.message || 'Could not pick screenshot');
    }
  };

  const handleTakePaymentScreenshotPhoto = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Camera Permission', 'Please enable camera permission in device settings.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.8,
        base64: true,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setPayScreenshotUri(result.assets[0].uri);
        setPayScreenshotBase64(result.assets[0].base64 || null);
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not capture photo');
    }
  };

  const handleSubmitPayment = async () => {
    const numAmt = parseFloat(payAmountText);
    if (!numAmt || numAmt <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount.');
      return;
    }
    if (!payScreenshotUri) {
      Alert.alert('Screenshot Required', 'Please attach your payment confirmation screenshot.');
      return;
    }

    setIsSubmittingPayment(true);
    try {
      const amountPaise = Math.round(numAmt * 100);
      let remoteUrl = payScreenshotUri;

      if (payScreenshotBase64) {
        try {
          const client = supabaseAdmin || supabase;
          const storagePath = `settlements/${tripId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
          const arrayBuffer = decodeBase64ToArrayBuffer(payScreenshotBase64);
          const { data: uploadData } = await client.storage
            .from('attachments')
            .upload(storagePath, arrayBuffer, { contentType: 'image/jpeg', upsert: true });
          if (uploadData?.path) {
            const { data: pubData } = client.storage.from('attachments').getPublicUrl(uploadData.path);
            if (pubData?.publicUrl) {
              remoteUrl = pubData.publicUrl;
            }
          }
        } catch (uploadErr) {
          console.warn('Screenshot upload fallback to local URI:', uploadErr);
        }
      }

      const targetMem = tripMembers.find(m => m.id === payTargetMemberId) || otherMember || tripMembers[0];
      const targetName = targetMem?.display_name || 'Member';

      const payload = {
        type: 'payment_settlement',
        amountPaise,
        payerId: currentUserId,
        payerMemberId: myMember?.id,
        payerName: resolvedSenderName,
        receiverId: targetMem?.profile_id || targetMem?.id,
        receiverMemberId: targetMem?.id,
        receiverName: targetName,
        mediaUrl: remoteUrl,
        screenshotUrl: remoteUrl,
        note: payNote.trim() || undefined,
        status: 'pending',
      };

      await sendMessage(
        tripId,
        currentUserId,
        resolvedSenderName,
        JSON.stringify(payload),
        {
          type: 'image',
          url: remoteUrl,
          name: 'Payment_Screenshot.jpg',
        },
        isGroup ? 'group' : 'individual'
      );

      // Trigger high-priority notification to receiver
      useNotificationStore.getState().addNotification({
        type: 'payment_claim',
        title: `💰 Payment Claim: ₹${(amountPaise / 100).toFixed(0)}`,
        message: `${resolvedSenderName} paid ${formatCurrencyAmount(amountPaise, userCurrency)} to your account. Tap to verify screenshot and accept.`,
        tripId,
        amountPaise,
        senderId: currentUserId,
        senderName: resolvedSenderName,
        screenshotUrl: remoteUrl,
      });

      setPayModalVisible(false);
      setTimeout(() => {
        scrollToBottom(true);
      }, 100);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not submit payment');
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  const handleSubmitRequestMoney = async () => {
    const numAmt = parseFloat(requestAmountText);
    if (!numAmt || numAmt <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount.');
      return;
    }

    setIsSubmittingRequest(true);
    try {
      const amountPaise = Math.round(numAmt * 100);
      const targetMem = tripMembers.find(m => m.id === requestTargetMemberId) || otherMember || tripMembers[0];
      const targetName = targetMem?.display_name || 'Member';

      const payload = {
        type: 'payment_request',
        amountPaise,
        requesterId: currentUserId,
        requesterMemberId: myMember?.id,
        requesterName: resolvedSenderName,
        targetId: targetMem?.profile_id || targetMem?.id,
        targetMemberId: targetMem?.id,
        targetName,
        note: requestNote.trim() || undefined,
        status: 'requested',
      };

      await sendMessage(
        tripId,
        currentUserId,
        resolvedSenderName,
        JSON.stringify(payload),
        undefined,
        isGroup ? 'group' : 'individual'
      );

      useNotificationStore.getState().addNotification({
        type: 'payment_request',
        title: `💸 Payment Request: ₹${(amountPaise / 100).toFixed(0)}`,
        message: `${resolvedSenderName} requested ${formatCurrencyAmount(amountPaise, userCurrency)} from you.`,
        tripId,
        amountPaise,
        senderId: currentUserId,
        senderName: resolvedSenderName,
      });

      setRequestMoneyModalVisible(false);
      setTimeout(() => {
        scrollToBottom(true);
      }, 100);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not send payment request');
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  const handleAcceptPayment = async (item: TripMessage) => {
    let payload: any = item.payload;
    if (!payload && item.content && item.content.startsWith('{')) {
      try { payload = JSON.parse(item.content); } catch {}
    }
    if (!payload && item.message && item.message.startsWith('{')) {
      try { payload = JSON.parse(item.message); } catch {}
    }
    payload = payload || {};

    const amountPaise = Number(payload.amountPaise || payload.amount_paise) || 0;
    if (amountPaise <= 0) return;

    try {
      let payerMember = tripMembers.find(
        m => m.id === payload.payerMemberId || m.id === payload.payerId || m.profile_id === payload.payerId || (m as any).user_id === payload.payerId
      );
      if (!payerMember && otherMember) payerMember = otherMember;
      if (!payerMember) payerMember = tripMembers[0];

      let receiverMember = tripMembers.find(
        m => m.id === payload.receiverMemberId || m.id === payload.receiverId || m.profile_id === payload.receiverId || (m as any).user_id === payload.receiverId
      );
      if (!receiverMember && myMember) receiverMember = myMember;
      if (!receiverMember) receiverMember = tripMembers[1] || tripMembers[0];

      const payerName = payload.payerName || payerMember?.display_name || 'Member';
      const receiverName = payload.receiverName || receiverMember?.display_name || 'Member';

      const mode = (payload.paymentMode || 'cash') as PaymentMode;
      const targetTripId = payload.tripId || tripId;
      const targetDesc = `${mode === 'cash' ? '💵 Cash' : '📱 UPI'} Settlement: ${payerName} paid ${receiverName}`;

      // 1. Record settlement expense which mathematically offsets and deducts from debt/amount to receive!
      await addExpense({
        tripId: targetTripId,
        amountPaise,
        description: targetDesc,
        category: 'settlement',
        paidByMemberId: payerMember.id,
        paymentMode: mode,
        splitType: 'exact',
        participantMemberIds: [receiverMember.id],
        customSplits: [{ memberId: receiverMember.id, shareAmount: amountPaise }],
        attachmentUrl: payload.mediaUrl || payload.screenshotUrl || item.media_url,
        userId: currentUserId,
      });

      // 2. Also insert into public.settlement_payments table in Supabase
      if (isSupabaseConfigured && isValidUUID(targetTripId)) {
        try {
          const client = supabaseAdmin || supabase;
          await client.from('settlement_payments').insert({
            trip_id: targetTripId,
            from_member: payerMember.id,
            to_member: receiverMember.id,
            amount: amountPaise,
            method: mode,
            note: payload.note || (mode === 'cash' ? 'Settled in cash' : 'Paid via UPI'),
            paid_at: new Date().toISOString(),
          });
        } catch (spErr) {
          console.log('settlement_payments insert notice:', spErr);
        }
      }

      const updatedPayload = {
        ...payload,
        status: 'accepted',
        acceptedAt: new Date().toISOString(),
      };
      await editTripMessage(tripId, item.id, JSON.stringify(updatedPayload));

      // Also update matching claim in linked 1-on-1 / group chats if claimId present
      if (payload.claimId) {
        const storeMessages = useTripStore.getState().messages;
        const matchingMsgs = storeMessages.filter(
          m => m.id !== item.id && (m.content?.includes(payload.claimId) || (m.payload as any)?.claimId === payload.claimId)
        );
        for (const mm of matchingMsgs) {
          await editTripMessage(mm.trip_id, mm.id, JSON.stringify(updatedPayload)).catch(() => {});
        }
      }

      const amtStr = formatCurrencyAmount(amountPaise, userCurrency);
      await sendMessage(
        tripId,
        currentUserId,
        resolvedSenderName,
        `✅ Payment of ${amtStr} accepted and deducted from balance!`,
        undefined,
        isGroup ? 'group' : 'individual'
      );

      useNotificationStore.getState().addNotification({
        type: 'payment_accepted',
        title: '✅ Payment Accepted',
        message: `${resolvedSenderName} accepted your payment of ${amtStr}. Balance updated!`,
        tripId,
        amountPaise,
        senderId: currentUserId,
        senderName: resolvedSenderName,
      });

      await loadTripDetails(tripId);
      if (!isGroup) {
        useContactsStore.getState().fetchFriendsSummary(currentUserId);
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not accept payment');
    }
  };

  const handleRejectPayment = async (item: TripMessage) => {
    let payload: any = item.payload;
    if (!payload && item.content && item.content.startsWith('{')) {
      try { payload = JSON.parse(item.content); } catch {}
    }
    if (!payload && item.message && item.message.startsWith('{')) {
      try { payload = JSON.parse(item.message); } catch {}
    }
    payload = payload || {};

    const amountPaise = Number(payload.amountPaise || payload.amount_paise) || 0;
    const amtStr = formatCurrencyAmount(amountPaise, userCurrency);

    Alert.alert(
      'Reject Payment Claim?',
      `Are you sure you want to reject this payment claim of ${amtStr}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            try {
              const updatedPayload = {
                ...payload,
                status: 'rejected',
                rejectedAt: new Date().toISOString(),
              };
              await editTripMessage(tripId, item.id, JSON.stringify(updatedPayload));

              // Also update matching claim in linked 1-on-1 / group chats if claimId present
              if (payload.claimId) {
                const storeMessages = useTripStore.getState().messages;
                const matchingMsgs = storeMessages.filter(
                  m => m.id !== item.id && (m.content?.includes(payload.claimId) || (m.payload as any)?.claimId === payload.claimId)
                );
                for (const mm of matchingMsgs) {
                  await editTripMessage(mm.trip_id, mm.id, JSON.stringify(updatedPayload)).catch(() => {});
                }
              }

              await sendMessage(
                tripId,
                currentUserId,
                resolvedSenderName,
                `❌ Payment claim of ${amtStr} was rejected.`,
                undefined,
                isGroup ? 'group' : 'individual'
              );

              useNotificationStore.getState().addNotification({
                type: 'payment_rejected',
                title: '❌ Payment Claim Rejected',
                message: `${resolvedSenderName} rejected the payment claim of ${amtStr}.`,
                tripId,
                amountPaise,
                senderId: currentUserId,
                senderName: resolvedSenderName,
              });

              await loadTripDetails(tripId);
            } catch (e: any) {
              Alert.alert('Error', e?.message || 'Could not reject payment');
            }
          },
        },
      ]
    );
  };

  const effectiveSubtitle = isGroup
    ? `${tripMembers.length} ${tripMembers.length === 1 ? 'member' : 'members'} • ${tripExpenses.length} ${tripExpenses.length === 1 ? 'expense' : 'expenses'} • Total ${formatCurrencyAmount(totalGroupSpendPaise, currentTrip?.currency)}`
    : displayPhone && displayPhone !== 'Linked Contact'
    ? `${displayPhone} • Split Your Trip`
    : !isGuestFriend
    ? 'Linked Contact • Split Your Trip'
    : 'Guest Friend • Tap Link Contact';

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* Top Header with Trip/Chat Icon + Name + Info Subtitle (Click Name/Icon to open Info Screen) */}
      {showHeader && (
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
            onPress={() => {
              if (onBack) onBack();
              else router.back();
            }}
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>

          {/* Clickable Trip / Chat Identity Area -> Opens Info Screen */}
          <TouchableOpacity
            style={styles.headerIdentityRow}
            activeOpacity={0.75}
            onPress={() => router.push(`/trip/${tripId}/info`)}
          >
            <View style={[styles.headerAvatar, { backgroundColor: colors.primaryLight, overflow: 'hidden' }]}>
              {isGroup ? (
                <TripCoverBadge
                  imageUrl={currentTrip?.image_url}
                  size={38}
                  borderRadius={19}
                  fallbackEmoji="✈️"
                />
              ) : currentFriendAvatarUrl ? (
                <Image
                  source={{ uri: currentFriendAvatarUrl }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="cover"
                />
              ) : (
                <Text style={[styles.headerAvatarText, { color: colors.primary }]}>
                  {avatarText || displayTitle.charAt(0).toUpperCase()}
                </Text>
              )}
            </View>

            <View style={styles.headerTitleCol}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[styles.headerTitleText, { color: colors.text }]} numberOfLines={1}>
                  {displayTitle}
                </Text>
                {!isGroup && isGuestFriend && (
                  <View style={[styles.guestHeaderPill, { backgroundColor: colors.warningBg }]}>
                    <Text style={[styles.guestHeaderPillText, { color: colors.warning }]}>GUEST</Text>
                  </View>
                )}
                <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
              </View>
              <Text style={[styles.headerSubtitleText, { color: colors.textSecondary }]} numberOfLines={1}>
                {effectiveSubtitle}
              </Text>
            </View>
          </TouchableOpacity>

          {/* Three-Dots Button -> Opens Options Sidebar Drawer */}
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.headerIconBtn}
              onPress={() => setOptionsSidebarVisible(true)}
            >
              <Ionicons name="ellipsis-vertical" size={21} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Guest Friend Link Prompt Banner (if guest / unlinked in 1-on-1 chat) */}
      {!isGroup && isGuestFriend && (
        <View
          style={[
            styles.guestLinkBanner,
            {
              backgroundColor: colors.warningBg,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <View style={styles.guestLinkBannerLeft}>
            <Ionicons name="link-outline" size={18} color={colors.warning} />
            <Text
              style={[
                styles.guestLinkBannerText,
                { color: colors.text },
              ]}
              numberOfLines={2}
            >
              {displayTitle} is added as a Guest. Link with a phone contact to sync splits & phone number.
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.guestLinkActionBtn, { backgroundColor: colors.warning }]}
            onPress={openLinkContactModal}
          >
            <Ionicons name="person-add" size={13} color="#FFFFFF" />
            <Text style={styles.guestLinkActionText}>Link Contact</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Sticky Balance Banner (shows Pay button instead of Split button when You Owe) */}
      <View
        style={[
          styles.balanceBanner,
          {
            backgroundColor: isBannerLoading
              ? colors.cardSecondary
              : activeBannerNetPaise < 0
              ? colors.dangerBg
              : activeBannerNetPaise > 0
              ? colors.successBg
              : colors.cardSecondary,
            borderBottomColor: isBannerLoading
              ? colors.border
              : activeBannerNetPaise < 0
              ? colors.danger
              : activeBannerNetPaise > 0
              ? colors.success
              : colors.border,
          },
        ]}
      >
        {isBannerLoading ? (
          <View style={styles.balanceBannerLeft}>
            <Animated.View
              style={[
                styles.balanceBannerIcon,
                {
                  backgroundColor: isDark ? '#2A3649' : '#E2E8F0',
                  opacity: bannerPulseAnim,
                },
              ]}
            />
            <View style={{ flex: 1, gap: 5 }}>
              <Animated.View
                style={{
                  height: 14,
                  width: '60%',
                  borderRadius: 6,
                  backgroundColor: isDark ? '#2A3649' : '#E2E8F0',
                  opacity: bannerPulseAnim,
                }}
              />
              <Animated.View
                style={{
                  height: 10,
                  width: '38%',
                  borderRadius: 5,
                  backgroundColor: isDark ? '#1F2937' : '#EDF2F7',
                  opacity: bannerPulseAnim,
                }}
              />
            </View>
          </View>
        ) : (
          <View style={styles.balanceBannerLeft}>
            <View
              style={[
                styles.balanceBannerIcon,
                {
                  backgroundColor:
                    activeBannerNetPaise < 0
                      ? colors.dangerBg
                      : activeBannerNetPaise > 0
                      ? colors.successBg
                      : colors.borderLight,
                },
              ]}
            >
              <Ionicons
                name={
                  activeBannerNetPaise < 0
                    ? 'arrow-up-circle'
                    : activeBannerNetPaise > 0
                    ? 'arrow-down-circle'
                    : 'checkmark-circle'
                }
                size={20}
                color={
                  activeBannerNetPaise < 0
                    ? colors.danger
                    : activeBannerNetPaise > 0
                    ? colors.success
                    : colors.textSecondary
                }
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.balanceBannerTitle,
                  {
                    color:
                      activeBannerNetPaise < 0
                        ? colors.danger
                        : activeBannerNetPaise > 0
                        ? colors.success
                        : colors.text,
                  },
                ]}
              >
                {activeBannerNetPaise < 0
                  ? isGroup
                    ? `You owe ${formatCurrencyAmount(Math.abs(activeBannerNetPaise), currentTrip?.currency)}`
                    : `You owe ${displayTitle} ${formatCurrencyAmount(Math.abs(activeBannerNetPaise), currentTrip?.currency)}`
                  : activeBannerNetPaise > 0
                  ? isGroup
                    ? `You are owed ${formatCurrencyAmount(activeBannerNetPaise, currentTrip?.currency)}`
                    : `${displayTitle} owes you ${formatCurrencyAmount(activeBannerNetPaise, currentTrip?.currency)}`
                  : isGroup
                  ? 'All settled up'
                  : `Settled up with ${displayTitle}`}
              </Text>
              {!isGroup && sharedTripLabels.length > 0 && activeBannerNetPaise !== 0 ? (
                <Text style={[styles.balanceBannerSub, { color: colors.textSecondary }]} numberOfLines={1}>
                  From: {sharedTripLabels.join(', ')}
                </Text>
              ) : null}
            </View>
          </View>
        )}

        <View style={styles.balanceBannerActions}>
          {isBannerLoading ? (
            <Animated.View
              style={{
                width: 68,
                height: 28,
                borderRadius: 14,
                backgroundColor: isDark ? '#2A3649' : '#E2E8F0',
                opacity: bannerPulseAnim,
              }}
            />
          ) : activeBannerNetPaise < 0 ? (
            <TouchableOpacity
              style={[styles.payNowMiniBtn, { backgroundColor: colors.danger, minWidth: 74, justifyContent: 'center' }]}
              onPress={() => {
                const payeeName = isGroup ? groupPrimaryCreditorName : displayTitle;
                const rupees = (Math.abs(activeBannerNetPaise) / 100).toFixed(2);
                const upiUrl = `upi://pay?pn=${encodeURIComponent(payeeName)}&am=${rupees}&cu=INR`;
                Linking.openURL(upiUrl).catch(() => {
                  router.push({
                    pathname: '/trip/[id]/info',
                    params: { id: tripId, tab: 'settle' },
                  });
                });
              }}
            >
              <Ionicons name="flash" size={14} color="#FFFFFF" />
              <Text style={styles.payNowMiniText}>Pay</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.addSplitMiniBtn, { backgroundColor: colors.primary }]}
              onPress={() => {
                if (onAddExpense) onAddExpense();
                else router.push(`/trip/${tripId}/add`);
              }}
            >
              <Ionicons name="add" size={15} color="#FFFFFF" />
              <Text style={styles.addSplitMiniText}>Split</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Messages Feed */}
      <View style={{ flex: 1, position: 'relative' }}>
        {isFeedLoading ? (
          <ChatFeedSkeleton colors={colors} isDark={isDark} />
        ) : combinedMessages.length === 0 ? (
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <View style={styles.emptyCenterWrapper}>
              <View
                style={[
                  styles.emptyIconCircle,
                  {
                    backgroundColor: isDark ? 'rgba(99, 102, 241, 0.14)' : 'rgba(99, 102, 241, 0.08)',
                    borderColor: isDark ? 'rgba(99, 102, 241, 0.25)' : 'rgba(99, 102, 241, 0.2)',
                  },
                ]}
              >
                <Ionicons name="chatbubbles-outline" size={32} color={colors.primary} />
              </View>

              <Text style={[styles.emptyCenterTitle, { color: colors.text }]} allowFontScaling={false}>
                No messages yet
              </Text>

              <Text style={[styles.emptyCenterSubtitle, { color: colors.textSecondary }]} allowFontScaling={false}>
                {isGroup
                  ? `Send a message or tap "+ Split" to add the first expense for ${displayTitle}.`
                  : `Send a message or tap "+ Split" to add an expense with ${displayTitle}.`}
              </Text>

              <View
                style={[
                  styles.emptySecurityBadge,
                  {
                    backgroundColor: isDark ? '#1E293B' : '#F1F5F9',
                    borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
                  },
                ]}
              >
                <Ionicons name="lock-closed" size={12} color={colors.textSecondary} />
                <Text style={[styles.emptySecurityText, { color: colors.textSecondary }]} allowFontScaling={false}>
                  Messages & bills are end-to-end encrypted
                </Text>
              </View>
            </View>
          </TouchableWithoutFeedback>
        ) : (
          <FlatList
            ref={flatListRef}
            data={invertedMessages}
            keyExtractor={item => item.id}
            inverted
            initialNumToRender={PAGE_SIZE}
            maxToRenderPerBatch={PAGE_SIZE}
            windowSize={11}
            removeClippedSubviews={false}
            contentContainerStyle={styles.messagesList}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            onEndReached={handleLoadEarlierMessages}
            onEndReachedThreshold={0.15}
            ListFooterComponent={
              combinedMessages.length > messagesVisibleCount ? (
                <View style={styles.loadEarlierContainer}>
                  {loadingEarlierMessages ? (
                    <View style={styles.loadEarlierRow}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={[styles.loadEarlierText, { color: colors.textSecondary }]}>
                        Loading older messages...
                      </Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[
                        styles.loadEarlierBtn,
                        { backgroundColor: colors.card, borderColor: colors.border },
                      ]}
                      onPress={handleLoadEarlierMessages}
                    >
                      <Ionicons name="arrow-up-circle-outline" size={16} color={colors.primary} />
                      <Text style={[styles.loadEarlierBtnText, { color: colors.primary }]}>
                        Scroll up or tap for older messages ({combinedMessages.length - messagesVisibleCount} older)
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : null
            }
          renderItem={({ item, index }) => {
            const prevItem = invertedMessages[index + 1];
            const currentDate = getMessageDate(item);
            const prevDate = getMessageDate(prevItem);

            let shouldShowDateHeader = false;
            if (currentDate) {
              if (!prevDate) {
                shouldShowDateHeader = true;
              } else if (currentDate.toDateString() !== prevDate.toDateString()) {
                shouldShowDateHeader = true;
              }
            }

            const wrapWithDateHeader = (node: React.ReactElement) => {
              if (!shouldShowDateHeader || !currentDate) {
                return node;
              }
              return (
                <View style={styles.messageWithDateWrapper} key={`date_wrap_${item.id}`}>
                  <View style={styles.dateSeparatorRow}>
                    <View
                      style={[
                        styles.dateSeparatorBadge,
                        {
                          backgroundColor: isDark ? '#1E293B' : '#E2E8F0',
                          borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.dateSeparatorText,
                          { color: isDark ? '#E2E8F0' : '#475569' },
                        ]}
                      >
                        {formatChatDateSeparator(currentDate)}
                      </Text>
                    </View>
                  </View>
                  {node}
                </View>
              );
            };

          // Reliably identify if message was sent by active user
          const isSenderOther = Boolean(
            otherMember &&
            (
              (item.sender_id && (item.sender_id === otherMember.id || item.sender_id === otherMember.profile_id || item.sender_id === (otherMember as any).user_id)) ||
              (item.sender_name && otherMember.display_name && item.sender_name.trim().toLowerCase() === otherMember.display_name.trim().toLowerCase())
            )
          );

          const isMine = !isSenderOther && Boolean(
            (user?.id && (item.sender_id === user.id || (item as any).sender_profile_id === user.id)) ||
            (currentUserId && item.sender_id === currentUserId) ||
            (myMember && (item.sender_id === myMember.id || item.sender_id === myMember.profile_id || item.sender_id === (myMember as any).user_id)) ||
            (item.sender_name && currentUserName && currentUserName !== 'You' && item.sender_name.trim().toLowerCase() === currentUserName.trim().toLowerCase())
          );

          const isFromOther = !isGroup ? !isMine : false;

          // 1. Photo Message
          const photoUrl =
            item.media_url ||
            (item as any).payload?.media_url ||
            (item as any).payload?.mediaUrl ||
            (item as any).payload?.url;
          if (item.type === 'image' && photoUrl) {
            return wrapWithDateHeader(
              <View
                style={[
                  styles.bubbleContainer,
                  isMine ? styles.bubbleRight : styles.bubbleLeft,
                ]}
              >
                <View
                  style={[
                    styles.imageBubble,
                    {
                      backgroundColor: isMine ? colors.primary : colors.card,
                      borderColor: isMine ? 'transparent' : colors.border,
                      borderWidth: isMine ? 0 : 1,
                    },
                  ]}
                >
                  {isGroup && !isMine && (
                    <Text style={[styles.senderNameHeader, { color: colors.primary, paddingHorizontal: 8, paddingTop: 6 }]}>
                      {resolveSenderName(item)}
                    </Text>
                  )}
                  <TouchableOpacity
                    activeOpacity={item.is_sent === false ? 1 : 0.9}
                    onPress={() => item.is_sent !== false && setSelectedPhotoPreview(photoUrl || null)}
                    onLongPress={() => item.is_sent !== false && handleMessageLongPress(item, isMine)}
                    delayLongPress={280}
                  >
                    <Image source={{ uri: photoUrl }} style={styles.messageImage} />
                    {item.is_sent === false && (
                      <View style={styles.mediaUploadingOverlay}>
                        <View style={styles.mediaUploadingCenterPill}>
                          <ActivityIndicator size="large" color="#FFFFFF" />
                          <View style={styles.mediaUploadingBadge}>
                            <Ionicons
                              name={!isNetOnline ? 'cloud-offline' : 'cloud-upload'}
                              size={13}
                              color="#FFFFFF"
                              style={{ marginRight: 4 }}
                            />
                            <Text style={styles.mediaUploadingText}>
                              {!isNetOnline ? 'Waiting for network...' : 'Uploading...'}
                            </Text>
                          </View>
                        </View>
                      </View>
                    )}
                  </TouchableOpacity>

                  {item.message && item.message !== '📷 Photo' ? (
                    <Text style={[styles.imageCaption, { color: isMine ? '#FFFFFF' : colors.text }]}>
                      {item.message}
                    </Text>
                  ) : null}

                  <View style={styles.bubbleMetaRow}>
                    <Text style={[styles.timestampText, { color: isMine ? 'rgba(255,255,255,0.75)' : colors.textMuted }]}>
                      {formatTime(item.created_at)}
                    </Text>
                    {isMine && renderMessageTicks(item, isMine)}
                  </View>
                </View>
              </View>
            );
          }

          // 1.5 Video Message
          const videoUrl =
            item.media_url ||
            (item as any).payload?.media_url ||
            (item as any).payload?.mediaUrl ||
            (item as any).payload?.url;
          if (item.type === 'video' && videoUrl) {
            const isPendingUpload = item.is_sent === false;
            return wrapWithDateHeader(
              <View
                style={[
                  styles.bubbleContainer,
                  isMine ? styles.bubbleRight : styles.bubbleLeft,
                ]}
              >
                <View
                  style={[
                    styles.imageBubble,
                    {
                      backgroundColor: isMine ? colors.primary : colors.card,
                      borderColor: isMine ? 'transparent' : colors.border,
                      borderWidth: isMine ? 0 : 1,
                    },
                  ]}
                >
                  {isGroup && !isMine && (
                    <Text style={[styles.senderNameHeader, { color: colors.primary, paddingHorizontal: 8, paddingTop: 6 }]}>
                      {resolveSenderName(item)}
                    </Text>
                  )}
                  <TouchableOpacity
                    activeOpacity={isPendingUpload ? 1 : 0.88}
                    onPress={() => !isPendingUpload && setSelectedVideoPreview(videoUrl || null)}
                    onLongPress={() => !isPendingUpload && handleMessageLongPress(item, isMine)}
                    delayLongPress={280}
                    style={{ position: 'relative' }}
                  >
                    <SafeVideo
                      source={{ uri: videoUrl }}
                      style={styles.messageImage}
                      resizeMode={ResizeMode.COVER}
                      useNativeControls={false}
                      isMuted
                      shouldPlay={false}
                    />

                    {/* Play Button Overlay */}
                    {!isPendingUpload && (
                      <View style={styles.videoPlayOverlay}>
                        <View style={styles.videoPlayBtnCircle}>
                          <Ionicons name="play" size={26} color="#FFFFFF" style={{ marginLeft: 3 }} />
                        </View>
                      </View>
                    )}

                    {/* Video Duration / Tag */}
                    <View style={styles.videoDurationBadge}>
                      <Ionicons name="videocam" size={12} color="#FFFFFF" style={{ marginRight: 4 }} />
                      <Text style={styles.videoDurationText}>
                        {item.duration ? formatDuration(item.duration) : 'Video'}
                      </Text>
                    </View>

                    {isPendingUpload && (
                      <View style={styles.mediaUploadingOverlay}>
                        <View style={styles.mediaUploadingCenterPill}>
                          <ActivityIndicator size="large" color="#FFFFFF" />
                          <View style={styles.mediaUploadingBadge}>
                            <Ionicons
                              name={!isNetOnline ? 'cloud-offline' : 'cloud-upload'}
                              size={13}
                              color="#FFFFFF"
                              style={{ marginRight: 4 }}
                            />
                            <Text style={styles.mediaUploadingText}>
                              {!isNetOnline ? 'Waiting for network...' : 'Uploading video...'}
                            </Text>
                          </View>
                        </View>
                      </View>
                    )}
                  </TouchableOpacity>

                  {item.message && item.message !== '🎥 Video' ? (
                    <Text style={[styles.imageCaption, { color: isMine ? '#FFFFFF' : colors.text }]}>
                      {item.message}
                    </Text>
                  ) : null}

                  <View style={styles.bubbleMetaRow}>
                    <Text style={[styles.timestampText, { color: isMine ? 'rgba(255,255,255,0.75)' : colors.textMuted }]}>
                      {formatTime(item.created_at)}
                    </Text>
                    {isMine && renderMessageTicks(item, isMine)}
                  </View>
                </View>
              </View>
            );
          }

          // 2. Document Message
          if (item.type === 'document') {
            const docUrl =
              item.media_url ||
              (item as any).payload?.media_url ||
              (item as any).payload?.mediaUrl ||
              (item as any).payload?.url;
            return wrapWithDateHeader(
              <View
                style={[
                  styles.bubbleContainer,
                  isMine ? styles.bubbleRight : styles.bubbleLeft,
                ]}
              >
                <TouchableOpacity
                  style={[
                    styles.docBubble,
                    {
                      backgroundColor: isMine ? colors.primary : colors.card,
                      borderColor: isMine ? 'transparent' : colors.border,
                      borderWidth: isMine ? 0 : 1,
                    },
                  ]}
                  activeOpacity={0.8}
                  onPress={() => handleOpenDoc(docUrl)}
                  onLongPress={() => handleMessageLongPress(item, isMine)}
                  delayLongPress={280}
                >
                  {isGroup && !isMine && (
                    <Text style={[styles.senderNameHeader, { color: colors.primary, marginBottom: 4 }]}>
                      {resolveSenderName(item)}
                    </Text>
                  )}
                  <View style={[styles.docIconBox, { backgroundColor: isMine ? 'rgba(255,255,255,0.2)' : colors.dangerBg }]}>
                    {item.is_sent === false ? (
                      <ActivityIndicator size="small" color={isMine ? '#FFFFFF' : colors.danger} />
                    ) : (
                      <Ionicons name="document-text" size={24} color={isMine ? '#FFFFFF' : colors.danger} />
                    )}
                  </View>
                  <View style={{ flex: 1, marginHorizontal: 8 }}>
                    <Text
                      style={[styles.docName, { color: isMine ? '#FFFFFF' : colors.text }]}
                      numberOfLines={1}
                    >
                      {item.media_name || item.message || 'Document.pdf'}
                    </Text>
                    {item.is_sent === false ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                        <Ionicons
                          name={!isNetOnline ? 'cloud-offline-outline' : 'cloud-upload-outline'}
                          size={12}
                          color={isMine ? 'rgba(255,255,255,0.9)' : colors.primary}
                          style={{ marginRight: 4 }}
                        />
                        <Text style={[styles.docSize, { color: isMine ? '#FFFFFF' : colors.primary, fontWeight: '700' }]}>
                          {!isNetOnline ? 'Waiting for network...' : 'Uploading document...'}
                        </Text>
                      </View>
                    ) : (
                      <Text style={[styles.docSize, { color: isMine ? 'rgba(255,255,255,0.75)' : colors.textMuted }]}>
                        {item.media_size || 'PDF Document'}
                      </Text>
                    )}
                  </View>
                  {item.is_sent === false ? (
                    <View style={styles.docUploadingBox}>
                      <ActivityIndicator size="small" color={isMine ? '#FFFFFF' : colors.primary} />
                    </View>
                  ) : (
                    <Ionicons name="download-outline" size={20} color={isMine ? 'rgba(255,255,255,0.85)' : colors.textSecondary} />
                  )}

                  <View style={styles.docMetaRow}>
                    <Text style={[styles.timestampText, { color: isMine ? 'rgba(255,255,255,0.75)' : colors.textMuted }]}>
                      {formatTime(item.created_at)}
                    </Text>
                    {isMine && renderMessageTicks(item, isMine)}
                  </View>
                </TouchableOpacity>
              </View>
            );
          }

          // 2.5 Audio Voice Note Message
          if (item.type === 'audio') {
            const audioUrl =
              item.media_url ||
              (item as any).payload?.media_url ||
              (item as any).payload?.mediaUrl ||
              (item as any).payload?.url;
            const isThisPlaying = playingAudioId === item.id && isPlayingAudio;
            const isThisLoaded = playingAudioId === item.id;
            const displayDur = isThisLoaded && audioPlaybackPosition > 0
              ? formatPlaybackMillis(audioPlaybackPosition)
              : (item.duration ? formatDuration(item.duration) : '0:05');

            const progressRatio = isThisLoaded && audioPlaybackDuration > 0
              ? Math.min(1, Math.max(0, audioPlaybackPosition / audioPlaybackDuration))
              : 0;

            return wrapWithDateHeader(
              <View
                style={[
                  styles.bubbleContainer,
                  isMine ? styles.bubbleRight : styles.bubbleLeft,
                ]}
              >
                <TouchableOpacity
                  style={[
                    styles.audioBubble,
                    {
                      backgroundColor: isMine ? colors.primary : colors.card,
                      borderColor: isMine ? 'transparent' : colors.border,
                      borderWidth: isMine ? 0 : 1,
                    },
                  ]}
                  activeOpacity={0.88}
                  onLongPress={() => handleMessageLongPress(item, isMine)}
                  delayLongPress={280}
                >
                  {isGroup && !isMine && (
                    <Text style={[styles.senderNameHeader, { color: colors.primary, marginBottom: 6 }]}>
                      {resolveSenderName(item)}
                    </Text>
                  )}

                  <View style={styles.audioMainRow}>
                    {/* Play / Pause Circular Button */}
                    <TouchableOpacity
                      style={[
                        styles.audioPlayBtn,
                        {
                          backgroundColor: isMine ? 'rgba(255,255,255,0.25)' : (isDark ? 'rgba(99, 102, 241, 0.2)' : '#EEF2FF'),
                        },
                      ]}
                      disabled={item.is_sent === false}
                      onPress={() => handleTogglePlayAudio(item.id, audioUrl, item.duration)}
                    >
                      {item.is_sent === false ? (
                        <ActivityIndicator size="small" color={isMine ? '#FFFFFF' : colors.primary} />
                      ) : (
                        <Ionicons
                          name={isThisPlaying ? 'pause' : 'play'}
                          size={22}
                          color={isMine ? '#FFFFFF' : colors.primary}
                          style={{ marginLeft: isThisPlaying ? 0 : 2 }}
                        />
                      )}
                    </TouchableOpacity>

                    {/* Waveform track & scrub bar */}
                    <View style={styles.audioTrackContainer}>
                      <View style={styles.audioTrackBg}>
                        <View
                          style={[
                            styles.audioTrackProgress,
                            {
                              width: `${Math.round(progressRatio * 100)}%`,
                              backgroundColor: isMine ? '#FFFFFF' : colors.primary,
                            },
                          ]}
                        />
                      </View>

                      {/* Waveform decorative bars */}
                      <View style={styles.audioWaveformVisual}>
                        {[6, 12, 18, 10, 16, 20, 14, 8, 16, 22, 17, 11, 14, 19, 10, 16, 12, 8].map((h, idx) => {
                          const barActive = progressRatio >= (idx / 18);
                          return (
                            <View
                              key={idx}
                              style={[
                                styles.audioWaveBar,
                                {
                                  height: h,
                                  backgroundColor: isMine
                                    ? (barActive ? '#FFFFFF' : 'rgba(255,255,255,0.45)')
                                    : (barActive ? colors.primary : (isDark ? 'rgba(255,255,255,0.18)' : '#CBD5E1')),
                                },
                              ]}
                            />
                          );
                        })}
                      </View>

                      {/* Duration & status */}
                      <View style={styles.audioTimeRow}>
                        <Text
                          style={[
                            styles.audioDurationText,
                            { color: isMine ? 'rgba(255,255,255,0.85)' : colors.textSecondary },
                          ]}
                        >
                          {item.is_sent === false
                            ? (!isNetOnline ? 'Waiting for network...' : 'Uploading...')
                            : displayDur}
                        </Text>
                        <Ionicons
                          name="mic"
                          size={12}
                          color={isMine ? 'rgba(255,255,255,0.7)' : colors.textMuted}
                        />
                      </View>
                    </View>
                  </View>

                  <View style={styles.audioMetaRow}>
                    <Text style={[styles.timestampText, { color: isMine ? 'rgba(255,255,255,0.75)' : colors.textMuted }]}>
                      {formatTime(item.created_at)}
                    </Text>
                    {isMine && renderMessageTicks(item, isMine)}
                  </View>
                </TouchableOpacity>
              </View>
            );
          }

          // 3. Expense Notification Card
          if (item.type === 'expense' && item.expense_data) {
            const exp = item.expense_data;
            const impactPaise = Number(exp.impact_paise) || 0;
            const targetTripId = exp.trip_id || tripId;
            return wrapWithDateHeader(
              <View style={styles.expenseCardContainer}>
                <View
                  style={[
                    styles.expenseCard,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  {exp.trip_name && !isGroup ? (
                    <View style={styles.expenseTripBadgeRow}>
                      <View
                        style={[
                          styles.expenseTripBadge,
                          { backgroundColor: colors.primaryLight },
                        ]}
                      >
                        <Ionicons
                          name={exp.trip_name === 'Direct Split' ? 'people' : 'airplane'}
                          size={11}
                          color={colors.primary}
                        />
                        <Text style={[styles.expenseTripBadgeText, { color: colors.primary }]}>
                          {exp.trip_name}
                        </Text>
                      </View>

                      {impactPaise !== 0 && (
                        <Text
                          style={[
                            styles.expenseImpactText,
                            {
                              color:
                                exp.is_group_expense || exp.trip_name !== 'Direct Split'
                                  ? colors.textSecondary
                                  : impactPaise < 0
                                  ? colors.danger
                                  : colors.success,
                            },
                          ]}
                        >
                          {exp.is_group_expense || exp.trip_name !== 'Direct Split'
                            ? `Your share ${formatCurrencyAmount(Math.abs(impactPaise), exp.currency || currentTrip?.currency)}`
                            : impactPaise < 0
                            ? `You owe ${formatCurrencyAmount(Math.abs(impactPaise), exp.currency || currentTrip?.currency)}`
                            : `Owes you ${formatCurrencyAmount(impactPaise, exp.currency || currentTrip?.currency)}`}
                        </Text>
                      )}
                    </View>
                  ) : null}

                  <View style={styles.expenseCardTop}>
                    <View style={[styles.expenseIconBox, { backgroundColor: colors.successBg }]}>
                      <Ionicons name="receipt" size={20} color={colors.success} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.expenseCardTitle, { color: colors.text }]}>
                        {exp.description}
                      </Text>
                      <Text style={[styles.expenseCardSubtitle, { color: colors.textSecondary }]}>
                        Paid by {resolveExpensePayerName(exp)} • Split among {exp.split_count || 2} members
                      </Text>
                      {exp.location ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3, gap: 3 }}>
                          <Ionicons name="location-sharp" size={11} color={colors.primary} />
                          <Text style={{ fontSize: 11, color: colors.textSecondary }} numberOfLines={1}>
                            {exp.location}
                          </Text>
                        </View>
                      ) : null}
                      {(() => {
                        const cardAttachment =
                          exp.attachment_url ||
                          exp.screenshot_path ||
                          (exp as any).media_url ||
                          (exp as any).attachmentUrl;
                        if (!cardAttachment) return null;
                        const isDoc =
                          exp.attachment_type === 'pdf' ||
                          exp.attachment_type === 'doc' ||
                          cardAttachment.toLowerCase().endsWith('.pdf') ||
                          cardAttachment.toLowerCase().endsWith('.doc') ||
                          cardAttachment.toLowerCase().endsWith('.docx');
                        return (
                          <TouchableOpacity
                            activeOpacity={0.8}
                            onPress={() => {
                              if (!isDoc) {
                                setSelectedPhotoPreview(cardAttachment);
                              } else {
                                handleOpenDoc(cardAttachment);
                              }
                            }}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              marginTop: 4,
                              gap: 4,
                              backgroundColor: colors.primaryLight,
                              alignSelf: 'flex-start',
                              paddingHorizontal: 7,
                              paddingVertical: 3,
                              borderRadius: 6,
                            }}
                          >
                            <Ionicons name={isDoc ? 'document-text' : 'image'} size={12} color={colors.primary} />
                            <Text style={{ fontSize: 11, color: colors.primary, fontWeight: '600' }} numberOfLines={1}>
                              {exp.attachment_name || (isDoc ? 'Ticket / Document' : 'Receipt Screenshot')}
                            </Text>
                            <Ionicons name="eye-outline" size={11} color={colors.primary} style={{ marginLeft: 2 }} />
                          </TouchableOpacity>
                        );
                      })()}
                    </View>
                    <Text style={[styles.expenseCardAmount, { color: colors.primary }]}>
                      {formatCurrencyAmount(exp.amount, exp.currency || currentTrip?.currency)}
                    </Text>
                  </View>

                  <View style={[styles.expenseCardBottom, { borderTopColor: colors.border }]}>
                    <Text style={[styles.expenseTime, { color: colors.textMuted }]}>{formatTime(item.created_at)}</Text>
                    <TouchableOpacity
                      style={[styles.viewExpenseBtn, { backgroundColor: colors.primary, minWidth: 84, alignItems: 'center' }]}
                      onPress={() => {
                        const expenseIdToOpen = exp.id || item.expense_id;
                        if (expenseIdToOpen) {
                          router.push(`/trip/${targetTripId}/expense/${expenseIdToOpen}`);
                        } else {
                          router.push(`/trip/${targetTripId}`);
                        }
                      }}
                    >
                      <Text style={styles.viewExpenseText}>View Bill</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            );
          }

          // 4. Payment Settlement / Claim Card
          const isSettlementMsg =
            item.type === 'payment_settlement' ||
            item.type === 'payment_claim' ||
            (item.content && (item.content.includes('"type":"payment_settlement"') || item.content.includes('"type":"payment_claim"')));

          if (isSettlementMsg) {
            let pData: any = item.payload;
            if (!pData && item.content && item.content.startsWith('{')) {
              try { pData = JSON.parse(item.content); } catch {}
            }
            if (!pData && item.message && item.message.startsWith('{')) {
              try { pData = JSON.parse(item.message); } catch {}
            }
            pData = pData || {};

            const amountPaise = Number(pData.amountPaise || pData.amount_paise) || 0;
            const amtStr = formatCurrencyAmount(amountPaise, userCurrency);
            const status = pData.status || 'pending';
            const screenshotUrl = pData.mediaUrl || pData.screenshotUrl || pData.screenshot_url || item.media_url;
            const payerName = pData.payerName || item.sender_name || 'Member';
            const receiverName = pData.receiverName || 'Receiver';
            const note = pData.note;

            const isPayer = Boolean(
              isMine ||
              (pData.payerId && (
                pData.payerId === currentUserId ||
                pData.payerId === user?.id ||
                (myMember && (myMember.id === pData.payerId || myMember.profile_id === pData.payerId || (myMember as any).user_id === pData.payerId))
              )) ||
              (pData.payerPhone && (
                (myMember?.phone_number && myMember.phone_number.replace(/[^0-9]/g, '').slice(-10) === pData.payerPhone.replace(/[^0-9]/g, '').slice(-10)) ||
                (currentUserPhone && currentUserPhone.replace(/[^0-9]/g, '').slice(-10) === pData.payerPhone.replace(/[^0-9]/g, '').slice(-10))
              ))
            );

            const isReceiver = !isPayer && Boolean(
              (pData.receiverId && (
                pData.receiverId === currentUserId ||
                pData.receiverId === user?.id ||
                (myMember && (
                  myMember.id === pData.receiverId ||
                  myMember.profile_id === pData.receiverId ||
                  (myMember as any).user_id === pData.receiverId
                ))
              )) ||
              (pData.receiverMemberId && myMember && myMember.id === pData.receiverMemberId) ||
              (pData.receiverPhone && (
                (myMember?.phone_number && myMember.phone_number.replace(/[^0-9]/g, '').slice(-10) === pData.receiverPhone.replace(/[^0-9]/g, '').slice(-10)) ||
                (currentUserPhone && currentUserPhone.replace(/[^0-9]/g, '').slice(-10) === pData.receiverPhone.replace(/[^0-9]/g, '').slice(-10))
              )) ||
              (pData.receiverName && (
                (currentUserName && currentUserName !== 'You' && currentUserName.trim().toLowerCase() === pData.receiverName.trim().toLowerCase()) ||
                (myMember?.display_name && myMember.display_name !== 'You' && myMember.display_name.trim().toLowerCase() === pData.receiverName.trim().toLowerCase())
              )) ||
              (!isGroup && !isMine)
            );

            const isAccepted = status === 'accepted';
            const isRejected = status === 'rejected';
            const isPending = status === 'pending';

            return wrapWithDateHeader(
              <View style={styles.settlementCardContainer}>
                <View
                  style={[
                    styles.settlementCard,
                    {
                      backgroundColor: colors.card,
                      borderColor: isAccepted ? colors.success : isRejected ? colors.danger : colors.border,
                      borderWidth: isAccepted || isRejected ? 1.5 : 1,
                    },
                  ]}
                >
                  <View style={styles.settleCardHeaderRow}>
                    <View
                      style={[
                        styles.settleIconBox,
                        {
                          backgroundColor: isAccepted
                            ? 'rgba(16, 185, 129, 0.15)'
                            : isRejected
                            ? 'rgba(239, 68, 68, 0.15)'
                            : pData.paymentMode === 'cash'
                            ? 'rgba(16, 185, 129, 0.15)'
                            : 'rgba(99, 102, 241, 0.15)',
                        },
                      ]}
                    >
                      <Ionicons
                        name={isAccepted ? 'checkmark-circle' : isRejected ? 'close-circle' : pData.paymentMode === 'cash' ? 'cash' : 'card'}
                        size={20}
                        color={isAccepted ? colors.success : isRejected ? colors.danger : pData.paymentMode === 'cash' ? colors.success : colors.primary}
                      />
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={[styles.settleCardTitle, { color: colors.text }]}>
                          Payment: {amtStr}
                        </Text>
                        <View
                          style={{
                            paddingHorizontal: 6,
                            paddingVertical: 2,
                            borderRadius: 6,
                            backgroundColor: pData.paymentMode === 'cash' ? '#DCFCE7' : '#EEF2FF',
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 10,
                              fontWeight: '700',
                              color: pData.paymentMode === 'cash' ? '#15803D' : '#4F46E5',
                            }}
                          >
                            {pData.paymentMode === 'cash' ? '💵 CASH' : '📱 UPI'}
                          </Text>
                        </View>
                      </View>
                      <Text style={[styles.settleCardSub, { color: colors.textSecondary }]}>
                        {payerName} ➔ {receiverName}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.settleStatusBadge,
                        {
                          backgroundColor: isAccepted
                            ? 'rgba(16, 185, 129, 0.15)'
                            : isRejected
                            ? 'rgba(239, 68, 68, 0.15)'
                            : 'rgba(245, 158, 11, 0.15)',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.settleStatusText,
                          {
                            color: isAccepted ? colors.success : isRejected ? colors.danger : '#D97706',
                          },
                        ]}
                      >
                        {isAccepted ? 'Accepted' : isRejected ? 'Rejected' : 'Pending'}
                      </Text>
                    </View>
                  </View>

                  {/* Payment Screenshot Thumbnail */}
                  {screenshotUrl ? (
                    <TouchableOpacity
                      activeOpacity={0.9}
                      onPress={() => setSelectedPhotoPreview(screenshotUrl)}
                      style={styles.settleScreenshotWrapper}
                    >
                      <Image source={{ uri: screenshotUrl }} style={styles.settleScreenshotImage} resizeMode="cover" />
                      <View style={styles.settleScreenshotOverlay}>
                        <Ionicons name="expand" size={15} color="#FFFFFF" />
                        <Text style={styles.settleScreenshotLabel}>View Payment Screenshot</Text>
                      </View>
                    </TouchableOpacity>
                  ) : null}

                  {note ? (
                    <Text style={[styles.settleNoteText, { color: colors.textSecondary }]}>
                      Note: {note}
                    </Text>
                  ) : null}

                  {/* Accept / Reject Action Buttons for Receiver */}
                  {isPending && isReceiver && (
                    <View style={styles.settleActionsRow}>
                      <TouchableOpacity
                        style={[styles.settleRejectBtn, { borderColor: colors.danger }]}
                        onPress={() => handleRejectPayment(item)}
                      >
                        <Ionicons name="close" size={16} color={colors.danger} style={{ marginRight: 4 }} />
                        <Text style={[styles.settleRejectText, { color: colors.danger }]}>Reject</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.settleAcceptBtn, { backgroundColor: colors.success }]}
                        onPress={() => handleAcceptPayment(item)}
                      >
                        <Ionicons name="checkmark" size={16} color="#FFFFFF" style={{ marginRight: 4 }} />
                        <Text style={styles.settleAcceptText}>Accept & Deduct</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {isPending && !isReceiver && (
                    <View style={[styles.settlePendingNotice, { backgroundColor: isDark ? '#1E293B' : '#F8FAFC' }]}>
                      <Ionicons name="time-outline" size={15} color={colors.textMuted} style={{ marginRight: 6 }} />
                      <Text style={[styles.settlePendingText, { color: colors.textMuted }]}>
                        Waiting for {receiverName} to verify and accept.
                      </Text>
                    </View>
                  )}

                  {isAccepted && (
                    <View style={[styles.settleSuccessNotice, { backgroundColor: isDark ? 'rgba(16, 185, 129, 0.1)' : '#ECFDF5' }]}>
                      <Ionicons name="checkmark-done" size={15} color={colors.success} style={{ marginRight: 6 }} />
                      <Text style={[styles.settleSuccessText, { color: colors.success }]}>
                        Payment accepted! {amtStr} deducted from pending balance.
                      </Text>
                    </View>
                  )}

                  {isRejected && (
                    <View style={[styles.settleRejectedNotice, { backgroundColor: isDark ? 'rgba(239, 68, 68, 0.1)' : '#FEF2F2' }]}>
                      <Ionicons name="alert-circle-outline" size={15} color={colors.danger} style={{ marginRight: 6 }} />
                      <Text style={[styles.settleRejectedText, { color: colors.danger }]}>
                        Payment claim was rejected. No balance was deducted.
                      </Text>
                    </View>
                  )}

                  <View style={[styles.settleCardBottom, { borderTopColor: colors.borderLight }]}>
                    <Text style={[styles.timestampText, { color: colors.textMuted }]}>
                      {formatTime(item.created_at)}
                    </Text>
                  </View>
                </View>
              </View>
            );
          }

          // 5. Payment Request Card
          const isRequestMsg =
            item.type === 'payment_request' ||
            (item.content && item.content.includes('"type":"payment_request"'));

          if (isRequestMsg) {
            let pData: any = item.payload;
            if (!pData && item.content && item.content.startsWith('{')) {
              try { pData = JSON.parse(item.content); } catch {}
            }
            if (!pData && item.message && item.message.startsWith('{')) {
              try { pData = JSON.parse(item.message); } catch {}
            }
            pData = pData || {};

            const amountPaise = Number(pData.amountPaise || pData.amount_paise) || 0;
            const amtStr = formatCurrencyAmount(amountPaise, userCurrency);
            const requesterName = pData.requesterName || item.sender_name || 'Member';
            const targetName = pData.targetName || 'Member';
            const note = pData.note;

            const isTargetMe = Boolean(
              (pData.targetId && (pData.targetId === currentUserId || (myMember && (myMember.id === pData.targetId || myMember.profile_id === pData.targetId)))) ||
              (!isGroup && !isMine)
            );

            return wrapWithDateHeader(
              <View style={styles.settlementCardContainer}>
                <View
                  style={[
                    styles.settlementCard,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.primary,
                      borderWidth: 1.2,
                    },
                  ]}
                >
                  <View style={styles.settleCardHeaderRow}>
                    <View style={[styles.settleIconBox, { backgroundColor: 'rgba(99, 102, 241, 0.15)' }]}>
                      <Ionicons name="cash" size={20} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={[styles.settleCardTitle, { color: colors.text }]}>
                        Payment Request: {amtStr}
                      </Text>
                      <Text style={[styles.settleCardSub, { color: colors.textSecondary }]}>
                        From {requesterName} to {targetName}
                      </Text>
                    </View>
                  </View>

                  {note ? (
                    <Text style={[styles.settleNoteText, { color: colors.textSecondary }]}>
                      Note: {note}
                    </Text>
                  ) : null}

                  {isTargetMe ? (
                    <TouchableOpacity
                      style={[styles.payNowActionBtn, { backgroundColor: colors.primary }]}
                      onPress={() => handleOpenPayModal(amountPaise)}
                    >
                      <Ionicons name="card" size={17} color="#FFFFFF" style={{ marginRight: 6 }} />
                      <Text style={styles.payNowActionBtnText}>Pay & Upload Screenshot</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={[styles.settlePendingNotice, { backgroundColor: isDark ? '#1E293B' : '#F8FAFC' }]}>
                      <Text style={[styles.settlePendingText, { color: colors.textMuted }]}>
                        Requested from {targetName}
                      </Text>
                    </View>
                  )}

                  <View style={[styles.settleCardBottom, { borderTopColor: colors.borderLight }]}>
                    <Text style={[styles.timestampText, { color: colors.textMuted }]}>
                      {formatTime(item.created_at)}
                    </Text>
                  </View>
                </View>
              </View>
            );
          }

          // 6. Standard Text Message Bubble
          return wrapWithDateHeader(
            <View
              style={[
                styles.bubbleContainer,
                isMine ? styles.bubbleRight : styles.bubbleLeft,
              ]}
            >
              <TouchableOpacity
                activeOpacity={0.88}
                onLongPress={() => handleMessageLongPress(item, isMine)}
                delayLongPress={280}
                style={[
                  styles.textBubble,
                  {
                    backgroundColor: isMine ? colors.primary : colors.card,
                    borderColor: isMine ? 'transparent' : colors.border,
                    borderWidth: isMine ? 0 : 1,
                  },
                ]}
              >
                {isGroup && !isMine && (
                  <Text style={[styles.senderNameHeader, { color: colors.primary }]}>{resolveSenderName(item)}</Text>
                )}
                <Text style={[styles.messageText, { color: isMine ? '#FFFFFF' : colors.text }]}>
                  {item.message}
                </Text>

                <View style={styles.bubbleMetaRow}>
                  {item.is_edited ? (
                    <Text
                      style={[
                        styles.editedBadgeText,
                        { color: isMine ? 'rgba(255,255,255,0.65)' : colors.textMuted },
                      ]}
                    >
                      edited{' '}
                    </Text>
                  ) : null}
                  <Text style={[styles.timestampText, { color: isMine ? 'rgba(255,255,255,0.75)' : colors.textMuted }]}>
                    {formatTime(item.created_at)}
                  </Text>
                  {isMine && renderMessageTicks(item, isMine)}
                </View>
              </TouchableOpacity>
            </View>
          );
        }}
      />
      )}
      </View>

      {/* Editing Message Banner */}
      {editingMessage && (
        <View
          style={[
            styles.editingBanner,
            {
              backgroundColor: isDark ? '#1E293B' : '#F1F5F9',
              borderTopColor: colors.border,
            },
          ]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 }}>
            <View style={[styles.editIconBadge, { backgroundColor: colors.primary + '25' }]}>
              <Ionicons name="pencil" size={14} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.editingTitle, { color: colors.primary }]}>Editing message</Text>
              <Text style={[styles.editingSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                {editingMessage.text}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={() => {
              setEditingMessage(null);
              setInputText('');
            }}
            style={styles.cancelEditBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      )}

      {/* Live Outbox Queue & Uploading Banner */}
      {(outboxQueue.length > 0 || uploadingAttachment) && (
        <View
          style={[
            styles.uploadingBannerContainer,
            {
              backgroundColor: isDark ? '#1E293B' : '#F8FAFC',
              borderTopColor: colors.border,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <View style={styles.uploadingBannerLeft}>
            <View
              style={[
                styles.uploadingIconCircle,
                {
                  backgroundColor: !isNetOnline
                    ? (isDark ? 'rgba(239, 68, 68, 0.2)' : '#FEF2F2')
                    : (isDark ? 'rgba(59, 130, 246, 0.2)' : '#EFF6FF'),
                },
              ]}
            >
              <Ionicons
                name={!isNetOnline ? 'cloud-offline' : 'cloud-upload'}
                size={18}
                color={!isNetOnline ? '#EF4444' : '#3B82F6'}
              />
            </View>

            <View style={{ flex: 1, marginLeft: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={[styles.uploadingBannerTitle, { color: colors.text }]} numberOfLines={1}>
                  {!isNetOnline
                    ? 'Waiting for connection...'
                    : outboxQueue.length > 0
                    ? outboxQueue.length === 1
                      ? 'Sending 1 message in queue...'
                      : `Sending ${outboxQueue.length} messages in queue...`
                    : uploadingAttachment?.name || 'Uploading attachment...'}
                </Text>
                <Animated.View
                  style={[
                    styles.uploadingDotPulse,
                    {
                      opacity: uploadPulseAnim,
                      backgroundColor: !isNetOnline ? '#EF4444' : '#3B82F6',
                    },
                  ]}
                />
              </View>
              <Text style={[styles.uploadingBannerSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                {!isNetOnline
                  ? `${outboxQueue.length || 1} queued • Will send automatically when online`
                  : 'Uploading media & syncing to cloud...'}
              </Text>
            </View>
          </View>

          <View style={styles.uploadingBannerRight}>
            <ActivityIndicator
              size="small"
              color={!isNetOnline ? '#EF4444' : '#3B82F6'}
            />
          </View>

          {/* Animated uploading progress bar */}
          <View
            style={[
              styles.uploadingProgressBarBg,
              { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
            ]}
          >
            <Animated.View
              style={[
                styles.uploadingProgressBarFill,
                {
                  backgroundColor: !isNetOnline ? '#EF4444' : '#3B82F6',
                  width: uploadBarAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['12%', '98%'],
                  }),
                },
              ]}
            />
          </View>
        </View>
      )}

      {/* Composer Bottom Bar */}
      {isBlocked ? (
        <View
          style={[
            styles.blockedBar,
            {
              backgroundColor: colors.card,
              borderTopColor: colors.border,
              paddingBottom: Math.max(insets.bottom, 14),
            },
          ]}
        >
          <Ionicons name="ban-outline" size={20} color={colors.danger} />
          <Text style={[styles.blockedText, { color: colors.danger }]}>
            This friend is blocked. Unblock in Friend Settings to chat.
          </Text>
        </View>
      ) : (
        <View
          style={[
            styles.composerBar,
            {
              backgroundColor: colors.card,
              borderTopColor: colors.border,
              borderTopWidth: editingMessage ? 0 : 1,
              paddingBottom: isKeyboardActive
                ? 8
                : Math.max(insets.bottom, 8),
            },
          ]}
        >
        {isRecording ? (
          <View style={styles.recordingComposerRow}>
            {/* Blinking red dot & live timer */}
            <View style={styles.recordingStatusBadge}>
              <Animated.View style={[styles.recordingBlinkDot, { opacity: recordingBlinkAnim }]} />
              <Text style={styles.recordingDurationText}>
                {formatDuration(recordingDuration)}
              </Text>
            </View>

            {/* Hint & waveform text */}
            <View style={styles.recordingWaveformRow}>
              <Ionicons name="mic" size={18} color="#EF4444" />
              <Text style={[styles.recordingHintText, { color: colors.textSecondary }]}>
                Recording voice note...
              </Text>
            </View>

            {/* Cancel (Trash) */}
            <TouchableOpacity
              style={styles.cancelRecordBtn}
              onPress={cancelVoiceRecording}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="trash-outline" size={22} color="#EF4444" />
            </TouchableOpacity>

            {/* Send voice note */}
            <TouchableOpacity
              style={[styles.sendCircleBtn, { backgroundColor: colors.primary, marginLeft: 4 }]}
              onPress={stopAndSendVoiceRecording}
              disabled={isSendingVoice}
            >
              {isSendingVoice ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="send" size={18} color="#FFFFFF" style={{ marginLeft: 2 }} />
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View
              style={[
                styles.inputBox,
                {
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.border,
                  borderWidth: 1,
                },
              ]}
            >
              {/* Attachment Paperclip 📎 */}
              <TouchableOpacity
                style={styles.composerIconBtn}
                onPress={() => {
                  Keyboard.dismiss();
                  setAttachmentModalVisible(true);
                }}
              >
                <Ionicons name="attach" size={24} color={colors.textSecondary} />
              </TouchableOpacity>

              <TextInput
                ref={inputRef}
                style={[styles.textInputField, { color: colors.text }]}
                placeholder={editingMessage ? 'Edit your message...' : 'Type a message...'}
                placeholderTextColor={colors.textMuted}
                value={inputText}
                onChangeText={setInputText}
                onFocus={() => {
                  setIsInputFocused(true);
                  setTimeout(() => {
                    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
                  }, 120);
                }}
                onBlur={() => {
                  setIsInputFocused(false);
                }}
                multiline
              />

              {/* Camera Button 📷 */}
              <TouchableOpacity style={styles.composerIconBtn} onPress={handleCameraIconPress}>
                <Ionicons name="camera" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Send / Mic Action Button */}
            <TouchableOpacity
              style={[
                styles.sendCircleBtn,
                { backgroundColor: colors.primary },
              ]}
              onPress={
                inputText.trim()
                  ? handleSendText
                  : (editingMessage ? handleSendText : startVoiceRecording)
              }
            >
              <Ionicons
                name={editingMessage ? 'checkmark' : (inputText.trim() ? 'send' : 'mic')}
                size={20}
                color="#FFFFFF"
                style={{ marginLeft: (!editingMessage && inputText.trim()) ? 2 : 0 }}
              />
            </TouchableOpacity>
          </>
        )}
      </View>
      )}

      {/* Link Guest Friend with Phone Contact Modal (Paginated by 10) */}
      {linkContactModalVisible && (
        <StandardBottomSheet
          visible={linkContactModalVisible}
          onClose={() => setLinkContactModalVisible(false)}
          maxHeight="88%"
          scrollable={false}
          showHandle={true}
          sheetStyle={{ paddingHorizontal: 20, paddingTop: 4 }}
        >
            <View style={styles.linkModalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.linkModalTitle, { color: colors.text }]}>
                  Link "{displayTitle}" with Contact
                </Text>
                <Text style={[styles.linkModalSubtitle, { color: colors.textSecondary }]}>
                  Select a phone contact to link all splits, balances & chat history.
                </Text>
              </View>
              <TouchableOpacity
                style={styles.linkModalCloseBtn}
                onPress={() => setLinkContactModalVisible(false)}
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Search Contacts */}
            <View
              style={[
                styles.linkSearchBox,
                { backgroundColor: colors.inputBackground, borderColor: colors.border },
              ]}
            >
              <Ionicons name="search" size={18} color={colors.textMuted} />
              <TextInput
                style={[styles.linkSearchInput, { color: colors.text }]}
                placeholder="Search phone contacts by name or number..."
                placeholderTextColor={colors.textMuted}
                value={linkSearchQuery}
                onChangeText={setLinkSearchQuery}
              />
              {linkSearchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setLinkSearchQuery('')}>
                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            {contactsLoading || linkingInProgress ? (
              <View style={styles.linkLoadingBox}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[styles.linkLoadingText, { color: colors.textSecondary }]}>
                  {linkingInProgress
                    ? 'Linking guest with selected contact...'
                    : 'Loading phone contacts...'}
                </Text>
              </View>
            ) : (
              <FlatList
                data={paginatedLinkContacts}
                keyExtractor={item => item.id}
                style={{ maxHeight: 380 }}
                onEndReached={handleLoadMoreLinkContacts}
                onEndReachedThreshold={0.3}
                ListEmptyComponent={
                  <View style={styles.linkEmptyBox}>
                    <Ionicons name="people-outline" size={38} color={colors.textMuted} />
                    <Text style={[styles.linkEmptyText, { color: colors.textSecondary }]}>
                      No phone contacts found.
                    </Text>
                    <TouchableOpacity
                      style={[styles.reloadContactsBtn, { backgroundColor: colors.primary }]}
                      onPress={() => initContacts()}
                    >
                      <Ionicons name="refresh" size={15} color="#FFFFFF" />
                      <Text style={styles.reloadContactsBtnText}>Reload Phone Contacts</Text>
                    </TouchableOpacity>
                  </View>
                }
                ListFooterComponent={
                  linkVisibleCount < phoneContactsToLink.length ? (
                    <View style={styles.linkPaginationFooter}>
                      {loadingMoreLinkContacts ? (
                        <View style={styles.loadEarlierRow}>
                          <ActivityIndicator size="small" color={colors.primary} />
                          <Text style={[styles.loadEarlierText, { color: colors.textSecondary }]}>
                            Loading more contacts...
                          </Text>
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={[
                            styles.loadEarlierBtn,
                            { backgroundColor: colors.inputBackground, borderColor: colors.border },
                          ]}
                          onPress={handleLoadMoreLinkContacts}
                        >
                          <Text style={[styles.loadEarlierBtnText, { color: colors.primary }]}>
                            Load More Contacts ({paginatedLinkContacts.length} of {phoneContactsToLink.length})
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ) : phoneContactsToLink.length > 0 ? (
                    <View style={styles.linkPaginationFooter}>
                      <Text style={{ fontSize: 11, color: colors.textMuted }}>
                        Showing all {phoneContactsToLink.length} contacts
                      </Text>
                    </View>
                  ) : null
                }
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[
                      styles.linkContactRow,
                      { borderBottomColor: colors.borderLight },
                    ]}
                    onPress={() => handleLinkFriendToContact(item)}
                  >
                    <View
                      style={[
                        styles.linkContactAvatar,
                        {
                          backgroundColor: item.isRegistered
                            ? colors.primaryLight
                            : colors.cardSecondary,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.linkContactAvatarText,
                          {
                            color: item.isRegistered ? colors.primary : colors.textSecondary,
                          },
                        ]}
                      >
                        {item.name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.linkContactName, { color: colors.text }]}>
                        {item.name}
                      </Text>
                      <Text style={[styles.linkContactPhone, { color: colors.textSecondary }]}>
                        {item.phoneNumber || 'No number'}
                      </Text>
                    </View>
                    <View style={[styles.linkSelectPill, { backgroundColor: colors.primary }]}>
                      <Ionicons name="link" size={13} color="#FFFFFF" />
                      <Text style={styles.linkSelectPillText}>Link</Text>
                    </View>
                  </TouchableOpacity>
                )}
              />
            )}
        </StandardBottomSheet>
      )}

      {/* WhatsApp Attachment Menu Sheet */}
      {attachmentModalVisible && (
        <StandardBottomSheet
          visible={attachmentModalVisible}
          onClose={() => setAttachmentModalVisible(false)}
          scrollable={false}
          showHandle={true}
          sheetStyle={{ paddingHorizontal: 20, paddingTop: 4 }}
        >
            <Text style={[styles.attachmentHeader, { color: colors.textSecondary }]}>
              SHARE TO CHAT
            </Text>

            <View style={styles.attachmentGrid}>
              {/* 1. Document */}
              <TouchableOpacity style={styles.attachmentItem} onPress={handlePickDocument} activeOpacity={0.7}>
                <View style={[styles.attachCircle, { backgroundColor: '#6366F1' }]}>
                  <Ionicons name="document-text" size={26} color="#FFFFFF" />
                </View>
                <Text style={[styles.attachLabel, { color: colors.text }]} numberOfLines={1}>Document</Text>
              </TouchableOpacity>

              {/* 2. Camera */}
              <TouchableOpacity style={styles.attachmentItem} onPress={handleTakePhoto} activeOpacity={0.7}>
                <View style={[styles.attachCircle, { backgroundColor: '#EC4899' }]}>
                  <Ionicons name="camera" size={26} color="#FFFFFF" />
                </View>
                <Text style={[styles.attachLabel, { color: colors.text }]} numberOfLines={1}>Camera</Text>
              </TouchableOpacity>

              {/* 3. Gallery */}
              <TouchableOpacity style={styles.attachmentItem} onPress={handlePickImage} activeOpacity={0.7}>
                <View style={[styles.attachCircle, { backgroundColor: '#8B5CF6' }]}>
                  <Ionicons name="images" size={26} color="#FFFFFF" />
                </View>
                <Text style={[styles.attachLabel, { color: colors.text }]} numberOfLines={1}>Gallery</Text>
              </TouchableOpacity>

              {/* 4. Split Bill */}
              <TouchableOpacity
                style={styles.attachmentItem}
                activeOpacity={0.7}
                onPress={() => {
                  setAttachmentModalVisible(false);
                  setTimeout(() => {
                    if (onAddExpense) onAddExpense();
                    else router.push(`/trip/${tripId}/add`);
                  }, 120);
                }}
              >
                <View style={[styles.attachCircle, { backgroundColor: '#10B981' }]}>
                  <Ionicons name="receipt" size={26} color="#FFFFFF" />
                </View>
                <Text style={[styles.attachLabel, { color: colors.text }]} numberOfLines={1}>Split Bill</Text>
              </TouchableOpacity>

              {/* 5. Pay & Share Screenshot */}
              <TouchableOpacity style={styles.attachmentItem} onPress={() => handleOpenPayModal()} activeOpacity={0.7}>
                <View style={[styles.attachCircle, { backgroundColor: '#F59E0B' }]}>
                  <Ionicons name="card" size={26} color="#FFFFFF" />
                </View>
                <Text style={[styles.attachLabel, { color: colors.text }]} numberOfLines={1}>Pay / Settle</Text>
              </TouchableOpacity>

              {/* 6. Request Money */}
              <TouchableOpacity style={styles.attachmentItem} onPress={() => handleOpenRequestMoneyModal()} activeOpacity={0.7}>
                <View style={[styles.attachCircle, { backgroundColor: '#06B6D4' }]}>
                  <Ionicons name="cash" size={26} color="#FFFFFF" />
                </View>
                <Text style={[styles.attachLabel, { color: colors.text }]} numberOfLines={1}>Request Money</Text>
              </TouchableOpacity>
            </View>
        </StandardBottomSheet>
      )}

      {/* 1. Pay with Screenshot Modal */}
      <StandardBottomSheet
        visible={payModalVisible}
        onClose={() => setPayModalVisible(false)}
        maxHeight="90%"
        scrollable={true}
        showHandle={true}
        sheetStyle={{ paddingHorizontal: 20, paddingTop: 4 }}
      >
            <View style={styles.payModalHeader}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={[styles.payModalTitle, { color: colors.text }]}>Pay / Settle Up</Text>
                <Text style={[styles.payModalSubtitle, { color: colors.textSecondary }]}>
                  Attach payment screenshot for receiver to accept
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setPayModalVisible(false)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={styles.modalCloseCircle}
              >
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Amount Input */}
            <View style={styles.payInputGroup}>
              <Text style={[styles.payInputLabel, { color: colors.textSecondary }]}>Amount Paid (₹)</Text>
              <View style={[styles.payAmountInputWrapper, { backgroundColor: isDark ? '#1E293B' : '#F8FAFC', borderColor: colors.border }]}>
                <Text style={[styles.payCurrencySymbol, { color: colors.primary }]}>₹</Text>
                <TextInput
                  style={[styles.payAmountTextInput, { color: colors.text }]}
                  placeholder="0.00"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="numeric"
                  value={payAmountText}
                  onChangeText={setPayAmountText}
                />
              </View>

              {/* Quick Suggestion Chips */}
              <View style={styles.quickChipsRow}>
                {friendNetPaise < 0 && (
                  <TouchableOpacity
                    style={[styles.quickChip, { backgroundColor: colors.primaryLight }]}
                    onPress={() => setPayAmountText((Math.abs(friendNetPaise) / 100).toString())}
                  >
                    <Text style={[styles.quickChipText, { color: colors.primary }]}>
                      Full Debt: ₹{(Math.abs(friendNetPaise) / 100).toFixed(0)}
                    </Text>
                  </TouchableOpacity>
                )}
                {friendNetPaise < 0 && Math.abs(friendNetPaise) > 1000 && (
                  <TouchableOpacity
                    style={[styles.quickChip, { backgroundColor: isDark ? '#334155' : '#F1F5F9' }]}
                    onPress={() => setPayAmountText((Math.abs(friendNetPaise) / 200).toFixed(0))}
                  >
                    <Text style={[styles.quickChipText, { color: colors.text }]}>
                      Half: ₹{(Math.abs(friendNetPaise) / 200).toFixed(0)}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* If Group Trip: Member Picker */}
            {isGroup && tripMembers.length > 2 && (
              <View style={styles.payInputGroup}>
                <Text style={[styles.payInputLabel, { color: colors.textSecondary }]}>Paid To Member</Text>
                <View style={styles.memberPickerRow}>
                  {tripMembers.filter(m => m.id !== myMember?.id).map(m => {
                    const isSelected = payTargetMemberId === m.id;
                    return (
                      <TouchableOpacity
                        key={m.id}
                        onPress={() => setPayTargetMemberId(m.id)}
                        style={[
                          styles.memberChip,
                          {
                            backgroundColor: isSelected ? colors.primary : isDark ? '#1E293B' : '#F1F5F9',
                            borderColor: isSelected ? colors.primary : colors.border,
                          },
                        ]}
                      >
                        <Text style={[styles.memberChipText, { color: isSelected ? '#FFFFFF' : colors.text }]}>
                          {m.display_name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Screenshot Attachment Area */}
            <View style={styles.payInputGroup}>
              <Text style={[styles.payInputLabel, { color: colors.textSecondary }]}>Payment Proof / Screenshot</Text>
              {payScreenshotUri ? (
                <View style={styles.screenshotPreviewBox}>
                  <Image source={{ uri: payScreenshotUri }} style={styles.screenshotThumb} resizeMode="cover" />
                  <View style={styles.screenshotOverlayActions}>
                    <TouchableOpacity
                      style={styles.changeScreenshotBtn}
                      onPress={handlePickPaymentScreenshot}
                    >
                      <Ionicons name="images" size={16} color="#FFFFFF" style={{ marginRight: 4 }} />
                      <Text style={styles.changeScreenshotText}>Change</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.removeScreenshotBtn}
                      onPress={() => {
                        setPayScreenshotUri(null);
                        setPayScreenshotBase64(null);
                      }}
                    >
                      <Ionicons name="trash" size={16} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.attachScreenshotButtonsRow}>
                  <TouchableOpacity
                    style={[styles.attachScreenshotBtn, { backgroundColor: isDark ? '#1E293B' : '#F8FAFC', borderColor: colors.border }]}
                    onPress={handlePickPaymentScreenshot}
                  >
                    <Ionicons name="images-outline" size={22} color={colors.primary} />
                    <Text style={[styles.attachScreenshotText, { color: colors.text }]}>From Gallery</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.attachScreenshotBtn, { backgroundColor: isDark ? '#1E293B' : '#F8FAFC', borderColor: colors.border }]}
                    onPress={handleTakePaymentScreenshotPhoto}
                  >
                    <Ionicons name="camera-outline" size={22} color={colors.secondary} />
                    <Text style={[styles.attachScreenshotText, { color: colors.text }]}>Take Photo</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {/* Optional Note */}
            <View style={styles.payInputGroup}>
              <Text style={[styles.payInputLabel, { color: colors.textSecondary }]}>Note (Optional)</Text>
              <TextInput
                style={[styles.payNoteInput, { backgroundColor: isDark ? '#1E293B' : '#F8FAFC', borderColor: colors.border, color: colors.text }]}
                placeholder="UPI Ref ID, GPay, Bank..."
                placeholderTextColor={colors.textMuted}
                value={payNote}
                onChangeText={setPayNote}
              />
            </View>

            {/* Submit Button */}
            <TouchableOpacity
              style={[styles.submitPayBtn, { backgroundColor: colors.success, opacity: isSubmittingPayment ? 0.7 : 1 }]}
              onPress={handleSubmitPayment}
              disabled={isSubmittingPayment}
            >
              {isSubmittingPayment ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
                  <Text style={styles.submitPayBtnText}>Submit Payment Proof</Text>
                </>
              )}
            </TouchableOpacity>
      </StandardBottomSheet>

      {/* 2. Request Money / Select Amount to Receive Modal */}
      <StandardBottomSheet
        visible={requestMoneyModalVisible}
        onClose={() => setRequestMoneyModalVisible(false)}
        maxHeight="90%"
        scrollable={true}
        showHandle={true}
        sheetStyle={{ paddingHorizontal: 20, paddingTop: 4 }}
      >
            <View style={styles.payModalHeader}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={[styles.payModalTitle, { color: colors.text }]}>Request Money</Text>
                <Text style={[styles.payModalSubtitle, { color: colors.textSecondary }]}>
                  Select amount you are going to receive
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setRequestMoneyModalVisible(false)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={styles.modalCloseCircle}
              >
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Amount Input */}
            <View style={styles.payInputGroup}>
              <Text style={[styles.payInputLabel, { color: colors.textSecondary }]}>Amount to Receive (₹)</Text>
              <View style={[styles.payAmountInputWrapper, { backgroundColor: isDark ? '#1E293B' : '#F8FAFC', borderColor: colors.border }]}>
                <Text style={[styles.payCurrencySymbol, { color: colors.primary }]}>₹</Text>
                <TextInput
                  style={[styles.payAmountTextInput, { color: colors.text }]}
                  placeholder="0.00"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="numeric"
                  value={requestAmountText}
                  onChangeText={setRequestAmountText}
                />
              </View>

              {/* Quick Suggestion Chips */}
              <View style={styles.quickChipsRow}>
                {friendNetPaise > 0 && (
                  <TouchableOpacity
                    style={[styles.quickChip, { backgroundColor: colors.primaryLight }]}
                    onPress={() => setRequestAmountText((friendNetPaise / 100).toString())}
                  >
                    <Text style={[styles.quickChipText, { color: colors.primary }]}>
                      Total Owed: ₹{(friendNetPaise / 100).toFixed(0)}
                    </Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.quickChip, { backgroundColor: isDark ? '#334155' : '#F1F5F9' }]}
                  onPress={() => setRequestAmountText('200')}
                >
                  <Text style={[styles.quickChipText, { color: colors.text }]}>₹200</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.quickChip, { backgroundColor: isDark ? '#334155' : '#F1F5F9' }]}
                  onPress={() => setRequestAmountText('500')}
                >
                  <Text style={[styles.quickChipText, { color: colors.text }]}>₹500</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* If Group Trip: Target Member Picker */}
            {isGroup && tripMembers.length > 2 && (
              <View style={styles.payInputGroup}>
                <Text style={[styles.payInputLabel, { color: colors.textSecondary }]}>Request From</Text>
                <View style={styles.memberPickerRow}>
                  {tripMembers.filter(m => m.id !== myMember?.id).map(m => {
                    const isSelected = requestTargetMemberId === m.id;
                    return (
                      <TouchableOpacity
                        key={m.id}
                        onPress={() => setRequestTargetMemberId(m.id)}
                        style={[
                          styles.memberChip,
                          {
                            backgroundColor: isSelected ? colors.primary : isDark ? '#1E293B' : '#F1F5F9',
                            borderColor: isSelected ? colors.primary : colors.border,
                          },
                        ]}
                      >
                        <Text style={[styles.memberChipText, { color: isSelected ? '#FFFFFF' : colors.text }]}>
                          {m.display_name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Optional Note */}
            <View style={styles.payInputGroup}>
              <Text style={[styles.payInputLabel, { color: colors.textSecondary }]}>Note (Optional)</Text>
              <TextInput
                style={[styles.payNoteInput, { backgroundColor: isDark ? '#1E293B' : '#F8FAFC', borderColor: colors.border, color: colors.text }]}
                placeholder="For cabs, dinner, hotel..."
                placeholderTextColor={colors.textMuted}
                value={requestNote}
                onChangeText={setRequestNote}
              />
            </View>

            {/* Submit Button */}
            <TouchableOpacity
              style={[styles.submitPayBtn, { backgroundColor: colors.primary, opacity: isSubmittingRequest ? 0.7 : 1 }]}
              onPress={handleSubmitRequestMoney}
              disabled={isSubmittingRequest}
            >
              {isSubmittingRequest ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <Ionicons name="paper-plane" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
                  <Text style={styles.submitPayBtnText}>Send Payment Request</Text>
                </>
              )}
            </TouchableOpacity>
      </StandardBottomSheet>

      {/* Photo Full-Screen Modal Preview */}
      {Boolean(selectedPhotoPreview) && (
      <Modal
        visible={Boolean(selectedPhotoPreview)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedPhotoPreview(null)}
      >
        <View style={styles.photoPreviewOverlay}>
          <TouchableOpacity
            style={[styles.photoCloseBtn, { top: Math.max(insets.top, 24) + 16 }]}
            onPress={() => setSelectedPhotoPreview(null)}
          >
            <Ionicons name="close-circle" size={32} color="#FFFFFF" />
          </TouchableOpacity>
          {selectedPhotoPreview && (
            <Image
              source={{ uri: selectedPhotoPreview }}
              style={styles.fullScreenPhoto}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>
      )}

      {/* Video Full-Screen Modal Preview */}
      {Boolean(selectedVideoPreview) && (
        <Modal
          visible={Boolean(selectedVideoPreview)}
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedVideoPreview(null)}
        >
          <View style={styles.photoPreviewOverlay}>
            <TouchableOpacity
              style={[styles.photoCloseBtn, { top: Math.max(insets.top, 24) + 16 }]}
              onPress={() => setSelectedVideoPreview(null)}
            >
              <Ionicons name="close-circle" size={32} color="#FFFFFF" />
            </TouchableOpacity>
            {selectedVideoPreview && (
              <SafeVideo
                source={{ uri: selectedVideoPreview }}
                style={styles.fullScreenPhoto}
                resizeMode={ResizeMode.CONTAIN}
                useNativeControls
                shouldPlay
                isLooping={false}
              />
            )}
          </View>
        </Modal>
      )}

      {/* Three-Dots Options Sidebar Drawer (for both Trip Chat and Normal Friend Chat) */}
      {optionsSidebarVisible && (
        <Modal
          visible={optionsSidebarVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setOptionsSidebarVisible(false)}
        >
          <View style={styles.sidebarOverlay}>
            <TouchableOpacity
              style={styles.sidebarBackdrop}
              activeOpacity={1}
              onPress={() => setOptionsSidebarVisible(false)}
            />

            <View
              style={[
                styles.sidebarDrawer,
                {
                  backgroundColor: colors.card,
                  borderLeftColor: colors.border,
                },
              ]}
            >
              {/* Sidebar Top Header */}
              <View
                style={[
                  styles.sidebarHeader,
                  {
                    backgroundColor: colors.card,
                    borderBottomColor: colors.border,
                    borderBottomWidth: 1,
                    paddingTop: Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 44) + 6,
                  },
                ]}
              >
                <View style={styles.sidebarHeaderTopRow}>
                  <View style={[styles.sidebarAvatar, { backgroundColor: colors.primaryLight }]}>
                    {isGroup ? (
                      <Ionicons name="airplane" size={22} color={colors.primary} />
                    ) : currentFriendAvatarUrl ? (
                      <Image
                        source={{ uri: currentFriendAvatarUrl }}
                        style={{ width: '100%', height: '100%' }}
                        resizeMode="cover"
                      />
                    ) : (
                      <Text style={[styles.headerAvatarText, { color: colors.primary }]}>
                        {avatarText || displayTitle.charAt(0).toUpperCase()}
                      </Text>
                    )}
                  </View>

                  <TouchableOpacity
                    style={[styles.sidebarCloseBtn, { backgroundColor: colors.cardSecondary }]}
                    onPress={() => setOptionsSidebarVisible(false)}
                  >
                    <Ionicons name="close" size={22} color={colors.text} />
                  </TouchableOpacity>
                </View>

                <Text style={[styles.sidebarTitle, { color: colors.text }]} numberOfLines={1}>
                  {displayTitle}
                </Text>
                <Text style={[styles.sidebarSubtitle, { color: colors.textSecondary }]} numberOfLines={2}>
                  {effectiveSubtitle}
                </Text>
              </View>

              {/* Sidebar Menu Items */}
              <View style={[styles.sidebarBody, { paddingBottom: Math.max(insets.bottom, 20) + 16 }]}>
                <Text style={[styles.sidebarSectionLabel, { color: colors.textMuted }]}>
                  TABS & OVERVIEW
                </Text>

                {/* 1. Expenses Tab */}
                <TouchableOpacity
                  style={[styles.sidebarMenuItem, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    setOptionsSidebarVisible(false);
                    setTimeout(() => {
                      router.push({
                        pathname: '/trip/[id]/info',
                        params: { id: tripId, tab: 'expenses' },
                      });
                    }, 80);
                  }}
                >
                  <View style={[styles.sidebarIconBox, { backgroundColor: colors.primaryLight }]}>
                    <Ionicons name="receipt-outline" size={19} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sidebarMenuTitle, { color: colors.text }]}>
                      Expenses
                    </Text>
                    <Text style={[styles.sidebarMenuSub, { color: colors.textSecondary }]}>
                      {tripExpenses.length} {tripExpenses.length === 1 ? 'bill' : 'bills'} • Total{' '}
                      {formatCurrencyAmount(totalGroupSpendPaise, currentTrip?.currency)}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>

                {/* 2. Members Tab */}
                <TouchableOpacity
                  style={[styles.sidebarMenuItem, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    setOptionsSidebarVisible(false);
                    setTimeout(() => {
                      router.push({
                        pathname: '/trip/[id]/info',
                        params: { id: tripId, tab: 'members' },
                      });
                    }, 80);
                  }}
                >
                  <View style={[styles.sidebarIconBox, { backgroundColor: colors.successBg }]}>
                    <Ionicons name="people-outline" size={19} color={colors.success} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sidebarMenuTitle, { color: colors.text }]}>
                      Members
                    </Text>
                    <Text style={[styles.sidebarMenuSub, { color: colors.textSecondary }]}>
                      {tripMembers.length} {tripMembers.length === 1 ? 'member' : 'members'} in chat
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>

                {/* 3. Balances Tab */}
                <TouchableOpacity
                  style={[styles.sidebarMenuItem, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    setOptionsSidebarVisible(false);
                    setTimeout(() => {
                      router.push({
                        pathname: '/trip/[id]/info',
                        params: { id: tripId, tab: 'balances' },
                      });
                    }, 80);
                  }}
                >
                  <View style={[styles.sidebarIconBox, { backgroundColor: colors.warningBg }]}>
                    <Ionicons name="wallet-outline" size={19} color={colors.warning} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sidebarMenuTitle, { color: colors.text }]}>
                      Balances
                    </Text>
                    <Text style={[styles.sidebarMenuSub, { color: colors.textSecondary }]}>
                      Member-wise paid & share breakdown
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>

                {/* 4. Settle Up Tab */}
                <TouchableOpacity
                  style={[styles.sidebarMenuItem, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    setOptionsSidebarVisible(false);
                    setTimeout(() => {
                      router.push({
                        pathname: '/trip/[id]/info',
                        params: { id: tripId, tab: 'settle' },
                      });
                    }, 80);
                  }}
                >
                  <View style={[styles.sidebarIconBox, { backgroundColor: colors.dangerBg }]}>
                    <Ionicons name="cash-outline" size={19} color={colors.danger} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sidebarMenuTitle, { color: colors.text }]}>
                      Settle Up
                    </Text>
                    <Text style={[styles.sidebarMenuSub, { color: colors.textSecondary }]}>
                      Pay via UPI & share WhatsApp summary
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>

                <Text
                  style={[
                    styles.sidebarSectionLabel,
                    { color: colors.textMuted, marginTop: 18 },
                  ]}
                >
                  ACTIONS & SETTINGS
                </Text>

                {/* 5. Add Expense / Split Bill */}
                <TouchableOpacity
                  style={[styles.sidebarMenuItem, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    setOptionsSidebarVisible(false);
                    setTimeout(() => {
                      if (onAddExpense) onAddExpense();
                      else router.push(`/trip/${tripId}/add`);
                    }, 80);
                  }}
                >
                  <View style={[styles.sidebarIconBox, { backgroundColor: colors.primaryLight }]}>
                    <Ionicons name="add-circle-outline" size={19} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sidebarMenuTitle, { color: colors.text }]}>
                      Add Expense / Split Bill
                    </Text>
                    <Text style={[styles.sidebarMenuSub, { color: colors.textSecondary }]}>
                      Log a new bill in {displayTitle}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>

                {/* 6. Link Guest Contact (if 1-on-1 unlinked guest) */}
                {!isGroup && isGuestFriend && (
                  <TouchableOpacity
                    style={[styles.sidebarMenuItem, { borderBottomColor: colors.border }]}
                    onPress={() => {
                      setOptionsSidebarVisible(false);
                      setTimeout(() => {
                        openLinkContactModal();
                      }, 120);
                    }}
                  >
                    <View style={[styles.sidebarIconBox, { backgroundColor: colors.warningBg }]}>
                      <Ionicons name="person-add-outline" size={19} color={colors.warning} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.sidebarMenuTitle, { color: colors.text }]}>
                        Link with Phone Contact
                      </Text>
                      <Text style={[styles.sidebarMenuSub, { color: colors.textSecondary }]}>
                        Connect guest friend to phone number
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                )}

                {/* 7. Settings (Trip Settings vs Friend Settings) */}
                {isGroup ? (
                  <TouchableOpacity
                    style={[styles.sidebarMenuItem, { borderBottomColor: colors.border }]}
                    onPress={() => {
                      setOptionsSidebarVisible(false);
                      setTimeout(() => {
                        router.push(`/trip/${tripId}/settings`);
                      }, 80);
                    }}
                  >
                    <View style={[styles.sidebarIconBox, { backgroundColor: colors.primaryLight }]}>
                      <Ionicons name="settings-outline" size={19} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.sidebarMenuTitle, { color: colors.text }]}>
                        Trip Settings
                      </Text>
                      <Text style={[styles.sidebarMenuSub, { color: colors.textSecondary }]}>
                        Cover photo, members, currency & options
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.sidebarMenuItem, { borderBottomColor: colors.border }]}
                    onPress={() => {
                      setOptionsSidebarVisible(false);
                      setTimeout(() => {
                        router.push({
                          pathname: '/chat/[id]/settings',
                          params: {
                            id: tripId,
                            friendName: displayTitle,
                            friendPhone: displayPhone,
                            friendId,
                          },
                        });
                      }, 80);
                    }}
                  >
                    <View style={[styles.sidebarIconBox, { backgroundColor: colors.primaryLight }]}>
                      <Ionicons name="person-circle-outline" size={19} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.sidebarMenuTitle, { color: colors.text }]}>
                        Friend Settings
                      </Text>
                      <Text style={[styles.sidebarMenuSub, { color: colors.textSecondary }]}>
                        Block contact, custom nickname, mute & options
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Long-Press Message Actions Modal */}
      <Modal
        visible={messageActionModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMessageActionModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setMessageActionModalVisible(false)}
        >
          <View
            style={[
              styles.actionSheetContent,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.actionSheetHandle} />
            <View style={styles.actionSheetHeader}>
              <Text style={[styles.actionSheetTitle, { color: colors.textSecondary }]}>
                Message Options
              </Text>
              {selectedMessageForAction?.message ? (
                <Text
                  style={[styles.actionSheetSnippet, { color: colors.text }]}
                  numberOfLines={2}
                >
                  "{selectedMessageForAction.message}"
                </Text>
              ) : null}
            </View>

            {/* Edit Option (only for text messages) */}
            {selectedMessageForAction?.type === 'text' && (
              <TouchableOpacity
                style={[styles.actionSheetItem, { borderBottomColor: colors.border }]}
                onPress={() => {
                  if (!selectedMessageForAction) return;
                  const item = selectedMessageForAction;
                  setMessageActionModalVisible(false);
                  setEditingMessage({ id: item.id, text: item.message || '' });
                  setInputText(item.message || '');
                  setTimeout(() => {
                    inputRef.current?.focus();
                  }, 180);
                }}
              >
                <Ionicons name="pencil-outline" size={20} color={colors.primary} />
                <Text style={[styles.actionSheetItemText, { color: colors.text }]}>
                  Edit Message
                </Text>
              </TouchableOpacity>
            )}

            {/* Delete Option */}
            <TouchableOpacity
              style={[styles.actionSheetItem, { borderBottomColor: colors.border }]}
              onPress={() => {
                if (!selectedMessageForAction) return;
                const msgId = selectedMessageForAction.id;
                setMessageActionModalVisible(false);
                Alert.alert(
                  'Delete Message',
                  'Are you sure you want to delete this message for everyone?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: async () => {
                        await deleteTripMessage(tripId, msgId);
                      },
                    },
                  ]
                );
              }}
            >
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
              <Text style={[styles.actionSheetItemText, { color: colors.danger }]}>
                Delete Message
              </Text>
            </TouchableOpacity>

            {/* Cancel Button */}
            <TouchableOpacity
              style={styles.actionSheetCancelBtn}
              onPress={() => setMessageActionModalVisible(false)}
            >
              <Text style={[styles.actionSheetCancelText, { color: colors.textSecondary }]}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
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
  headerIdentityRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 6,
  },
  headerAvatar: {
    width: moderateScale(38),
    height: moderateScale(38),
    borderRadius: moderateScale(19),
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: moderateScale(10),
  },
  headerAvatarText: {
    fontSize: scaleFont(16),
    fontWeight: '800',
  },
  headerTitleCol: {
    flex: 1,
  },
  sidebarOverlay: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  sidebarBackdrop: {
    flex: 1,
  },
  sidebarDrawer: {
    width: '82%',
    maxWidth: 340,
    height: '100%',
    borderLeftWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 16,
  },
  sidebarHeader: {
    paddingTop: Platform.OS === 'ios' ? 56 : 24,
    paddingBottom: moderateScale(18),
    paddingHorizontal: moderateScale(18),
  },
  sidebarHeaderTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: moderateScale(12),
  },
  sidebarAvatar: {
    width: moderateScale(48),
    height: moderateScale(48),
    borderRadius: moderateScale(24),
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarCloseBtn: {
    width: moderateScale(34),
    height: moderateScale(34),
    borderRadius: moderateScale(17),
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarTitle: {
    fontSize: scaleFont(18),
    fontWeight: '800',
  },
  sidebarSubtitle: {
    fontSize: scaleFont(12),
    marginTop: 4,
    lineHeight: scaleFont(17),
  },
  sidebarBody: {
    flex: 1,
    paddingHorizontal: moderateScale(16),
    paddingTop: moderateScale(16),
  },
  sidebarSectionLabel: {
    fontSize: scaleFont(11),
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sidebarMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: moderateScale(12),
    borderBottomWidth: 1,
    gap: moderateScale(12),
  },
  sidebarIconBox: {
    width: moderateScale(38),
    height: moderateScale(38),
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarMenuTitle: {
    fontSize: scaleFont(14),
    fontWeight: '700',
  },
  sidebarMenuSub: {
    fontSize: scaleFont(11),
    marginTop: 2,
  },
  headerTitleText: {
    fontSize: scaleFont(16),
    fontWeight: '700',
    color: '#FFFFFF',
    flexShrink: 1,
  },
  guestHeaderPill: {
    backgroundColor: 'rgba(245, 158, 11, 0.35)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  guestHeaderPillText: {
    fontSize: scaleFont(9),
    fontWeight: '800',
    color: '#FEF3C7',
  },
  headerSubtitleText: {
    fontSize: scaleFont(12),
    color: 'rgba(255,255,255,0.75)',
    marginTop: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  linkHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: moderateScale(9),
    paddingVertical: moderateScale(5),
    borderRadius: 12,
    gap: 4,
  },
  linkHeaderBtnText: {
    color: '#FFFFFF',
    fontSize: scaleFont(11),
    fontWeight: '700',
  },
  headerIconBtn: {
    padding: 6,
  },
  guestLinkBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: moderateScale(14),
    paddingVertical: moderateScale(8),
    borderBottomWidth: 1,
    gap: 10,
  },
  guestLinkBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  guestLinkBannerText: {
    fontSize: scaleFont(12),
    fontWeight: '600',
    flex: 1,
    lineHeight: scaleFont(16),
  },
  guestLinkActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: moderateScale(10),
    paddingVertical: moderateScale(6),
    borderRadius: 12,
    gap: 4,
  },
  guestLinkActionText: {
    color: '#FFFFFF',
    fontSize: scaleFont(11),
    fontWeight: '700',
  },
  balanceBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: moderateScale(14),
    paddingVertical: moderateScale(10),
    borderBottomWidth: 1,
  },
  balanceBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  balanceBannerIcon: {
    width: moderateScale(34),
    height: moderateScale(34),
    borderRadius: moderateScale(17),
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: moderateScale(10),
  },
  balanceBannerTitle: {
    fontSize: scaleFont(14),
    fontWeight: '800',
  },
  balanceBannerSub: {
    fontSize: scaleFont(11),
    marginTop: 1,
    fontWeight: '500',
  },
  balanceBannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  payNowMiniBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: moderateScale(10),
    paddingVertical: moderateScale(6),
    borderRadius: 14,
    gap: 4,
  },
  payNowMiniText: {
    color: '#FFFFFF',
    fontSize: scaleFont(12),
    fontWeight: '700',
  },
  addSplitMiniBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: moderateScale(10),
    paddingVertical: moderateScale(6),
    borderRadius: 14,
    gap: 3,
  },
  addSplitMiniText: {
    color: '#FFFFFF',
    fontSize: scaleFont(12),
    fontWeight: '700',
  },
  syncingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    gap: 8,
  },
  syncingText: {
    fontSize: scaleFont(12),
    fontWeight: '600',
  },
  loadEarlierContainer: {
    alignItems: 'center',
    marginBottom: 12,
  },
  loadEarlierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    gap: 8,
  },
  loadEarlierText: {
    fontSize: scaleFont(12),
    fontWeight: '600',
  },
  loadEarlierBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: moderateScale(14),
    paddingVertical: moderateScale(8),
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
  },
  loadEarlierBtnText: {
    fontSize: scaleFont(12),
    fontWeight: '700',
  },
  expenseTripBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  expenseTripBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    gap: 4,
  },
  expenseTripBadgeText: {
    fontSize: scaleFont(11),
    fontWeight: '700',
  },
  expenseImpactText: {
    fontSize: scaleFont(12),
    fontWeight: '800',
  },
  messagesList: {
    paddingHorizontal: moderateScale(12),
    paddingVertical: moderateScale(14),
  },
  chatLoadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 40,
  },
  chatLoadingText: {
    fontSize: scaleFont(14),
    fontWeight: '500',
    marginTop: 12,
  },
  emptyCenterWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: moderateScale(28),
    width: '100%',
  },
  emptyIconCircle: {
    width: moderateScale(68),
    height: moderateScale(68),
    borderRadius: moderateScale(34),
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    marginBottom: 14,
  },
  emptyCenterTitle: {
    fontSize: scaleFont(18),
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyCenterSubtitle: {
    fontSize: scaleFont(13),
    textAlign: 'center',
    lineHeight: scaleFont(20),
    marginBottom: 20,
    maxWidth: 290,
  },
  emptySecurityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  emptySecurityText: {
    fontSize: scaleFont(11),
    fontWeight: '500',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 40,
    paddingHorizontal: 20,
  },
  encryptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginBottom: 16,
    gap: 8,
    maxWidth: '92%',
  },
  encryptionText: {
    fontSize: scaleFont(11),
    textAlign: 'center',
    lineHeight: scaleFont(16),
  },
  emptySubtitle: {
    fontSize: scaleFont(13),
    marginTop: 8,
  },
  messageWithDateWrapper: {
    width: '100%',
  },
  dateSeparatorRow: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: moderateScale(10),
  },
  dateSeparatorBadge: {
    paddingHorizontal: moderateScale(14),
    paddingVertical: moderateScale(4),
    borderRadius: moderateScale(12),
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  dateSeparatorText: {
    fontSize: scaleFont(12),
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  bubbleContainer: {
    marginVertical: 3,
    maxWidth: '82%',
  },
  bubbleRight: {
    alignSelf: 'flex-end',
  },
  bubbleLeft: {
    alignSelf: 'flex-start',
  },
  textBubble: {
    borderRadius: 12,
    paddingHorizontal: moderateScale(12),
    paddingTop: moderateScale(8),
    paddingBottom: moderateScale(6),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  senderNameHeader: {
    fontSize: scaleFont(12),
    fontWeight: '700',
    marginBottom: 2,
  },
  messageText: {
    fontSize: scaleFont(15),
    lineHeight: scaleFont(20),
  },
  bubbleMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  timestampText: {
    fontSize: scaleFont(10),
  },
  imageBubble: {
    borderRadius: 14,
    overflow: 'hidden',
    padding: 3,
  },
  messageImage: {
    width: moderateScale(240),
    height: moderateScale(180),
    borderRadius: 12,
  },
  imageCaption: {
    fontSize: scaleFont(14),
    paddingHorizontal: 6,
    paddingTop: 6,
  },
  docBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 10,
    minWidth: moderateScale(200),
  },
  docIconBox: {
    width: moderateScale(36),
    height: moderateScale(36),
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docName: {
    fontSize: scaleFont(14),
    fontWeight: '700',
  },
  docSize: {
    fontSize: scaleFont(11),
    marginTop: 2,
  },
  docMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'absolute',
    right: 8,
    bottom: 4,
  },
  expenseCardContainer: {
    marginVertical: 8,
    alignItems: 'center',
    width: '100%',
  },
  expenseCard: {
    width: '94%',
    borderRadius: 16,
    borderWidth: 1,
    padding: moderateScale(14),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  expenseCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: moderateScale(12),
  },
  expenseIconBox: {
    width: moderateScale(42),
    height: moderateScale(42),
    borderRadius: moderateScale(21),
    alignItems: 'center',
    justifyContent: 'center',
  },
  expenseCardTitle: {
    fontSize: scaleFont(15),
    fontWeight: '700',
  },
  expenseCardSubtitle: {
    fontSize: scaleFont(12),
    marginTop: 2,
  },
  expenseCardAmount: {
    fontSize: scaleFont(17),
    fontWeight: '800',
  },
  expenseCardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  expenseTime: {
    fontSize: scaleFont(11),
  },
  viewExpenseBtn: {
    paddingHorizontal: moderateScale(12),
    paddingVertical: 5,
    borderRadius: 12,
  },
  viewExpenseText: {
    color: '#FFFFFF',
    fontSize: scaleFont(12),
    fontWeight: '700',
  },
  blockedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: moderateScale(14),
    paddingHorizontal: moderateScale(16),
    gap: 10,
    borderTopWidth: 1,
  },
  blockedText: {
    fontSize: scaleFont(13),
    fontWeight: '600',
    textAlign: 'center',
    flex: 1,
  },
  composerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: moderateScale(8),
    paddingTop: 8,
    paddingBottom: 8,
  },
  inputBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 24,
    paddingHorizontal: moderateScale(10),
    minHeight: moderateScale(46),
    maxHeight: 120,
    marginRight: 6,
  },
  composerIconBtn: {
    padding: 6,
  },
  textInputField: {
    flex: 1,
    fontSize: scaleFont(15),
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  sendCircleBtn: {
    width: moderateScale(46),
    height: moderateScale(46),
    borderRadius: moderateScale(23),
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
  },
  linkModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  linkModalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 34,
    borderTopWidth: 1,
    maxHeight: '82%',
  },
  linkModalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  linkModalTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  linkModalSubtitle: {
    fontSize: 12,
    marginTop: 3,
  },
  linkModalCloseBtn: {
    padding: 4,
  },
  linkSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 12,
    gap: 8,
  },
  linkSearchInput: {
    flex: 1,
    fontSize: 14,
  },
  linkLoadingBox: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 10,
  },
  linkLoadingText: {
    fontSize: 13,
    fontWeight: '600',
  },
  linkEmptyBox: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 10,
  },
  linkEmptyText: {
    fontSize: 13,
  },
  reloadContactsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 6,
    marginTop: 4,
  },
  reloadContactsBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  linkPaginationFooter: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  linkContactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    borderBottomWidth: 1,
    gap: 12,
  },
  linkContactAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkContactAvatarText: {
    fontSize: 15,
    fontWeight: '700',
  },
  linkContactName: {
    fontSize: 14,
    fontWeight: '700',
  },
  linkContactPhone: {
    fontSize: 12,
    marginTop: 2,
  },
  linkSelectPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 4,
  },
  linkSelectPillText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  attachmentOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
    paddingBottom: 70,
  },
  attachmentSheet: {
    marginHorizontal: 16,
    borderRadius: 20,
    padding: 20,
    elevation: 10,
  },
  attachmentHeader: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 16,
    textAlign: 'center',
  },
  attachmentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  attachmentItem: {
    width: '33.33%',
    alignItems: 'center',
    marginBottom: 18,
  },
  attachCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  attachLabel: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  photoPreviewOverlay: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoCloseBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
  },
  fullScreenPhoto: {
    width: '100%',
    height: '85%',
  },
  editingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopWidth: 1,
  },
  editIconBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  editingTitle: {
    fontSize: scaleFont(11),
    fontWeight: '700',
  },
  editingSubtitle: {
    fontSize: scaleFont(12),
    marginTop: 1,
  },
  cancelEditBtn: {
    padding: 4,
  },
  editedBadgeText: {
    fontSize: scaleFont(10),
    fontStyle: 'italic',
    marginRight: 2,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  actionSheetContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: 16,
    paddingBottom: 28,
    paddingTop: 10,
  },
  actionSheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(150,150,150,0.4)',
    alignSelf: 'center',
    marginBottom: 10,
  },
  actionSheetHeader: {
    marginBottom: 12,
    alignItems: 'center',
  },
  actionSheetTitle: {
    fontSize: scaleFont(12),
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  actionSheetSnippet: {
    fontSize: scaleFont(13),
    fontStyle: 'italic',
    marginTop: 4,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  actionSheetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actionSheetItemText: {
    fontSize: scaleFont(15),
    fontWeight: '600',
    marginLeft: 12,
  },
  actionSheetCancelBtn: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  actionSheetCancelText: {
    fontSize: scaleFont(15),
    fontWeight: '600',
  },

  // Payment settlement & Request card styles
  settlementCardContainer: {
    paddingHorizontal: 12,
    marginVertical: 6,
    alignItems: 'center',
    width: '100%',
  },
  settlementCard: {
    width: '92%',
    borderRadius: 16,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
  settleCardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  settleIconBox: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settleCardTitle: {
    fontSize: scaleFont(15),
    fontWeight: '700',
  },
  settleCardSub: {
    fontSize: scaleFont(12),
    marginTop: 1,
  },
  settleStatusBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
  },
  settleStatusText: {
    fontSize: scaleFont(11),
    fontWeight: '700',
  },
  settleScreenshotWrapper: {
    width: '100%',
    height: 160,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    marginVertical: 8,
    backgroundColor: '#000000',
  },
  settleScreenshotImage: {
    width: '100%',
    height: '100%',
  },
  settleScreenshotOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    gap: 6,
  },
  settleScreenshotLabel: {
    color: '#FFFFFF',
    fontSize: scaleFont(11.5),
    fontWeight: '600',
  },
  settleNoteText: {
    fontSize: scaleFont(13),
    fontStyle: 'italic',
    marginBottom: 8,
    marginTop: 2,
  },
  settleActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 10,
  },
  settleRejectBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.2,
  },
  settleRejectText: {
    fontSize: scaleFont(13.5),
    fontWeight: '700',
  },
  settleAcceptBtn: {
    flex: 1.4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 12,
  },
  settleAcceptText: {
    color: '#FFFFFF',
    fontSize: scaleFont(13.5),
    fontWeight: '700',
  },
  settlePendingNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    marginTop: 6,
  },
  settlePendingText: {
    fontSize: scaleFont(12),
    fontStyle: 'italic',
  },
  settleSuccessNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    marginTop: 6,
  },
  settleSuccessText: {
    fontSize: scaleFont(12.5),
    fontWeight: '600',
  },
  settleRejectedNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    marginTop: 6,
  },
  settleRejectedText: {
    fontSize: scaleFont(12.5),
    fontWeight: '600',
  },
  settleCardBottom: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'flex-end',
  },
  payNowActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    borderRadius: 12,
    marginTop: 10,
  },
  payNowActionBtnText: {
    color: '#FFFFFF',
    fontSize: scaleFont(13.5),
    fontWeight: '700',
  },

  // Modal styles
  payModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  payModalCard: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 32,
  },
  payModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  payModalTitle: {
    fontSize: scaleFont(18),
    fontWeight: '800',
  },
  payModalSubtitle: {
    fontSize: scaleFont(12.5),
    marginTop: 2,
  },
  payInputGroup: {
    marginBottom: 14,
  },
  payInputLabel: {
    fontSize: scaleFont(12),
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  payAmountInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    height: 52,
  },
  payCurrencySymbol: {
    fontSize: scaleFont(20),
    fontWeight: '800',
    marginRight: 8,
  },
  payAmountTextInput: {
    flex: 1,
    fontSize: scaleFont(18),
    fontWeight: '700',
  },
  quickChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  quickChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  quickChipText: {
    fontSize: scaleFont(11.5),
    fontWeight: '600',
  },
  memberPickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  memberChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    borderWidth: 1,
  },
  memberChipText: {
    fontSize: scaleFont(12.5),
    fontWeight: '600',
  },
  attachScreenshotButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  attachScreenshotBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
  },
  attachScreenshotText: {
    fontSize: scaleFont(13),
    fontWeight: '600',
  },
  screenshotPreviewBox: {
    width: '100%',
    height: 140,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#000000',
  },
  screenshotThumb: {
    width: '100%',
    height: '100%',
  },
  screenshotOverlayActions: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    gap: 8,
  },
  changeScreenshotBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  changeScreenshotText: {
    color: '#FFFFFF',
    fontSize: scaleFont(11),
    fontWeight: '600',
  },
  removeScreenshotBtn: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 6,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  payNoteInput: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: scaleFont(13.5),
  },
  modalCloseCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(150, 150, 150, 0.12)',
  },
  submitPayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: 16,
    marginTop: 10,
    marginBottom: 8,
  },
  submitPayBtnText: {
    color: '#FFFFFF',
    fontSize: scaleFont(15),
    fontWeight: '700',
  },
  recordingComposerRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  recordingStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
  },
  recordingBlinkDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#EF4444',
    marginRight: 6,
  },
  recordingDurationText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#EF4444',
  },
  recordingWaveformRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  recordingHintText: {
    fontSize: 13,
    fontWeight: '500',
    marginLeft: 6,
  },
  cancelRecordBtn: {
    padding: 8,
    marginRight: 4,
  },
  audioBubble: {
    maxWidth: '82%',
    borderRadius: 16,
    padding: 12,
    minWidth: 220,
  },
  audioMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  audioPlayBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  audioTrackContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  audioTrackBg: {
    height: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 6,
  },
  audioTrackProgress: {
    height: '100%',
    borderRadius: 2,
  },
  audioWaveformVisual: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 22,
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  audioWaveBar: {
    width: 3,
    borderRadius: 2,
  },
  audioTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  audioDurationText: {
    fontSize: 11,
    fontWeight: '600',
  },
  audioMetaRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 4,
  },
  uploadingBannerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  uploadingBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  uploadingIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadingBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  uploadingDotPulse: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginLeft: 6,
  },
  uploadingBannerSubtitle: {
    fontSize: 11,
    marginTop: 2,
  },
  uploadingBannerRight: {
    paddingLeft: 6,
  },
  uploadingProgressBarBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    overflow: 'hidden',
  },
  uploadingProgressBarFill: {
    height: '100%',
    borderRadius: 1.5,
  },
  mediaUploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.48)',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  mediaUploadingCenterPill: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.82)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  mediaUploadingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  mediaUploadingText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  docUploadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  videoPlayOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPlayBtnCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  videoDurationBadge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  videoDurationText: {
    color: '#FFFFFF',
    fontSize: scaleFont(11),
    fontWeight: '600',
  },
});
