import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Animated,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DraggableBottomSheet } from './DraggableBottomSheet';
import { useTheme } from '../theme/useThemeStore';
import { useTripStore, findMyMember, generateUUID } from '../features/trips/useTripStore';
import { useAuthStore } from '../features/auth/useAuthStore';
import { useContactsStore, normalizePhone } from '../features/contacts/useContactsStore';
import { useNotificationStore } from '../features/notifications/useNotificationStore';
import { TripMember, PaymentMode } from '../types/database';
import { AppStorage } from '../lib/storage';
import * as FileSystem from 'expo-file-system';
import { scaleFont, moderateScale, useResponsive } from '../theme/responsive';
import { formatCurrencyAmount } from '../services/currency';
import {
  transcribeAudioWithDetails,
  runVoiceCopilot,
  isWhisperHallucination,
  VoiceLanguage,
  CopilotMessage,
  CopilotAction,
  CopilotRecentExpense,
  CopilotContactSummary,
  SMART_VOICE_SUGGESTIONS,
} from '../services/voiceAiService';
import {
  speakAssistantReply,
  stopSpeaking,
  isTtsEnabled,
  isTtsSpeaking,
  setTtsEnabled,
} from '../services/voiceTtsService';

// Safely load expo-av if ExponentAV native module is compiled into this binary
let Audio: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Audio = require('expo-av')?.Audio;
} catch {
  // Graceful fallback when ExponentAV native module is not compiled into current binary
}

/**
 * Dedicated mono audio recording profile for speech-to-text.
 * Explicitly sets numberOfChannels: 1 to eliminate dual-mic phase cancellation
 * between primary talk mic (bottom) and ambient noise cancellation mic (top).
 */
const SPEECH_RECORDING_OPTIONS: any = {
  isMeteringEnabled: true,
  android: {
    extension: '.m4a',
    outputFormat: Audio?.AndroidOutputFormat?.MPEG_4 ?? 2,
    audioEncoder: Audio?.AndroidAudioEncoder?.AAC ?? 3,
    sampleRate: 44100,
    numberOfChannels: 1, // Mono: Eliminates dual-microphone phase cancellation
    bitRate: 128000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio?.IOSOutputFormat?.MPEG4AAC ?? 'mp4f',
    audioQuality: Audio?.IOSAudioQuality?.HIGH ?? 127,
    sampleRate: 44100,
    numberOfChannels: 1, // Mono: Clean primary vocal mic
    bitRate: 128000,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 128000,
  },
};

export interface VoiceExpenseModalProps {
  visible: boolean;
  onClose: () => void;
  defaultTripId?: string;
}

export default function VoiceExpenseModal({
  visible,
  onClose,
  defaultTripId,
}: VoiceExpenseModalProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { isSmall } = useResponsive();
  const { user, profile } = useAuthStore();
  const {
    trips,
    members: rawMembers,
    loadTripDetails,
    addExpense,
    updateExpense,
    deleteExpense,
    balances,
    findOrCreateFriendSplitTrip,
  } = useTripStore();
  const { contacts, deviceContacts, initContacts, friendsSummary } = useContactsStore();

  const currentUserPhone =
    profile?.phone_number || (user as any)?.phone || (user as any)?.user_metadata?.phone_number;

  // Conversational Messages State
  const [messages, setMessages] = useState<CopilotMessage[]>([
    {
      id: 'welcome_1',
      role: 'assistant',
      content: "Hi! I'm your SplitYourTrip AI Copilot. Speak or type to add expenses, check balances, settle up, or navigate the app.",
      timestamp: new Date().toISOString(),
    },
  ]);

  // TTS audio speech readout state
  const [isTtsActive, setIsTtsActive] = useState<boolean>(isTtsEnabled());
  const [pendingAction, setPendingAction] = useState<CopilotAction | null>(null);

  // Automatic Listening & Status states
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  // References
  const recordingRef = useRef<any>(null);
  const hasSpokenRef = useRef(false);
  const speechFrameCountRef = useRef(0);
  const lastSpokenTimestampRef = useRef<number>(0);
  const lastTtsEndTimeRef = useRef<number>(0);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const webRecognitionRef = useRef<any>(null);
  const scrollViewRef = useRef<ScrollView | null>(null);

  // Smooth circular pulse ring animations
  const pulseRing1 = useRef(new Animated.Value(1)).current;
  const pulseRing2 = useRef(new Animated.Value(1)).current;
  const opacityRing1 = useRef(new Animated.Value(0.7)).current;
  const opacityRing2 = useRef(new Animated.Value(0.5)).current;

  // Speech Language selection: Auto (multilingual) / English / Hindi / Gujarati
  const [selectedLanguage, setSelectedLanguage] = useState<VoiceLanguage>('auto');

  useEffect(() => {
    AppStorage.getItem('@splityourtrip_voice_language')
      .then(saved => {
        if (saved && (saved === 'auto' || saved === 'en' || saved === 'hi' || saved === 'gu')) {
          setSelectedLanguage(saved as VoiceLanguage);
        }
      })
      .catch(() => {});
  }, []);

  const handleCycleLanguage = useCallback(() => {
    const cycle: VoiceLanguage[] = ['auto', 'en', 'hi', 'gu'];
    const nextIdx = (cycle.indexOf(selectedLanguage) + 1) % cycle.length;
    const nextLang = cycle[nextIdx];
    setSelectedLanguage(nextLang);
    AppStorage.setItem('@splityourtrip_voice_language', nextLang).catch(() => {});
  }, [selectedLanguage]);

  // Text input state
  const [textInput, setTextInput] = useState('');
  const [speechStatusMessage, setSpeechStatusMessage] = useState<string | null>(null);
  const [speechStatusType, setSpeechStatusType] = useState<'info' | 'warning' | 'error'>('info');
  const [tripMembersMap, setTripMembersMap] = useState<Record<string, TripMember[]>>({});
  const [selectedTripId, setSelectedTripId] = useState<string | null>(defaultTripId || null);
  const [isExecutingAction, setIsExecutingAction] = useState(false);
  const [recentExpenses, setRecentExpenses] = useState<CopilotRecentExpense[]>([]);

  // Deduplicated contacts summary for AI Copilot matching
  const contactsSummary = useMemo<CopilotContactSummary[]>(() => {
    const map = new Map<string, CopilotContactSummary>();
    contacts.forEach(c => {
      if (c.name && c.name.trim()) {
        const key = c.phoneNumber ? normalizePhone(c.phoneNumber) : c.id;
        map.set(key, { id: c.id, name: c.name.trim(), phoneNumber: c.phoneNumber });
      }
    });
    deviceContacts.forEach(dc => {
      if (dc.name && dc.name.trim()) {
        const key = dc.phoneNumber ? normalizePhone(dc.phoneNumber) : dc.id;
        if (!map.has(key)) {
          map.set(key, { id: dc.id, name: dc.name.trim(), phoneNumber: dc.phoneNumber });
        }
      }
    });
    return Array.from(map.values());
  }, [contacts, deviceContacts]);

  // Contextual names for Whisper domain conditioning (current members, trips, top contacts)
  const contextNames = useMemo<string[]>(() => {
    const set = new Set<string>();
    if (selectedTripId && tripMembersMap[selectedTripId]) {
      tripMembersMap[selectedTripId].forEach(m => {
        if (m.display_name) set.add(m.display_name.trim());
      });
    }
    trips.forEach(t => {
      if (t.name) set.add(t.name.trim());
    });
    contactsSummary.slice(0, 15).forEach(c => {
      if (c.name) set.add(c.name.trim());
    });
    return Array.from(set).slice(0, 20);
  }, [selectedTripId, tripMembersMap, trips, contactsSummary]);

  // Idempotency & Concurrency Guards to prevent duplicate/triplicate submissions
  const isStoppingListeningRef = useRef(false);
  const isTurnProcessingRef = useRef(false);
  const isSubmittingExpenseRef = useRef(false);
  const submittedExpenseKeysRef = useRef<Set<string>>(new Set());

  // Gather cached trip members and recent expenses once when modal opens
  const hasInitializedModalRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      hasInitializedModalRef.current = false;
      return;
    }
    if (hasInitializedModalRef.current) return;
    hasInitializedModalRef.current = true;

    // Proactively initialize address book contacts so contact splits have full access
    initContacts().catch(() => {});

    // Collect expenses from store synchronously (instant, 0 lag)
    const storeState = useTripStore.getState();
    const storeTrips = storeState.trips || [];
    const storeExps = storeState.expenses || [];
    const storeMembers = storeState.members || [];

    const membersMap: Record<string, TripMember[]> = {};
    storeTrips.forEach(t => {
      const ms = storeMembers.filter(m => m.trip_id === t.id);
      if (ms.length > 0) {
        membersMap[t.id] = ms;
      }
    });
    setTripMembersMap(membersMap);

    const collectedExpenses: CopilotRecentExpense[] = [];
    const seenExpIds = new Set<string>();

    storeExps.forEach(e => {
      if (e.id && !seenExpIds.has(e.id)) {
        seenExpIds.add(e.id);
        const tr = storeTrips.find(t => t.id === e.trip_id);
        collectedExpenses.push({
          id: e.id,
          tripId: e.trip_id,
          tripName: tr ? tr.name : 'Trip',
          description: e.description || 'Expense',
          amountPaise: Number(e.amount) || 0,
          amountRupees: Math.round((Number(e.amount) || 0) / 100).toString(),
          category: e.category,
          date: e.date || (e as any).created_at,
          paidByName: (e as any).payerName,
        });
      }
    });

    collectedExpenses.sort((a, b) => {
      const timeA = a.date ? new Date(a.date).getTime() : 0;
      const timeB = b.date ? new Date(b.date).getTime() : 0;
      return timeB - timeA;
    });

    setRecentExpenses(collectedExpenses.slice(0, 20));

    // Asynchronously scan AppStorage for all trips to guarantee 100% visibility of all cached expenses
    (async () => {
      try {
        const fullExpenses: CopilotRecentExpense[] = [...collectedExpenses];
        const fullMembersMap: Record<string, TripMember[]> = { ...membersMap };

        for (const trip of storeTrips) {
          try {
            const raw = await AppStorage.getItem(`@splityourtrip_local_details_${trip.id}`);
            if (raw) {
              const details = JSON.parse(raw);
              if (Array.isArray(details?.members) && details.members.length > 0) {
                fullMembersMap[trip.id] = details.members;
              }
              if (Array.isArray(details?.expenses)) {
                details.expenses.forEach((e: any) => {
                  if (e.id && !seenExpIds.has(e.id)) {
                    seenExpIds.add(e.id);
                    fullExpenses.push({
                      id: e.id,
                      tripId: trip.id,
                      tripName: trip.name,
                      description: e.description || 'Expense',
                      amountPaise: Number(e.amount) || 0,
                      amountRupees: Math.round((Number(e.amount) || 0) / 100).toString(),
                      category: e.category,
                      date: e.date || e.created_at,
                      paidByName: e.payerName,
                    });
                  }
                });
              }
            }
          } catch {}
        }

        fullExpenses.sort((a, b) => {
          const timeA = a.date ? new Date(a.date).getTime() : 0;
          const timeB = b.date ? new Date(b.date).getTime() : 0;
          return timeB - timeA;
        });

        setRecentExpenses(fullExpenses.slice(0, 30));
        setTripMembersMap(fullMembersMap);
      } catch {}
    })();
  }, [visible]);

  // Set default trip when modal opens
  useEffect(() => {
    if (visible && defaultTripId) {
      setSelectedTripId(defaultTripId);
    } else if (visible && !selectedTripId && trips.length > 0) {
      setSelectedTripId(trips[0].id);
    }
  }, [visible, defaultTripId]);

  // Concentric ripple wave pulse animation loop when listening
  useEffect(() => {
    let animLoop: Animated.CompositeAnimation | null = null;
    if (isListening) {
      pulseRing1.setValue(1);
      pulseRing2.setValue(1);
      opacityRing1.setValue(0.7);
      opacityRing2.setValue(0.5);

      animLoop = Animated.loop(
        Animated.parallel([
          Animated.sequence([
            Animated.parallel([
              Animated.timing(pulseRing1, {
                toValue: 1.38,
                duration: 1100,
                useNativeDriver: true,
              }),
              Animated.timing(opacityRing1, {
                toValue: 0,
                duration: 1100,
                useNativeDriver: true,
              }),
            ]),
            Animated.parallel([
              Animated.timing(pulseRing1, {
                toValue: 1,
                duration: 0,
                useNativeDriver: true,
              }),
              Animated.timing(opacityRing1, {
                toValue: 0.7,
                duration: 0,
                useNativeDriver: true,
              }),
            ]),
          ]),
          Animated.sequence([
            Animated.delay(350),
            Animated.parallel([
              Animated.timing(pulseRing2, {
                toValue: 1.62,
                duration: 1100,
                useNativeDriver: true,
              }),
              Animated.timing(opacityRing2, {
                toValue: 0,
                duration: 1100,
                useNativeDriver: true,
              }),
            ]),
            Animated.parallel([
              Animated.timing(pulseRing2, {
                toValue: 1,
                duration: 0,
                useNativeDriver: true,
              }),
              Animated.timing(opacityRing2, {
                toValue: 0.5,
                duration: 0,
                useNativeDriver: true,
              }),
            ]),
          ]),
        ])
      );
      animLoop.start();
    } else {
      pulseRing1.setValue(1);
      pulseRing2.setValue(1);
      opacityRing1.setValue(0);
      opacityRing2.setValue(0);
    }
    return () => {
      if (animLoop) animLoop.stop();
    };
  }, [isListening, opacityRing1, opacityRing2, pulseRing1, pulseRing2]);

  // Clean up on unmount or close
  const handleModalClose = useCallback(() => {
    stopSpeaking();
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (recordingRef.current) {
      recordingRef.current.stopAndUnloadAsync().catch(() => {});
      recordingRef.current = null;
    }
    if (webRecognitionRef.current) {
      try {
        webRecognitionRef.current.stop();
      } catch {}
      webRecognitionRef.current = null;
    }
    setIsListening(false);
    setIsSpeaking(false);
    setIsAnalyzing(false);
    setSpeechStatusMessage(null);
    onClose();
  }, [onClose]);

  // Auto-scroll to end of conversation
  useEffect(() => {
    const timer = setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 150);
    return () => clearTimeout(timer);
  }, [messages, isAnalyzing, isListening]);

  // Toggle Text-to-Speech
  const toggleTts = () => {
    const nextVal = !isTtsActive;
    setIsTtsActive(nextVal);
    setTtsEnabled(nextVal);
  };

  // Submit Expense Automatically to store and backend with deduplication & concurrency locks
  const executeSubmitExpense = useCallback(
    async (targetData: {
      amountPaise: number;
      amountRupees: string;
      description?: string;
      category?: string;
      tripId: string;
      paidByMemberId?: string;
      participantMemberIds?: string[];
      paymentMode?: 'upi' | 'cash' | 'other';
      splitAll?: boolean;
    }): Promise<boolean> => {
      if (isSubmittingExpenseRef.current) {
        console.warn('[VoiceModal] Expense submission already in progress, suppressing duplicate call');
        return false;
      }

      const targetTrip =
        trips.find(t => t.id === targetData.tripId) ||
        trips.find(t => t.id === selectedTripId) ||
        trips.find(t => t.id === defaultTripId) ||
        trips[0];

      if (!targetTrip) {
        Alert.alert('No Trip Found', 'Please create a trip first.');
        return false;
      }

      let members = tripMembersMap[targetTrip.id] || rawMembers.filter(m => m.trip_id === targetTrip.id);
      if (!members || members.length === 0) {
        try {
          await loadTripDetails(targetTrip.id);
          members = useTripStore.getState().members.filter(m => m.trip_id === targetTrip.id);
        } catch {}
      }

      if (!members || members.length === 0) {
        Alert.alert('No Members', 'Could not find members for this trip.');
        return false;
      }

      const myMember = findMyMember(members, user?.id, currentUserPhone);
      let paidBy = targetData.paidByMemberId;
      if (!paidBy || !members.some(m => m.id === paidBy || m.profile_id === paidBy)) {
        paidBy = myMember?.id || members[0]?.id;
      }

      if (!paidBy) {
        Alert.alert('Member Error', 'Could not locate payer member for this trip.');
        return false;
      }

      // FIX ISSUE 2: Preserve exact participants requested by the user
      let participants = (targetData.participantMemberIds || []).filter(pid =>
        members.some(m => m.id === pid || m.profile_id === pid)
      );

      // Only default to all members if splitAll is explicitly true OR no participants were specified
      if (targetData.splitAll === true || participants.length === 0) {
        participants = members.map(m => m.id);
      } else if (participants.length === 1 && myMember && participants[0] !== myMember.id) {
        // Splitting with 1 person always implies [speaker, person] (50-50 split)
        participants.push(myMember.id);
      }

      const finalAmountPaise = targetData.amountPaise;
      if (!finalAmountPaise || finalAmountPaise <= 0) {
        return false;
      }

      const description = (targetData.description || `${targetTrip.name} Expense`).trim();
      const category = targetData.category || 'General';
      const paymentMode = (targetData.paymentMode || 'upi') as PaymentMode;

      // FIX ISSUE 1: Deduplication key to prevent duplicate / triplicate additions
      const dedupeKey = `${targetTrip.id}_${finalAmountPaise}_${description.toLowerCase()}_${paidBy}_${participants.slice().sort().join(',')}`;
      if (submittedExpenseKeysRef.current.has(dedupeKey)) {
        console.warn('[VoiceModal] Duplicate expense submission detected, suppressing duplicate:', dedupeKey);
        return false;
      }

      isSubmittingExpenseRef.current = true;
      setIsExecutingAction(true);

      const expenseId = generateUUID();

      try {
        const success = await addExpense({
          expenseId,
          tripId: targetTrip.id,
          paidByMemberId: paidBy,
          amountPaise: finalAmountPaise,
          description,
          category,
          paymentMode,
          splitType: 'equal',
          participantMemberIds: participants,
          userId: user?.id || 'local_user',
        });

        if (success) {
          submittedExpenseKeysRef.current.add(dedupeKey);

          // Update local recentExpenses state so subsequent turns have instant context
          const newRecentExp: CopilotRecentExpense = {
            id: expenseId,
            tripId: targetTrip.id,
            tripName: targetTrip.name,
            description,
            amountPaise: finalAmountPaise,
            amountRupees: targetData.amountRupees || Math.round(finalAmountPaise / 100).toString(),
            category,
            date: new Date().toISOString(),
            paidByName: myMember?.display_name || 'You',
          };
          setRecentExpenses(prev => [newRecentExp, ...prev]);

          // Fire global notification toast banner
          try {
            useNotificationStore.getState().showToast({
              id: `voice_exp_${expenseId}`,
              type: 'expense',
              title: 'Expense Added!',
              message: `₹${targetData.amountRupees} for ${description} in ${targetTrip.name}`,
              timestamp: new Date().toISOString(),
              read: true,
              tripId: targetTrip.id,
              tripName: targetTrip.name,
              amountPaise: finalAmountPaise,
            });
          } catch {}

          return true;
        }
        return false;
      } catch (err: any) {
        return false;
      } finally {
        isSubmittingExpenseRef.current = false;
        setIsExecutingAction(false);
      }
    },
    [
      trips,
      selectedTripId,
      defaultTripId,
      tripMembersMap,
      rawMembers,
      loadTripDetails,
      user?.id,
      currentUserPhone,
      addExpense,
    ]
  );

  // Execute Delete Expense
  const executeDeleteExpense = useCallback(
    async (targetData: {
      tripId: string;
      tripName?: string;
      expenseId: string;
      description: string;
      amountRupees: string;
      amountPaise: number;
    }): Promise<boolean> => {
      setIsExecutingAction(true);
      try {
        const success = await deleteExpense(targetData.tripId, targetData.expenseId);
        if (success) {
          // Remove from local recentExpenses state
          setRecentExpenses(prev => prev.filter(e => e.id !== targetData.expenseId));

          // Global toast
          try {
            useNotificationStore.getState().showToast({
              id: `toast_del_${targetData.expenseId}`,
              type: 'expense',
              title: 'Expense Deleted',
              message: `₹${targetData.amountRupees} for ${targetData.description} removed.`,
              timestamp: new Date().toISOString(),
              read: true,
            });
          } catch {}

          return true;
        }
        return false;
      } catch (err) {
        console.warn('[VoiceModal] Delete expense error:', err);
        return false;
      } finally {
        setIsExecutingAction(false);
      }
    },
    [deleteExpense]
  );

  // Execute Update Expense
  const executeUpdateExpense = useCallback(
    async (targetData: {
      expenseId: string;
      tripId: string;
      tripName?: string;
      description?: string;
      amountRupees?: string;
      amountPaise?: number;
      category?: string;
      paidByMemberId?: string;
      participantMemberIds?: string[];
      splitAll?: boolean;
      paymentMode?: 'upi' | 'cash' | 'other';
    }): Promise<boolean> => {
      setIsExecutingAction(true);
      try {
        const targetTrip =
          trips.find(t => t.id === targetData.tripId) ||
          trips.find(t => t.id === selectedTripId) ||
          trips.find(t => t.id === defaultTripId) ||
          trips[0];

        if (!targetTrip) {
          Alert.alert('No Trip Found', 'Could not locate the trip for this expense.');
          return false;
        }

        let existingExpense = useTripStore.getState().expenses.find(e => e.id === targetData.expenseId);
        if (!existingExpense) {
          try {
            await loadTripDetails(targetTrip.id);
            existingExpense = useTripStore.getState().expenses.find(e => e.id === targetData.expenseId);
          } catch {}
        }

        if (!existingExpense) {
          existingExpense = useTripStore
            .getState()
            .expenses.find(
              e =>
                e.trip_id === targetTrip.id &&
                (e.description?.toLowerCase() === targetData.description?.toLowerCase() ||
                  e.amount === targetData.amountPaise)
            );
        }

        if (!existingExpense) {
          console.warn('[VoiceModal] Expense not found to update:', targetData.expenseId);
          return false;
        }

        let members = tripMembersMap[targetTrip.id] || rawMembers.filter(m => m.trip_id === targetTrip.id);
        if (!members || members.length === 0) {
          try {
            await loadTripDetails(targetTrip.id);
            members = useTripStore.getState().members.filter(m => m.trip_id === targetTrip.id);
          } catch {}
        }

        const myMember = findMyMember(members, user?.id, currentUserPhone);

        // Participants resolution
        let participants = (targetData.participantMemberIds || []).filter(pid =>
          members.some(m => m.id === pid || m.profile_id === pid)
        );

        if (targetData.splitAll === true || participants.length === 0) {
          participants = members.map(m => m.id);
        } else if (participants.length === 1 && myMember && participants[0] !== myMember.id) {
          participants.push(myMember.id);
        }

        const finalAmountPaise =
          targetData.amountPaise && targetData.amountPaise > 0
            ? targetData.amountPaise
            : targetData.amountRupees
            ? Math.round(Number(targetData.amountRupees) * 100)
            : Number(existingExpense.amount) || 0;

        const description = (targetData.description || existingExpense.description || 'Expense').trim();
        const category = targetData.category || existingExpense.category || 'General';
        const paidBy = targetData.paidByMemberId || existingExpense.paid_by || myMember?.id || members[0]?.id;
        const paymentMode = (targetData.paymentMode || existingExpense.payment_mode || 'upi') as PaymentMode;

        const targetExpenseId = existingExpense.id;

        const success = await updateExpense({
          tripId: targetTrip.id,
          expenseId: targetExpenseId,
          amountPaise: finalAmountPaise,
          description,
          category,
          paidByMemberId: paidBy,
          participantMemberIds: participants,
          paymentMode,
          splitType: 'equal',
          userId: user?.id || 'local_user',
          editorName: myMember?.display_name || profile?.full_name || (user as any)?.user_metadata?.full_name || 'You',
        });

        if (success) {
          const updatedAmtRupees = Math.round(finalAmountPaise / 100).toString();

          setRecentExpenses(prev =>
            prev.map(e =>
              e.id === targetExpenseId
                ? {
                    ...e,
                    description,
                    amountPaise: finalAmountPaise,
                    amountRupees: updatedAmtRupees,
                    category,
                  }
                : e
            )
          );

          try {
            useNotificationStore.getState().showToast({
              id: `toast_update_${targetExpenseId}`,
              type: 'expense',
              title: 'Expense Updated',
              message: `₹${updatedAmtRupees} for ${description} in ${targetTrip.name} updated.`,
              timestamp: new Date().toISOString(),
              read: true,
              tripId: targetTrip.id,
              tripName: targetTrip.name,
              amountPaise: finalAmountPaise,
            });
          } catch {}

          return true;
        }

        return false;
      } catch (err) {
        console.warn('[VoiceModal] Update expense error:', err);
        return false;
      } finally {
        setIsExecutingAction(false);
      }
    },
    [
      trips,
      selectedTripId,
      defaultTripId,
      tripMembersMap,
      rawMembers,
      loadTripDetails,
      user?.id,
      currentUserPhone,
      updateExpense,
    ]
  );

  // Execute Start Contact Split
  const executeStartContactSplit = useCallback(
    async (targetData: {
      contactId?: string;
      contactName: string;
      phoneNumber?: string;
      amountRupees?: string;
      amountPaise?: number;
      description?: string;
      category?: string;
    }): Promise<{ trip: any; expenseAdded: boolean } | null> => {
      setIsExecutingAction(true);
      try {
        // Locate contact in contacts summary
        const matched = contactsSummary.find(
          c =>
            (targetData.contactId && c.id === targetData.contactId) ||
            (c.phoneNumber && targetData.phoneNumber && c.phoneNumber.includes(targetData.phoneNumber.slice(-8))) ||
            (c.name && targetData.contactName && c.name.toLowerCase().includes(targetData.contactName.toLowerCase()))
        );

        const friendObj = {
          id: matched?.id || generateUUID(),
          name: matched?.name || targetData.contactName,
          phoneNumber: matched?.phoneNumber || targetData.phoneNumber || null,
        };

        const friendTrip = await findOrCreateFriendSplitTrip(friendObj);
        if (!friendTrip) {
          Alert.alert('Error', `Could not create split with ${friendObj.name}.`);
          return null;
        }

        let expenseAdded = false;
        const amtPaise =
          targetData.amountPaise && targetData.amountPaise > 0
            ? targetData.amountPaise
            : targetData.amountRupees
            ? Math.round(Number(targetData.amountRupees) * 100)
            : 0;

        if (amtPaise > 0) {
          const desc = (targetData.description || 'Expense').trim();
          const cat = targetData.category || 'General';
          expenseAdded = await executeSubmitExpense({
            amountPaise: amtPaise,
            amountRupees: targetData.amountRupees || Math.round(amtPaise / 100).toString(),
            description: desc,
            category: cat,
            tripId: friendTrip.id,
            splitAll: true,
          });
        }

        try {
          useNotificationStore.getState().showToast({
            id: `toast_split_${friendTrip.id}`,
            type: 'trip_member_added',
            title: 'Split Started!',
            message: amtPaise > 0
              ? `Split with ${friendObj.name} started with ₹${targetData.amountRupees} for ${targetData.description}.`
              : `Split with ${friendObj.name} is active.`,
            timestamp: new Date().toISOString(),
            read: true,
            tripId: friendTrip.id,
            tripName: friendTrip.name,
          });
        } catch {}

        return { trip: friendTrip, expenseAdded };
      } catch (err) {
        console.warn('[VoiceModal] Start contact split error:', err);
        return null;
      } finally {
        setIsExecutingAction(false);
      }
    },
    [contactsSummary, findOrCreateFriendSplitTrip, executeSubmitExpense]
  );

  // Undo newly added expense
  const handleUndoExpense = async (tripId: string, expenseId: string) => {
    try {
      setIsExecutingAction(true);
      const success = await deleteExpense(tripId, expenseId);
      setIsExecutingAction(false);
      if (success) {
        setMessages(prev => [
          ...prev,
          {
            id: generateUUID(),
            role: 'assistant',
            content: 'The expense was cancelled and removed.',
            timestamp: new Date().toISOString(),
          },
        ]);
        speakAssistantReply('The expense was cancelled and removed.');
      }
    } catch {
      setIsExecutingAction(false);
    }
  };

  // Process a user message turn through the conversational Copilot
  const handleProcessUserTurn = useCallback(
    async (inputText: string) => {
      const trimmed = inputText.trim();
      if (!trimmed) return;

      // Filter out Whisper ambient silence hallucinations (e.g., "The", "The The", "I'm")
      if (isWhisperHallucination(trimmed)) {
        console.log('[VoiceModal] Ignored ambient silence hallucination:', trimmed);
        setSpeechStatusMessage('Tap mic to speak');
        setSpeechStatusType('info');
        setIsAnalyzing(false);
        setIsListening(false);
        return;
      }

      // Prevent concurrent/overlapping turns
      if (isTurnProcessingRef.current) {
        console.warn('[VoiceModal] Turn is already processing, ignoring duplicate input:', trimmed);
        return;
      }
      isTurnProcessingRef.current = true;

      // 1. Add user message
      const userMsg: CopilotMessage = {
        id: generateUUID(),
        role: 'user',
        content: trimmed,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, userMsg]);
      setTextInput('');
      setSpeechStatusMessage(null);
      setIsAnalyzing(true);
      setIsListening(false);

      // Build history for Groq
      const historyTurns = messages.map(m => ({
        role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: m.content,
      }));

      try {
        const result = await runVoiceCopilot({
          userPrompt: trimmed,
          history: historyTurns,
          trips,
          tripMembersMap,
          balances,
          currentUserId: user?.id,
          currentUserPhone,
          activeTripId: selectedTripId || defaultTripId,
          friendsSummary,
          recentExpenses,
          contacts: contactsSummary,
        });

        setIsAnalyzing(false);

        // 2. Add assistant response
        const assistantMsg: CopilotMessage = {
          id: generateUUID(),
          role: 'assistant',
          content: result.reply,
          action: result.action,
          timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, assistantMsg]);

        // 3. Speak assistant reply aloud via TTS (without automatic echo loop)
        speakAssistantReply(result.reply, {
          onDone: () => {
            lastTtsEndTimeRef.current = Date.now();
          },
        });

        // 4. Handle Actions
        if (result.action) {
          if (result.action.status === 'confirmed') {
            if (
              (result.action.type === 'ADD_EXPENSE' || result.action.type === 'CONFIRM_ADD_EXPENSE') &&
              result.action.expense
            ) {
              setPendingAction(null);
              const ok = await executeSubmitExpense(result.action.expense);
              if (!ok) {
                const failMsg: CopilotMessage = {
                  id: generateUUID(),
                  role: 'assistant',
                  content: `I had trouble saving the expense to ${result.action.expense.tripName || 'your trip'}. Please try again.`,
                  timestamp: new Date().toISOString(),
                };
                setMessages(prev => [...prev, failMsg]);
                speakAssistantReply('I could not save the expense.');
              }
            } else if (result.action.type === 'UPDATE_EXPENSE' && result.action.updateExpense) {
              setPendingAction(null);
              const ok = await executeUpdateExpense(result.action.updateExpense);
              if (!ok) {
                const failMsg: CopilotMessage = {
                  id: generateUUID(),
                  role: 'assistant',
                  content: `I could not update that expense. Please make sure the expense exists in ${result.action.updateExpense.tripName || 'your trip'}.`,
                  timestamp: new Date().toISOString(),
                };
                setMessages(prev => [...prev, failMsg]);
                speakAssistantReply('I could not update that expense.');
              }
            } else if (result.action.type === 'DELETE_EXPENSE' && result.action.deleteExpense) {
              setPendingAction(null);
              await executeDeleteExpense(result.action.deleteExpense);
            } else if (result.action.type === 'START_CONTACT_SPLIT' && result.action.contactSplit) {
              setPendingAction(null);
              await executeStartContactSplit(result.action.contactSplit);
            }
          } else if (result.action.status === 'pending_confirmation') {
            setPendingAction(result.action);
          } else if (result.action.type === 'NAVIGATE' && result.action.navigation?.screen) {
            const screen = result.action.navigation.screen;
            setTimeout(() => {
              handleModalClose();
              router.push(screen as any);
            }, 1200);
          }
        }
      } catch (err) {
        setIsAnalyzing(false);
        const errorMsg: CopilotMessage = {
          id: generateUUID(),
          role: 'assistant',
          content: "I had trouble processing that. Tap the mic or type your expense below.",
          timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, errorMsg]);
        speakAssistantReply("I had trouble processing that. Tap the mic or type your expense below.", {
          onDone: () => {
            lastTtsEndTimeRef.current = Date.now();
          },
        });
      } finally {
        isTurnProcessingRef.current = false;
        setIsAnalyzing(false);
      }
    },
    [
      messages,
      trips,
      tripMembersMap,
      balances,
      user?.id,
      currentUserPhone,
      selectedTripId,
      defaultTripId,
      friendsSummary,
      recentExpenses,
      contactsSummary,
      executeSubmitExpense,
      executeUpdateExpense,
      executeDeleteExpense,
      executeStartContactSplit,
      handleModalClose,
      router,
    ]
  );

  // Automatic Speech Recognition with speech metering & silence suppression
  const startAutomaticListening = useCallback(async () => {
    try {
      // Echo cancellation: Stop any TTS playing
      stopSpeaking();

      // Safely unload any prior recording object before preparing a new one
      if (recordingRef.current) {
        try {
          await recordingRef.current.stopAndUnloadAsync();
        } catch {}
        recordingRef.current = null;
      }

      isStoppingListeningRef.current = false;
      setSpeechStatusMessage('Starting microphone...');
      setSpeechStatusType('info');
      setRecordingSeconds(0);
      hasSpokenRef.current = false;
      speechFrameCountRef.current = 0;
      lastSpokenTimestampRef.current = 0;
      setIsSpeaking(false);
      setIsAnalyzing(false);

      // Web Speech API fallback for browser testing
      if (
        Platform.OS === 'web' &&
        typeof window !== 'undefined' &&
        ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)
      ) {
        try {
          const SpeechClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
          const rec = new SpeechClass();
          rec.continuous = true;
          rec.interimResults = false;
          rec.lang = selectedLanguage === 'hi' ? 'hi-IN' : selectedLanguage === 'gu' ? 'gu-IN' : 'en-IN';
          rec.onresult = (e: any) => {
            let fullText = '';
            for (let i = 0; i < e.results.length; i++) {
              fullText += e.results[i][0]?.transcript || '';
            }
            if (fullText.trim()) {
              handleProcessUserTurn(fullText.trim());
            }
          };
          rec.onerror = () => {
            setIsListening(false);
            setIsSpeaking(false);
          };
          rec.onend = () => {
            setIsListening(false);
            setIsSpeaking(false);
          };
          rec.start();
          webRecognitionRef.current = rec;
          return;
        } catch {}
      }

      // Native iOS & Android recording via expo-av
      if (!Audio?.requestPermissionsAsync) {
        setIsListening(false);
        setSpeechStatusMessage('Voice recording not available on this device');
        setSpeechStatusType('error');
        return;
      }

      const perm = await Audio.requestPermissionsAsync();
      if (!perm?.granted) {
        setIsListening(false);
        setSpeechStatusMessage('Microphone permission denied. Please allow microphone access in Settings.');
        setSpeechStatusType('error');
        Alert.alert(
          'Microphone Permission Required',
          'Please allow microphone access in Settings so you can speak to SplitYourTrip AI Copilot.'
        );
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });

      // Dedicated mono recording with calibrated sensitivity
      const { recording } = await Audio.Recording.createAsync(
        SPEECH_RECORDING_OPTIONS,
        (status: any) => {
          if (!status?.isRecording) return;

          const currentMetering = typeof status.metering === 'number' ? status.metering : -160;
          const duration = status.durationMillis || 0;
          setRecordingSeconds(Math.round(duration / 100) / 10);

          // Calibrated voice detection threshold:
          // Background room noise is -60 to -48 dB.
          // Real human voice at normal phone distance: -44 dB to -15 dB.
          if (currentMetering > -44) {
            speechFrameCountRef.current += 1;
            // Require at least 2 frames (200ms) of sustained audio to confirm user speech
            if (speechFrameCountRef.current >= 2) {
              hasSpokenRef.current = true;
              lastSpokenTimestampRef.current = Date.now();
              setIsSpeaking(true);
            }
          } else if (Date.now() - lastSpokenTimestampRef.current > 700) {
            setIsSpeaking(false);
          }

          // Auto silence timeout: only if user has actually spoken, recording is at least 1.8s long,
          // and user has been silent for 3.2 seconds (prevents cutting off normal conversational pauses)
          if (
            hasSpokenRef.current &&
            duration > 1800 &&
            lastSpokenTimestampRef.current > 0 &&
            Date.now() - lastSpokenTimestampRef.current > 3200
          ) {
            if (!isStoppingListeningRef.current) {
              isStoppingListeningRef.current = true;
              stopAutomaticListening();
            }
          }

          // Maximum recording duration: 30 seconds
          if (duration > 30000) {
            if (!isStoppingListeningRef.current) {
              isStoppingListeningRef.current = true;
              stopAutomaticListening();
            }
          }
        },
        100
      );

      recordingRef.current = recording;
      setIsListening(true);
      const langLabel =
        selectedLanguage === 'auto'
          ? 'Auto'
          : selectedLanguage === 'hi'
          ? 'Hindi'
          : selectedLanguage === 'gu'
          ? 'Gujarati'
          : 'English';
      setSpeechStatusMessage(`Listening (${langLabel})... Speak now`);
      setSpeechStatusType('info');
    } catch (err: any) {
      console.warn('[VoiceModal] Auto listen start error:', err);
      setIsListening(false);
      setIsSpeaking(false);
      setSpeechStatusMessage(`Microphone error: ${err?.message || 'Could not start recording'}`);
      setSpeechStatusType('error');
    }
  }, [handleProcessUserTurn, selectedLanguage]);

  // Stop listening and process audio turn
  const stopAutomaticListening = useCallback(async () => {
    if (!recordingRef.current && !webRecognitionRef.current) {
      setIsListening(false);
      setIsSpeaking(false);
      return;
    }

    setIsListening(false);
    setIsSpeaking(false);
    setRecordingSeconds(0);
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    if (webRecognitionRef.current) {
      try {
        webRecognitionRef.current.stop();
      } catch {}
      webRecognitionRef.current = null;
    }

    const rec = recordingRef.current;
    recordingRef.current = null;

    let recordedUri: string | null = null;
    try {
      if (rec) {
        recordedUri = rec.getURI();
        await rec.stopAndUnloadAsync();
      }
      if (Audio) {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
        });
      }
    } catch (err) {
      console.warn('[VoiceModal] Error unloading recording:', err);
    }

    if (recordedUri) {
      let fileInfo: any = null;
      try {
        fileInfo = await FileSystem.getInfoAsync(recordedUri);
      } catch {}

      // Discard only if file does not exist or size is tiny (< 300 bytes)
      if (!fileInfo?.exists || ('size' in fileInfo && fileInfo.size < 300)) {
        setIsAnalyzing(false);
        setSpeechStatusType('info');
        setSpeechStatusMessage('Tap mic to speak at your own pace');
        return;
      }

      setIsAnalyzing(true);
      setSpeechStatusType('info');
      setSpeechStatusMessage('Processing your speech with AI...');

      const result = await transcribeAudioWithDetails(recordedUri, selectedLanguage, contextNames);
      if (result.text && result.text.trim()) {
        const clean = result.text.trim();
        if (isWhisperHallucination(clean)) {
          setIsAnalyzing(false);
          setSpeechStatusType('info');
          setSpeechStatusMessage('Tap mic to speak at your own pace');
          return;
        }
        await handleProcessUserTurn(clean);
      } else {
        setIsAnalyzing(false);
        setSpeechStatusType('info');
        setSpeechStatusMessage('No speech detected. Tap the mic to speak.');
      }
    }
  }, [handleProcessUserTurn, selectedLanguage, contextNames]);

  // Stop listening and speaking when modal closes
  useEffect(() => {
    if (!visible) {
      stopAutomaticListening();
      stopSpeaking();
    }
  }, [visible, stopAutomaticListening]);

  return (
    <DraggableBottomSheet
      visible={visible}
      onClose={handleModalClose}
      height="88%"
      maxHeight="92%"
      showHandle={true}
      sheetStyle={{
        maxWidth: 640,
        alignSelf: 'center',
        width: '100%',
        paddingHorizontal: moderateScale(16),
      }}
    >
      {() => (
        <View style={{ flex: 1, paddingBottom: Platform.OS === 'android' ? Math.max(insets.bottom, 12) : 0 }}>
          {/* Top Bar Header: AI Copilot Title + Voice Readout Toggle + Close Button */}
          <View style={styles.topBar}>
            <View style={styles.titleRow}>
              <View style={[styles.titleIconBadge, { backgroundColor: colors.primaryLight }]}>
                <Ionicons name="sparkles" size={14} color={colors.primary} />
              </View>
              <Text style={[styles.topBarTitle, { color: colors.text }]}>AI Copilot</Text>
            </View>

            <View style={styles.topBarRightActions}>
              {/* Language Selector Pill (Auto / EN / HI / GU) */}
              <TouchableOpacity
                style={[
                  styles.langTogglePill,
                  {
                    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#F1F5F9',
                    borderColor: isDark ? 'rgba(255, 255, 255, 0.15)' : '#E2E8F0',
                  },
                ]}
                onPress={handleCycleLanguage}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Speech language: ${selectedLanguage}. Tap to cycle.`}
              >
                <Ionicons name="language" size={13} color={colors.primary} />
                <Text style={[styles.langToggleText, { color: colors.text }]}>
                  {selectedLanguage === 'auto'
                    ? 'Auto'
                    : selectedLanguage === 'hi'
                    ? 'हिंदी'
                    : selectedLanguage === 'gu'
                    ? 'ગુજરાતી'
                    : 'EN'}
                </Text>
              </TouchableOpacity>

              {/* Speaker Readout Toggle (TTS) */}
              <TouchableOpacity
                style={[
                  styles.ttsTogglePill,
                  {
                    backgroundColor: isTtsActive
                      ? (isDark ? 'rgba(59, 130, 246, 0.18)' : '#DBEAFE')
                      : (isDark ? 'rgba(255, 255, 255, 0.08)' : '#F1F5F9'),
                    borderColor: isTtsActive ? colors.primary : (isDark ? 'rgba(255, 255, 255, 0.15)' : '#E2E8F0'),
                  },
                ]}
                onPress={toggleTts}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Voice Readout ${isTtsActive ? 'ON' : 'OFF'}`}
              >
                <Ionicons
                  name={isTtsActive ? 'volume-high' : 'volume-mute-outline'}
                  size={14}
                  color={isTtsActive ? colors.primary : colors.textMuted}
                />
                <Text
                  style={[
                    styles.ttsToggleText,
                    { color: isTtsActive ? colors.primary : colors.textSecondary },
                  ]}
                >
                  {isTtsActive ? (isSmall ? 'ON' : 'Voice ON') : (isSmall ? 'Muted' : 'Muted')}
                </Text>
              </TouchableOpacity>

              {/* Close Button */}
              <TouchableOpacity
                style={[
                  styles.closeIconBtn,
                  { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#F1F5F9' },
                ]}
                onPress={handleModalClose}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Conversation Chat Feed */}
          <ScrollView
            ref={scrollViewRef}
            style={styles.chatScrollView}
            contentContainerStyle={styles.chatScrollContent}
            showsVerticalScrollIndicator={true}
            keyboardShouldPersistTaps="handled"
          >
            {messages.map((item, index) => {
              const isAssistant = item.role === 'assistant';
              return (
                <View
                  key={item.id || index}
                  style={[
                    styles.messageRow,
                    isAssistant ? styles.messageRowAssistant : styles.messageRowUser,
                  ]}
                >
                  {isAssistant && (
                    <View style={[styles.avatarBadge, { backgroundColor: colors.primaryLight }]}>
                      <Ionicons name="sparkles" size={13} color={colors.primary} />
                    </View>
                  )}

                  <View
                    style={[
                      styles.bubbleContainer,
                      isAssistant
                        ? [
                            styles.bubbleAssistant,
                            {
                              backgroundColor: isDark ? colors.card : '#F1F5F9',
                              borderColor: isDark ? colors.border : '#E2E8F0',
                            },
                          ]
                        : [
                            styles.bubbleUser,
                            { backgroundColor: colors.primary },
                          ],
                    ]}
                  >
                    <Text
                      style={[
                        styles.bubbleText,
                        { color: isAssistant ? colors.text : '#FFFFFF' },
                        isSmall && { fontSize: scaleFont(13) },
                      ]}
                    >
                      {item.content}
                    </Text>

                    {/* Action Card inside Assistant Bubble */}
                    {isAssistant && (item.action?.type === 'ADD_EXPENSE' || item.action?.type === 'CONFIRM_ADD_EXPENSE') && item.action?.expense && (item.action.status === 'pending_confirmation' || item.action.status === 'confirmed') && (
                      <View style={[styles.actionCard, { borderColor: item.action.status === 'confirmed' ? '#10B981' : colors.primary, backgroundColor: isDark ? colors.background : '#FFFFFF' }]}>
                        <View style={styles.actionCardHeader}>
                          <Text style={[styles.actionCardTitle, { color: colors.textSecondary }]}>
                            {item.action.status === 'confirmed' ? 'Added Expense' : 'Proposed Expense'}
                          </Text>
                          <Text
                            style={[styles.actionCardAmount, { color: item.action.status === 'confirmed' ? '#10B981' : colors.primary }]}
                            numberOfLines={1}
                            adjustsFontSizeToFit={true}
                            minimumFontScale={0.72}
                          >
                            ₹{item.action.expense.amountRupees}
                          </Text>
                        </View>

                        <Text style={[styles.actionCardDesc, { color: colors.text }]}>
                          {item.action.expense.description}
                        </Text>

                        {/* Detail tags */}
                        <View style={styles.actionTagsRow}>
                          <View style={[styles.actionTagPill, { backgroundColor: isDark ? colors.card : '#F1F5F9' }]}>
                            <Ionicons name="location-outline" size={11} color={colors.primary} />
                            <Text style={[styles.actionTagText, { color: colors.text }]} numberOfLines={1}>
                              {item.action.expense.tripName || 'Trip'}
                            </Text>
                          </View>
                          <View style={[styles.actionTagPill, { backgroundColor: isDark ? colors.card : '#F1F5F9' }]}>
                            <Ionicons name="pricetag-outline" size={11} color={colors.textSecondary} />
                            <Text style={[styles.actionTagText, { color: colors.text }]} numberOfLines={1}>
                              {item.action.expense.category}
                            </Text>
                          </View>
                          {item.action.expense.participantMemberIds && item.action.expense.participantMemberIds.length > 0 && (
                            <View style={[styles.actionTagPill, { backgroundColor: isDark ? colors.card : '#F1F5F9' }]}>
                              <Ionicons name="people-outline" size={11} color={colors.primary} />
                              <Text style={[styles.actionTagText, { color: colors.text }]} numberOfLines={1}>
                                {item.action.expense.splitAll
                                  ? 'All members'
                                  : `${item.action.expense.participantMemberIds.length} members`}
                              </Text>
                            </View>
                          )}
                        </View>

                        {/* Interactive Confirm / Review / Cancel Buttons or Confirmed Badge */}
                        {item.action.status === 'pending_confirmation' ? (
                          <View style={styles.actionCardButtonsRow}>
                            <TouchableOpacity
                              style={[styles.confirmBtn, { backgroundColor: '#10B981' }]}
                              onPress={async () => {
                                const proposedExp = item.action?.expense;
                                if (proposedExp && !isExecutingAction) {
                                  if (item.action) item.action.status = 'confirmed';
                                  setPendingAction(null);
                                  const ok = await executeSubmitExpense(proposedExp);
                                  if (ok) {
                                    setMessages(prev => [
                                      ...prev,
                                      {
                                        id: generateUUID(),
                                        role: 'assistant',
                                        content: `Confirmed! ₹${proposedExp.amountRupees} was saved to ${proposedExp.tripName || 'your trip'}.`,
                                        timestamp: new Date().toISOString(),
                                      },
                                    ]);
                                    speakAssistantReply(`Confirmed! Saved to your trip.`);
                                  }
                                }
                              }}
                              activeOpacity={0.8}
                              disabled={isExecutingAction}
                            >
                              {isExecutingAction ? (
                                <ActivityIndicator size="small" color="#FFFFFF" />
                              ) : (
                                <>
                                  <Ionicons name="checkmark" size={15} color="#FFFFFF" />
                                  <Text style={styles.confirmBtnText}>Confirm & Add</Text>
                                </>
                              )}
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={[styles.cancelBtn, { borderColor: '#EF4444' }]}
                              onPress={() => {
                                if (item.action) item.action.status = 'info_only';
                                setPendingAction(null);
                                setMessages(prev => [
                                  ...prev,
                                  {
                                    id: generateUUID(),
                                    role: 'assistant',
                                    content: 'Cancelled. Let me know if you would like to change the amount or details.',
                                    timestamp: new Date().toISOString(),
                                  },
                                ]);
                                speakAssistantReply('Cancelled.');
                              }}
                              activeOpacity={0.8}
                              disabled={isExecutingAction}
                            >
                              <Text style={styles.cancelBtnText}>Cancel</Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <View style={styles.confirmedBadgeRow}>
                            <Ionicons name="checkmark-circle" size={15} color="#10B981" />
                            <Text style={styles.confirmedBadgeText}>Saved to Trip</Text>
                          </View>
                        )}
                      </View>
                    )}

                    {/* Update Expense Action Card */}
                    {isAssistant && item.action?.type === 'UPDATE_EXPENSE' && item.action.updateExpense && (
                      <View
                        style={[
                          styles.actionCard,
                          {
                            borderColor: item.action.status === 'confirmed' ? '#3B82F6' : '#F59E0B',
                            backgroundColor: isDark ? colors.background : '#FFFFFF',
                          },
                        ]}
                      >
                        <View style={styles.actionCardHeader}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <View style={[styles.titleIconBadge, { backgroundColor: isDark ? 'rgba(59, 130, 246, 0.2)' : '#DBEAFE' }]}>
                              <Ionicons name="create-outline" size={13} color="#3B82F6" />
                            </View>
                            <Text style={[styles.actionCardTitle, { color: '#3B82F6' }]}>
                              {item.action.status === 'confirmed' ? 'Updated Expense' : 'Confirm Update Expense'}
                            </Text>
                          </View>
                          <Text
                            style={[styles.actionCardAmount, { color: '#3B82F6' }]}
                            numberOfLines={1}
                            adjustsFontSizeToFit={true}
                            minimumFontScale={0.72}
                          >
                            ₹{item.action.updateExpense.amountRupees}
                          </Text>
                        </View>

                        <Text style={[styles.actionCardDesc, { color: colors.text }]}>
                          {item.action.updateExpense.description}
                        </Text>

                        {/* Detail tags */}
                        <View style={styles.actionTagsRow}>
                          {Boolean(item.action.updateExpense.tripName) && (
                            <View style={[styles.actionTagPill, { backgroundColor: isDark ? colors.card : '#F1F5F9' }]}>
                              <Ionicons name="location-outline" size={11} color={colors.primary} />
                              <Text style={[styles.actionTagText, { color: colors.text }]} numberOfLines={1}>
                                {item.action.updateExpense.tripName}
                              </Text>
                            </View>
                          )}
                          {Boolean(item.action.updateExpense.category) && (
                            <View style={[styles.actionTagPill, { backgroundColor: isDark ? colors.card : '#F1F5F9' }]}>
                              <Ionicons name="pricetag-outline" size={11} color={colors.textSecondary} />
                              <Text style={[styles.actionTagText, { color: colors.text }]} numberOfLines={1}>
                                {item.action.updateExpense.category}
                              </Text>
                            </View>
                          )}
                          {item.action.updateExpense.participantMemberIds && item.action.updateExpense.participantMemberIds.length > 0 && (
                            <View style={[styles.actionTagPill, { backgroundColor: isDark ? colors.card : '#F1F5F9' }]}>
                              <Ionicons name="people-outline" size={11} color="#3B82F6" />
                              <Text style={[styles.actionTagText, { color: colors.text }]} numberOfLines={1}>
                                {item.action.updateExpense.splitAll
                                  ? 'All members'
                                  : `${item.action.updateExpense.participantMemberIds.length} members (50-50)`}
                              </Text>
                            </View>
                          )}
                        </View>

                        {item.action.status === 'pending_confirmation' ? (
                          <View style={styles.actionCardButtonsRow}>
                            <TouchableOpacity
                              style={[styles.confirmBtn, { backgroundColor: '#3B82F6' }]}
                              onPress={async () => {
                                const updPayload = item.action?.updateExpense;
                                if (updPayload && !isExecutingAction) {
                                  if (item.action) item.action.status = 'confirmed';
                                  setPendingAction(null);
                                  const ok = await executeUpdateExpense(updPayload);
                                  if (ok) {
                                    setMessages(prev => [
                                      ...prev,
                                      {
                                        id: generateUUID(),
                                        role: 'assistant',
                                        content: `Updated! The ${updPayload.description} expense in ${updPayload.tripName || 'your trip'} was updated.`,
                                        timestamp: new Date().toISOString(),
                                      },
                                    ]);
                                    speakAssistantReply(`Updated the ${updPayload.description} expense.`);
                                  } else {
                                    setMessages(prev => [
                                      ...prev,
                                      {
                                        id: generateUUID(),
                                        role: 'assistant',
                                        content: `Could not update the expense in ${updPayload.tripName || 'your trip'}.`,
                                        timestamp: new Date().toISOString(),
                                      },
                                    ]);
                                    speakAssistantReply('Could not update the expense.');
                                  }
                                }
                              }}
                              activeOpacity={0.8}
                              disabled={isExecutingAction}
                            >
                              {isExecutingAction ? (
                                <ActivityIndicator size="small" color="#FFFFFF" />
                              ) : (
                                <>
                                  <Ionicons name="checkmark" size={15} color="#FFFFFF" />
                                  <Text style={styles.confirmBtnText}>Confirm Update</Text>
                                </>
                              )}
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={[styles.cancelBtn, { borderColor: colors.border }]}
                              onPress={() => {
                                if (item.action) item.action.status = 'info_only';
                                setPendingAction(null);
                                setMessages(prev => [
                                  ...prev,
                                  {
                                    id: generateUUID(),
                                    role: 'assistant',
                                    content: 'Update cancelled. The expense was kept unchanged.',
                                    timestamp: new Date().toISOString(),
                                  },
                                ]);
                                speakAssistantReply('Cancelled.');
                              }}
                              activeOpacity={0.8}
                              disabled={isExecutingAction}
                            >
                              <Text style={[styles.cancelBtnText, { color: colors.textSecondary }]}>Keep Original</Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <View style={styles.confirmedBadgeRow}>
                            <Ionicons name="checkmark-circle" size={15} color="#3B82F6" />
                            <Text style={[styles.confirmedBadgeText, { color: '#3B82F6' }]}>Updated in Trip</Text>
                          </View>
                        )}
                      </View>
                    )}

                    {/* Delete Expense Action Card */}
                    {isAssistant && item.action?.type === 'DELETE_EXPENSE' && item.action.deleteExpense && (
                      <View
                        style={[
                          styles.actionCard,
                          {
                            borderColor: item.action.status === 'confirmed' ? '#EF4444' : '#F59E0B',
                            backgroundColor: isDark ? colors.background : '#FFFFFF',
                          },
                        ]}
                      >
                        <View style={styles.actionCardHeader}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <View style={[styles.titleIconBadge, { backgroundColor: isDark ? 'rgba(239, 68, 68, 0.2)' : '#FEE2E2' }]}>
                              <Ionicons name="trash-outline" size={13} color="#EF4444" />
                            </View>
                            <Text style={[styles.actionCardTitle, { color: '#EF4444' }]}>
                              {item.action.status === 'confirmed' ? 'Deleted Expense' : 'Confirm Delete Expense'}
                            </Text>
                          </View>
                          <Text
                            style={[
                              styles.actionCardAmount,
                              {
                                color: '#EF4444',
                                textDecorationLine: item.action.status === 'confirmed' ? 'line-through' : 'none',
                              },
                            ]}
                            numberOfLines={1}
                            adjustsFontSizeToFit={true}
                            minimumFontScale={0.72}
                          >
                            ₹{item.action.deleteExpense.amountRupees}
                          </Text>
                        </View>

                        <Text style={[styles.actionCardDesc, { color: colors.text }]}>
                          {item.action.deleteExpense.description}
                        </Text>

                        {/* Detail tags */}
                        <View style={styles.actionTagsRow}>
                          {Boolean(item.action.deleteExpense.tripName) && (
                            <View style={[styles.actionTagPill, { backgroundColor: isDark ? colors.card : '#F1F5F9' }]}>
                              <Ionicons name="location-outline" size={11} color={colors.primary} />
                              <Text style={[styles.actionTagText, { color: colors.text }]} numberOfLines={1}>
                                {item.action.deleteExpense.tripName}
                              </Text>
                            </View>
                          )}
                        </View>

                        {item.action.status === 'pending_confirmation' ? (
                          <View style={styles.actionCardButtonsRow}>
                            <TouchableOpacity
                              style={[styles.confirmBtn, { backgroundColor: '#EF4444' }]}
                              onPress={async () => {
                                const delPayload = item.action?.deleteExpense;
                                if (delPayload && !isExecutingAction) {
                                  if (item.action) item.action.status = 'confirmed';
                                  setPendingAction(null);
                                  const ok = await executeDeleteExpense(delPayload);
                                  if (ok) {
                                    setMessages(prev => [
                                      ...prev,
                                      {
                                        id: generateUUID(),
                                        role: 'assistant',
                                        content: `Deleted the ₹${delPayload.amountRupees} ${delPayload.description} expense.`,
                                        timestamp: new Date().toISOString(),
                                      },
                                    ]);
                                    speakAssistantReply(`Deleted the ${delPayload.description} expense.`);
                                  }
                                }
                              }}
                              activeOpacity={0.8}
                              disabled={isExecutingAction}
                            >
                              {isExecutingAction ? (
                                <ActivityIndicator size="small" color="#FFFFFF" />
                              ) : (
                                <>
                                  <Ionicons name="trash-outline" size={15} color="#FFFFFF" />
                                  <Text style={styles.confirmBtnText}>Confirm Delete</Text>
                                </>
                              )}
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={[styles.cancelBtn, { borderColor: colors.border }]}
                              onPress={() => {
                                if (item.action) item.action.status = 'info_only';
                                setPendingAction(null);
                                setMessages(prev => [
                                  ...prev,
                                  {
                                    id: generateUUID(),
                                    role: 'assistant',
                                    content: 'Deletion cancelled. The expense was kept.',
                                    timestamp: new Date().toISOString(),
                                  },
                                ]);
                                speakAssistantReply('Cancelled.');
                              }}
                              activeOpacity={0.8}
                              disabled={isExecutingAction}
                            >
                              <Text style={[styles.cancelBtnText, { color: colors.textSecondary }]}>Keep</Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <View style={styles.confirmedBadgeRow}>
                            <Ionicons name="trash" size={15} color="#EF4444" />
                            <Text style={[styles.confirmedBadgeText, { color: '#EF4444' }]}>Deleted from Trip</Text>
                          </View>
                        )}
                      </View>
                    )}

                    {/* Start Contact Split Action Card */}
                    {isAssistant && item.action?.type === 'START_CONTACT_SPLIT' && item.action.contactSplit && (
                      <View
                        style={[
                          styles.actionCard,
                          {
                            borderColor: item.action.status === 'confirmed' ? '#10B981' : colors.primary,
                            backgroundColor: isDark ? colors.background : '#FFFFFF',
                          },
                        ]}
                      >
                        <View style={styles.actionCardHeader}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <View style={[styles.titleIconBadge, { backgroundColor: colors.primaryLight }]}>
                              <Ionicons name="person-circle-outline" size={14} color={colors.primary} />
                            </View>
                            <Text style={[styles.actionCardTitle, { color: colors.primary }]}>
                              Split with {item.action.contactSplit.contactName}
                            </Text>
                          </View>
                          {Boolean(item.action.contactSplit.amountRupees && Number(item.action.contactSplit.amountRupees) > 0) && (
                            <Text
                              style={[styles.actionCardAmount, { color: item.action.status === 'confirmed' ? '#10B981' : colors.primary }]}
                              numberOfLines={1}
                              adjustsFontSizeToFit={true}
                              minimumFontScale={0.72}
                            >
                              ₹{item.action.contactSplit.amountRupees}
                            </Text>
                          )}
                        </View>

                        {Boolean(item.action.contactSplit.description && item.action.contactSplit.description !== 'Split') && (
                          <Text style={[styles.actionCardDesc, { color: colors.text }]}>
                            {item.action.contactSplit.description}
                          </Text>
                        )}

                        {/* Detail tags */}
                        <View style={styles.actionTagsRow}>
                          {Boolean(item.action.contactSplit.phoneNumber) && (
                            <View style={[styles.actionTagPill, { backgroundColor: isDark ? colors.card : '#F1F5F9' }]}>
                              <Ionicons name="call-outline" size={11} color={colors.primary} />
                              <Text style={[styles.actionTagText, { color: colors.text }]} numberOfLines={1}>
                                {item.action.contactSplit.phoneNumber}
                              </Text>
                            </View>
                          )}
                          {Boolean(item.action.contactSplit.category) && (
                            <View style={[styles.actionTagPill, { backgroundColor: isDark ? colors.card : '#F1F5F9' }]}>
                              <Ionicons name="pricetag-outline" size={11} color={colors.textSecondary} />
                              <Text style={[styles.actionTagText, { color: colors.text }]} numberOfLines={1}>
                                {item.action.contactSplit.category}
                              </Text>
                            </View>
                          )}
                        </View>

                        {item.action.status === 'pending_confirmation' ? (
                          <View style={styles.actionCardButtonsRow}>
                            <TouchableOpacity
                              style={[styles.confirmBtn, { backgroundColor: '#10B981' }]}
                              onPress={async () => {
                                const splitPayload = item.action?.contactSplit;
                                if (splitPayload && !isExecutingAction) {
                                  if (item.action) item.action.status = 'confirmed';
                                  setPendingAction(null);
                                  const res = await executeStartContactSplit(splitPayload);
                                  if (res) {
                                    setMessages(prev => [
                                      ...prev,
                                      {
                                        id: generateUUID(),
                                        role: 'assistant',
                                        content: `Split started with ${splitPayload.contactName}${splitPayload.amountRupees && Number(splitPayload.amountRupees) > 0 ? ` for ₹${splitPayload.amountRupees}` : ''}!`,
                                        timestamp: new Date().toISOString(),
                                      },
                                    ]);
                                    speakAssistantReply(`Split started with ${splitPayload.contactName}.`);
                                  }
                                }
                              }}
                              activeOpacity={0.8}
                              disabled={isExecutingAction}
                            >
                              {isExecutingAction ? (
                                <ActivityIndicator size="small" color="#FFFFFF" />
                              ) : (
                                <>
                                  <Ionicons name="checkmark" size={15} color="#FFFFFF" />
                                  <Text style={styles.confirmBtnText}>Confirm & Split</Text>
                                </>
                              )}
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={[styles.cancelBtn, { borderColor: '#EF4444' }]}
                              onPress={() => {
                                if (item.action) item.action.status = 'info_only';
                                setPendingAction(null);
                                setMessages(prev => [
                                  ...prev,
                                  {
                                    id: generateUUID(),
                                    role: 'assistant',
                                    content: 'Cancelled split.',
                                    timestamp: new Date().toISOString(),
                                  },
                                ]);
                                speakAssistantReply('Cancelled.');
                              }}
                              activeOpacity={0.8}
                              disabled={isExecutingAction}
                            >
                              <Text style={styles.cancelBtnText}>Cancel</Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                            <View style={styles.confirmedBadgeRow}>
                              <Ionicons name="checkmark-circle" size={15} color="#10B981" />
                              <Text style={styles.confirmedBadgeText}>Split Active</Text>
                            </View>

                            <TouchableOpacity
                              style={[styles.openSplitBtn, { backgroundColor: colors.primary }]}
                              onPress={async () => {
                                const splitPayload = item.action?.contactSplit;
                                if (splitPayload) {
                                  const res = await executeStartContactSplit(splitPayload);
                                  if (res?.trip) {
                                    handleModalClose();
                                    router.push(`/trip/${res.trip.id}` as any);
                                  }
                                }
                              }}
                              activeOpacity={0.85}
                            >
                              <Text style={styles.openSplitBtnText}>Open Split →</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    )}

                    {/* Navigation Action Card */}
                    {isAssistant && item.action?.type === 'NAVIGATE' && item.action.navigation?.screen && (
                      <TouchableOpacity
                        style={[styles.navActionCard, { backgroundColor: colors.primary }]}
                        onPress={() => {
                          handleModalClose();
                          router.push(item.action?.navigation?.screen as any);
                        }}
                        activeOpacity={0.85}
                      >
                        <Ionicons name="arrow-forward-circle" size={16} color="#FFFFFF" />
                        <Text style={styles.navActionCardText}>Open Screen →</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}

            {/* Live AI Thinking Shimmer / Indicator */}
            {isAnalyzing && (
              <View style={[styles.messageRow, styles.messageRowAssistant]}>
                <View style={[styles.avatarBadge, { backgroundColor: colors.primaryLight }]}>
                  <Ionicons name="sparkles" size={13} color={colors.primary} />
                </View>
                <View style={[styles.bubbleContainer, styles.bubbleAssistant, { backgroundColor: isDark ? colors.card : '#F1F5F9' }]}>
                  <View style={styles.analyzingRow}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={[styles.analyzingText, { color: colors.textSecondary }]}>
                      Copilot thinking...
                    </Text>
                  </View>
                </View>
              </View>
            )}
          </ScrollView>

          {/* Quick Suggestions Chips (when chat is new) */}
          {messages.length <= 2 && (
            <View style={styles.suggestionsWrapper}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.suggestionsScroll}>
                {SMART_VOICE_SUGGESTIONS.auto.map((item, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={[
                      styles.suggestionChip,
                      {
                        backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : '#F1F5F9',
                        borderColor: colors.border,
                      },
                    ]}
                    onPress={() => handleProcessUserTurn(item.text)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.suggestionChipText, { color: colors.textSecondary }]}>
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Speech Status Bar */}
          {Boolean(speechStatusMessage) && (
            <View style={styles.statusBox}>
              <Text style={[styles.statusBoxText, { color: speechStatusType === 'error' ? '#EF4444' : colors.textSecondary }]}>
                {speechStatusMessage}
              </Text>
            </View>
          )}

          {/* Center Microphone & Done Speaking Section */}
          <View style={styles.bottomMicSection}>
            <View style={styles.micButtonContainer}>
              {isListening && (
                <>
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.pulseRingOuter,
                      {
                        borderColor: isSpeaking ? colors.secondary : colors.primary,
                        backgroundColor: isSpeaking
                          ? 'rgba(155, 180, 161, 0.20)'
                          : isDark
                          ? 'rgba(120, 149, 183, 0.22)'
                          : 'rgba(91, 120, 154, 0.16)',
                        transform: [{ scale: pulseRing2 }],
                        opacity: opacityRing2,
                      },
                    ]}
                  />
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.pulseRingInner,
                      {
                        borderColor: isSpeaking ? colors.secondary : colors.primary,
                        backgroundColor: isSpeaking
                          ? 'rgba(155, 180, 161, 0.30)'
                          : isDark
                          ? 'rgba(120, 149, 183, 0.32)'
                          : 'rgba(91, 120, 154, 0.24)',
                        transform: [{ scale: pulseRing1 }],
                        opacity: opacityRing1,
                      },
                    ]}
                  />
                </>
              )}

              {/* Main Glowing Mic Button */}
              <TouchableOpacity
                style={[
                  styles.micButton,
                  {
                    backgroundColor: isListening
                      ? isSpeaking
                        ? '#10B981'
                        : colors.primary
                      : colors.primary,
                  },
                ]}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                onPress={() => {
                  if (isListening) {
                    stopAutomaticListening();
                  } else {
                    startAutomaticListening();
                  }
                }}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={isListening ? 'Done speaking' : 'Start speaking'}
              >
                <Ionicons
                  name={isListening ? (isSpeaking ? 'mic' : 'pause') : 'mic'}
                  size={36}
                  color="#FFFFFF"
                />
              </TouchableOpacity>
            </View>

            {/* Status Hint with Tap-to-Finish Button */}
            <View style={styles.micStatusRow}>
              {isListening ? (
                <TouchableOpacity
                  style={[styles.doneSpeakingBtn, { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.12)' : '#E2E8F0' }]}
                  onPress={stopAutomaticListening}
                  activeOpacity={0.8}
                >
                  <View style={[styles.listeningDot, { backgroundColor: isSpeaking ? '#10B981' : colors.primary }]} />
                  <Text style={[styles.doneSpeakingText, { color: colors.text }]}>
                    {isSpeaking ? 'Listening... Tap when done' : 'Speaking... Tap when done'}
                  </Text>
                  <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
                </TouchableOpacity>
              ) : (
                <Text style={[styles.micHintText, { color: colors.textMuted }]}>
                  Tap mic to speak at your own pace
                </Text>
              )}
            </View>
          </View>

          {/* Text Input Fallback Bar (for typing in quiet environments) */}
          <View style={[styles.inputBar, { backgroundColor: isDark ? colors.card : '#F8FAFC', borderColor: colors.border }]}>
            <TextInput
              style={[styles.textInput, { color: colors.text }]}
              placeholder="Ask Copilot or type an expense..."
              placeholderTextColor={colors.textMuted}
              value={textInput}
              onChangeText={setTextInput}
              onSubmitEditing={() => handleProcessUserTurn(textInput)}
              returnKeyType="send"
            />
            {Boolean(textInput.trim()) && (
              <TouchableOpacity
                style={[styles.sendBtn, { backgroundColor: colors.primary }]}
                onPress={() => handleProcessUserTurn(textInput)}
                activeOpacity={0.8}
              >
                <Ionicons name="arrow-up" size={16} color="#FFFFFF" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
    </DraggableBottomSheet>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(150, 150, 150, 0.2)',
    marginBottom: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  titleIconBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    fontSize: scaleFont(16),
    fontWeight: '700',
  },
  topBarRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  langTogglePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
  },
  langToggleText: {
    fontSize: scaleFont(11),
    fontWeight: '700',
  },
  ttsTogglePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
  },
  ttsToggleText: {
    fontSize: scaleFont(11),
    fontWeight: '700',
  },
  closeIconBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatScrollView: {
    flex: 1,
    width: '100%',
  },
  chatScrollContent: {
    paddingVertical: 8,
    gap: 12,
  },
  messageRow: {
    flexDirection: 'row',
    width: '100%',
    alignItems: 'flex-start',
    gap: 8,
  },
  messageRowAssistant: {
    justifyContent: 'flex-start',
  },
  messageRowUser: {
    justifyContent: 'flex-end',
  },
  avatarBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  bubbleContainer: {
    maxWidth: '82%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleAssistant: {
    borderTopLeftRadius: 4,
    borderWidth: 1,
  },
  bubbleUser: {
    borderTopRightRadius: 4,
  },
  bubbleText: {
    fontSize: scaleFont(14),
    lineHeight: scaleFont(20),
    fontWeight: '500',
  },
  actionCard: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  actionCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  actionCardTitle: {
    fontSize: scaleFont(10),
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  actionCardAmount: {
    fontSize: scaleFont(20),
    fontWeight: '900',
  },
  actionCardDesc: {
    fontSize: scaleFont(14),
    fontWeight: '700',
  },
  actionTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  actionTagPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  actionTagText: {
    fontSize: scaleFont(11),
    fontWeight: '600',
  },
  actionCardButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  confirmBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 8,
  },
  confirmBtnText: {
    color: '#FFFFFF',
    fontSize: scaleFont(12),
    fontWeight: '700',
  },
  cancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelBtnText: {
    color: '#EF4444',
    fontSize: scaleFont(12),
    fontWeight: '600',
  },
  navActionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  navActionCardText: {
    color: '#FFFFFF',
    fontSize: scaleFont(12),
    fontWeight: '700',
  },
  analyzingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  analyzingText: {
    fontSize: scaleFont(13),
    fontStyle: 'italic',
  },
  suggestionsWrapper: {
    marginVertical: 4,
  },
  suggestionsScroll: {
    gap: 8,
    paddingHorizontal: 2,
  },
  suggestionChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  suggestionChipText: {
    fontSize: scaleFont(11),
    fontWeight: '600',
  },
  statusBox: {
    paddingVertical: 4,
    alignItems: 'center',
  },
  statusBoxText: {
    fontSize: scaleFont(11),
    textAlign: 'center',
  },
  bottomMicSection: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
    width: '100%',
  },
  micButtonContainer: {
    width: 76,
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRingOuter: {
    position: 'absolute',
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
  },
  pulseRingInner: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
  },
  micButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  micStatusRow: {
    marginTop: 4,
    alignItems: 'center',
  },
  doneSpeakingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 14,
  },
  listeningDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  doneSpeakingText: {
    fontSize: scaleFont(12),
    fontWeight: '700',
  },
  micHintText: {
    fontSize: scaleFont(11),
    fontWeight: '500',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 8 : 4,
    marginTop: 4,
    marginBottom: Platform.OS === 'ios' ? 8 : 4,
  },
  textInput: {
    flex: 1,
    fontSize: scaleFont(13),
    padding: 0,
  },
  sendBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  confirmedBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  confirmedBadgeText: {
    fontSize: scaleFont(12),
    fontWeight: '700',
    color: '#10B981',
  },
  openSplitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  openSplitBtnText: {
    color: '#FFFFFF',
    fontSize: scaleFont(12),
    fontWeight: '700',
  },
});
