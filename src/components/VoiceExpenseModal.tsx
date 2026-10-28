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
import { useTripStore, findMyMember } from '../features/trips/useTripStore';
import { useAuthStore } from '../features/auth/useAuthStore';
import { TripMember } from '../types/database';
import { AppStorage } from '../lib/storage';
import { scaleFont, moderateScale, useResponsive } from '../theme/responsive';
import { formatCurrencyAmount } from '../services/currency';
import {
  analyzeVoiceExpense,
  VoiceExpenseAnalysis,
} from '../services/voiceExpenseParser';
import {
  transcribeAudioWithDetails,
  parseExpenseWithGroqLlama,
  AiExpenseParseResult,
  SMART_VOICE_SUGGESTIONS,
} from '../services/voiceAiService';

// Safely load expo-av for microphone recording
let Audio: any = null;
try {
  const ExpoAV = require('expo-av');
  Audio = ExpoAV.Audio;
} catch (e) {
  // Graceful fallback if expo-av is unavailable
}

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
  const { trips, members: rawMembers, loadTripDetails, addExpense } = useTripStore();

  const currentUserPhone =
    profile?.phone_number || (user as any)?.phone || (user as any)?.user_metadata?.phone_number;

  // Automatic Listening & Status states
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  // AI Understanding result state
  const [aiParsedResult, setAiParsedResult] = useState<AiExpenseParseResult | null>(null);

  // References
  const recordingRef = useRef<any>(null);
  const hasSpokenRef = useRef(false);
  const lastSpokenTimestampRef = useRef<number>(0);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const webRecognitionRef = useRef<any>(null);
  const inputRef = useRef<TextInput | null>(null);
  const scrollViewRef = useRef<ScrollView | null>(null);

  // Smooth circular pulse ring animations
  const pulseRing1 = useRef(new Animated.Value(1)).current;
  const pulseRing2 = useRef(new Animated.Value(1)).current;
  const opacityRing1 = useRef(new Animated.Value(0.7)).current;
  const opacityRing2 = useRef(new Animated.Value(0.5)).current;

  // Transcript state
  const [transcript, setTranscript] = useState('');
  const [speechStatusMessage, setSpeechStatusMessage] = useState<string | null>(null);
  const [speechStatusType, setSpeechStatusType] = useState<'info' | 'warning' | 'error'>('info');
  const [tripMembersMap, setTripMembersMap] = useState<Record<string, TripMember[]>>({});
  const [selectedTripId, setSelectedTripId] = useState<string | null>(defaultTripId || null);
  const [isSavingDirectly, setIsSavingDirectly] = useState(false);

  // Load trip members for matching
  useEffect(() => {
    if (!visible) return;

    trips.forEach(async trip => {
      const fromStore = rawMembers.filter(m => m.trip_id === trip.id);
      if (fromStore.length > 0) {
        setTripMembersMap(prev => ({ ...prev, [trip.id]: fromStore }));
        return;
      }

      try {
        const raw = await AppStorage.getItem(`@splityourtrip_local_details_${trip.id}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed.members) && parsed.members.length > 0) {
            setTripMembersMap(prev => ({ ...prev, [trip.id]: parsed.members }));
            return;
          }
        }
      } catch {}

      loadTripDetails(trip.id);
    });
  }, [visible, trips, rawMembers]);

  // Set default trip when modal opens
  useEffect(() => {
    if (visible && defaultTripId) {
      setSelectedTripId(defaultTripId);
    } else if (visible && !selectedTripId && trips.length > 0) {
      setSelectedTripId(trips[0].id);
    }
  }, [visible, defaultTripId, trips]);

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
  }, [isListening]);

  // Clean up on unmount or close
  const handleModalClose = useCallback(() => {
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
    setAiParsedResult(null);
    onClose();
  }, [onClose]);

  // Open Expense Screen directly with prefilled parameters
  const navigateToExpenseScreen = useCallback(
    (
      targetData: {
        amountRupees: string;
        description?: string;
        category?: string;
        matchedTripId?: string | null;
        paidByMemberId?: string | null;
        selectedParticipantIds?: string[];
        paymentMode?: 'upi' | 'cash' | 'other';
      },
      spokenText: string
    ) => {
      const targetTrip =
        trips.find(t => t.id === targetData.matchedTripId) ||
        trips.find(t => t.id === selectedTripId) ||
        trips.find(t => t.id === defaultTripId) ||
        trips[0];

      if (!targetTrip) {
        handleModalClose();
        router.push('/add-trip' as any);
        return;
      }

      setSpeechStatusType('info');
      setSpeechStatusMessage(`✓ Expense recognized! Opening ${targetTrip.name}...`);

      setTimeout(() => {
        handleModalClose();
        router.push({
          pathname: `/trip/${targetTrip.id}/add` as any,
          params: {
            prefillAmount: targetData.amountRupees,
            prefillDescription: targetData.description || 'Expense',
            prefillCategory: targetData.category || 'General',
            prefillPaidBy: targetData.paidByMemberId || '',
            prefillParticipants: (targetData.selectedParticipantIds || []).join(','),
            prefillPaymentMode: targetData.paymentMode || 'upi',
            voicePrompt: spokenText,
          },
        });
      }, 450);
    },
    [trips, selectedTripId, defaultTripId, router, handleModalClose]
  );

  // Automatic Speech Recognition & Silence Detection
  const startAutomaticListening = useCallback(async () => {
    try {
      setSpeechStatusMessage(null);
      setRecordingSeconds(0);
      hasSpokenRef.current = false;
      lastSpokenTimestampRef.current = 0;
      setIsListening(true);
      setIsSpeaking(false);
      setIsAnalyzing(false);

      // Web Speech API support for Web environments
      if (
        Platform.OS === 'web' &&
        typeof window !== 'undefined' &&
        ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)
      ) {
        try {
          const SpeechClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
          const rec = new SpeechClass();
          rec.continuous = true;
          rec.interimResults = true;
          rec.lang = 'en-IN';
          rec.onresult = (e: any) => {
            let fullText = '';
            for (let i = 0; i < e.results.length; i++) {
              fullText += e.results[i][0]?.transcript || '';
            }
            if (fullText) {
              setTranscript(fullText);
              setAiParsedResult(null);
              setIsSpeaking(true);
            }
          };
          rec.onerror = (e: any) => {
            console.log('[VoiceModal] Web Speech error:', e);
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
        } catch (webErr) {
          console.log('[VoiceModal] Web Speech init note:', webErr);
        }
      }

      // Native iOS & Android recording via expo-av
      if (!Audio?.requestPermissionsAsync) return;

      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        setIsListening(false);
        setSpeechStatusMessage('Microphone permission denied. Please allow microphone access in Settings.');
        setSpeechStatusType('error');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync({
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
      });

      recording.setOnRecordingStatusUpdate((status: any) => {
        if (!status?.isRecording) return;

        const currentMetering = typeof status.metering === 'number' ? status.metering : -160;
        const duration = status.durationMillis || 0;
        setRecordingSeconds(Math.round(duration / 100) / 10);

        const isVoiceDetected = currentMetering > -58 || duration > 600;
        if (isVoiceDetected) {
          hasSpokenRef.current = true;
          if (currentMetering > -58) {
            lastSpokenTimestampRef.current = Date.now();
            setIsSpeaking(true);
          }
        }

        // Auto-stop on 1.8s of silence after speech (if recorded > 1.2s)
        if (
          hasSpokenRef.current &&
          duration > 1200 &&
          lastSpokenTimestampRef.current > 0 &&
          Date.now() - lastSpokenTimestampRef.current > 1800
        ) {
          stopAutomaticListening();
        }

        // Safety maximum recording length: 8 seconds auto-finish
        if (duration > 8000) {
          stopAutomaticListening();
        }
      });

      await recording.startAsync();
      recordingRef.current = recording;
    } catch (err) {
      console.warn('[VoiceModal] Auto listen start error:', err);
      setIsListening(false);
    }
  }, []);

  // Stop listening and auto-analyze
  const stopAutomaticListening = useCallback(async () => {
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

    let recordedUri: string | null = null;
    try {
      if (recordingRef.current) {
        recordedUri = recordingRef.current.getURI();
        await recordingRef.current.stopAndUnloadAsync();
        recordingRef.current = null;
      }
      if (Audio) {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
        });
      }
    } catch (e) {
      recordingRef.current = null;
    }

    // Auto-transcribe or handle speech results with auto language detection
    setIsAnalyzing(true);
    if (!transcript.trim()) {
      if (recordedUri) {
        const result = await transcribeAudioWithDetails(recordedUri, 'auto');
        if (result.text && result.text.trim()) {
          const spoken = result.text.trim();
          setTranscript(spoken);
          setSpeechStatusMessage(null);

          // Deep AI comprehension using Groq Llama 3.1 8B Instant
          parseExpenseWithGroqLlama(
            spoken,
            trips,
            user?.id,
            currentUserPhone,
            tripMembersMap,
            selectedTripId || defaultTripId
          )
            .then(aiRes => {
              if (aiRes && aiRes.amountPaise > 0) {
                setAiParsedResult(aiRes);
                if (aiRes.matchedTripId) {
                  setSelectedTripId(aiRes.matchedTripId);
                }
                // Directly open expense screen when speaking completes
                navigateToExpenseScreen(aiRes, spoken);
              } else {
                // Fallback to local regex parser
                const localRes = analyzeVoiceExpense(
                  spoken,
                  trips,
                  user?.id,
                  currentUserPhone,
                  tripMembersMap
                );
                if (localRes.isValid && localRes.parsed && localRes.parsed.amountPaise > 0) {
                  navigateToExpenseScreen(localRes.parsed, spoken);
                } else {
                  setSpeechStatusType('info');
                  setSpeechStatusMessage(
                    `Spoken: "${spoken}". Please mention an amount (e.g. ₹100 for lunch).`
                  );
                }
              }
              setIsAnalyzing(false);
            })
            .catch(() => {
              const localRes = analyzeVoiceExpense(
                spoken,
                trips,
                user?.id,
                currentUserPhone,
                tripMembersMap
              );
              if (localRes.isValid && localRes.parsed && localRes.parsed.amountPaise > 0) {
                navigateToExpenseScreen(localRes.parsed, spoken);
              }
              setIsAnalyzing(false);
            });
          return;
        } else {
          setSpeechStatusType('info');
          setSpeechStatusMessage('No speech heard. Tap mic to speak.');
        }
      } else {
        setSpeechStatusType('info');
        setSpeechStatusMessage('No voice detected. Tap mic to try again.');
      }
    } else {
      // If transcript was already present, run Llama parse on it
      parseExpenseWithGroqLlama(
        transcript,
        trips,
        user?.id,
        currentUserPhone,
        tripMembersMap,
        selectedTripId || defaultTripId
      )
        .then(aiRes => {
          if (aiRes && aiRes.amountPaise > 0) {
            setAiParsedResult(aiRes);
            if (aiRes.matchedTripId) {
              setSelectedTripId(aiRes.matchedTripId);
            }
            navigateToExpenseScreen(aiRes, transcript);
          } else {
            const localRes = analyzeVoiceExpense(
              transcript,
              trips,
              user?.id,
              currentUserPhone,
              tripMembersMap
            );
            if (localRes.isValid && localRes.parsed && localRes.parsed.amountPaise > 0) {
              navigateToExpenseScreen(localRes.parsed, transcript);
            }
          }
          setIsAnalyzing(false);
        })
        .catch(() => {
          setIsAnalyzing(false);
        });
      return;
    }
    setIsAnalyzing(false);
  }, [transcript, trips, user?.id, currentUserPhone, tripMembersMap, navigateToExpenseScreen]);

  // Automatically start listening whenever the modal opens
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (visible) {
      // Small timeout to allow drawer entrance animation to settle smoothly
      timer = setTimeout(() => {
        startAutomaticListening();
      }, 350);
    } else {
      stopAutomaticListening();
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [visible, startAutomaticListening, stopAutomaticListening]);

  // Analyze spoken transcript in real-time
  const analysis: VoiceExpenseAnalysis = useMemo(() => {
    const res = analyzeVoiceExpense(
      transcript,
      trips,
      user?.id,
      currentUserPhone,
      tripMembersMap
    );

    // If Groq Llama AI parsed details are available, prioritize them!
    if (aiParsedResult && res.parsed) {
      if (aiParsedResult.amountPaise > 0) {
        res.parsed.amountRupees = aiParsedResult.amountRupees;
        res.parsed.amountPaise = aiParsedResult.amountPaise;
        res.isValid = true;
      }
      if (aiParsedResult.category) {
        res.parsed.category = aiParsedResult.category;
      }
      if (aiParsedResult.description) {
        res.parsed.description = aiParsedResult.description;
      }
      if (aiParsedResult.matchedTripId) {
        const foundTrip = trips.find(t => t.id === aiParsedResult.matchedTripId);
        if (foundTrip) res.parsed.matchedTrip = foundTrip;
      }
      if (aiParsedResult.paidByMemberId) {
        res.parsed.paidByMemberId = aiParsedResult.paidByMemberId;
        res.parsed.paidByMemberName = aiParsedResult.paidByMemberName;
      }
      res.parsed.splitAll = aiParsedResult.splitAll;
      if (aiParsedResult.selectedParticipantIds.length > 0) {
        res.parsed.selectedParticipantIds = aiParsedResult.selectedParticipantIds;
      }
      if (aiParsedResult.paymentMode) {
        res.parsed.paymentMode = aiParsedResult.paymentMode;
      }
    }

    // If user explicitly picked a trip, override the matched trip
    if (selectedTripId && res.parsed) {
      const explicitTrip = trips.find(t => t.id === selectedTripId);
      if (explicitTrip) {
        res.parsed.matchedTrip = explicitTrip;
        const members = tripMembersMap[explicitTrip.id] || [];
        if (res.parsed.splitAll || res.parsed.selectedParticipantIds.length === 0) {
          res.parsed.selectedParticipantIds = members.map(m => m.id);
        }
      }
    }
    return res;
  }, [transcript, trips, user?.id, currentUserPhone, tripMembersMap, selectedTripId, aiParsedResult]);

  const parsed = analysis.parsed;
  const effectiveTrip = parsed?.matchedTrip || trips.find(t => t.id === selectedTripId) || trips[0];

  // Auto-scroll when expense is detected or user speaks
  useEffect(() => {
    if (analysis.isValid || transcript.length > 25) {
      const timer = setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [analysis.isValid, Boolean(aiParsedResult)]);

  // Save Expense Directly (1-tap, zero extra steps)
  const handleSaveDirectly = async () => {
    if (!analysis.isValid || !parsed) {
      Alert.alert(
        'Information Needed',
        analysis.errorMessage || 'Please speak an expense amount (e.g. ₹500 for lunch).'
      );
      return;
    }

    if (!effectiveTrip) {
      Alert.alert('No Trip Found', 'Please create a trip first.');
      return;
    }

    const members = tripMembersMap[effectiveTrip.id] || [];
    const myMember = findMyMember(members, user?.id, currentUserPhone);
    const paidBy = parsed.paidByMemberId || myMember?.id || members[0]?.id;

    if (!paidBy) {
      Alert.alert('Member Error', 'Could not locate payer member for this trip.');
      return;
    }

    const participants =
      parsed.selectedParticipantIds.length > 0
        ? parsed.selectedParticipantIds
        : members.map(m => m.id);

    try {
      setIsSavingDirectly(true);
      const success = await addExpense({
        tripId: effectiveTrip.id,
        paidByMemberId: paidBy,
        amountPaise: parsed.amountPaise,
        description: parsed.description || `${effectiveTrip.name} Expense`,
        category: parsed.category || 'General',
        paymentMode: 'cash',
        splitType: 'equal',
        participantMemberIds: participants,
        userId: user?.id || 'local_user',
      });

      setIsSavingDirectly(false);

      if (success) {
        handleModalClose();
        Alert.alert(
          'Expense Added!',
          `₹${parsed.amountRupees} added to ${effectiveTrip.name} split with ${
            parsed.splitAll ? 'all members' : `${participants.length} members`
          }.`
        );
      } else {
        Alert.alert('Error', 'Could not save expense.');
      }
    } catch (err: any) {
      setIsSavingDirectly(false);
      Alert.alert('Error', err?.message || 'Failed to add expense.');
    }
  };

  // 1-Tap quick suggestion filler
  const handleApplySuggestion = (text: string) => {
    setSpeechStatusMessage(null);
    setTranscript(text);
    setAiParsedResult(null);
    if (isListening) {
      stopAutomaticListening();
    }
    parseExpenseWithGroqLlama(
      text,
      trips,
      user?.id,
      currentUserPhone,
      tripMembersMap,
      selectedTripId || defaultTripId
    )
      .then(aiRes => {
        if (aiRes && aiRes.amountPaise > 0) {
          setAiParsedResult(aiRes);
          if (aiRes.matchedTripId) {
            setSelectedTripId(aiRes.matchedTripId);
          }
          navigateToExpenseScreen(aiRes, text);
        } else {
          const localRes = analyzeVoiceExpense(
            text,
            trips,
            user?.id,
            currentUserPhone,
            tripMembersMap
          );
          if (localRes.isValid && localRes.parsed && localRes.parsed.amountPaise > 0) {
            navigateToExpenseScreen(localRes.parsed, text);
          }
        }
      })
      .catch(() => {});
  };

  return (
    <DraggableBottomSheet
      visible={visible}
      onClose={handleModalClose}
      defaultHeight="60%"
      maxHeight="92%"
      minHeight="45%"
      enableExpandUp={true}
      sheetStyle={{
        maxWidth: 640,
        alignSelf: 'center',
        width: '100%',
        paddingHorizontal: moderateScale(18),
      }}
    >
      {() => (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          {/* Clean Minimalist Top Bar: Title & Close Button */}
          <View style={styles.topBar}>
            <View style={styles.titleRow}>
              <View style={[styles.titleIconBadge, { backgroundColor: colors.primaryLight }]}>
                <Ionicons name="sparkles" size={14} color={colors.primary} />
              </View>
              <Text style={[styles.topBarTitle, { color: colors.text }]}>Voice Assistant</Text>
            </View>

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

          <ScrollView
            ref={scrollViewRef}
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContainer}
            showsVerticalScrollIndicator={true}
            nestedScrollEnabled={true}
            bounces={true}
            alwaysBounceVertical={false}
            overScrollMode="always"
            keyboardShouldPersistTaps="handled"
            scrollEventThrottle={16}
          >
            {/* 1. Mic Logo in Center of Drawer */}
            <View style={styles.centerMicSection}>
              <View style={styles.micButtonContainer}>
                {isListening && (
                  <>
                    <Animated.View
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

                <TouchableOpacity
                  style={[
                    styles.micButton,
                    {
                      backgroundColor: isListening
                        ? isSpeaking
                          ? '#10B981'
                          : colors.primary
                        : colors.primary,
                      shadowColor: isListening
                        ? isSpeaking
                          ? '#10B981'
                          : colors.primary
                        : '#000000',
                    },
                  ]}
                  onPress={() => {
                    if (isListening) {
                      stopAutomaticListening();
                    } else {
                      startAutomaticListening();
                    }
                  }}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={isListening ? 'Stop recording' : 'Start speaking'}
                >
                  <Ionicons
                    name={isListening ? (isSpeaking ? 'mic' : 'mic-outline') : 'mic'}
                    size={38}
                    color="#FFFFFF"
                  />
                </TouchableOpacity>
              </View>

              {/* Status Indicator directly below mic */}
              <View style={styles.statusRow}>
                {isAnalyzing ? (
                  <View style={styles.statusPill}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={[styles.statusPillText, { color: colors.textSecondary }]}>
                      AI understanding your expense...
                    </Text>
                  </View>
                ) : isListening ? (
                  <View style={styles.statusPill}>
                    <View
                      style={[
                        styles.statusDot,
                        { backgroundColor: isSpeaking ? '#10B981' : colors.primary },
                      ]}
                    />
                    <Text
                      style={[
                        styles.statusPillText,
                        {
                          color: isSpeaking ? '#10B981' : colors.primary,
                          fontWeight: '700',
                        },
                      ]}
                    >
                      {isSpeaking ? 'Listening to speech...' : 'Listening... speak your expense'}
                    </Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.statusPill}
                    onPress={startAutomaticListening}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="mic-circle" size={16} color={colors.textSecondary} />
                    <Text style={[styles.statusPillText, { color: colors.textSecondary }]}>
                      {transcript.trim() ? 'Tap mic to speak again' : 'Tap mic to speak'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* 2. What We Speak Comes Below That */}
            <View
              style={[
                styles.transcriptContainer,
                {
                  backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : '#F8FAFC',
                  borderColor: isListening ? colors.primary : colors.border,
                },
              ]}
            >
              <TextInput
                ref={inputRef}
                style={[
                  styles.transcriptTextInput,
                  { color: colors.text },
                  isSmall && { fontSize: scaleFont(14) },
                ]}
                multiline
                placeholder={
                  isListening
                    ? 'Listening... what you speak will appear here'
                    : 'Tap mic or type your expense here...'
                }
                placeholderTextColor={colors.textMuted}
                value={transcript}
                onChangeText={t => {
                  setTranscript(t);
                  setAiParsedResult(null);
                }}
                textAlign="center"
              />

              {Boolean(transcript.trim()) && (
                <TouchableOpacity
                  style={styles.clearBtn}
                  onPress={() => {
                    setTranscript('');
                    setAiParsedResult(null);
                    setSpeechStatusMessage(null);
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            {/* Speech Status / Error Message */}
            {!isListening && !Boolean(transcript.trim()) && Boolean(speechStatusMessage) && (
              <View
                style={[
                  styles.speechStatusBox,
                  {
                    backgroundColor:
                      speechStatusType === 'warning'
                        ? isDark
                          ? 'rgba(245, 158, 11, 0.12)'
                          : '#FEF3C7'
                        : isDark
                        ? 'rgba(255, 255, 255, 0.05)'
                        : '#F1F5F9',
                    borderColor:
                      speechStatusType === 'warning'
                        ? isDark
                          ? 'rgba(245, 158, 11, 0.3)'
                          : '#FCD34D'
                        : 'transparent',
                    borderWidth: speechStatusType === 'warning' ? 1 : 0,
                  },
                ]}
              >
                <Ionicons
                  name={speechStatusType === 'warning' ? 'warning-outline' : 'information-circle-outline'}
                  size={15}
                  color={speechStatusType === 'warning' ? '#D97706' : colors.textSecondary}
                />
                <Text
                  style={[
                    styles.speechStatusText,
                    {
                      color: speechStatusType === 'warning' ? (isDark ? '#FCD34D' : '#B45309') : colors.textSecondary,
                    },
                  ]}
                >
                  {speechStatusMessage}
                </Text>
              </View>
            )}

            {/* 3. Detected Expense Result Card */}
            {analysis.isValid && parsed && (
              <View
                style={[
                  styles.detectedExpenseCard,
                  {
                    backgroundColor: isDark ? colors.card : '#FFFFFF',
                    borderColor: isDark ? colors.border : colors.borderLight,
                  },
                ]}
              >
                <View style={styles.detectedMainRow}>
                  <View>
                    <Text style={[styles.detectedAmountLabel, { color: colors.textSecondary }]}>
                      Detected Amount
                    </Text>
                    <Text
                      style={[styles.detectedAmountNumber, { color: colors.primary }]}
                      numberOfLines={1}
                      adjustsFontSizeToFit={true}
                      minimumFontScale={0.72}
                    >
                      {formatCurrencyAmount(parsed.amountPaise, effectiveTrip?.currency || 'INR')}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.categoryBadge,
                      { backgroundColor: colors.primaryLight },
                    ]}
                  >
                    <Ionicons name="pricetag" size={12} color={colors.primary} />
                    <Text style={[styles.categoryBadgeText, { color: colors.primary }]}>
                      {parsed.category || 'General'}
                    </Text>
                  </View>
                </View>

                {/* Tags: Trip, Payer, Split */}
                <View style={styles.detectedTagsRow}>
                  <TouchableOpacity
                    style={[styles.detectedPill, { backgroundColor: isDark ? colors.background : '#F8FAFC' }]}
                    onPress={() => {
                      if (trips.length > 1) {
                        const currentIndex = trips.findIndex(t => t.id === effectiveTrip?.id);
                        const nextIndex = (currentIndex + 1) % trips.length;
                        setSelectedTripId(trips[nextIndex].id);
                      }
                    }}
                    activeOpacity={trips.length > 1 ? 0.7 : 1}
                  >
                    <Ionicons name="location-outline" size={12} color={colors.primary} />
                    <Text style={[styles.detectedPillText, { color: colors.text }]} numberOfLines={1}>
                      {effectiveTrip?.name || 'Trip'}
                    </Text>
                    {trips.length > 1 && (
                      <Ionicons name="swap-horizontal" size={11} color={colors.textMuted} />
                    )}
                  </TouchableOpacity>

                  <View style={[styles.detectedPill, { backgroundColor: isDark ? colors.background : '#F8FAFC' }]}>
                    <Ionicons name="wallet-outline" size={12} color={colors.success} />
                    <Text style={[styles.detectedPillText, { color: colors.text }]} numberOfLines={1}>
                      Paid: {parsed.paidByMemberName || 'You'}
                    </Text>
                  </View>

                  <View style={[styles.detectedPill, { backgroundColor: isDark ? colors.background : '#F8FAFC' }]}>
                    <Ionicons name="people-outline" size={12} color={colors.primary} />
                    <Text style={[styles.detectedPillText, { color: colors.text }]} numberOfLines={1}>
                      Split: {parsed.splitAll ? 'All Members' : `${parsed.selectedParticipantIds.length} Members`}
                    </Text>
                  </View>

                  <View style={[styles.detectedPill, { backgroundColor: isDark ? colors.background : '#F8FAFC' }]}>
                    <Ionicons
                      name={parsed.paymentMode === 'cash' ? 'cash-outline' : parsed.paymentMode === 'other' ? 'card-outline' : 'qr-code-outline'}
                      size={12}
                      color={colors.primary}
                    />
                    <Text style={[styles.detectedPillText, { color: colors.text }]} numberOfLines={1}>
                      Mode: {(parsed.paymentMode || 'upi').toUpperCase()}
                    </Text>
                  </View>
                </View>

                {/* Open in Expense Screen Button */}
                <TouchableOpacity
                  style={[
                    styles.saveExpenseBtn,
                    {
                      backgroundColor: colors.primary,
                      opacity: isSavingDirectly ? 0.7 : 1,
                    },
                  ]}
                  onPress={() => navigateToExpenseScreen(parsed, transcript)}
                  activeOpacity={0.85}
                  disabled={isSavingDirectly}
                >
                  <Ionicons name="arrow-forward-circle" size={18} color="#FFFFFF" />
                  <Text style={styles.saveExpenseBtnText}>
                    Open in Expense Screen ({effectiveTrip?.name || 'Trip'})
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Hint if transcript exists but no expense amount recognized */}
            {!analysis.isValid && Boolean(transcript.trim()) && !isListening && (
              <View style={styles.hintCard}>
                <Text style={[styles.hintText, { color: colors.textSecondary }]}>
                  💡 Please mention an amount, e.g.{' '}
                  <Text style={{ fontWeight: '700', color: colors.primary }}>
                    "Dinner ₹850 in Goa trip paid by me"
                  </Text>
                </Text>
              </View>
            )}

            {/* Sample Suggestion Chips when transcript is empty */}
            {!transcript.trim() && !isListening && (
              <View style={styles.suggestionsContainer}>
                <Text style={[styles.suggestionsLabel, { color: colors.textMuted }]}>
                  Or tap an example to try:
                </Text>
                <View style={styles.suggestionsRow}>
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
                      onPress={() => handleApplySuggestion(item.text)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.suggestionChipText, { color: colors.textSecondary }]}>
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
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
    marginBottom: 12,
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
  closeIconBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
    width: '100%',
  },
  scrollContainer: {
    paddingBottom: 48,
    alignItems: 'center',
    gap: 14,
    flexGrow: 1,
  },
  centerMicSection: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    width: '100%',
  },
  micButtonContainer: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRingOuter: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
  },
  pulseRingInner: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
  },
  micButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  statusRow: {
    marginTop: 10,
    alignItems: 'center',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusPillText: {
    fontSize: scaleFont(12),
    fontWeight: '600',
  },
  transcriptContainer: {
    width: '100%',
    minHeight: 64,
    maxHeight: 120,
    borderWidth: 1.5,
    borderRadius: 16,
    paddingHorizontal: moderateScale(14),
    paddingVertical: moderateScale(10),
    justifyContent: 'center',
    alignItems: 'center',
  },
  transcriptTextInput: {
    width: '100%',
    fontSize: scaleFont(15),
    fontWeight: '600',
    lineHeight: scaleFont(22),
    padding: 0,
    textAlign: 'center',
  },
  clearBtn: {
    position: 'absolute',
    right: 10,
    top: 10,
    padding: 2,
  },
  speechStatusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    maxWidth: '96%',
  },
  speechStatusText: {
    fontSize: scaleFont(11),
    textAlign: 'center',
    lineHeight: 15,
    flex: 1,
  },
  detectedExpenseCard: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 14,
    padding: moderateScale(12),
    gap: 10,
  },
  detectedMainRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detectedAmountLabel: {
    fontSize: scaleFont(10),
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detectedAmountNumber: {
    fontSize: scaleFont(22),
    fontWeight: '800',
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  categoryBadgeText: {
    fontSize: scaleFont(11),
    fontWeight: '700',
  },
  detectedTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  detectedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4.5,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(150, 150, 150, 0.25)',
  },
  detectedPillText: {
    fontSize: scaleFont(11),
    fontWeight: '600',
  },
  saveExpenseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: moderateScale(11),
    borderRadius: 10,
    marginTop: 2,
  },
  saveExpenseBtnText: {
    color: '#FFFFFF',
    fontSize: scaleFont(13),
    fontWeight: '700',
  },
  hintCard: {
    width: '100%',
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  hintText: {
    fontSize: scaleFont(11),
    textAlign: 'center',
    lineHeight: scaleFont(16),
  },
  suggestionsContainer: {
    width: '100%',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
  },
  suggestionsLabel: {
    fontSize: scaleFont(11),
    fontWeight: '500',
  },
  suggestionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
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
});
