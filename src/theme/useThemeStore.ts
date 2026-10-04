import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { darkColors, lightColors, theme } from './colors';

export type ThemeMode = 'dark' | 'light';

interface ThemeState {
  themeMode: ThemeMode;
  hasChosenTheme: boolean;
  isHydrated: boolean;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  completeThemeOnboarding: (mode?: ThemeMode) => Promise<void>;
  initTheme: () => Promise<void>;
}

const THEME_STORAGE_KEY = '@splityourtrip_theme_mode';
const THEME_ONBOARDED_KEY = '@splityourtrip_theme_onboarded';

export const useThemeStore = create<ThemeState>((set, get) => ({
  themeMode: 'dark', // Default to Dark Theme as requested
  hasChosenTheme: false,
  isHydrated: false,

  initTheme: async () => {
    try {
      const [savedMode, savedOnboarded] = await Promise.all([
        AsyncStorage.getItem(THEME_STORAGE_KEY),
        AsyncStorage.getItem(THEME_ONBOARDED_KEY),
      ]);

      set({
        themeMode: (savedMode as ThemeMode) || 'dark',
        hasChosenTheme: savedOnboarded === 'true',
        isHydrated: true,
      });
    } catch {
      set({ isHydrated: true });
    }
  },

  setThemeMode: async (mode: ThemeMode) => {
    set({ themeMode: mode });
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch (e) {
      // Ignored
    }
  },

  completeThemeOnboarding: async (mode?: ThemeMode) => {
    const finalMode = mode || get().themeMode || 'dark';
    try {
      await Promise.all([
        AsyncStorage.setItem(THEME_STORAGE_KEY, finalMode),
        AsyncStorage.setItem(THEME_ONBOARDED_KEY, 'true'),
      ]);
    } catch (e) {
      // Ignored
    }
    set({ themeMode: finalMode, hasChosenTheme: true });
  },
}));

// Convenience hook to access reactive theme colors anywhere
export function useTheme() {
  const {
    themeMode,
    hasChosenTheme,
    isHydrated,
    setThemeMode,
    completeThemeOnboarding,
  } = useThemeStore();

  const isDark = themeMode === 'dark';
  const colors = isDark ? darkColors : lightColors;

  const toggleTheme = () => {
    setThemeMode(isDark ? 'light' : 'dark');
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
