import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppStorage } from '../lib/storage';
import { darkColors, lightColors, theme } from './colors';

export type ThemeMode = 'dark' | 'light';

export interface ThemeTransitionOrigin {
  x: number;
  y: number;
}

interface ThemeState {
  themeMode: ThemeMode;
  hasChosenTheme: boolean;
  isHydrated: boolean;
  transitionMode: ThemeMode | null;
  transitionOrigin: ThemeTransitionOrigin | null;
  setThemeMode: (mode: ThemeMode, origin?: ThemeTransitionOrigin) => Promise<void>;
  requestThemeTransition: (mode: ThemeMode, origin?: ThemeTransitionOrigin) => void;
  finishThemeTransition: () => Promise<void>;
  completeThemeOnboarding: (mode?: ThemeMode) => Promise<void>;
  initTheme: () => Promise<void>;
}

export const THEME_STORAGE_KEY = '@splityourtrip_theme_mode';
export const THEME_ONBOARDED_KEY = '@splityourtrip_theme_onboarded';

export const useThemeStore = create<ThemeState>((set, get) => ({
  themeMode: 'dark', // Default to Dark Theme as requested
  hasChosenTheme: false,
  isHydrated: false,
  transitionMode: null,
  transitionOrigin: null,

  initTheme: async () => {
    try {
      const [savedMode, savedOnboarded] = await Promise.all([
        AppStorage.getItem(THEME_STORAGE_KEY).catch(() => AsyncStorage.getItem(THEME_STORAGE_KEY)),
        AppStorage.getItem(THEME_ONBOARDED_KEY).catch(() => AsyncStorage.getItem(THEME_ONBOARDED_KEY)),
      ]);

      const effectiveMode: ThemeMode =
        savedMode === 'light' || savedMode === 'dark' ? savedMode : 'dark';

      // If either the onboarded flag was set OR a mode preference was already saved,
      // consider theme preference permanently established.
      const hasChosen = savedOnboarded === 'true' || Boolean(savedMode);

      set({
        themeMode: effectiveMode,
        hasChosenTheme: hasChosen,
        isHydrated: true,
      });
    } catch {
      set({ isHydrated: true, hasChosenTheme: true });
    }
  },

  setThemeMode: async (mode: ThemeMode, origin?: ThemeTransitionOrigin) => {
    const finalMode: ThemeMode = mode === 'light' ? 'light' : 'dark';
    if (get().themeMode !== finalMode) {
      get().requestThemeTransition(finalMode, origin);
      return;
    }
    set({ themeMode: finalMode, hasChosenTheme: true });
    try {
      await Promise.all([
        AppStorage.setItem(THEME_STORAGE_KEY, finalMode),
        AppStorage.setItem(THEME_ONBOARDED_KEY, 'true'),
        AsyncStorage.setItem(THEME_STORAGE_KEY, finalMode).catch(() => {}),
        AsyncStorage.setItem(THEME_ONBOARDED_KEY, 'true').catch(() => {}),
      ]);
    } catch (e) {
      // Ignored
    }
  },

  requestThemeTransition: (mode: ThemeMode, origin?: ThemeTransitionOrigin) => {
    const state = get();
    if (state.transitionMode || state.themeMode === mode) return;
    set({ transitionMode: mode, transitionOrigin: origin || null });
  },

  finishThemeTransition: async () => {
    const mode = get().transitionMode || get().themeMode;
    set({ themeMode: mode, transitionMode: null, transitionOrigin: null, hasChosenTheme: true });
    try {
      await Promise.all([
        AppStorage.setItem(THEME_STORAGE_KEY, mode),
        AppStorage.setItem(THEME_ONBOARDED_KEY, 'true'),
        AsyncStorage.setItem(THEME_STORAGE_KEY, mode).catch(() => {}),
        AsyncStorage.setItem(THEME_ONBOARDED_KEY, 'true').catch(() => {}),
      ]);
    } catch {}
  },

  completeThemeOnboarding: async (mode?: ThemeMode) => {
    const finalMode: ThemeMode = mode || get().themeMode || 'dark';
    set({ themeMode: finalMode, hasChosenTheme: true });
    try {
      await Promise.all([
        AppStorage.setItem(THEME_STORAGE_KEY, finalMode),
        AppStorage.setItem(THEME_ONBOARDED_KEY, 'true'),
        AsyncStorage.setItem(THEME_STORAGE_KEY, finalMode).catch(() => {}),
        AsyncStorage.setItem(THEME_ONBOARDED_KEY, 'true').catch(() => {}),
      ]);
    } catch (e) {
      // Ignored
    }
  },
}));

// Run self-hydration immediately so preference is loaded before views mount
try {
  useThemeStore.getState().initTheme().catch(() => {});
} catch {}

// Convenience hook to access reactive theme colors anywhere
export function useTheme() {
  const {
    themeMode,
    hasChosenTheme,
    isHydrated,
    setThemeMode,
    requestThemeTransition,
    completeThemeOnboarding,
  } = useThemeStore();

  const isDark = themeMode === 'dark';
  const colors = isDark ? darkColors : lightColors;

  const toggleTheme = (origin?: ThemeTransitionOrigin) => {
    requestThemeTransition(isDark ? 'light' : 'dark', origin);
  };

  return {
    themeMode,
    isDark,
    colors,
    spacing: theme.spacing,
    borderRadius: theme.borderRadius,
    setThemeMode,
    toggleTheme,
    hasChosenTheme,
    isHydrated,
    completeThemeOnboarding,
  };
}
