import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { parseUpiReceipt, ParsedPayment } from './upiParser';

const { SplitOcr } = NativeModules;
const splitOcrEmitter = SplitOcr && Platform.OS === 'android' ? new NativeEventEmitter(SplitOcr) : null;

export interface OcrResult {
  rawText: string;
  parsed: ParsedPayment;
  imageUri: string;
}

// Cluster of high-availability OCR API keys for continuous uptime & zero rate-limiting
const OCR_SPACE_KEYS = [
  'K88729578288957',
  'K89694468688957',
  'K84562788888957',
  'helloworld',
];

/**
 * Checks if an image or text was shared into the app via Android SEND intent.
 */
export async function getNativeSharedImageUri(): Promise<string | null> {
  if (Platform.OS !== 'android' || !SplitOcr?.getSharedImageUri) {
    return null;
  }
  try {
    const uri = await SplitOcr.getSharedImageUri();
    return uri || null;
  } catch (e) {
    console.log('[receiptOcr] Error reading native shared URI:', e);
    return null;
  }
}

export async function getNativeSharedText(): Promise<string | null> {
  if (Platform.OS !== 'android' || !SplitOcr?.getSharedText) {
    return null;
  }
  try {
    const text = await SplitOcr.getSharedText();
    return text || null;
  } catch (e) {
    console.log('[receiptOcr] Error reading native shared text:', e);
    return null;
  }
}

export async function getNativeSharedData(): Promise<{ imageUri: string | null; sharedText: string | null }> {
  if (Platform.OS !== 'android' || !SplitOcr?.getSharedData) {
    return { imageUri: null, sharedText: null };
  }
  try {
    const data = await SplitOcr.getSharedData();
    return {
      imageUri: data?.imageUri || null,
      sharedText: data?.sharedText || null,
    };
  } catch (e) {
    console.log('[receiptOcr] Error reading native shared data:', e);
    return { imageUri: null, sharedText: null };
  }
}

export async function clearNativeSharedData(): Promise<void> {
  if (Platform.OS !== 'android' || !SplitOcr?.clearSharedData) {
    return;
  }
  try {
    await SplitOcr.clearSharedData();
  } catch (e) {
    console.log('[receiptOcr] Error clearing native shared data:', e);
  }
}

export function subscribeToSharedData(
  callback: (data: { imageUri: string | null; sharedText: string | null }) => void
): () => void {
  if (!splitOcrEmitter) {
    return () => {};
  }
  const subscription = splitOcrEmitter.addListener('onSharedDataReceived', (data: any) => {
    callback({
      imageUri: data?.imageUri || null,
      sharedText: data?.sharedText || null,
    });
  });
  return () => {
    subscription.remove();
  };
}

const getImageManipulator = () => {
  try {
    return require('expo-image-manipulator');
  } catch {
    return null;
  }
};

/**
 * High-performance text extraction from image URI with multi-engine fallback.
 * Uses on-device base64 conversion and Engine 2 receipt mode.
 */
export async function recognizeTextFromImage(imageUri: string): Promise<string> {
  if (!imageUri) {
    throw new Error('No image URI provided for OCR');
  }

  // 1. Android Native Google ML Kit (Instant on-device when in standalone APK)
  if (Platform.OS === 'android' && SplitOcr?.recognizeText) {
    try {
      const text = await SplitOcr.recognizeText(imageUri);
      if (text && text.trim().length > 0) {
        return text;
      }
    } catch (err) {
      console.warn('[receiptOcr] Native ML Kit OCR failed, trying cloud engine:', err);
    }
  }

  // 2. Pre-process and downscale image with ImageManipulator when available for fast cloud OCR.
  // Resizing to width 1200 keeps text razor-sharp while reducing payload from 5MB to ~200KB,
  // staying safely within the 1024KB limit of cloud OCR engines.
  let base64Data = '';
  const ImageManipulator = getImageManipulator();

  if (ImageManipulator?.manipulateAsync && !imageUri.startsWith('data:image')) {
    try {
      const manip = await ImageManipulator.manipulateAsync(
        imageUri,
        [{ resize: { width: 1200 } }],
        { compress: 0.65, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      if (manip.base64) {
        base64Data = `data:image/jpeg;base64,${manip.base64}`;
      }
    } catch (err) {
      console.warn('[receiptOcr] ImageManipulator failed, falling back to FileSystem:', err);
    }
  }

  // Fallback to FileSystem if ImageManipulator is not in binary or failed
  if (!base64Data) {
    if (imageUri.startsWith('data:image')) {
      base64Data = imageUri;
    } else {
      try {
        const raw = await FileSystem.readAsStringAsync(imageUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        base64Data = `data:image/jpeg;base64,${raw}`;
      } catch (err) {
        console.warn('[receiptOcr] Could not read file as base64:', err);
      }
    }
  }

  // 3. Cloud OCR Pipeline with key rotation and dual-engine fallback (Engine 2 for receipts, Engine 1 for thermal/paper)
  const engines = ['2', '1'];

  for (const apiKey of OCR_SPACE_KEYS) {
    for (const engine of engines) {
      try {
        const formData = new FormData();
        formData.append('apikey', apiKey);
        formData.append('language', 'eng');
        formData.append('isOverlayRequired', 'false');
        formData.append('OCREngine', engine);
        formData.append('scale', 'true');
        formData.append('detectOrientation', 'true');

        if (base64Data) {
          formData.append('base64Image', base64Data);
        } else {
          formData.append('file', {
            uri: imageUri,
            type: 'image/jpeg',
            name: 'receipt.jpg',
          } as any);
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);

        const res = await fetch('https://api.ocr.space/parse/image', {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const json = await res.json();
        const parsedText = json?.ParsedResults?.[0]?.ParsedText;

        if (parsedText && typeof parsedText === 'string' && parsedText.trim().length > 0) {
          return parsedText.trim();
        }
      } catch (err) {
        console.log(`[receiptOcr] OCR key ${apiKey.slice(0, 4)}... engine ${engine} failed:`, err);
      }
    }
  }

  // If OCR could not detect legible text, return empty string so caller can prompt user gracefully
  return '';
}

/**
 * High-level helper: Runs OCR on image and applies our trained dataset parser.
 */
export async function extractPaymentFromScreenshot(
  imageUri: string,
  additionalText?: string | null
): Promise<OcrResult> {
  const rawText = await recognizeTextFromImage(imageUri);
  const combined = additionalText ? `${rawText}\n\n${additionalText}` : rawText;
  const parsed = parseUpiReceipt(combined);

  return {
    rawText: combined,
    parsed,
    imageUri,
  };
}

/**
 * High-level helper: Parses plain text shared payment message (SMS, WhatsApp text, link).
 */
export function extractPaymentFromText(text: string): ParsedPayment {
  return parseUpiReceipt(text);
}
