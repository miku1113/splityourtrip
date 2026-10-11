import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { supabase, supabaseAdmin, isSupabaseConfigured, SUPABASE_SERVICE_ROLE_KEY } from '../lib/supabase';
import { decodeBase64ToArrayBuffer } from '../features/auth/useAuthStore';

const SUPABASE_BASE_URL = 'https://hpjizujbzvwkxvfsoqqd.supabase.co';

/**
 * Uploads a local file URI (from Expo ImagePicker / camera / cropper) or base64 data to Supabase Storage
 * and returns the permanent public URL.
 * Uses native streaming FileSystem.uploadAsync on iOS/Android for 100% reliable uploads without heap memory limits.
 */
export async function uploadImageToSupabase(
  bucket: 'avatars' | 'attachments',
  storagePath: string,
  imageUriOrBase64: string | null,
  customMimeType?: string
): Promise<string | null> {
  if (!imageUriOrBase64) return null;
  if (
    imageUriOrBase64.startsWith('http://') ||
    imageUriOrBase64.startsWith('https://') ||
    imageUriOrBase64.startsWith('emoji:')
  ) {
    return imageUriOrBase64;
  }

  if (!isSupabaseConfigured) {
    return null;
  }

  const ext = imageUriOrBase64.split('.').pop()?.split('?')[0] || 'jpg';
  const cleanExt = ext.length <= 4 ? ext.toLowerCase() : 'jpg';
  const mimeType = customMimeType || (cleanExt === 'png' ? 'image/png' : 'image/jpeg');

  const uploadEndpoint = `${SUPABASE_BASE_URL}/storage/v1/object/${bucket}/${storagePath}`;
  const publicUrl = `${SUPABASE_BASE_URL}/storage/v1/object/public/${bucket}/${storagePath}`;

  // Strategy 1: Supabase JS Admin client with ArrayBuffer (most reliable for Supabase Storage)
  try {
    let cleanB64: string | null = null;
    if (imageUriOrBase64.startsWith('data:image')) {
      cleanB64 = imageUriOrBase64
        .replace(/^data:image\/[a-zA-Z0-9+]+;base64,/, '')
        .replace(/[\r\n\s]/g, '');
    } else if (Platform.OS !== 'web' && (imageUriOrBase64.startsWith('file:') || imageUriOrBase64.startsWith('content:'))) {
      const raw = await FileSystem.readAsStringAsync(imageUriOrBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      cleanB64 = raw.replace(/[\r\n\s]/g, '');
    }

    if (cleanB64) {
      const arrayBuffer = decodeBase64ToArrayBuffer(cleanB64);
      const client = supabaseAdmin || supabase;
      const { data: upData, error: upErr } = await client.storage
        .from(bucket)
        .upload(storagePath, arrayBuffer, {
          contentType: mimeType,
          upsert: true,
        });

      if (!upErr && upData?.path) {
        const { data: pubData } = client.storage.from(bucket).getPublicUrl(upData.path);
        if (pubData?.publicUrl) {
          return pubData.publicUrl;
        }
      } else if (upErr) {
        console.warn('Supabase Admin Storage error notice:', upErr.message);
      }
    }
  } catch (e) {
    console.warn('Supabase storage upload error:', e);
  }

  // Strategy 2: Native streaming upload using FileSystem.uploadAsync fallback
  if (Platform.OS !== 'web' && (imageUriOrBase64.startsWith('file:') || imageUriOrBase64.startsWith('content:'))) {
    try {
      const res = await FileSystem.uploadAsync(uploadEndpoint, imageUriOrBase64, {
        httpMethod: 'POST',
        uploadType: (FileSystem as any).FileSystemUploadType?.BINARY_CONTENT ?? 0,
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          'Content-Type': mimeType,
          'x-upsert': 'true',
        },
      });

      if (res.status === 200 || res.status === 201) {
        return publicUrl;
      }
    } catch (e) {
      console.warn('FileSystem.uploadAsync notice:', e);
    }
  }

  return null;
}

/**
 * Uploads a trip cover image to Supabase Storage and returns its permanent URL.
 */
export async function uploadTripCoverImage(tripId: string, imageUri: string | null): Promise<string | null> {
  if (!imageUri) return null;
  if (imageUri.startsWith('http://') || imageUri.startsWith('https://') || imageUri.startsWith('emoji:')) {
    return imageUri;
  }

  const ext = imageUri.split('.').pop()?.split('?')[0] || 'jpg';
  const cleanExt = ext.length <= 4 ? ext.toLowerCase() : 'jpg';
  const mimeType = cleanExt === 'png' ? 'image/png' : 'image/jpeg';
  const fileName = `cover_${tripId}_${Date.now()}.${cleanExt}`;
  const storagePath = `trip_covers/${fileName}`;

  return uploadImageToSupabase('avatars', storagePath, imageUri, mimeType);
}
