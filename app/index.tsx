import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Animated,
  StatusBar,
  TouchableOpacity,
  Platform,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, usePathname } from 'expo-router';
import { useAuthStore } from '../src/features/auth/useAuthStore';
import { useTripStore } from '../src/features/trips/useTripStore';
import { useTheme, ThemeMode } from '../src/theme/useThemeStore';

export default function SplashScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { user, isLoading: authLoading } = useAuthStore();
  const fetchTrips = useTripStore(state => state.fetchTrips);
  const initTrips = useTripStore(state => state.initTrips);
  const { colors, isDark, themeMode, hasChosenTheme, completeThemeOnboarding, isHydrated } = useTheme();

  const [selectedMode, setSelectedMode] = useState<ThemeMode>(themeMode || 'dark');
  const [showThemePrompt, setShowThemePrompt] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  const navigatingRef = useRef(false);
  const splashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const isExternalSource = (url: string | null) => {
    if (!url) return false;
    const clean = url.toLowerCase();
    return (
      clean.includes('shared-payment') ||
      clean.includes('join/') ||
      clean.includes('trip/') ||
      clean.includes('chat/') ||
      clean.includes('add-expense') ||
      clean.includes('friends') ||
      clean.includes('settings')
    );
  };

  // If already navigated to another route (e.g. /shared-payment from intent), cancel splash redirect immediately
  useEffect(() => {
    if (pathname && pathname !== '/') {
      navigatingRef.current = true;
      if (splashTimerRef.current) {
        clearTimeout(splashTimerRef.current);
        splashTimerRef.current = null;
      }
    }
  }, [pathname]);

  // Entrance Animations & External Intent Detection
  const scaleAnim = useRef(new Animated.Value(0.75)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let isCancelled = false;

    // Check immediately if app was launched via an external intent / deep link
    Linking.getInitialURL().then(initialUrl => {
      if (isCancelled) return;
      if (isExternalSource(initialUrl)) {
        console.log('[SplashScreen] External launch detected on mount:', initialUrl);
        navigatingRef.current = true;
        if (splashTimerRef.current) {
          clearTimeout(splashTimerRef.current);
          splashTimerRef.current = null;
        }
        const currentUser = useAuthStore.getState().user;
        if (currentUser?.id) {
          initTrips().catch(() => {});
          fetchTrips(currentUser.id).catch(() => {});
        }
      }
    }).catch(() => {});

    // Run entrance animation
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 6,
        tension: 40,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 650,
        useNativeDriver: true,
      }),
    ]).start();

    Animated.timing(textOpacity, {
      toValue: 1,
      duration: 500,
      delay: 250,
      useNativeDriver: true,
    }).start();

    return () => {
      isCancelled = true;
      scaleAnim.stopAnimation();
      opacityAnim.stopAnimation();
      textOpacity.stopAnimation();
      if (splashTimerRef.current) {
        clearTimeout(splashTimerRef.current);
        splashTimerRef.current = null;
      }
    };
  }, []);

  const proceedNext = async () => {
    if (navigatingRef.current) return;

    // If current route is not splash ('/'), user has already been routed elsewhere - DO NOT replace!
    if (pathnameRef.current && pathnameRef.current !== '/') {
      console.log('[SplashScreen] Route is already outside splash:', pathnameRef.current);
      navigatingRef.current = true;
      return;
    }

    try {
      const initialUrl = await Linking.getInitialURL();
      if (isExternalSource(initialUrl)) {
        console.log('[SplashScreen] External launch in proceedNext, routing to target:', initialUrl);
        navigatingRef.current = true;
        if (splashTimerRef.current) {
          clearTimeout(splashTimerRef.current);
          splashTimerRef.current = null;
        }

        const currentUser = useAuthStore.getState().user;
        if (!currentUser) {
          router.replace('/(auth)/login');
          return;
        }

        const clean = (initialUrl || '').toLowerCase();
        if (clean.includes('add-expense') || clean.includes('add-trip') || clean.includes('add-contact')) {
          if (clean.includes('new-trip') || clean.includes('add-trip')) {
            router.replace('/add-expense?action=new-trip' as any);
          } else if (clean.includes('new-contact') || clean.includes('add-contact')) {
            router.replace('/add-expense?action=new-contact' as any);
          } else {
            router.replace('/add-expense' as any);
          }
          return;
        } else if (clean.includes('shared-payment')) {
          router.replace('/shared-payment');
          return;
        } else if (clean.includes('friends')) {
          router.replace('/(tabs)/friends');
          return;
        } else if (clean.includes('trips')) {
          router.replace('/(tabs)');
          return;
        }
      }
    } catch {}

    navigatingRef.current = true;

    if (splashTimerRef.current) {
      clearTimeout(splashTimerRef.current);
      splashTimerRef.current = null;
    }

    try {
      const currentUser = useAuthStore.getState().user;
      if (currentUser?.id) {
        await initTrips();
        await fetchTrips(currentUser.id);
      }
    } catch (e) {
      console.log('Preload notice:', e);
    }

    // Final check before replacing route
    if (pathnameRef.current && pathnameRef.current !== '/') {
      return;
    }

    try {
      const currentUser = useAuthStore.getState().user;
      if (currentUser) {
        router.replace('/(tabs)');
      } else {
        router.replace('/(auth)/login');
      }
    } catch (navError) {
      console.log('Navigation dispatch error:', navError);
    }
  };

  useEffect(() => {
    if (!isHydrated || authLoading || navigatingRef.current) return;

    if (!hasChosenTheme) {
      setShowThemePrompt(true);
      return;
    }

    // Returning user: automatically transition after logo presentation
    splashTimerRef.current = setTimeout(() => {
      proceedNext();
    }, 1200);

    return () => {
      if (splashTimerRef.current) {
        clearTimeout(splashTimerRef.current);
        splashTimerRef.current = null;
      }
    };
  }, [user, authLoading, isHydrated, hasChosenTheme]);

  const handleSelectMode = (mode: ThemeMode) => {
    setSelectedMode(mode);
  };

  const handleConfirmTheme = async (chosenMode?: ThemeMode) => {
    if (navigatingRef.current || isConfirming) return;
    navigatingRef.current = true; // Lock immediately to prevent duplicate dispatch or race conditions

    if (splashTimerRef.current) {
      clearTimeout(splashTimerRef.current);
      splashTimerRef.current = null;
    }

    setIsConfirming(true);
    const modeToApply = chosenMode || selectedMode;

    try {
      await completeThemeOnboarding(modeToApply);
    } catch (e) {
      console.log('Theme onboarding notice:', e);
    }

    // Small delay ensures state reconciliation finishes cleanly before route transition
    setTimeout(async () => {
      if (pathnameRef.current && pathnameRef.current !== '/') {
        return;
      }
      try {
        const initialUrl = await Linking.getInitialURL();
        if (isExternalSource(initialUrl)) {
          return;
        }
      } catch {}

      try {
        const currentUser = useAuthStore.getState().user;
        if (currentUser) {
          router.replace('/(tabs)');
        } else {
          router.replace('/(auth)/login');
        }
      } catch (e) {
        console.log('Theme nav error:', e);
      }
    }, 150);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent={Platform.OS === 'android'}
      />

      {/* Decorative background glow */}
      <View style={[styles.glowTop, { backgroundColor: isDark ? 'rgba(99, 102, 241, 0.12)' : '#EEF2FF' }]} />
      <View style={[styles.glowBottom, { backgroundColor: isDark ? 'rgba(56, 189, 248, 0.08)' : '#E0F2FE' }]} />

      <Animated.View
        style={[
          styles.brandContainer,
          {
            opacity: opacityAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        <View style={[styles.logoBadge, { backgroundColor: colors.primary }]}>
          <Text style={styles.logoIcon}>✈️</Text>
        </View>

        <Animated.View style={{ opacity: textOpacity, alignItems: 'center' }}>
          <Text style={[styles.brandTitle, { color: colors.text }]}>Split Your Trip</Text>
          <Text style={[styles.brandTagline, { color: colors.textSecondary }]}>
            Smarter Group Expenses & Settlements
          </Text>
        </Animated.View>
      </Animated.View>

      {/* First-time Theme Selection Card */}
      {showThemePrompt ? (
        <View style={[styles.themeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.themeCardTitle, { color: colors.text }]}>Choose Your Theme</Text>
          <Text style={[styles.themeCardSub, { color: colors.textSecondary }]}>
            Personalize your experience. Dark mode is enabled by default.
          </Text>

          <View style={styles.themeOptionsRow}>
            {/* Dark Mode Option */}
            <TouchableOpacity
              style={[
                styles.themeOptionBtn,
                {
                  backgroundColor: '#0B0F19',
                  borderColor: selectedMode === 'dark' ? colors.primary : colors.border,
                },
                selectedMode === 'dark' && styles.themeOptionActive,
              ]}
              onPress={() => handleSelectMode('dark')}
              activeOpacity={0.8}
            >
              <Text style={styles.themeEmoji}>🌙</Text>
              <Text style={[styles.themeOptionTitle, { color: '#F8FAFC' }]}>Dark Theme</Text>
              <Text style={styles.themeOptionBadge}>Default</Text>
            </TouchableOpacity>

            {/* Light Mode Option */}
            <TouchableOpacity
              style={[
                styles.themeOptionBtn,
                {
                  backgroundColor: '#F8FAFC',
                  borderColor: selectedMode === 'light' ? colors.primary : colors.border,
                },
                selectedMode === 'light' && styles.themeOptionActive,
              ]}
              onPress={() => handleSelectMode('light')}
              activeOpacity={0.8}
            >
              <Text style={styles.themeEmoji}>☀️</Text>
              <Text style={[styles.themeOptionTitle, { color: '#0F172A' }]}>Light Theme</Text>
              <Text style={[styles.themeOptionSub, { color: '#64748B' }]}>Classic</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.continueBtn, { backgroundColor: colors.primary, opacity: isConfirming ? 0.75 : 1 }]}
            onPress={() => handleConfirmTheme()}
            disabled={isConfirming}
            activeOpacity={0.85}
          >
            {isConfirming ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.continueBtnText}>Continue →</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        /* Loading indicator for standard transition */
        <View style={[styles.footer, { bottom: Math.max(insets.bottom, 24) + 16 }]}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.footerText, { color: colors.textMuted }]}>
            Loading your travel experience...
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  glowTop: {
    position: 'absolute',
    top: -100,
    right: -100,
    width: 320,
    height: 320,
    borderRadius: 160,
  },
  glowBottom: {
    position: 'absolute',
    bottom: -100,
    left: -100,
    width: 340,
    height: 340,
    borderRadius: 170,
  },
  brandContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoBadge: {
    width: 96,
    height: 96,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 10,
  },
  logoIcon: {
    fontSize: 46,
  },
  brandTitle: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  brandTagline: {
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
  },
  themeCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
    alignItems: 'center',
  },
  themeCardTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 6,
  },
  themeCardSub: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  themeOptionsRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    marginBottom: 20,
  },
  themeOptionBtn: {
    flex: 1,
    paddingVertical: 18,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
  },
  themeOptionActive: {
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  themeEmoji: {
    fontSize: 28,
    marginBottom: 8,
  },
  themeOptionTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  themeOptionBadge: {
    fontSize: 11,
    color: '#34D399',
    fontWeight: '600',
  },
  themeOptionSub: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500',
  },
  continueBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  continueBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  footer: {
    position: 'absolute',
    bottom: 48,
    alignItems: 'center',
  },
  footerText: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: '500',
  },
});
