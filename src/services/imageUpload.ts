import * as FileSystem from 'expo-file-system';
import { supabase, supabaseAdmin, isSupabaseConfigured } from '../lib/supabase';

/**
 * Uploads a local file URI (from Expo ImagePicker) to Supabase Storage
 * and returns the permanent public URL.
 * If the URI is already an HTTP URL or an emoji (e.g. "emoji:🌴"), returns it directly.
 */
export async function uploadTripCoverImage(tripId: string, imageUri: string | null): Promise<string | null> {
  if (!imageUri) return null;
  if (imageUri.startsWith('http://') || imageUri.startsWith('https://') || imageUri.startsWith('emoji:')) {
    return imageUri;
  }

  if (!isSupabaseConfigured) {
    return imageUri;
  }

  try {
    const ext = imageUri.split('.').pop()?.split('?')[0] || 'jpg';
    const cleanExt = ext.length <= 4 ? ext.toLowerCase() : 'jpg';
    const contentType = cleanExt === 'png' ? 'image/png' : 'image/jpeg';
    const storagePath = `trip_covers/${tripId}_${Date.now()}.${cleanExt}`;

    // Read file as base64 string
    const base64Data = await FileSystem.readAsStringAsync(imageUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // Convert base64 to Uint8Array / ArrayBuffer for reliable upload
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);

    const client = supabaseAdmin || supabase;
    const { data, error } = await client.storage
      .from('attachments')
      .upload(storagePath, byteArray.buffer, {
        contentType,
        upsert: true,
      });

    if (error) {
      console.warn('Storage upload error for trip cover:', error.message);
      return imageUri; // Fallback to local URI
    }

    if (data?.path) {
      const { data: pubData } = client.storage
        .from('attachments')
        .getPublicUrl(data.path);

      if (pubData?.publicUrl) {
        return pubData.publicUrl;
      }
    }
  } catch (err: any) {
    console.error('Failed to upload trip cover image:', err);
  }

  return imageUri;
}
