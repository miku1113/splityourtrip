import { create } from 'zustand';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { AppStorage } from '../../lib/storage';
import { supabase, supabaseAdmin, isSupabaseConfigured } from '../../lib/supabase';
import { Profile } from '../../types/database';
import { getUserCurrencyPreference, setUserCurrencyPreference } from '../../services/currency';

// Complete any auth session started in the browser
WebBrowser.maybeCompleteAuthSession();

// Helper to guard any promise with a fast timeout
const withTimeout = <T>(promise: PromiseLike<T>, ms = 6000): Promise<T> =>
  Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Request timed out. Please check your network and try again.')), ms)
    ),
  ]);

// Helpers to cleanly isolate and synchronize user data across accounts
const resetUserStores = () => {
  try {
    const { useTripStore } = require('../trips/useTripStore');
    useTripStore.getState().clearTripStore();
  } catch {}
  try {
    const { useContactsStore } = require('../contacts/useContactsStore');
    useContactsStore.getState().clearContacts();
  } catch {}
};

const syncUserData = async (userId: string) => {
  try {
    // Immediately fetch live profile (including avatar_url) from Supabase
    await useAuthStore.getState().fetchProfile(userId);
  } catch {}
  try {
    const { useTripStore } = require('../trips/useTripStore');
    const authState = useAuthStore.getState();
    const userPhone = authState.profile?.phone_number || (authState.user as any)?.phone || (authState.user as any)?.user_metadata?.phone_number;
    if (userPhone && userId) {
      await useTripStore.getState().claimUnlinkedSplits(userId, userPhone);
    }
    await useTripStore.getState().fetchTrips(userId);
  } catch {}
  try {
    const { useContactsStore } = require('../contacts/useContactsStore');
    useContactsStore.getState().initContacts(true);
  } catch {}
};

const isValidUUID = (str?: string | null): boolean => {
  if (!str) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
};

export function decodeBase64ToUint8Array(base64Str: string): Uint8Array {
  const clean = base64Str.replace(/^data:image\/[a-zA-Z]+;base64,/, '').trim();
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let bufferLength = Math.floor(clean.length * 0.75);
  if (clean.endsWith('==')) bufferLength -= 2;
  else if (clean.endsWith('=')) bufferLength -= 1;
  const bytes = new Uint8Array(bufferLength);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const encoded1 = chars.indexOf(clean[i]);
    const encoded2 = chars.indexOf(clean[i + 1]);
    const encoded3 = chars.indexOf(clean[i + 2]);
    const encoded4 = chars.indexOf(clean[i + 3]);
    bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
    if (encoded3 !== -1 && encoded3 !== 64) {
      bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
    }
    if (encoded4 !== -1 && encoded4 !== 64) {
      bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
    }
  }
  return bytes;
}

export function decodeBase64ToArrayBuffer(base64Str: string): ArrayBuffer {
  const bytes = decodeBase64ToUint8Array(base64Str);
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return ab;
}


function parseAuthUrlParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  if (!url) return params;

  try {
    // 1. Extract from query string (?...)
    const queryStart = url.indexOf('?');
    const hashStart = url.indexOf('#');

    if (queryStart !== -1) {
      const queryEnd = hashStart > queryStart ? hashStart : url.length;
      const queryString = url.slice(queryStart + 1, queryEnd);
      const searchParams = new URLSearchParams(queryString);
      searchParams.forEach((value, key) => {
        params[key] = value;
      });
    }

    // 2. Extract from hash fragment (#...)
    if (hashStart !== -1) {
      const hashString = url.slice(hashStart + 1);
      const hashParams = new URLSearchParams(hashString);
      hashParams.forEach((value, key) => {
        params[key] = value;
      });
    }
  } catch (e) {
    console.log('Error parsing auth URL params:', e);
  }

  return params;
}

interface AuthState {
  user: { id: string; email?: string } | null;
  profile: Profile | null;
  isLoading: boolean;
  isConfigured: boolean;
  initialize: () => Promise<void>;
  fetchProfile: (userId?: string) => Promise<Profile | null>;
  signInWithPassword: (email: string, password: string) => Promise<{ error: Error | null }>;
  sendPasswordResetEmail: (email: string) => Promise<{ error: Error | null }>;
  resetPasswordWithOtp: (email: string, otp: string, newPassword: string) => Promise<{ error: Error | null }>;
  signUpWithPassword: (
    email: string,
    password: string,
    fullName: string,
    phoneNumber?: string,
    currency?: string,
    country?: string
  ) => Promise<{ error: Error | null; sessionActive: boolean }>;
  signInWithGoogle: () => Promise<{ error: Error | null }>;
  handleAuthUrl: (url: string) => Promise<{ success: boolean; error: Error | null }>;
  verifyOtp: (email: string, token: string) => Promise<{ error: Error | null }>;
  resendVerification: (email: string) => Promise<{ error: Error | null }>;
  signInWithEmail: (email: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  updateProfile: (updates: {
    full_name?: string;
    name?: string;
    avatar_url?: string | null;
    upi_id?: string;
    phone_number?: string;
    currency?: string;
    country?: string;
  }) => Promise<{ error: Error | null }>;
  ensureProfile: (userId: string, nameFallback?: string) => Promise<Profile | null>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  profile: null,
  isLoading: true,
  isConfigured: isSupabaseConfigured,

  fetchProfile: async (userId?: string) => {
    try {
      const targetUserId = userId || get().user?.id || get().profile?.id;
      if (!targetUserId || !isValidUUID(targetUserId)) {
        return get().profile;
      }

      if (isSupabaseConfigured) {
        let profileRow: any = null;
        try {
          const { data } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', targetUserId)
            .maybeSingle();
          if (data) profileRow = data;
        } catch {}

        if (!profileRow) {
          try {
            const { data } = await supabaseAdmin
              .from('profiles')
              .select('*')
              .eq('id', targetUserId)
              .maybeSingle();
            if (data) profileRow = data;
          } catch {}
        }

        if (profileRow) {
          const resolvedCurrency = profileRow.currency || get().profile?.currency || 'INR';
          if (resolvedCurrency) {
            await setUserCurrencyPreference(resolvedCurrency);
          }

          const updatedProfile: Profile = {
            id: targetUserId,
            full_name: profileRow.full_name || profileRow.name || get().profile?.full_name || 'Traveler',
            name: profileRow.name || profileRow.full_name || get().profile?.name || 'Traveler',
            avatar_url: profileRow.avatar_url || null,
            phone_number: profileRow.phone_number || null,
            currency: resolvedCurrency,
            country: profileRow.country || get().profile?.country || 'India',
            upi_id: profileRow.upi_id || '',
            created_at: profileRow.created_at,
            updated_at: profileRow.updated_at,
          };

          try {
            await AppStorage.setItem(`@splityourtrip_user_profile_${targetUserId}`, JSON.stringify(updatedProfile));
            await AppStorage.setItem(
              '@splityourtrip_last_active_profile',
              JSON.stringify({ ...updatedProfile, email: get().user?.email })
            );
          } catch {}

          set({ profile: updatedProfile });
          return updatedProfile;
        }
      }

      return get().profile;
    } catch (e) {
      console.warn('fetchProfile notice:', e);
      return get().profile;
    }
  },

  ensureProfile: async (userId: string, nameFallback?: string) => {
    try {
      // 0. Check cached local profile first
      let cachedProfile: Profile | null = null;
      try {
        const raw = await AppStorage.getItem(`@splityourtrip_user_profile_${userId}`);
        if (raw) {
          cachedProfile = JSON.parse(raw);
        }
      } catch {}

      // 1. Fetch live record in profiles table
      let dbProfile: any = null;
      if (isSupabaseConfigured && isValidUUID(userId)) {
        try {
          const { data } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .maybeSingle();
          if (data) dbProfile = data;
        } catch {}

        if (!dbProfile) {
          try {
            const { data } = await supabaseAdmin
              .from('profiles')
              .select('*')
              .eq('id', userId)
              .maybeSingle();
            if (data) dbProfile = data;
          } catch {}
        }
      }

      // 2. Fetch user metadata from active auth user session ONLY if dbProfile was not found in database
      let metaName = nameFallback;
      let metaAvatar: string | null = null;
      let metaPhone: string | null = null;
      let metaCurrency: string | null = null;

      if (!dbProfile) {
        try {
          const { data: authData } = await supabase.auth.getUser();
          if (authData?.user) {
            metaName =
              authData.user.user_metadata?.full_name ||
              authData.user.user_metadata?.name ||
              metaName ||
              authData.user.email?.split('@')[0];
            metaAvatar = authData.user.user_metadata?.avatar_url || authData.user.user_metadata?.picture || null;
            metaPhone = authData.user.user_metadata?.phone_number || authData.user.phone || null;
            metaCurrency = authData.user.user_metadata?.currency || null;
          }
        } catch (e) {}
      }

      const resolvedName =
        dbProfile?.full_name ||
        dbProfile?.name ||
        cachedProfile?.full_name ||
        cachedProfile?.name ||
        metaName ||
        'Traveler';

      let resolvedAvatar =
        (dbProfile?.avatar_url && dbProfile.avatar_url.trim() !== '')
          ? dbProfile.avatar_url
          : (cachedProfile?.avatar_url && cachedProfile.avatar_url.trim() !== '')
          ? cachedProfile.avatar_url
          : metaAvatar || null;

      if (resolvedAvatar && (resolvedAvatar.startsWith('file:') || resolvedAvatar.startsWith('content:'))) {
        if (dbProfile?.avatar_url && dbProfile.avatar_url.startsWith('http')) {
          resolvedAvatar = dbProfile.avatar_url;
        } else if (metaAvatar && (metaAvatar.startsWith('http') || metaAvatar.startsWith('data:'))) {
          resolvedAvatar = metaAvatar;
        }
      }

      const resolvedPhone =
        (dbProfile?.phone_number !== undefined && dbProfile?.phone_number !== null)
          ? dbProfile.phone_number
          : (cachedProfile?.phone_number !== undefined && cachedProfile?.phone_number !== null)
          ? cachedProfile.phone_number
          : metaPhone || null;

      const resolvedCurrency =
        dbProfile?.currency ||
        cachedProfile?.currency ||
        metaCurrency ||
        (await getUserCurrencyPreference()) ||
        'INR';

      const resolvedUpiId =
        (dbProfile?.upi_id !== undefined && dbProfile?.upi_id !== null)
          ? dbProfile.upi_id
          : cachedProfile?.upi_id || '';

      const resolvedCountry =
        dbProfile?.country ||
        cachedProfile?.country ||
        'India';

      if (resolvedCurrency) {
        await setUserCurrencyPreference(resolvedCurrency);
      }

      // ONLY insert if the profile does not exist in DB yet!
      // NEVER overwrite an existing profile during read!
      if (isSupabaseConfigured && isValidUUID(userId) && !dbProfile) {
        try {
          await supabase.from('profiles').insert({
            id: userId,
            full_name: resolvedName,
            name: resolvedName,
            avatar_url: resolvedAvatar,
            phone_number: resolvedPhone,
            currency: resolvedCurrency,
            country: resolvedCountry,
            upi_id: resolvedUpiId,
          });
        } catch (e) {
          console.log('Initial profile insert notice:', e);
        }
      }

      const enriched: Profile = {
        id: userId,
        full_name: resolvedName,
        name: resolvedName,
        avatar_url: resolvedAvatar,
        phone_number: resolvedPhone,
        currency: resolvedCurrency,
        country: resolvedCountry,
        upi_id: resolvedUpiId,
        created_at: dbProfile?.created_at || cachedProfile?.created_at,
        updated_at: dbProfile?.updated_at || cachedProfile?.updated_at,
      };

      try {
        await AppStorage.setItem(`@splityourtrip_user_profile_${userId}`, JSON.stringify(enriched));
        await AppStorage.setItem(
          '@splityourtrip_last_active_profile',
          JSON.stringify({ ...enriched, email: get().user?.email })
        );
      } catch {}

      return enriched;
    } catch (e) {
      console.warn('ensureProfile warning:', e);
      return { id: userId, full_name: nameFallback || 'Traveler', name: nameFallback || 'Traveler', avatar_url: null };
    }
  },

  initialize: async () => {
    if (!isSupabaseConfigured) {
      set({ isLoading: false, isConfigured: false });
      return;
    }

    try {
      // 1. Restore last known profile from local storage immediately so UI is populated with zero latency
      try {
        const lastProfileRaw = await AppStorage.getItem('@splityourtrip_last_active_profile');
        if (lastProfileRaw) {
          const cached = JSON.parse(lastProfileRaw);
          if (cached?.id && isValidUUID(cached.id)) {
            set({
              user: { id: cached.id, email: cached.email } as any,
              profile: cached,
              isLoading: false,
            });
            const { useTripStore } = require('../trips/useTripStore');
            useTripStore.getState().fetchTrips(cached.id);
          }
        }
      } catch {}

      // 2. Fetch live session from Supabase
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const profile = await get().ensureProfile(
          session.user.id,
          session.user.user_metadata?.full_name ||
          session.user.user_metadata?.name ||
          session.user.email?.split('@')[0]
        );

        set({
          user: session.user,
          profile,
          isLoading: false,
        });

        // Immediately fetch full profile with avatar from Supabase
        get().fetchProfile(session.user.id).catch(() => {});

        // Trigger background data & trips fetch immediately on cold start (non-blocking)
        syncUserData(session.user.id).catch(() => {});
      } else {
        if (!get().profile) {
          set({ user: null, profile: null, isLoading: false });
        } else {
          set({ isLoading: false });
        }
      }

      // Listen to auth changes - ONLY reset when explicitly signed out!
      supabase.auth.onAuthStateChange(async (event, session) => {
        const prevUser = get().user;
        const newUser = session?.user;

        if (event === 'SIGNED_OUT') {
          resetUserStores();
          try {
            await AppStorage.removeItem('@splityourtrip_last_active_profile');
          } catch {}
          set({ user: null, profile: null, isLoading: false });
          return;
        }

        if (newUser) {
          if (!prevUser || prevUser.id !== newUser.id) {
            resetUserStores();
          }

          const existingProfile = get().profile;
          const fallbackName =
            newUser.user_metadata?.full_name ||
            newUser.user_metadata?.name ||
            newUser.email?.split('@')[0] ||
            'Traveler';

          const immediateProfile: Profile =
            existingProfile && existingProfile.id === newUser.id
              ? existingProfile
              : {
                  id: newUser.id,
                  full_name: fallbackName,
                  name: fallbackName,
                  avatar_url: null,
                };

          set({
            user: newUser,
            profile: immediateProfile,
            isLoading: false,
          });

          // Background non-blocking sync
          get().ensureProfile(newUser.id, fallbackName).then(enriched => {
            if (enriched) set({ profile: enriched });
          }).catch(() => {});
          syncUserData(newUser.id).catch(() => {});
        }
      });

      // Check initial deep link URL if app was opened via redirect from cold start
      try {
        const initialUrl = await Linking.getInitialURL();
        if (initialUrl && initialUrl.startsWith('splityourtrip:')) {
          await get().handleAuthUrl(initialUrl);
        }
      } catch (e) {
        console.log('Initial URL check notice:', e);
      }

      // Also listen to incoming deep links while app is active
      Linking.addEventListener('url', async event => {
        if (event.url && event.url.startsWith('splityourtrip:')) {
          await get().handleAuthUrl(event.url);
        }
      });
    } catch {
      set({ isLoading: false });
    }
  },

  signInWithPassword: async (email: string, password: string) => {
    if (!isSupabaseConfigured) {
      return { error: new Error('Supabase is not configured yet.') };
    }
    const cleanEmail = email.trim().toLowerCase();
    let res: any;
    try {
      res = await withTimeout(
        supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        }),
        8000
      );
    } catch (e: any) {
      return { error: new Error(e?.message || 'Login request timed out. Please check your connection.') };
    }

    const { data, error } = res;
    if (error) {
      return { error: new Error(error.message) };
    }

    if (data?.user) {
      const prevUser = get().user;
      if (!prevUser || prevUser.id !== data.user.id) {
        resetUserStores();
      }

      let quickProfile: Profile | null = null;
      try {
        const raw = await AppStorage.getItem(`@splityourtrip_user_profile_${data.user.id}`);
        if (raw) quickProfile = JSON.parse(raw);
      } catch {}

      const fallbackName =
        data.user.user_metadata?.full_name ||
        data.user.user_metadata?.name ||
        data.user.email?.split('@')[0] ||
        'Traveler';

      const initialProfile = quickProfile || {
        id: data.user.id,
        full_name: fallbackName,
        name: fallbackName,
        avatar_url: null,
      };

      set({ user: data.user, profile: initialProfile, isLoading: false });

      // Background non-blocking sync
      get().ensureProfile(data.user.id, fallbackName).catch(() => {});
      syncUserData(data.user.id).catch(() => {});
    }

    return { error: null };
  },

  sendPasswordResetEmail: async (email: string) => {
    if (!isSupabaseConfigured) {
      return { error: new Error('Supabase is not configured yet.') };
    }
    const cleanEmail = email.trim().toLowerCase();
    try {
      const { error } = await withTimeout(
        supabase.auth.resetPasswordForEmail(cleanEmail),
        7000
      );
      if (error) {
        return { error: new Error(error.message) };
      }
      return { error: null };
    } catch (e: any) {
      return { error: new Error(e?.message || 'Failed to send recovery email. Please check your connection.') };
    }
  },

  resetPasswordWithOtp: async (email: string, otp: string, newPassword: string) => {
    if (!isSupabaseConfigured) {
      return { error: new Error('Supabase is not configured yet.') };
    }
    const cleanEmail = email.trim().toLowerCase();
    try {
      // 1. Verify OTP with recovery type
      const { data, error: verifyError } = await withTimeout(
        supabase.auth.verifyOtp({
          email: cleanEmail,
          token: otp.trim(),
          type: 'recovery',
        }),
        7000
      );

      if (verifyError) {
        return { error: new Error(verifyError.message) };
      }

      // 2. Session is now active, update user password
      const { error: updateError } = await withTimeout(
        supabase.auth.updateUser({
          password: newPassword,
        }),
        7000
      );

      if (updateError) {
        return { error: new Error(updateError.message) };
      }

      if (data?.user) {
        const fallbackName =
          data.user.user_metadata?.full_name ||
          data.user.user_metadata?.name ||
          data.user.email?.split('@')[0] ||
          'Traveler';

        set({
          user: data.user,
          profile: {
            id: data.user.id,
            full_name: fallbackName,
            name: fallbackName,
            avatar_url: null,
          },
          isLoading: false,
        });

        get().ensureProfile(data.user.id, fallbackName).catch(() => {});
        syncUserData(data.user.id).catch(() => {});
      }

      return { error: null };
    } catch (e: any) {
      return { error: new Error(e?.message || 'Password reset failed. Please check your code and try again.') };
    }
  },

  signUpWithPassword: async (
    email: string,
    password: string,
    fullName: string,
    phoneNumber?: string,
    currency?: string,
    country?: string
  ) => {
    if (!isSupabaseConfigured) {
      return { error: new Error('Supabase is not configured yet.'), sessionActive: false };
    }

    if (currency) {
      await setUserCurrencyPreference(currency);
    }

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: fullName.trim(),
          name: fullName.trim(),
          phone_number: phoneNumber?.trim() || null,
          currency: currency || 'INR',
          country: country || 'India',
        },
      },
    });

    if (error) {
      return { error: new Error(error.message), sessionActive: false };
    }

    if (data?.user && data.user.identities && data.user.identities.length === 0) {
      return {
        error: new Error('An account with this email already exists. Please switch to "Sign In" and enter your password.'),
        sessionActive: false,
      };
    }

    if (data?.session && data?.user) {
      const prevUser = get().user;
      if (!prevUser || prevUser.id !== data.user.id) {
        resetUserStores();
      }
      const profile = await get().ensureProfile(data.user.id, fullName);
      set({ user: data.user, profile, isLoading: false });
      syncUserData(data.user.id).catch(() => {});
      return { error: null, sessionActive: true };
    }

    return { error: null, sessionActive: false };
  },

  handleAuthUrl: async (url: string) => {
    if (!url) return { success: false, error: new Error('Empty redirect URL') };

    const params = parseAuthUrlParams(url);

    if (params.error || params.error_description) {
      const msg = params.error_description || params.error || 'Authentication failed';
      return { success: false, error: new Error(decodeURIComponent(msg.replace(/\+/g, ' '))) };
    }

    // 1. PKCE Authorization Code Exchange
    if (params.code) {
      const { data: exData, error: exError } = await supabase.auth.exchangeCodeForSession(params.code);
      if (exError) return { success: false, error: new Error(exError.message) };
      if (exData?.user) {
        const prevUser = get().user;
        if (!prevUser || prevUser.id !== exData.user.id) {
          resetUserStores();
        }
        const profile = await get().ensureProfile(
          exData.user.id,
          exData.user.user_metadata?.full_name || exData.user.user_metadata?.name
        );
        set({ user: exData.user, profile, isLoading: false });
        syncUserData(exData.user.id).catch(() => {});
        return { success: true, error: null };
      }
    }

    // 2. Direct Token Set (Implicit Flow)
    if (params.access_token) {
      const { data: sData, error: sError } = await supabase.auth.setSession({
        access_token: params.access_token,
        refresh_token: params.refresh_token || '',
      });
      if (sError) return { success: false, error: new Error(sError.message) };
      if (sData?.user) {
        const prevUser = get().user;
        if (!prevUser || prevUser.id !== sData.user.id) {
          resetUserStores();
        }
        const profile = await get().ensureProfile(
          sData.user.id,
          sData.user.user_metadata?.full_name || sData.user.user_metadata?.name
        );
        set({ user: sData.user, profile, isLoading: false });
        syncUserData(sData.user.id).catch(() => {});
        return { success: true, error: null };
      }
    }

    return { success: false, error: new Error('No authentication tokens found in redirect URL') };
  },

  signInWithGoogle: async () => {
    if (!isSupabaseConfigured) {
      return { error: new Error('Supabase is not configured yet.') };
    }

    try {
      const redirectUrl = 'splityourtrip://';

      if (Platform.OS === 'web') {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: window.location.origin,
          },
        });
        if (error) return { error: new Error(error.message) };
        return { error: null };
      }

      // Mobile (iOS/Android): Use WebBrowser with PKCE and Implicit fallback
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: true,
        },
      });

      if (error) return { error: new Error(error.message) };
      if (!data?.url) return { error: new Error('Could not generate Google sign-in URL.') };

      // Set up deep link listener in case Android handles the redirect via native Intent
      let capturedUrl: string | null = null;
      const urlSubscription = Linking.addEventListener('url', event => {
        if (event.url && event.url.startsWith('splityourtrip:')) {
          capturedUrl = event.url;
          try {
            WebBrowser.dismissBrowser();
          } catch {}
        }
      });

      try {
        const res = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);

        let finalUrl = res.type === 'success' && res.url ? res.url : capturedUrl;

        // If not received yet and custom tab dismissed, wait briefly for any queued intent
        if (!finalUrl && res.type === 'dismiss') {
          await new Promise(resolve => setTimeout(resolve, 800));
          finalUrl = capturedUrl;
        }

        if (finalUrl) {
          const authRes = await get().handleAuthUrl(finalUrl);
          if (authRes.error) return { error: authRes.error };
          return { error: null };
        }

        if (res.type === 'cancel' || res.type === 'dismiss') {
          return { error: new Error('Google Sign-In was cancelled') };
        }

        return { error: new Error('Could not complete Google Sign-In') };
      } finally {
        urlSubscription.remove();
      }
    } catch (err: any) {
      return { error: new Error(err?.message || 'Google Sign-In failed') };
    }
  },

  verifyOtp: async (email: string, token: string) => {
    if (!isSupabaseConfigured) {
      return { error: new Error('Supabase is not configured yet.') };
    }

    const { data, error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: token.trim(),
      type: 'signup',
    });

    if (error) {
      // Also try 'email' type if signup type failed
      const retry = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: token.trim(),
        type: 'email',
      });
      if (retry.error) {
        return { error: new Error(retry.error.message) };
      }
      if (retry.data?.user) {
        const prevUser = get().user;
        if (!prevUser || prevUser.id !== retry.data.user.id) {
          resetUserStores();
        }
        const profile = await get().ensureProfile(
          retry.data.user.id,
          retry.data.user.user_metadata?.full_name || retry.data.user.user_metadata?.name
        );
        set({ user: retry.data.user, profile, isLoading: false });
        syncUserData(retry.data.user.id).catch(() => {});
        return { error: null };
      }
    }

    if (data?.user) {
      const prevUser = get().user;
      if (!prevUser || prevUser.id !== data.user.id) {
        resetUserStores();
      }
      const profile = await get().ensureProfile(
        data.user.id,
        data.user.user_metadata?.full_name || data.user.user_metadata?.name
      );
      set({ user: data.user, profile, isLoading: false });
      syncUserData(data.user.id).catch(() => {});
    }

    return { error: null };
  },

  resendVerification: async (email: string) => {
    if (!isSupabaseConfigured) {
      return { error: new Error('Supabase is not configured yet.') };
    }
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
    });
    return { error: error ? new Error(error.message) : null };
  },

  signInWithEmail: async (email: string) => {
    if (!isSupabaseConfigured) {
      return { error: new Error('Supabase is not configured yet.') };
    }
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: true,
      },
    });
    return { error: error ? new Error(error.message) : null };
  },

  signOut: async () => {
    resetUserStores();
    try {
      await AppStorage.removeItem('@splityourtrip_local_trips');
      await AppStorage.removeItem('@splityourtrip_cached_contacts');
    } catch {}
    if (isSupabaseConfigured) {
      try {
        await supabase.auth.signOut();
      } catch (e) {
        console.warn('Sign out error:', e);
      }
    }
    set({ user: null, profile: null });
  },

  updateProfile: async updates => {
    let authUser = get().user;
    if (!authUser?.id) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          authUser = session.user;
          set({ user: session.user });
        }
      } catch {}
    }

    const currentProf = get().profile;
    const effectiveUserId =
      authUser?.id && isValidUUID(authUser.id)
        ? authUser.id
        : currentProf?.id && isValidUUID(currentProf.id)
        ? currentProf.id
        : 'guest-user';

    const newName = (updates.full_name || updates.name || currentProf?.name || currentProf?.full_name || 'Traveler').trim();
    const newPhone = updates.phone_number !== undefined ? updates.phone_number.trim() : (currentProf?.phone_number || '');
    const newCurrency = updates.currency || currentProf?.currency || 'INR';
    const newAvatar = updates.avatar_url !== undefined ? updates.avatar_url : (currentProf?.avatar_url || null);
    const newUpi = updates.upi_id !== undefined ? updates.upi_id.trim() : (currentProf?.upi_id || '');
    const newCountry = updates.country !== undefined ? updates.country : (currentProf?.country || '');

    if (newCurrency) {
      await setUserCurrencyPreference(newCurrency);
    }

    let cloudAvatar = newAvatar;

    // Remote sync to Supabase (explicitly awaited for reliable persistence)
    if (isSupabaseConfigured && isValidUUID(effectiveUserId)) {
      // 1. Storage upload if base64 or file
      if (newAvatar && newAvatar.startsWith('data:image')) {
        try {
          const ext = newAvatar.includes('image/png') ? 'png' : 'jpg';
          const fileName = `${effectiveUserId}/avatar_${Date.now()}.${ext}`;
          const arrayBuffer = decodeBase64ToArrayBuffer(newAvatar);

          const { data: uploadData, error: uploadErr } = await supabaseAdmin.storage
            .from('avatars')
            .upload(fileName, arrayBuffer, {
              contentType: ext === 'png' ? 'image/png' : 'image/jpeg',
              upsert: true,
            });

          if (!uploadErr && uploadData?.path) {
            const { data: pubData } = supabaseAdmin.storage
              .from('avatars')
              .getPublicUrl(uploadData.path);
            if (pubData?.publicUrl) {
              cloudAvatar = pubData.publicUrl;
            }
          } else if (uploadErr) {
            console.error('Avatar base64 upload error:', uploadErr.message);
          }
        } catch (uploadErr) {
          console.error('Avatar base64 storage error:', uploadErr);
        }
      } else if (newAvatar && (newAvatar.startsWith('file:') || newAvatar.startsWith('content:'))) {
        try {
          const ext = newAvatar.split('.').pop()?.split('?')[0] || 'jpg';
          const fileName = `${effectiveUserId}/avatar_${Date.now()}.${ext.length <= 4 ? ext : 'jpg'}`;
          const formData = new FormData();
          formData.append('file', {
            uri: newAvatar,
            name: `avatar.${ext}`,
            type: `image/${ext === 'png' ? 'png' : 'jpeg'}`,
          } as any);

          const { data: uploadData, error: uploadErr } = await supabaseAdmin.storage
            .from('avatars')
            .upload(fileName, formData, {
              contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}`,
              upsert: true,
            });

          if (!uploadErr && uploadData?.path) {
            const { data: pubData } = supabaseAdmin.storage
              .from('avatars')
              .getPublicUrl(uploadData.path);
            if (pubData?.publicUrl) {
              cloudAvatar = pubData.publicUrl;
            }
          }
        } catch (uploadErr) {
          console.error('Avatar storage upload error:', uploadErr);
        }
      }

      const dbAvatar = (cloudAvatar && cloudAvatar.startsWith('data:image'))
        ? (currentProf?.avatar_url && !currentProf?.avatar_url?.startsWith('data:image') ? currentProf?.avatar_url : null)
        : cloudAvatar;

      // 2. Direct upsert to Supabase profiles table
      try {
        const payload = {
          id: effectiveUserId,
          full_name: newName,
          name: newName,
          avatar_url: dbAvatar,
          phone_number: newPhone,
          currency: newCurrency,
          country: newCountry,
          upi_id: newUpi,
          updated_at: new Date().toISOString(),
        };

        const { error: dbErr } = await supabaseAdmin
          .from('profiles')
          .upsert(payload, { onConflict: 'id' });

        if (dbErr) {
          console.error('Database profiles update error (admin):', dbErr.message);
          const { error: userErr } = await supabase
            .from('profiles')
            .upsert(payload, { onConflict: 'id' });
          if (userErr) {
            return { error: new Error(userErr.message || dbErr.message) };
          }
        }
      } catch (dbErr: any) {
        console.error('Database profiles update notice:', dbErr?.message);
        return { error: new Error(dbErr?.message || 'Failed to update database profile') };
      }

      // 3. Auth user metadata update & trips sync in background (non-blocking)
      (async () => {
        try {
          await supabase.auth.updateUser({
            data: {
              full_name: newName,
              name: newName,
              phone_number: newPhone,
              currency: newCurrency,
              country: newCountry,
              upi_id: newUpi,
              avatar_url: dbAvatar,
            },
          });
        } catch (authErr) {
          console.log('Auth user metadata update notice:', authErr);
        }

        if (newPhone) {
          try {
            const { useTripStore } = require('../trips/useTripStore');
            await useTripStore.getState().claimUnlinkedSplits(effectiveUserId, newPhone);
            await useTripStore.getState().fetchTrips(effectiveUserId);
          } catch {}
        }
      })();
    }

    const finalProfile: Profile = {
      ...(currentProf || { id: effectiveUserId, avatar_url: null }),
      ...updates,
      id: effectiveUserId,
      full_name: newName,
      name: newName,
      phone_number: newPhone,
      currency: newCurrency,
      avatar_url: cloudAvatar,
      upi_id: newUpi,
      country: newCountry,
      updated_at: new Date().toISOString(),
    };

    set({ profile: finalProfile });

    try {
      await AppStorage.setItem(
        `@splityourtrip_user_profile_${effectiveUserId}`,
        JSON.stringify(finalProfile)
      );
      await AppStorage.setItem(
        '@splityourtrip_last_active_profile',
        JSON.stringify(finalProfile)
      );
      if (effectiveUserId === 'guest-user') {
        await AppStorage.setItem('@splityourtrip_user_profile_guest', JSON.stringify(finalProfile));
      }
    } catch {}

    return { error: null };
  },
}));
