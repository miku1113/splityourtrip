import { Platform } from 'react-native';
import { AppStorage } from '../lib/storage';

let ExpoSpeech: any = null;
try {
  ExpoSpeech = require('expo-speech');
} catch (e) {
  // Graceful fallback if expo-speech is not yet linked or on unsupported environment
}

const TTS_PREF_KEY = '@splityourtrip_voice_tts_enabled';
let isTtsActive = true;
let isCurrentlySpeaking = false;

// Initialize saved preference
AppStorage.getItem(TTS_PREF_KEY)
  .then(val => {
    if (val !== null) {
      isTtsActive = val === 'true';
    }
  })
  .catch(() => {});

export function isTtsEnabled(): boolean {
  return isTtsActive;
}

export function isTtsSpeaking(): boolean {
  return isCurrentlySpeaking;
}

export function setTtsEnabled(enabled: boolean): void {
  isTtsActive = enabled;
  AppStorage.setItem(TTS_PREF_KEY, String(enabled)).catch(() => {});
  if (!enabled) {
    stopSpeaking();
  }
}

/**
 * Speaks a response aloud using native on-device TTS or Web Speech API
 */
export function speakAssistantReply(
  text: string,
  options?: {
    onDone?: () => void;
    onError?: (err: any) => void;
  }
): void {
  if (!isTtsActive || !text || !text.trim()) {
    isCurrentlySpeaking = false;
    options?.onDone?.();
    return;
  }

  isCurrentlySpeaking = true;

  const handleFinish = (callback?: () => void) => {
    isCurrentlySpeaking = false;
    callback?.();
  };

  const cleanText = text
    .replace(/[#*`_~]/g, '') // remove markdown symbols
    .replace(/₹/g, ' Rupees ')
    .trim();

  // 1. Web Speech Synthesis fallback
  if (Platform.OS === 'web' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = 'en-IN';
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      utterance.onend = () => handleFinish(options?.onDone);
      utterance.onerror = (e) => {
        handleFinish(() => options?.onError?.(e));
      };
      window.speechSynthesis.speak(utterance);
      return;
    } catch (e) {
      console.warn('[voiceTtsService] Web speech synthesis note:', e);
      handleFinish(options?.onDone);
      return;
    }
  }

  // 2. Native iOS & Android TTS via expo-speech
  if (ExpoSpeech?.speak) {
    try {
      ExpoSpeech.stop();
      ExpoSpeech.speak(cleanText, {
        language: 'en-IN',
        pitch: 1.0,
        rate: 1.0,
        onDone: () => {
          handleFinish(options?.onDone);
        },
        onError: (err: any) => {
          console.warn('[voiceTtsService] TTS speak error:', err);
          handleFinish(() => options?.onError?.(err));
        },
      });
      return;
    } catch (err) {
      console.warn('[voiceTtsService] ExpoSpeech error:', err);
      handleFinish(options?.onDone);
      return;
    }
  }

  handleFinish(options?.onDone);
}

/**
 * Immediately stops any currently speaking audio
 */
export function stopSpeaking(): void {
  isCurrentlySpeaking = false;
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (ExpoSpeech?.stop) {
      ExpoSpeech.stop();
    }
  } catch {}
}
