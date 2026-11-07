import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { AppStorage } from '../lib/storage';
import { TripMember, TripBalanceRow } from '../types/database';

// Supported language codes for speech recognition
export type VoiceLanguage = 'auto' | 'en' | 'hi' | 'gu';

export const GROQ_STORAGE_KEY = '@splityourtrip_groq_api_key';

export async function getSavedGroqApiKey(): Promise<string | null> {
  try {
    const saved = await AppStorage.getItem(GROQ_STORAGE_KEY);
    if (saved && saved.trim().length > 0) return saved.trim();
  } catch {}
  return process.env.EXPO_PUBLIC_GROQ_API_KEY || null;
}

export async function saveGroqApiKey(key: string): Promise<void> {
  try {
    await AppStorage.setItem(GROQ_STORAGE_KEY, key.trim());
  } catch {}
}

export async function hasSpeechApiKey(): Promise<boolean> {
  const groq = (await getSavedGroqApiKey()) || process.env.EXPO_PUBLIC_GROQ_API_KEY;
  const hf = process.env.EXPO_PUBLIC_HF_TOKEN;
  const wit = process.env.EXPO_PUBLIC_WIT_TOKEN;
  return Boolean(groq || hf || wit);
}

export interface TranscriptionResponse {
  text: string | null;
  error?: 'NO_API_KEY' | 'EMPTY_AUDIO' | 'NETWORK_ERROR' | 'FAILED' | 'NO_SPEECH';
  message?: string;
  source?: 'groq' | 'huggingface' | 'wit_ai' | 'web_speech';
}

const WHISPER_HALLUCINATIONS = new Set([
  'the',
  'the the',
  'the the the',
  'the.',
  'the...',
  'a',
  'an',
  'i',
  "i'm",
  "i'm.",
  "i'm..",
  "i'm happy to have you",
  "i'm happy to have you.",
  'thank you',
  'thank you.',
  'thank you so much',
  'thank you for watching',
  'thank you for watching.',
  'thanks for watching',
  'thanks for watching.',
  'you',
  'you.',
  'bye',
  'bye.',
  'goodbye',
  'subscribe',
  'please subscribe',
  'subtitles by',
  '[music]',
  '(music)',
  '[applause]',
  '(applause)',
  '[silence]',
]);

export function isWhisperHallucination(rawText: string): boolean {
  if (!rawText) return true;
  const trimmed = rawText.trim().toLowerCase();
  const stripped = trimmed.replace(/[.,!?;:…'"]/g, '').trim();
  if (stripped.length <= 1) return true;
  if (WHISPER_HALLUCINATIONS.has(trimmed)) return true;
  if (WHISPER_HALLUCINATIONS.has(stripped)) return true;
  return false;
}

/**
 * Transcribes recorded audio with detailed status reporting.
 * Uses Groq Whisper Large v3 (1550M parameters) with automatic fallback to Whisper Large v3 Turbo,
 * domain vocabulary conditioning, and dynamic contact/trip member name priming.
 */
export async function transcribeAudioWithDetails(
  audioUri: string,
  language: VoiceLanguage = 'auto',
  customContextNames?: string[]
): Promise<TranscriptionResponse> {
  if (!audioUri) {
    return { text: null, error: 'EMPTY_AUDIO', message: 'No audio recorded.' };
  }

  try {
    const fileInfo = await FileSystem.getInfoAsync(audioUri);
    if (!fileInfo.exists || ('size' in fileInfo && fileInfo.size < 400)) {
      console.log('[voiceAiService] Audio file is empty or too short (< 400 bytes):', fileInfo);
      return { text: null, error: 'EMPTY_AUDIO', message: 'No speech detected in audio file.' };
    }

    // Build context-aware domain prompt for Whisper decoder conditioning
    let basePrompt = 'SplitYourTrip hisaab: ₹, rupees, rupiya, paise, 50-50, split with, Khushi, Rohan, Priya, Isha, Mihir, Jigar, Aman, Pooja, Rahul, dinner, lunch, petrol, taxi, cab, auto, chai, nashta, groceries, hotel, bill, update, delete, paid by me, maine pay kiya, badha ma split kar.';
    if (language === 'hi') {
      basePrompt = 'SplitYourTrip hisaab: ₹, rupees, rupaye, paise, 50-50, split karo, add karo, kharcha, dinner, lunch, petrol, taxi, auto, bill, update karo, delete karo, maine pay kiya, hisaab batao.';
    } else if (language === 'gu') {
      basePrompt = 'SplitYourTrip hisaab: ₹, rupiya, paise, 50-50, badha ma split kar, kharcho, lunch, petrol, taxi, auto, bill, update kar, delete kar, hu aapis, ketlo hisaab che.';
    } else if (language === 'en') {
      basePrompt = 'SplitYourTrip expense: ₹, rupees, 50-50, split with, add expense, dinner, lunch, petrol, taxi, cab, hotel, bill, update, delete, paid by me.';
    }

    if (customContextNames && customContextNames.length > 0) {
      const cleanNames = Array.from(
        new Set(
          customContextNames
            .map(n => n.trim().split(/\s+/)[0])
            .filter(n => n && n.length > 1 && /^[a-zA-Z\u0900-\u097F\u0A80-\u0AFF]+$/.test(n))
        )
      ).slice(0, 15);
      if (cleanNames.length > 0) {
        basePrompt = `Names: ${cleanNames.join(', ')}. ` + basePrompt;
      }
    }

    // 1. Tier 1: Groq Cloud Whisper API (whisper-large-v3 primary -> whisper-large-v3-turbo fallback)
    const groqApiKey = (await getSavedGroqApiKey()) || process.env.EXPO_PUBLIC_GROQ_API_KEY;
    if (groqApiKey) {
      const groqModels = ['whisper-large-v3', 'whisper-large-v3-turbo'];
      for (const modelName of groqModels) {
        try {
          console.log(`[voiceAiService] Uploading audio to Groq ${modelName} (language: ${language})...`);
          const parameters: Record<string, string> = {
            model: modelName,
            response_format: 'json',
            temperature: '0.0',
            prompt: basePrompt,
          };
          if (language && language !== 'auto') {
            parameters.language = language;
          }

          const groqRes = await FileSystem.uploadAsync(
            'https://api.groq.com/openai/v1/audio/transcriptions',
            audioUri,
            {
              fieldName: 'file',
              httpMethod: 'POST',
              uploadType: FileSystem.FileSystemUploadType.MULTIPART,
              headers: {
                Authorization: `Bearer ${groqApiKey}`,
              },
              parameters,
              mimeType: 'audio/m4a',
            }
          );

          if (groqRes.status === 200 && groqRes.body) {
            const data = JSON.parse(groqRes.body);
            if (data?.text && typeof data.text === 'string' && data.text.trim().length > 0) {
              const candidate = data.text.trim();
              if (isWhisperHallucination(candidate)) {
                console.log('[voiceAiService] Suppressed Whisper silence hallucination:', candidate);
                return { text: null, error: 'NO_SPEECH', message: 'No speech detected in audio.' };
              }
              console.log(`[voiceAiService] Groq (${modelName}) transcription success:`, candidate);
              return { text: candidate, source: 'groq' };
            }
          } else {
            console.warn(`[voiceAiService] Groq (${modelName}) API error response:`, groqRes.status, groqRes.body);
          }
        } catch (groqErr) {
          console.warn(`[voiceAiService] Groq (${modelName}) upload note:`, groqErr);
        }
      }
    }

    // 2. Tier 2: HuggingFace Serverless Whisper Inference
    const hfToken = process.env.EXPO_PUBLIC_HF_TOKEN;
    if (hfToken) {
      try {
        console.log('[voiceAiService] Trying HuggingFace Whisper fallback...');
        const hfRes = await FileSystem.uploadAsync(
          'https://api-inference.huggingface.co/models/openai/whisper-large-v3-turbo',
          audioUri,
          {
            httpMethod: 'POST',
            uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
            headers: {
              Authorization: `Bearer ${hfToken}`,
              'Content-Type': 'audio/m4a',
            },
          }
        );

        if (hfRes.status === 200 && hfRes.body) {
          const data = JSON.parse(hfRes.body);
          if (data?.text && typeof data.text === 'string' && data.text.trim().length > 0) {
            return { text: data.text.trim(), source: 'huggingface' };
          }
        }
      } catch (hfErr) {
        console.warn('[voiceAiService] HuggingFace note:', hfErr);
      }
    }

    // 3. Tier 3: Wit.ai Speech API
    const witToken = process.env.EXPO_PUBLIC_WIT_TOKEN;
    if (witToken) {
      try {
        console.log('[voiceAiService] Trying Wit.ai fallback...');
        const witRes = await FileSystem.uploadAsync(
          'https://api.wit.ai/speech?v=20240304',
          audioUri,
          {
            httpMethod: 'POST',
            uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
            headers: {
              Authorization: `Bearer ${witToken}`,
              'Content-Type': 'audio/raw;encoding=signed-integer;bits=16;rate=16000;endian=little',
            },
          }
        );

        if (witRes.status === 200 && witRes.body) {
          const lines = witRes.body.split('\n').filter(Boolean);
          for (let i = lines.length - 1; i >= 0; i--) {
            try {
              const parsedChunk = JSON.parse(lines[i]);
              if (parsedChunk?.text) {
                return { text: parsedChunk.text.trim(), source: 'wit_ai' };
              }
            } catch {}
          }
        }
      } catch (witErr) {
        console.warn('[voiceAiService] Wit.ai note:', witErr);
      }
    }

    // If no key was configured
    if (!groqApiKey && !hfToken && !witToken) {
      console.warn('[voiceAiService] No Speech-to-Text API key configured (EXPO_PUBLIC_GROQ_API_KEY).');
      return {
        text: null,
        error: 'NO_API_KEY',
        message: 'No Speech-to-Text API key configured. Please configure a free Groq key or use keyboard dictation.',
      };
    }
  } catch (err: any) {
    console.error('[voiceAiService] Transcription error:', err);
    return { text: null, error: 'FAILED', message: err?.message || 'Transcription failed.' };
  }

  return { text: null, error: 'FAILED', message: 'Could not transcribe speech.' };
}

/**
 * Transcribes recorded audio using high-accuracy AI Speech Recognition
 */
export async function transcribeAudioWithAi(
  audioUri: string,
  language: VoiceLanguage = 'auto',
  customContextNames?: string[]
): Promise<string | null> {
  const res = await transcribeAudioWithDetails(audioUri, language, customContextNames);
  return res.text;
}

export interface AiExpenseParseResult {
  amountRupees: string;
  amountPaise: number;
  category: string;
  description: string;
  matchedTripId: string | null;
  paidByMemberId: string | null;
  paidByMemberName: string | null;
  splitAll: boolean;
  selectedParticipantIds: string[];
  paymentMode: 'upi' | 'cash' | 'other';
}

/**
 * Uses Groq Llama 3.1 8B Instant to intelligently parse complex multilingual speech
 * into exact structured expense objects (amount, category, trip, payer, splits, payment mode).
 */
export async function parseExpenseWithGroqLlama(
  transcript: string,
  trips: Array<{ id: string; name: string; currency?: string }>,
  currentUserId?: string,
  currentUserPhone?: string | null,
  tripMembersMap?: Record<string, TripMember[] | any[]>,
  activeTripId?: string | null
): Promise<AiExpenseParseResult | null> {
  const groqApiKey = (await getSavedGroqApiKey()) || process.env.EXPO_PUBLIC_GROQ_API_KEY;
  if (!groqApiKey || !transcript.trim()) return null;

  try {
    const candidateTrips = trips.map(t => ({ id: t.id, name: t.name }));
    const membersSummary: Record<string, Array<{ id: string; name: string; is_you: boolean }>> = {};

    Object.entries(tripMembersMap || {}).forEach(([tripId, members]) => {
      membersSummary[tripId] = (members || []).map(m => {
        const isYou = Boolean(
          (currentUserId && (m.user_id === currentUserId || m.profile_id === currentUserId)) ||
          (currentUserPhone && m.phone_number && m.phone_number.includes(currentUserPhone.slice(-8))) ||
          m.display_name.toLowerCase().includes('you')
        );
        return { id: m.id, name: m.display_name, is_you: isYou };
      });
    });

    const activeTrip = trips.find(t => t.id === activeTripId) || trips[0] || null;
    const defaultPayer =
      activeTrip && tripMembersMap
        ? (tripMembersMap[activeTrip.id] || []).find(m => {
            if (currentUserId && (m.user_id === currentUserId || m.profile_id === currentUserId)) return true;
            if (currentUserPhone && m.phone_number && m.phone_number.includes(currentUserPhone.slice(-8))) return true;
            return m.display_name.toLowerCase().includes('you');
          }) || (tripMembersMap[activeTrip.id] || [])[0]
        : null;

    const systemPrompt = `Extract structured expense JSON for SplitYourTrip from multilingual voice (EN/HI/GU/Hinglish).
Context:
ActiveTrip: ${activeTrip ? JSON.stringify({ id: activeTrip.id, name: activeTrip.name }) : 'None'}
Speaker(You): ${defaultPayer ? JSON.stringify({ id: defaultPayer.id, name: defaultPayer.display_name }) : 'Unknown'}
Trips: ${JSON.stringify(candidateTrips)}
MembersByTrip: ${JSON.stringify(membersSummary)}

Rules:
- amount: number in Rupees. Convert spoken words accurately (e.g. "dedh sau" -> 150, "dhai hazaar" -> 2500, "2k" -> 2000, "100 each for 4" -> 400, "jamvanu 850" -> 850, "paune teen sau" -> 275). If no amount, return null.
- description: concise Title Case title without conversational fillers (e.g. "Tea", "Petrol", "Beach Shack Dinner", "Auto Fare").
- category: strictly ONE of ["Food", "Stay", "Fuel", "Tickets", "Groceries", "General"].
- trip_id: matched trip ID from Trips (if multiple trips match the location/name, match the trip whose members match the named people/participants), or ActiveTrip ID.
- paid_by_member_id: member ID who paid (speaker -> speaker ID; other named member -> their ID).
- split_all: boolean (true if everyone/default, false if specific subset).
- selected_participant_ids: array of member IDs included in split (all trip members if split_all=true; or specific members if named; or all except excluded).
- payment_mode: strictly ONE of ["upi", "cash", "other"] (cash/rokhda -> cash; card/netbanking -> other; upi/gpay/phonepe/default -> upi).

Output JSON only: {"amount":number,"description":"...","category":"...","trip_id":"...","paid_by_member_id":"...","paid_by_name":"...","split_all":true,"selected_participant_ids":["..."],"payment_mode":"upi"|"cash"|"other"}`;

    const candidateModels = ['openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-120b'];

    for (const modelName of candidateModels) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);

        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${groqApiKey}`,
          },
          body: JSON.stringify({
            model: modelName,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: transcript },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.0,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!res.ok) {
          console.warn(`[voiceAiService] Model ${modelName} returned status ${res.status}. Trying fallback...`);
          continue;
        }

        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content;
        if (!content) continue;

        const parsedJson = JSON.parse(content);
        if (typeof parsedJson.amount === 'number' && parsedJson.amount > 0) {
          const matchedTrip =
            trips.find(t => t.id === parsedJson.trip_id) ||
            trips.find(t => t.id === activeTripId) ||
            trips[0] ||
            null;
          const tripMembers = matchedTrip && tripMembersMap ? tripMembersMap[matchedTrip.id] || [] : [];

          const currentMember =
            tripMembers.find(
              m =>
                (currentUserId && (m.user_id === currentUserId || m.profile_id === currentUserId)) ||
                (currentUserPhone && m.phone_number && m.phone_number.includes(currentUserPhone.slice(-8))) ||
                m.display_name.toLowerCase().includes('you')
            ) ||
            tripMembers[0] ||
            null;

          let paidByMemberId = currentMember ? currentMember.id : null;
          let paidByMemberName = currentMember ? 'You' : null;

          if (parsedJson.paid_by_member_id && tripMembers.some(m => m.id === parsedJson.paid_by_member_id)) {
            const foundPayer = tripMembers.find(m => m.id === parsedJson.paid_by_member_id);
            if (foundPayer) {
              paidByMemberId = foundPayer.id;
              paidByMemberName = (currentMember && foundPayer.id === currentMember.id) ? 'You' : foundPayer.display_name;
            }
          } else if (parsedJson.paid_by_name) {
            const foundPayer = tripMembers.find(m =>
              m.display_name.toLowerCase().includes(parsedJson.paid_by_name.toLowerCase())
            );
            if (foundPayer) {
              paidByMemberId = foundPayer.id;
              paidByMemberName = (currentMember && foundPayer.id === currentMember.id) ? 'You' : foundPayer.display_name;
            }
          }

          let splitAll = Boolean(parsedJson.split_all);
          const selectedParticipantIds: string[] = [];

          if (
            Array.isArray(parsedJson.selected_participant_ids) &&
            parsedJson.selected_participant_ids.length > 0 &&
            !splitAll
          ) {
            parsedJson.selected_participant_ids.forEach((id: string) => {
              if (tripMembers.some(m => m.id === id) && !selectedParticipantIds.includes(id)) {
                selectedParticipantIds.push(id);
              }
            });
          } else if (
            Array.isArray(parsedJson.participant_names) &&
            parsedJson.participant_names.length > 0 &&
            !splitAll
          ) {
            parsedJson.participant_names.forEach((name: string) => {
              const found = tripMembers.find(m =>
                m.display_name.toLowerCase().includes(name.toLowerCase())
              );
              if (found && !selectedParticipantIds.includes(found.id)) {
                selectedParticipantIds.push(found.id);
              }
            });
          }

          if (splitAll || selectedParticipantIds.length === 0) {
            splitAll = true;
            selectedParticipantIds.length = 0;
            tripMembers.forEach(m => selectedParticipantIds.push(m.id));
          } else if (selectedParticipantIds.length === 1 && currentMember && selectedParticipantIds[0] !== currentMember.id) {
            selectedParticipantIds.push(currentMember.id);
            splitAll = false;
          }

          // Resolve payment mode
          let paymentMode: 'upi' | 'cash' | 'other' = 'upi';
          if (parsedJson.payment_mode && ['upi', 'cash', 'other'].includes(parsedJson.payment_mode.toLowerCase())) {
            paymentMode = parsedJson.payment_mode.toLowerCase() as 'upi' | 'cash' | 'other';
          }

          // Clean description formatting
          let description = (parsedJson.description || 'Expense').trim();
          if (description.length > 0) {
            description = description.replace(/\b\w/g, (l: string) => l.toUpperCase());
          }

          // Category validation
          const validCategories = ['Food', 'Stay', 'Fuel', 'Tickets', 'Groceries', 'General'];
          let category = parsedJson.category || 'General';
          if (!validCategories.includes(category)) {
            if (category === 'Entertainment' || category === 'Shopping' || category === 'Medical') {
              category = 'General';
            } else {
              category = 'Food';
            }
          }

          return {
            amountRupees: parsedJson.amount.toString(),
            amountPaise: Math.round(parsedJson.amount * 100),
            category,
            description,
            matchedTripId: matchedTrip ? matchedTrip.id : null,
            paidByMemberId,
            paidByMemberName,
            splitAll,
            selectedParticipantIds,
            paymentMode,
          };
        }
      } catch (modelErr) {
        console.warn(`[voiceAiService] Model ${modelName} error:`, modelErr);
      }
    }
  } catch (err) {
    console.warn('[voiceAiService] Groq Llama parse note:', err);
  }

  return null;
}

export interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  action?: CopilotAction | null;
  timestamp: string;
}

export type CopilotActionType =
  | 'ADD_EXPENSE'
  | 'CONFIRM_ADD_EXPENSE'
  | 'SETTLE_UP'
  | 'NAVIGATE'
  | 'CREATE_TRIP'
  | 'DELETE_EXPENSE'
  | 'START_CONTACT_SPLIT'
  | 'UPDATE_EXPENSE'
  | 'NONE';

export type CopilotActionStatus =
  | 'needs_clarification'
  | 'pending_confirmation'
  | 'confirmed'
  | 'info_only';

export interface CopilotExpensePayload {
  amountPaise: number;
  amountRupees: string;
  description: string;
  category: string;
  tripId: string;
  tripName?: string;
  paidByMemberId: string;
  paidByMemberName?: string;
  participantMemberIds: string[];
  splitAll?: boolean;
  paymentMode: 'upi' | 'cash' | 'other';
}

export interface CopilotUpdateExpensePayload {
  expenseId: string;
  tripId: string;
  tripName?: string;
  description?: string;
  amountRupees?: string;
  amountPaise?: number;
  category?: string;
  paidByMemberId?: string;
  paidByMemberName?: string;
  participantMemberIds?: string[];
  splitAll?: boolean;
  paymentMode?: 'upi' | 'cash' | 'other';
}

export interface CopilotDeleteExpensePayload {
  tripId: string;
  tripName?: string;
  expenseId: string;
  description: string;
  amountRupees: string;
  amountPaise: number;
}

export interface CopilotContactSplitPayload {
  contactId?: string;
  contactName: string;
  phoneNumber?: string;
  amountRupees?: string;
  amountPaise?: number;
  description?: string;
  category?: string;
}

export interface CopilotAction {
  type: CopilotActionType;
  status: CopilotActionStatus;
  expense?: CopilotExpensePayload;
  updateExpense?: CopilotUpdateExpensePayload;
  deleteExpense?: CopilotDeleteExpensePayload;
  contactSplit?: CopilotContactSplitPayload;
  settle?: {
    tripId: string;
    fromMemberId: string;
    toMemberId: string;
    amountPaise: number;
    amountRupees: string;
    toMemberName?: string;
  };
  navigation?: {
    screen: string;
    params?: any;
  };
  trip?: {
    name: string;
    currency?: string;
  };
}

export interface CopilotRecentExpense {
  id: string;
  tripId: string;
  tripName?: string;
  description: string;
  amountPaise: number;
  amountRupees: string;
  category?: string;
  date?: string;
  paidByName?: string;
}

export interface CopilotContactSummary {
  id: string;
  name: string;
  phoneNumber?: string;
}

export interface CopilotTurnResult {
  reply: string;
  action: CopilotAction | null;
}

/**
 * Multi-Turn Conversational Voice AI Copilot for SplitYourTrip
 * Intelligently converses with the user, resolves ambiguities, asks for confirmation,
 * and operates all app features (expenses, delete expenses, contact splits, balances, settlements, navigation).
 */
export async function runVoiceCopilot(params: {
  userPrompt: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  trips: Array<{ id: string; name: string; currency?: string; trip_type?: string }>;
  tripMembersMap?: Record<string, TripMember[] | any[]>;
  balances?: TripBalanceRow[] | any[];
  currentUserId?: string;
  currentUserPhone?: string | null;
  activeTripId?: string | null;
  friendsSummary?: any;
  recentExpenses?: CopilotRecentExpense[];
  contacts?: CopilotContactSummary[];
}): Promise<CopilotTurnResult> {
  const {
    userPrompt,
    history = [],
    trips,
    tripMembersMap = {},
    balances = [],
    currentUserId,
    currentUserPhone,
    activeTripId,
    friendsSummary,
    recentExpenses = [],
    contacts = [],
  } = params;

  const groqApiKey = (await getSavedGroqApiKey()) || process.env.EXPO_PUBLIC_GROQ_API_KEY;
  if (!groqApiKey || !userPrompt.trim() || isWhisperHallucination(userPrompt.trim())) {
    return {
      reply: "I didn't catch that. Tap the mic or type your request below.",
      action: null,
    };
  }

  try {
    const candidateTrips = trips.map(t => ({ id: t.id, name: t.name }));
    const membersSummary: Record<string, Array<{ id: string; name: string; is_you: boolean }>> = {};

    Object.entries(tripMembersMap).forEach(([tripId, members]) => {
      membersSummary[tripId] = (members || []).map(m => {
        const isYou = Boolean(
          (currentUserId && (m.user_id === currentUserId || m.profile_id === currentUserId)) ||
          (currentUserPhone && m.phone_number && m.phone_number.includes(currentUserPhone.slice(-8))) ||
          (m.display_name && m.display_name.toLowerCase().includes('you'))
        );
        return { id: m.id, name: m.display_name, is_you: isYou };
      });
    });

    const activeTrip = trips.find(t => t.id === activeTripId) || trips[0] || null;
    const defaultPayer =
      activeTrip && tripMembersMap
        ? (tripMembersMap[activeTrip.id] || []).find(m => {
            if (currentUserId && (m.user_id === currentUserId || m.profile_id === currentUserId)) return true;
            if (currentUserPhone && m.phone_number && m.phone_number.includes(currentUserPhone.slice(-8))) return true;
            return m.display_name && m.display_name.toLowerCase().includes('you');
          }) || (tripMembersMap[activeTrip.id] || [])[0]
        : null;

    // Build human-readable balance context
    const balanceLines: string[] = [];
    if (friendsSummary) {
      if (friendsSummary.totalOwedToYouPaise > 0) {
        balanceLines.push(`Total owed to you across friends: ₹${Math.round(friendsSummary.totalOwedToYouPaise / 100)}`);
      }
      if (friendsSummary.totalYouOwePaise > 0) {
        balanceLines.push(`Total you owe across friends: ₹${Math.round(friendsSummary.totalYouOwePaise / 100)}`);
      }
    }

    if (Array.isArray(balances) && balances.length > 0) {
      balances.forEach(r => {
        const tr = trips.find(t => t.id === r.trip_id);
        const trName = tr ? tr.name : 'Active Trip';
        if (r.net_balance > 0) {
          balanceLines.push(`${r.display_name} gets back ₹${Math.round(r.net_balance / 100)} in "${trName}"`);
        } else if (r.net_balance < 0) {
          balanceLines.push(`${r.display_name} owes ₹${Math.round(Math.abs(r.net_balance) / 100)} in "${trName}"`);
        }
      });
    }

    const systemPrompt = `You are SplitYourTrip Copilot, an intelligent, helpful voice AI assistant inside the SplitYourTrip app.
You can converse with the user and operate all features in the app:
1. Expenses: add, view, update, delete.
2. Contacts & Friend Splits: find people from device/friend contacts and start a 1-on-1 split (with or without an initial expense).
3. Balances & Debts: answer who owes what, pairwise debts, total owed.
4. Settlements: record cash/UPI settlements.
5. Trips: create trips, list members.
6. Navigation: open screens (e.g. /trip/[id], /(tabs)/friends, /(tabs)/analyser, /(tabs)/profile).

Context:
ActiveTrip: ${activeTrip ? JSON.stringify({ id: activeTrip.id, name: activeTrip.name }) : 'None'}
Speaker(You): ${defaultPayer ? JSON.stringify({ id: defaultPayer.id, name: defaultPayer.display_name }) : 'Unknown'}
Trips: ${JSON.stringify(candidateTrips)}
MembersByTrip: ${JSON.stringify(membersSummary)}
RecentExpenses: ${JSON.stringify(
  recentExpenses.slice(0, 15).map(e => ({
    id: e.id,
    tripId: e.tripId,
    tripName: e.tripName,
    description: e.description,
    amountRupees: e.amountRupees,
    category: e.category,
  }))
)}
Contacts: ${JSON.stringify(
  contacts.slice(0, 35).map(c => ({
    id: c.id,
    name: c.name,
    phone: c.phoneNumber || '',
  }))
)}
Balances: ${JSON.stringify(balanceLines.slice(0, 15))}

Rules:
- Understand English, Hindi, Gujarati, Hinglish, and spoken slang ("2k" -> 2000, "dedh sau" -> 150, "jamvanu 850" -> 850, "paune teen sau" -> 275).
- CRITICAL INTEGRITY: NEVER claim or pretend that you added, updated, or deleted an expense unless you actually return the corresponding action object (ADD_EXPENSE, UPDATE_EXPENSE, DELETE_EXPENSE). If you cannot find the expense or need more information, answer honestly and ask the user.

- INTENT CLASSIFICATION RULES (ABSOLUTE PRIORITY):
  - If user uses words of removal, deletion, or cancellation ("remove", "delete", "cancel", "erase", "drop", "hatao", "hata do", "nikalo", "nikal do", "delete kar", "kadhi nakho"):
    You MUST classify this as DELETE_EXPENSE! NEVER output ADD_EXPENSE under ANY circumstances, even if expense categories like "petrol", "dinner", "fuel", "food" or amounts are present!
  - If user uses words of modification ("update", "change", "edit", "modify", "50-50 kar do", "badal do", "badli ne"):
    You MUST classify this as UPDATE_EXPENSE! NEVER output ADD_EXPENSE!
  - ONLY classify as ADD_EXPENSE when user explicitly intends to record a new expenditure.

- SPEAKER IDENTITY & PRONOUNS:
  - Speaker(You) represents the current user ("me", "myself", "I", "maine", "mere", "mene", "mane", "You").
  - In MembersByTrip, the speaker has "is_you": true.

- SPLITTING PARTICIPANT RULES (CRITICAL):
  - Whenever user says "split with [Name]" (e.g. "split with Khushi"), "split between me and [Name]", "split with me and [Name]", "mere aur [Name] me baant do", or "[Name] sathe split kar":
    Both Speaker(You) AND [Name] MUST be included in participantMemberIds (e.g. ["speaker_id", "khushi_id"])!
    For 2 people, this ensures a 50-50 split. NEVER omit Speaker(You) when user asks to split with someone!
    Set splitAll = false.
  - If user explicitly says "only [Name]" (e.g. "only for Khushi", "pure Khushi ka hai") or "split between Khushi and Isha without me", do NOT include Speaker(You).
  - If user specifies "everyone", "all", "all members", "sab me", "split equally", or does not specify members:
    Include ALL member IDs of the trip in participantMemberIds. Set splitAll = true.

- UPDATE EXPENSE RULES:
  - If user wants to update, edit, modify, or change an existing expense (e.g. "update this expense and split it with me and Khushi", "change last expense to 50-50", "update expense to 500 rupees", "Khushi aur mere me 50-50 split kar do", "change description to Lunch"):
    - Identify target expense:
      - For "this expense", "it", "last expense", "latest expense", or referring to the expense just created or discussed, pick the first item in RecentExpenses.
      - If user specifies an amount or description (e.g. "update 100 rupees expense", "change dinner to 200"), match by amount or description in RecentExpenses.
    - If found:
      - Set action.type = "UPDATE_EXPENSE".
      - Populate updateExpense:
        - expenseId: target expense ID.
        - tripId: target trip ID.
        - tripName: target trip name.
        - description: updated description or keep existing.
        - amountRupees: updated amount in Rupees or keep existing.
        - amountPaise: Math.round(Number(amountRupees) * 100).
        - category: updated category or keep existing.
        - participantMemberIds: updated member IDs. (Remember: if splitting with Khushi or 50-50, include BOTH Speaker(You) AND Khushi!).
        - splitAll: boolean (false if subset, true if all members).
      - If user explicitly instructed to update (e.g. "update this expense and split it with me and Khushi, so the amount will be 50-50", "update it now", "change it to 50-50"):
        Set status = "confirmed".
        Formulate reply: "I have updated the {description} expense to split 50-50 with {otherName}."
      - If user is proposing or asking: set status = "pending_confirmation".
    - If no matching expense is found in RecentExpenses:
      - Return reply: "I couldn't find that expense in your recent expenses. Please tell me which expense to update." with action = null.

- DELETE EXPENSE RULES:
  - If user wants to delete, cancel, or remove an expense (e.g. "remove last expence of petrol", "delete petrol expense", "remove petrol expense", "delete last expense", "cancel ₹500 petrol", "remove chai expense", "kharcha delete kar"):
    - Match the best expense from RecentExpenses:
      - For named expenses (e.g. "petrol", "dinner", "fuel", "500"): find the expense in RecentExpenses matching the description, category, or amount.
      - For "last expense", "latest expense", or "last one": pick the first item in RecentExpenses.
    - If found:
      - Set action.type = "DELETE_EXPENSE".
      - Populate deleteExpense: { tripId, tripName, expenseId, description, amountRupees, amountPaise: Math.round(Number(amountRupees) * 100) }.
      - OMIT or set expense: null. NEVER populate action.expense for a delete action!
      - If user gives a direct imperative command (e.g. "remove last expense of petrol", "delete petrol expense", "remove petrol", "delete last expense", "cancel it", "delete it"):
        Set status = "confirmed".
        Formulate reply: "I have removed the ₹{amountRupees} {description} expense from {tripName}."
      - If user asks tentatively (e.g. "can you delete...", "should we remove..."):
        Set status = "pending_confirmation".
        Formulate polite confirmation: "Are you sure you want to delete the ₹{amountRupees} {description} expense from {tripName}?".
    - If no matching expense is found in RecentExpenses:
      - Return reply: "I couldn't find that expense in your recent expenses to remove. Please check the trip or expense name." with action = null.

- 1-ON-1 CONTACT SPLIT RULES (CRITICAL):
  - When user wants to split with a contact or friend (e.g. "add an expense with Rohan from contacts", "add 500 rupees expense with Rohan", "split 100 with Parth", "start a split with Priya", "Rohan ke sath 500 split karo", "Rohan sathe split kar", "split with Rohan"):
    - In SplitYourTrip, 1-on-1 contact splits DO NOT require an existing group trip! A dedicated 1-on-1 split trip is automatically created by the app.
    - NEVER ask the user "Which trip do you mean?" or "Please clarify trip" when splitting with a contact!
    - If description is not mentioned, automatically default description to "Expense". NEVER ask the user to clarify description!
    - If category is not mentioned, automatically default category to "General". NEVER ask the user to clarify category!
    - NEVER set status = "needs_clarification" when a contact is identified!
    - Match the contact from Contacts by name or phone. If not in Contacts list, use the exact name mentioned by the user.
    - If an expense amount is mentioned (e.g. "add 500 for lunch with Rohan", "split 1000 with Priya", "add an expense of 100 with Rohan"):
      - Extract amountRupees and amountPaise (Math.round(Number(amountRupees) * 100)).
      - Extract description (or default to "Expense") and category (default to "General", or "Food", "Fuel", etc.).
      - Set action.type = "START_CONTACT_SPLIT".
      - Set status = "confirmed".
      - Set contactSplit: { contactId, contactName, phoneNumber, amountRupees, amountPaise, description, category }.
      - Formulate reply: "I found {contactName}. Starting a 1-on-1 split with ₹{amountRupees} for {description}."
    - If NO expense amount is mentioned (e.g. "start a split with Rohan", "split with Priya from contacts"):
      - Set action.type = "START_CONTACT_SPLIT".
      - Set status = "confirmed".
      - Set contactSplit: { contactId, contactName, phoneNumber, amountRupees: "0", amountPaise: 0, description: "Split", category: "General" }.
      - Formulate reply: "Starting a 1-on-1 split with {contactName}."
  - If user says "add an expense with a contact" or "find people from my contact and start a split" without naming a specific contact:
    - Formulate reply: "Who from your contacts would you like to split with? I can start a 1-on-1 split with Rohan, Priya, or anyone from your contacts."
    - Set action.type = "NAVIGATE", action.navigation = { screen: "/(tabs)/friends" }, status = "info_only".

- ADD EXPENSE RULES:
  - If user mentions adding an expense to a trip:
    - If trip is ambiguous (e.g. 2 trips named Goa), ASK for clarification politely: "Which Goa trip do you mean: Goa Friends or Goa Family?". Set status="needs_clarification".
    - If user specifies splitting with specific members (e.g. "split with Rohan", "split between Rohan and me", "split it with 2 members: Rohan and me", "only Khushi and Isha"):
      Match their member IDs from MembersByTrip for that trip. If the speaker/user is one of the participants, include speaker's ID too.
      Set splitAll=false and include ONLY those member IDs in participantMemberIds.
    - If user says "split with 2 members" without naming them:
      Ask for clarification: "Which 2 members would you like to split with?". Set status="needs_clarification".
    - If user specifies "everyone", "all", "all members", "sab me", "split equally", or does not specify members:
      Include ALL member IDs of the trip in participantMemberIds. Set splitAll=true.
    - When details are ready:
      Ask for user confirmation politely: "Should I confirm adding ₹{amountRupees} for {description} to {tripName}?". Set status="pending_confirmation".
    - ONLY set status="confirmed" if user has explicitly confirmed ("yes", "confirm", "add it", "go ahead").

- BALANCES & DEBTS RULES:
  - If user asks who owes what, how much they owe, who owes them, or their overall balance (e.g. "who owes me?", "kitne paise lene hai?", "how much do I owe in Goa?", "what is my net balance?", "hisaab batao"):
    - Answer accurately using Balances and friendsSummary context.
    - Keep reply concise, friendly, and natural for Text-to-Speech (TTS). Set action = null.

- SETTLE UP RULES:
  - If user wants to settle up or clear dues with a person (e.g. "settle with Rohan", "clear dues with Khushi", "Rohan ka hisaab clear karo"):
    - Identify target member from MembersByTrip.
    - Set action.type = "SETTLE_UP".
    - Populate settle: { tripId, fromMemberId, toMemberId, amountPaise, amountRupees, toMemberName }.
    - Set status = "pending_confirmation".

- NAVIGATION RULES:
  - If user wants to open or navigate to a screen:
    - "go to analyser" / "spending trends" / "analyser tab" -> { screen: "/(tabs)/analyser" }
    - "go to friends" / "open friends tab" / "1-on-1 splits" -> { screen: "/(tabs)/friends" }
    - "open profile" / "settings" / "my profile" -> { screen: "/(tabs)/profile" }
    - "open [TripName] trip" / "go to [TripName]" -> { screen: "/trip/[matchedTripId]" }
    - Set action.type = "NAVIGATE".
    - Formulate reply: "Opening {screenName}."

- HELP & FEATURES LIST RULES:
  - If user asks what features you have, what commands you support, or for help (e.g. "what can you do?", "list all features", "help", "commands list", "kya kya kar sakte ho?", "su kari sako chho?"):
    - Provide a concise summary of your 7 features:
      1. Add Expenses (e.g. "Add ₹850 for dinner split with all" or "split with me and Khushi 50-50")
      2. Update Expenses (e.g. "Update last expense to 50-50 with Khushi")
      3. Delete Expenses (e.g. "Delete my last expense")
      4. Friend & Contact Splits (e.g. "Start a split with Rohan from contacts")
      5. Check Balances (e.g. "Who owes me money?")
      6. Settle Up (e.g. "Settle up with Rohan")
      7. Navigation (e.g. "Open analyser" or "Go to friends")
    - Set action = null.

- Keep "reply" conversational, friendly, concise, natural for Text-to-Speech (TTS).

Output JSON only:
{
  "reply": "string to be spoken to user",
  "action": null | {
    "type": "ADD_EXPENSE" | "CONFIRM_ADD_EXPENSE" | "UPDATE_EXPENSE" | "SETTLE_UP" | "NAVIGATE" | "CREATE_TRIP" | "DELETE_EXPENSE" | "START_CONTACT_SPLIT" | "NONE",
    "status": "needs_clarification" | "pending_confirmation" | "confirmed" | "info_only",
    "expense": {
      "amountPaise": number,
      "amountRupees": "string",
      "description": "string",
      "category": "Food"|"Stay"|"Fuel"|"Tickets"|"Groceries"|"General",
      "tripId": "string",
      "paidByMemberId": "string",
      "participantMemberIds": ["string"],
      "splitAll": boolean,
      "paymentMode": "upi"|"cash"|"other"
    },
    "updateExpense": {
      "expenseId": "string",
      "tripId": "string",
      "tripName": "string",
      "description": "string",
      "amountRupees": "string",
      "amountPaise": number,
      "category": "Food"|"Stay"|"Fuel"|"Tickets"|"Groceries"|"General",
      "paidByMemberId": "string",
      "participantMemberIds": ["string"],
      "splitAll": boolean
    },
    "deleteExpense": {
      "tripId": "string",
      "tripName": "string",
      "expenseId": "string",
      "description": "string",
      "amountRupees": "string",
      "amountPaise": number
    },
    "contactSplit": {
      "contactId": "string",
      "contactName": "string",
      "phoneNumber": "string",
      "amountRupees": "string",
      "amountPaise": number,
      "description": "string",
      "category": "Food"|"Stay"|"Fuel"|"Tickets"|"Groceries"|"General"
    },
    "navigation": { "screen": "string" }
  }
};`;

    const candidateModels = ['openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-120b'];

    for (const modelName of candidateModels) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 7000);

        const conversationMessages = [
          { role: 'system', content: systemPrompt },
          ...history.slice(-8), // Keep last 8 turns for context
          { role: 'user', content: userPrompt },
        ];

        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${groqApiKey}`,
          },
          body: JSON.stringify({
            model: modelName,
            messages: conversationMessages,
            response_format: { type: 'json_object' },
            temperature: 0.1,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!res.ok) {
          console.warn(`[voiceAiService] Copilot model ${modelName} returned status ${res.status}. Falling back...`);
          continue;
        }

        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content;
        if (!content) continue;

        const parsed = JSON.parse(content);
        let reply = parsed.reply || "I'm on it.";
        let action: CopilotAction | null = null;

        if (parsed.action && parsed.action.type && parsed.action.type !== 'NONE') {
          action = parsed.action;
        }

        const lowerPrompt = userPrompt.toLowerCase();
        const isDeleteIntent = /\b(remove|delete|cancel|erase|drop|hatao|hata\s*do|nikal\s*do|nikalo|delete\s*karo|kadhi\s*nakho)\b/i.test(lowerPrompt);
        const isUpdateIntent = /\b(update|change|edit|modify|50-50|50\/50|badal\s*do|badli\s*ne)\b/i.test(lowerPrompt);

        // Pre-guard 1: If user clearly instructed to delete or remove, NEVER allow ADD_EXPENSE
        if (isDeleteIntent && (!action || action.type === 'ADD_EXPENSE' || action.type === 'CONFIRM_ADD_EXPENSE' || action.type === 'NONE')) {
          console.warn('[voiceAiService] Overriding hallucinated ADD_EXPENSE to DELETE_EXPENSE:', userPrompt);
          let matched = recentExpenses.find(
            e => e.description && lowerPrompt.includes(e.description.toLowerCase())
          );
          if (!matched && (lowerPrompt.includes('petrol') || lowerPrompt.includes('fuel'))) {
            matched = recentExpenses.find(
              e => e.category === 'Fuel' || (e.description && e.description.toLowerCase().includes('petrol'))
            );
          }
          if (!matched && (lowerPrompt.includes('food') || lowerPrompt.includes('dinner') || lowerPrompt.includes('lunch') || lowerPrompt.includes('coffee') || lowerPrompt.includes('chai'))) {
            matched = recentExpenses.find(
              e => e.category === 'Food' || (e.description && /dinner|lunch|food|coffee|chai/i.test(e.description))
            );
          }
          if (!matched && (lowerPrompt.includes('last') || lowerPrompt.includes('latest') || lowerPrompt.includes('recent') || lowerPrompt.includes('expense') || lowerPrompt.includes('kharcha'))) {
            matched = recentExpenses[0];
          }

          if (matched) {
            action = {
              type: 'DELETE_EXPENSE',
              status: 'confirmed',
              deleteExpense: {
                tripId: matched.tripId,
                tripName: matched.tripName,
                expenseId: matched.id,
                description: matched.description,
                amountRupees: matched.amountRupees,
                amountPaise: matched.amountPaise,
              },
            };
            reply = `I have removed the ₹${matched.amountRupees} ${matched.description} expense from ${matched.tripName}.`;
          } else {
            action = null;
            reply = "I couldn't find that expense in your recent expenses to remove. Please check the trip or expense name.";
          }
        }

        // Pre-guard 2: If user asked to split with a contact or friend, NEVER stall with needs_clarification
        const isContactSplitIntent = /\b(contact|friend|friends|split\s*with|sathe|ke\s*saath|ke\s*sath)\b/i.test(lowerPrompt);
        if (
          isContactSplitIntent &&
          (!action || action.type === 'NONE' || action.status === 'needs_clarification' || action.type === 'ADD_EXPENSE')
        ) {
          // Check if a contact from contactsSummary matches
          let matchedContact: CopilotContactSummary | undefined = undefined;
          for (const c of contacts) {
            if (c.name) {
              const firstName = c.name.toLowerCase().split(/\s+/)[0];
              if (firstName && firstName.length > 2 && lowerPrompt.includes(firstName)) {
                matchedContact = c;
                break;
              }
            }
          }

          // Extract amount if present in prompt
          const amtMatch = lowerPrompt.match(/(?:₹|rs\.?|inr|rupees?|rupiya|rupaye)?\s*(\d+(?:\.\d+)?)\s*(?:k|thousand|rupees?|rupiya|rupaye)?/i);
          let parsedAmtRupees = '0';
          let parsedAmtPaise = 0;
          if (amtMatch) {
            let num = parseFloat(amtMatch[1]);
            if (/k\b/i.test(userPrompt)) num *= 1000;
            parsedAmtRupees = Math.round(num).toString();
            parsedAmtPaise = Math.round(num * 100);
          }

          // Extract description / category
          let parsedDesc = 'Expense';
          let parsedCat = 'General';
          if (/dinner|lunch|breakfast|food|coffee|chai|nashta|cafe|restaurant|pizza|burger/i.test(lowerPrompt)) {
            parsedCat = 'Food';
            parsedDesc = lowerPrompt.match(/dinner|lunch|breakfast|food|coffee|chai|nashta|cafe|restaurant|pizza|burger/i)?.[0] || 'Food';
            parsedDesc = parsedDesc.charAt(0).toUpperCase() + parsedDesc.slice(1);
          } else if (/petrol|fuel|diesel|cab|taxi|uber|ola|auto|rickshaw/i.test(lowerPrompt)) {
            parsedCat = 'Fuel';
            parsedDesc = lowerPrompt.match(/petrol|fuel|diesel|cab|taxi|uber|ola|auto|rickshaw/i)?.[0] || 'Fuel';
            parsedDesc = parsedDesc.charAt(0).toUpperCase() + parsedDesc.slice(1);
          }

          if (matchedContact) {
            console.log('[voiceAiService] Auto-resolving stalled contact split to START_CONTACT_SPLIT for:', matchedContact.name);
            action = {
              type: 'START_CONTACT_SPLIT',
              status: 'confirmed',
              contactSplit: {
                contactId: matchedContact.id,
                contactName: matchedContact.name,
                phoneNumber: matchedContact.phoneNumber,
                amountRupees: parsedAmtRupees,
                amountPaise: parsedAmtPaise,
                description: parsedDesc,
                category: parsedCat as any,
              },
            };
            reply = parsedAmtPaise > 0
              ? `I found ${matchedContact.name}. Starting a 1-on-1 split with ₹${parsedAmtRupees} for ${parsedDesc}.`
              : `I found ${matchedContact.name}. Starting a 1-on-1 split.`;
          } else if (/from\s*(?:my\s*)?contacts?|with\s*(?:a\s*)?contact|find\s*people/i.test(lowerPrompt) && !matchedContact) {
            action = {
              type: 'NAVIGATE',
              status: 'info_only',
              navigation: { screen: '/(tabs)/friends' },
            };
            reply = contacts.length > 0
              ? `Who from your contacts would you like to split with? I found ${contacts.slice(0, 3).map(c => c.name).join(', ')} in your contacts.`
              : 'Who from your contacts would you like to split with? Tell me their name to start a 1-on-1 split.';
          }
        }

        // Strict Action Payload Isolation: Ensure ZERO cross-contamination between actions
        if (action) {
          if (action.type === 'ADD_EXPENSE' || action.type === 'CONFIRM_ADD_EXPENSE') {
            action.deleteExpense = undefined;
            action.updateExpense = undefined;
            action.contactSplit = undefined;
          } else if (action.type === 'DELETE_EXPENSE') {
            action.expense = undefined;
            action.updateExpense = undefined;
            action.contactSplit = undefined;
          } else if (action.type === 'UPDATE_EXPENSE') {
            action.expense = undefined;
            action.deleteExpense = undefined;
            action.contactSplit = undefined;
          } else if (action.type === 'START_CONTACT_SPLIT') {
            action.expense = undefined;
            action.deleteExpense = undefined;
            action.updateExpense = undefined;
          }
        }

        if (action) {
          // 1. Validate & clean expense fields if ADD_EXPENSE
          if ((action.type === 'ADD_EXPENSE' || action.type === 'CONFIRM_ADD_EXPENSE') && action.expense) {
            const exp = action.expense;
            const targetTrip =
              trips.find(t => t.id === exp.tripId) ||
              trips.find(t => t.id === activeTripId) ||
              trips[0] ||
              null;
            const tripMembers = targetTrip && tripMembersMap ? tripMembersMap[targetTrip.id] || [] : [];

            if (targetTrip) {
              exp.tripId = targetTrip.id;
              exp.tripName = targetTrip.name;
            }

            // Ensure amountPaise is integer
            const rawAmt = Number(exp.amountRupees || Math.round((exp.amountPaise || 0) / 100));
            exp.amountPaise = Math.round(rawAmt * 100);
            exp.amountRupees = rawAmt.toString();

            // Validate payer
            const myMember = tripMembers.find(
              m =>
                (currentUserId && (m.user_id === currentUserId || m.profile_id === currentUserId)) ||
                (currentUserPhone && m.phone_number && m.phone_number.includes(currentUserPhone.slice(-8))) ||
                (m.display_name && m.display_name.toLowerCase().includes('you'))
            ) || tripMembers[0];

            if (!exp.paidByMemberId || !tripMembers.some(m => m.id === exp.paidByMemberId)) {
              exp.paidByMemberId = myMember?.id || tripMembers[0]?.id || '';
            }

            const payerObj = tripMembers.find(m => m.id === exp.paidByMemberId);
            exp.paidByMemberName = payerObj?.display_name || (myMember?.id === exp.paidByMemberId ? 'You' : 'Member');

            // Validate participants & splitAll integrity
            if (!Array.isArray(exp.participantMemberIds) || exp.participantMemberIds.length === 0) {
              exp.participantMemberIds = tripMembers.map(m => m.id);
              exp.splitAll = true;
            } else if (exp.participantMemberIds.length < tripMembers.length) {
              exp.splitAll = false;
            } else if (typeof exp.splitAll !== 'boolean') {
              exp.splitAll = exp.participantMemberIds.length === tripMembers.length;
            }

            const lowerPrompt = userPrompt.toLowerCase();
            const mentionsMeOrSplitWith =
              lowerPrompt.includes('split with') ||
              lowerPrompt.includes('with me') ||
              lowerPrompt.includes('me and') ||
              lowerPrompt.includes('and me') ||
              lowerPrompt.includes('mere') ||
              lowerPrompt.includes('mane') ||
              lowerPrompt.includes('between') ||
              lowerPrompt.includes('50-50') ||
              lowerPrompt.includes('50/50');

            if (
              myMember &&
              !exp.splitAll &&
              mentionsMeOrSplitWith &&
              !exp.participantMemberIds.includes(myMember.id)
            ) {
              exp.participantMemberIds.push(myMember.id);
            }

            // Category validation
            const validCats = ['Food', 'Stay', 'Fuel', 'Tickets', 'Groceries', 'General'];
            if (!validCats.includes(exp.category)) exp.category = 'General';

            // Payment mode validation
            if (!['upi', 'cash', 'other'].includes(exp.paymentMode)) exp.paymentMode = 'upi';
          }

          // 2. Validate & clean updateExpense fields
          if (action?.type === 'UPDATE_EXPENSE' && action.updateExpense) {
            const upd = action.updateExpense;
            const matchedRecent = recentExpenses.find(
              e =>
                e.id === upd.expenseId ||
                (e.description && upd.description && e.description.toLowerCase() === upd.description.toLowerCase())
            ) || recentExpenses[0];

            if (matchedRecent) {
              upd.expenseId = upd.expenseId || matchedRecent.id;
              upd.tripId = upd.tripId || matchedRecent.tripId;
              upd.tripName = upd.tripName || matchedRecent.tripName;
              upd.description = upd.description || matchedRecent.description;
              upd.amountRupees = upd.amountRupees || matchedRecent.amountRupees;
              upd.amountPaise = upd.amountPaise || matchedRecent.amountPaise || Math.round(Number(upd.amountRupees) * 100);
              upd.category = upd.category || matchedRecent.category || 'General';
            } else {
              const rawAmt = Number(upd.amountRupees || Math.round((upd.amountPaise || 0) / 100));
              upd.amountPaise = Math.round(rawAmt * 100);
              upd.amountRupees = rawAmt.toString();
            }

            const targetTrip =
              trips.find(t => t.id === upd.tripId) ||
              trips.find(t => t.id === activeTripId) ||
              trips[0] ||
              null;
            const tripMembers = targetTrip && tripMembersMap ? tripMembersMap[targetTrip.id] || [] : [];

            if (targetTrip) {
              upd.tripId = targetTrip.id;
              upd.tripName = targetTrip.name;
            }

            const myMember = tripMembers.find(
              m =>
                (currentUserId && (m.user_id === currentUserId || m.profile_id === currentUserId)) ||
                (currentUserPhone && m.phone_number && m.phone_number.includes(currentUserPhone.slice(-8))) ||
                (m.display_name && m.display_name.toLowerCase().includes('you'))
            ) || tripMembers[0];

            if (!upd.paidByMemberId || !tripMembers.some(m => m.id === upd.paidByMemberId)) {
              upd.paidByMemberId = myMember?.id || tripMembers[0]?.id || '';
            }

            const lowerPrompt = userPrompt.toLowerCase();
            const mentionsMeOrSplitWith =
              lowerPrompt.includes('split with') ||
              lowerPrompt.includes('with me') ||
              lowerPrompt.includes('me and') ||
              lowerPrompt.includes('and me') ||
              lowerPrompt.includes('mere') ||
              lowerPrompt.includes('mane') ||
              lowerPrompt.includes('between') ||
              lowerPrompt.includes('50-50') ||
              lowerPrompt.includes('50/50');

            if (!Array.isArray(upd.participantMemberIds) || upd.participantMemberIds.length === 0) {
              upd.participantMemberIds = tripMembers.map(m => m.id);
              upd.splitAll = true;
            } else {
              if (myMember && mentionsMeOrSplitWith && !upd.participantMemberIds.includes(myMember.id)) {
                upd.participantMemberIds.push(myMember.id);
              }
              upd.splitAll = upd.participantMemberIds.length === tripMembers.length;
            }

            const validCats = ['Food', 'Stay', 'Fuel', 'Tickets', 'Groceries', 'General'];
            if (!upd.category || !validCats.includes(upd.category)) upd.category = 'General';
          }

          // 2. Validate & clean deleteExpense fields
          if (action?.type === 'DELETE_EXPENSE' && action.deleteExpense) {
            const del = action.deleteExpense;
            // Cross-match with recentExpenses to ensure valid ID
            const matchedRecent = recentExpenses.find(
              e =>
                e.id === del.expenseId ||
                (e.description && del.description && e.description.toLowerCase() === del.description.toLowerCase())
            ) || recentExpenses[0];

            if (matchedRecent) {
              del.expenseId = del.expenseId || matchedRecent.id;
              del.tripId = del.tripId || matchedRecent.tripId;
              del.tripName = del.tripName || matchedRecent.tripName;
              del.description = del.description || matchedRecent.description;
              del.amountRupees = del.amountRupees || matchedRecent.amountRupees;
              del.amountPaise = matchedRecent.amountPaise || Math.round(Number(del.amountRupees) * 100);
            } else {
              const rawAmt = Number(del.amountRupees || Math.round((del.amountPaise || 0) / 100));
              del.amountPaise = Math.round(rawAmt * 100);
              del.amountRupees = rawAmt.toString();
            }

            if (!del.tripName && del.tripId) {
              const t = trips.find(tr => tr.id === del.tripId);
              if (t) del.tripName = t.name;
            }
          }

          // 3. Validate & clean contactSplit fields
          if (action?.type === 'START_CONTACT_SPLIT' && action.contactSplit) {
            const cs = action.contactSplit;
            const rawAmt = Number(cs.amountRupees || Math.round((cs.amountPaise || 0) / 100) || 0);
            cs.amountPaise = Math.round(rawAmt * 100);
            cs.amountRupees = rawAmt.toString();

            // Match against known contacts list if possible
            if (contacts && contacts.length > 0) {
              const matched = contacts.find(
                c =>
                  (cs.contactId && c.id === cs.contactId) ||
                  (c.name && cs.contactName && c.name.toLowerCase().includes(cs.contactName.toLowerCase())) ||
                  (c.phoneNumber && cs.phoneNumber && c.phoneNumber.includes(cs.phoneNumber.slice(-8)))
              );
              if (matched) {
                cs.contactId = matched.id;
                cs.contactName = matched.name;
                if (!cs.phoneNumber && matched.phoneNumber) {
                  cs.phoneNumber = matched.phoneNumber;
                }
              }
            }

            const validCats = ['Food', 'Stay', 'Fuel', 'Tickets', 'Groceries', 'General'];
            if (!cs.category || !validCats.includes(cs.category)) {
              cs.category = 'Food';
            }
          }
        }

        return { reply, action };
      } catch (modelErr) {
        console.warn(`[voiceAiService] Copilot error with model ${modelName}:`, modelErr);
      }
    }
  } catch (err: any) {
    console.warn('[voiceAiService] Copilot turn error:', err);
  }

  // Graceful fallback response
  return {
    reply: "I couldn't catch that clearly. Tap the mic or type your request below.",
    action: null,
  };
}

/**
 * Complete Structured Directory of Voice Copilot Features & How Each Command is Recognized
 */
export interface VoiceCommandExample {
  title: string;
  prompt: string;
  language: 'en' | 'hi' | 'gu';
  intent: string;
}

export interface VoiceFeatureCategory {
  id: string;
  category: string;
  icon: string;
  color: string;
  description: string;
  howRecognized: string;
  commands: VoiceCommandExample[];
}

export const VOICE_COPILOT_FEATURE_CATEGORIES: VoiceFeatureCategory[] = [
  {
    id: 'add_expense',
    category: 'Add Expense',
    icon: 'receipt-outline',
    color: '#10B981',
    description: 'Add expenses with custom amounts, participants (all or 50-50), categories, and payers.',
    howRecognized: 'Triggers when user mentions amounts, items/descriptions, or adding costs. Resolves trip, payer, and members.',
    commands: [
      {
        title: 'Dinner for everyone',
        prompt: 'Add 850 rupees for dinner in Goa trip paid by me split with all',
        language: 'en',
        intent: 'Creates an equal split across all trip members.',
      },
      {
        title: '50-50 Split with a person',
        prompt: 'Add 100 rupees for coffee in Goa trip and split with me and Khushi 50-50',
        language: 'en',
        intent: 'Guarantees both speaker and named member are included (50-50 split).',
      },
      {
        title: 'Taxi fare in Hindi',
        prompt: 'Goa trip me 400 rupaye taxi ka kharcha maine bhara sabhi members me baant do',
        language: 'hi',
        intent: 'Converts Hindi spoken numbers & splits among all members.',
      },
      {
        title: 'Lunch in Gujarati',
        prompt: 'Jamvanu 600 rupiya me apya badha vache split kar',
        language: 'gu',
        intent: 'Extracts Gujarati food expense and sets equal split.',
      },
    ],
  },
  {
    id: 'update_expense',
    category: 'Update & Edit Expense',
    icon: 'create-outline',
    color: '#3B82F6',
    description: 'Update the amount, description, category, or participants of any recent or named expense.',
    howRecognized: 'Triggers on keywords like "update", "change", "edit", "modify", "50-50 kar do", "badli ne". Modifies existing store entry.',
    commands: [
      {
        title: 'Change to 50-50 with Khushi',
        prompt: 'Update this expense and split it with me and Khushi, so the amount will be 50-50',
        language: 'en',
        intent: 'Updates participant list to [Speaker, Khushi] and recalculates balances.',
      },
      {
        title: 'Update amount',
        prompt: 'Update my last expense to 500 rupees',
        language: 'en',
        intent: 'Changes amount to ₹500 and updates splits.',
      },
      {
        title: 'Update in Hindi',
        prompt: 'Mera aakhri kharcha update karke Khushi aur mere me 50-50 kar do',
        language: 'hi',
        intent: 'Updates participants to 50-50 in Hindi.',
      },
      {
        title: 'Update in Gujarati',
        prompt: 'Chhello kharch badli ne 50-50 kar do',
        language: 'gu',
        intent: 'Updates recent expense split in Gujarati.',
      },
    ],
  },
  {
    id: 'delete_expense',
    category: 'Delete Expense',
    icon: 'trash-outline',
    color: '#EF4444',
    description: 'Delete or cancel recent or named expenses from a trip with interactive confirmation.',
    howRecognized: 'Triggers on "delete", "remove", "cancel", "hata do", "kadhi nakh". Matches target from recent expenses.',
    commands: [
      {
        title: 'Delete latest expense',
        prompt: 'Delete my last expense',
        language: 'en',
        intent: 'Picks the latest entry, asks confirmation, and removes it upon confirm.',
      },
      {
        title: 'Delete by description',
        prompt: 'Delete the dinner expense from Goa trip',
        language: 'en',
        intent: 'Finds matching "Dinner" expense and deletes it.',
      },
      {
        title: 'Delete in Hindi',
        prompt: 'Mera aakhri kharcha delete karo',
        language: 'hi',
        intent: 'Cancels recent expense in Hindi.',
      },
      {
        title: 'Delete in Gujarati',
        prompt: 'Maro chhello kharch delete kar',
        language: 'gu',
        intent: 'Cancels recent expense in Gujarati.',
      },
    ],
  },
  {
    id: 'contact_split',
    category: 'Contact & Friend Splits',
    icon: 'people-outline',
    color: '#8B5CF6',
    description: 'Search device/saved contacts and start a 1-on-1 split (with or without initial expense).',
    howRecognized: 'Triggers when a person is mentioned with "contact", "friend", "split with [Person]". Searches phone contacts.',
    commands: [
      {
        title: 'Start split with contact',
        prompt: 'Start a split with Rohan from contacts',
        language: 'en',
        intent: 'Locates Rohan in device contacts and creates/opens 1-on-1 split trip.',
      },
      {
        title: 'Add expense with contact',
        prompt: 'Add 500 for lunch with Rohan from contacts',
        language: 'en',
        intent: 'Finds Rohan and immediately records ₹500 lunch split 50-50.',
      },
      {
        title: 'Split with contact in Hindi',
        prompt: 'Contacts me Rohan ke sath split shuru karo',
        language: 'hi',
        intent: 'Finds contact and starts 1-on-1 split in Hindi.',
      },
      {
        title: 'Split with contact in Gujarati',
        prompt: 'Contacts ma Rohan sathe split kar',
        language: 'gu',
        intent: 'Finds contact and starts 1-on-1 split in Gujarati.',
      },
    ],
  },
  {
    id: 'balances_debts',
    category: 'Balances & Debts',
    icon: 'wallet-outline',
    color: '#F59E0B',
    description: 'Check who owes you, how much you owe, pairwise debts, and overall net financial balances.',
    howRecognized: 'Triggers on "who owes", "balance", "debts", "how much do I owe", "kitne lene hai", "hisaab". Queries live balances store.',
    commands: [
      {
        title: 'Who owes me money',
        prompt: 'Who owes me money and what is my total balance?',
        language: 'en',
        intent: 'Summarizes all members who owe the user across trips and friends.',
      },
      {
        title: 'How much do I owe',
        prompt: 'How much do I owe across all trips?',
        language: 'en',
        intent: 'Calculates total pending debts payable by the user.',
      },
      {
        title: 'Balances in Hindi',
        prompt: 'Mujhe kis se kitne paise lene hai?',
        language: 'hi',
        intent: 'Speaks breakdown of who owes the user in Hindi.',
      },
      {
        title: 'Balances in Gujarati',
        prompt: 'Mane kona pase thi ketla rupiya leva na chhe?',
        language: 'gu',
        intent: 'Speaks net owed amounts in Gujarati.',
      },
    ],
  },
  {
    id: 'settle_up',
    category: 'Settle Up',
    icon: 'cash-outline',
    color: '#10B981',
    description: 'Record cash or UPI debt settlements between members.',
    howRecognized: 'Triggers on "settle", "settle up", "clear dues", "chuko kar", "hisaab clear". Emits settlement action.',
    commands: [
      {
        title: 'Settle with a member',
        prompt: 'Settle up with Rohan',
        language: 'en',
        intent: 'Prepares settlement transaction and prompts for confirmation.',
      },
      {
        title: 'Settle in Hindi',
        prompt: 'Rohan ka hisaab clear kar do',
        language: 'hi',
        intent: 'Records debt settlement in Hindi.',
      },
    ],
  },
  {
    id: 'navigation',
    category: 'App Navigation',
    icon: 'compass-outline',
    color: '#6366F1',
    description: 'Navigate to any tab or trip screen directly with voice.',
    howRecognized: 'Triggers on "go to", "open", "show", followed by screen or trip name. Navigates automatically.',
    commands: [
      {
        title: 'Open Analyser',
        prompt: 'Go to analyser tab',
        language: 'en',
        intent: 'Opens the Spending Analyser dashboard.',
      },
      {
        title: 'Open Friends',
        prompt: 'Open friends tab',
        language: 'en',
        intent: 'Navigates to the 1-on-1 Friends & Splits screen.',
      },
      {
        title: 'Open Profile',
        prompt: 'Show my profile settings',
        language: 'en',
        intent: 'Navigates to the Profile & Settings tab.',
      },
      {
        title: 'Open Trip',
        prompt: 'Open Goa trip',
        language: 'en',
        intent: 'Matches the trip by name and navigates to its feed screen.',
      },
    ],
  },
];

/**
 * Quick smart expense phrases in all 3 languages for instant 1-tap speech simulation
 */
export const SMART_VOICE_SUGGESTIONS: Record<
  VoiceLanguage,
  Array<{ label: string; text: string }>
> = {
  auto: [
    { label: '🍕 Dinner ₹850', text: 'Add 850 rupees for dinner in Goa trip paid by me' },
    { label: '👥 50-50 Split', text: 'Add 100 rupees in Goa trip split with me and Khushi 50-50' },
    { label: '✏️ Update 50-50', text: 'Update my last expense to split 50-50 with Khushi' },
    { label: '👥 Split with Rohan', text: 'Start a split with Rohan from contacts' },
    { label: '🗑️ Delete Expense', text: 'Delete my last expense' },
    { label: '💰 Who owes me?', text: 'Who owes me money and what is my total balance?' },
    { label: '🧭 Open Analyser', text: 'Go to analyser tab' },
  ],
  en: [
    { label: '🍕 Dinner ₹850', text: 'Add 850 rupees for dinner in Goa trip paid by me' },
    { label: '👥 50-50 Split', text: 'Add 100 rupees in Goa trip split with me and Khushi 50-50' },
    { label: '✏️ Update 50-50', text: 'Update my last expense to split 50-50 with Khushi' },
    { label: '👥 Split with Rohan', text: 'Start a split with Rohan from contacts' },
    { label: '🗑️ Delete Expense', text: 'Delete my last expense' },
    { label: '💰 Who owes me?', text: 'Who owes me money and what is my total balance?' },
    { label: '🧭 Open Analyser', text: 'Go to analyser tab' },
  ],
  hi: [
    { label: '🍛 खाना ₹750', text: 'Goa trip me 750 rupaye ka khana maine pay kiya sabhi members me split hoga' },
    { label: '👥 50-50 स्प्लिट', text: 'Goa trip me 100 rupaye Khushi aur mere me 50-50 split kar do' },
    { label: '✏️ अपडेट 50-50', text: 'Mera aakhri kharcha update karke Khushi aur mere me 50-50 kar do' },
    { label: '👥 रोहन से स्प्लिट', text: 'Contacts me Rohan ke sath split shuru karo' },
    { label: '🗑️ खर्चे डिलीट', text: 'Mera aakhri kharcha delete karo' },
    { label: '💰 हिसाब बताओ', text: 'Mujhe kis se kitne paise lene hai?' },
    { label: '🧭 एनालाइजर खोलो', text: 'Analyser tab par jao' },
  ],
  gu: [
    { label: '🍽️ જમવાનું ₹600', text: 'Jamvanu 600 rupiya me apya badha vache split kar' },
    { label: '👥 50-50 સ્પ્લિટ', text: 'Goa trip ma 100 rupiya Khushi ane mara vache 50-50 split kar' },
    { label: '✏️ અપડેટ 50-50', text: 'Chhello kharch badli ne 50-50 kar do' },
    { label: '👥 રોહન સાથે સ્પ્લિટ', text: 'Contacts ma Rohan sathe split shuru kar' },
    { label: '🗑️ ખર્ચ ડિલીટ', text: 'Maro chhello kharch delete kar' },
    { label: '💰 હિસાબ જણાવો', text: 'Mane kona pase thi ketla rupiya leva na chhe?' },
    { label: '🧭 એનાલાઈઝર ખોલો', text: 'Analyser tab open kar' },
  ],
};
