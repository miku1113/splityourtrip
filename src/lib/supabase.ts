import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = 'https://hpjizujbzvwkxvfsoqqd.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwaml6dWpienZ3a3h2ZnNvcXFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0Mjc2NzksImV4cCI6MjA5NDAwMzY3OX0.9sbvx4gqUiDc4Kz41KMXylUiQsLTSST2bPhIxfUqdgE';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;

export const isSupabaseConfigured =
  Boolean(supabaseUrl) &&
  Boolean(supabaseAnonKey) &&
  !supabaseUrl.includes('placeholder') &&
  !supabaseAnonKey.includes('placeholder');

const memoryStorage: Record<string, string> = {};

const SafeStorage = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      const val = await AsyncStorage.getItem(key);
      if (val !== null && val !== undefined) return val;
      return memoryStorage[key] || null;
    } catch (e) {
      return memoryStorage[key] || null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    memoryStorage[key] = value;
    try {
      await AsyncStorage.setItem(key, value);
    } catch (e) {
      // Memory fallback active
    }
  },
  removeItem: async (key: string): Promise<void> => {
    delete memoryStorage[key];
    try {
      await AsyncStorage.removeItem(key);
    } catch (e) {
      // Memory fallback active
    }
  },
};

import { Platform } from 'react-native';

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      storage: SafeStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === 'web',
    },
  }
);

export const SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwaml6dWpienZ3a3h2ZnNvcXFkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODQyNzY3OSwiZXhwIjoyMDk0MDAzNjc5fQ.OqoYiFvaX9Y1QnO-im008_Qag3raaEWRvLEuidXaMUc';

export const supabaseAdmin = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      storage: SafeStorage,
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);


