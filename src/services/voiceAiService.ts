import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { AppStorage } from '../lib/storage';
import { TripMember } from '../types/database';

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
  error?: 'NO_API_KEY' | 'EMPTY_AUDIO' | 'NETWORK_ERROR' | 'FAILED';
  message?: string;
  source?: 'groq' | 'huggingface' | 'wit_ai' | 'web_speech';
}

/**
 * Transcribes recorded audio with detailed status reporting
 */
export async function transcribeAudioWithDetails(
  audioUri: string,
  language: VoiceLanguage = 'auto'
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

    // 1. Tier 1: Groq Cloud Whisper API (Free & fastest multilingual transcription with auto language detection)
    const groqApiKey = (await getSavedGroqApiKey()) || process.env.EXPO_PUBLIC_GROQ_API_KEY;
    if (groqApiKey) {
      try {
        console.log('[voiceAiService] Uploading audio to Groq Whisper Large v3 (auto-detecting language)...');
        const parameters: Record<string, string> = {
          model: 'whisper-large-v3-turbo',
          response_format: 'json',
          temperature: '0.0',
          prompt: 'SplitYourTrip expense: rupees, ₹, dinner, lunch, petrol, taxi, hotel, paid by me, split with all',
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
          }
        );

        if (groqRes.status === 200 && groqRes.body) {
          const data = JSON.parse(groqRes.body);
          if (data?.text && typeof data.text === 'string' && data.text.trim().length > 0) {
            console.log('[voiceAiService] Groq transcription success:', data.text.trim());
            return { text: data.text.trim(), source: 'groq' };
          }
        } else {
          console.warn('[voiceAiService] Groq API error response:', groqRes.status, groqRes.body);
        }
      } catch (groqErr) {
        console.warn('[voiceAiService] Groq upload note:', groqErr);
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
  language: VoiceLanguage = 'en'
): Promise<string | null> {
  const res = await transcribeAudioWithDetails(audioUri, language);
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
- trip_id: matched trip ID from Trips, or ActiveTrip ID.
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

          if (splitAll || selectedParticipantIds.length <= 1) {
            splitAll = true;
            selectedParticipantIds.length = 0;
            tripMembers.forEach(m => selectedParticipantIds.push(m.id));
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

/**
 * Quick smart expense phrases in all 3 languages for instant 1-tap speech simulation
 */
export const SMART_VOICE_SUGGESTIONS: Record<
  VoiceLanguage,
  Array<{ label: string; text: string }>
> = {
  auto: [
    { label: '☕ Coffee ₹120', text: 'Add 120 rupees for coffee paid by me split with all' },
    { label: '🍕 Dinner ₹850', text: 'Dinner of 850 rupees in Goa trip paid by me' },
    { label: '🚕 Taxi ₹400', text: 'Taxi fare 400 rupees paid by me split with everyone' },
  ],
  en: [
    { label: '☕ Coffee ₹120', text: 'Add 120 rupees for coffee paid by me split with all' },
    { label: '🍕 Dinner ₹850', text: 'Dinner of 850 rupees in Goa trip paid by me' },
    { label: '🚕 Taxi ₹400', text: 'Taxi fare 400 rupees paid by me split with everyone' },
  ],
  hi: [
    { label: '☕ चाय ₹60', text: 'Chai nashta ka kharcha 60 rupaye maine bhara sabme baant do' },
    { label: '⛽ पेट्रोल ₹500', text: 'Petrol ka kharcha 500 rupaye maine pay kiya' },
    { label: '🍛 खाना ₹750', text: 'Goa trip me 750 rupaye ka khana maine pay kiya sabhi members me split hoga' },
  ],
  gu: [
    { label: '☕ ચા ₹50', text: 'Cha nasto no kharch 50 rupiya me chukvya badha ma split thase' },
    { label: '⛽ પેટ્રોલ ₹300', text: 'Petrol no kharch 300 rupiya me pay karyu' },
    { label: '🍽️ જમવાનું ₹600', text: 'Jamvanu 600 rupiya me apya badha vache split kar' },
  ],
};
