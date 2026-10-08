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
  Easing,
  Image,
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

  // Trailer Origami Transformation Intro Animations
  const receiptY = useRef(new Animated.Value(-35)).current;
  const receiptScale = useRef(new Animated.Value(0.85)).current;
  const receiptRotate = useRef(new Animated.Value(0)).current;
  const receiptOpacity = useRef(new Animated.Value(0)).current;

  const planeScale = useRef(new Animated.Value(0.15)).current;
  const planeY = useRef(new Animated.Value(15)).current;
  const planeRotate = useRef(new Animated.Value(0)).current;
  const planeOpacity = useRef(new Animated.Value(0)).current;
  const planeHover = useRef(new Animated.Value(0)).current;

  const flashScale = useRef(new Animated.Value(0.2)).current;
  const flashOpacity = useRef(new Animated.Value(0)).current;

  const textY = useRef(new Animated.Value(16)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;

  const containerOpacity = useRef(new Animated.Value(1)).current;

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

    // Stage 1: Receipt drops in gracefully
    Animated.parallel([
      Animated.timing(receiptOpacity, {
        toValue: 1,
        duration: 320,
        useNativeDriver: true,
      }),
      Animated.spring(receiptY, {
        toValue: 0,
        friction: 6,
        tension: 50,
        useNativeDriver: true,
      }),
      Animated.spring(receiptScale, {
        toValue: 1,
        friction: 6,
        useNativeDriver: true,
      }),
    ]).start();

    // Stage 2: Receipt folds into 3D Vector Origami Plane with radiant flash
    const foldTimeout = setTimeout(() => {
      if (isCancelled || navigatingRef.current) return;

      Animated.parallel([
        Animated.timing(receiptScale, {
          toValue: 0.1,
          duration: 380,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(receiptRotate, {
          toValue: 1,
          duration: 380,
          useNativeDriver: true,
        }),
        Animated.timing(receiptOpacity, {
          toValue: 0,
          duration: 280,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(flashOpacity, {
            toValue: 0.9,
            duration: 180,
            useNativeDriver: true,
          }),
          Animated.timing(flashOpacity, {
            toValue: 0,
            duration: 380,
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(flashScale, {
          toValue: 2.6,
          duration: 520,
          useNativeDriver: true,
        }),
        Animated.timing(planeOpacity, {
          toValue: 1,
          duration: 260,
          delay: 120,
          useNativeDriver: true,
        }),
        Animated.spring(planeScale, {
          toValue: 1,
          friction: 5,
          tension: 45,
          delay: 120,
          useNativeDriver: true,
        }),
        Animated.spring(planeY, {
          toValue: 0,
          friction: 6,
          delay: 120,
          useNativeDriver: true,
        }),
      ]).start(() => {
        // Start subtle breathing hover loop on plane
        Animated.loop(
          Animated.sequence([
            Animated.timing(planeHover, {
              toValue: -7,
              duration: 1400,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
            Animated.timing(planeHover, {
              toValue: 0,
              duration: 1400,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
          ])
        ).start();
      });
    }, 700);

    // Stage 3: Brand Typography slides in smoothly
    const textTimeout = setTimeout(() => {
      if (isCancelled || navigatingRef.current) return;
      Animated.parallel([
        Animated.timing(textOpacity, {
          toValue: 1,
          duration: 480,
          useNativeDriver: true,
        }),
        Animated.timing(textY, {
          toValue: 0,
          duration: 480,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    }, 1100);

    return () => {
      isCancelled = true;
      clearTimeout(foldTimeout);
      clearTimeout(textTimeout);
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

    // Aerodynamic Plane Takeoff Extro Transition
    Animated.parallel([
      Animated.timing(planeY, {
        toValue: -180,
        duration: 480,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(planeScale, {
        toValue: 1.25,
        duration: 480,
        useNativeDriver: true,
      }),
      Animated.timing(planeRotate, {
        toValue: 1,
        duration: 450,
        useNativeDriver: true,
      }),
      Animated.timing(planeOpacity, {
        toValue: 0,
        duration: 420,
        delay: 80,
        useNativeDriver: true,
      }),
      Animated.timing(textOpacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(textY, {
        toValue: 24,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(containerOpacity, {
        toValue: 0,
        duration: 400,
        delay: 100,
        useNativeDriver: true,
      }),
    ]).start(() => {
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
    });
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
    }, 2400);

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

      // Aerodynamic Plane Takeoff Extro Transition
      Animated.parallel([
        Animated.timing(planeY, {
          toValue: -180,
          duration: 480,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(planeScale, {
          toValue: 1.25,
          duration: 480,
          useNativeDriver: true,
        }),
        Animated.timing(planeRotate, {
          toValue: 1,
          duration: 450,
          useNativeDriver: true,
        }),
        Animated.timing(planeOpacity, {
          toValue: 0,
          duration: 420,
          delay: 80,
          useNativeDriver: true,
        }),
        Animated.timing(textOpacity, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(textY, {
          toValue: 24,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(containerOpacity, {
          toValue: 0,
          duration: 400,
          delay: 100,
          useNativeDriver: true,
        }),
      ]).start(() => {
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
      });
    }, 100);
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
            opacity: containerOpacity,
          },
        ]}
      >
        {/* Stage Box for Origami Receipt & 3D Airplane */}
        <View style={styles.stageBox}>
          {/* Flash Aura Burst */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.flashAura,
              {
                opacity: flashOpacity,
                transform: [{ scale: flashScale }],
              },
            ]}
          />

          {/* Foldable Receipt Card (Trailer Intro) */}
          <Animated.View
            style={[
              styles.receiptCard,
              {
                opacity: receiptOpacity,
                transform: [
                  { translateY: receiptY },
                  { scale: receiptScale },
                  {
                    rotateZ: receiptRotate.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0deg', '55deg'],
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={styles.receiptTopBorder} />
            <Text style={styles.receiptHeader}>SPLIT BILL</Text>
            <View style={styles.receiptRow}>
              <Text style={styles.receiptItem}>Chai &amp; Snacks</Text>
              <Text style={styles.receiptAmount}>₹120</Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={styles.receiptItem}>Cabs</Text>
              <Text style={styles.receiptAmount}>₹350</Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={styles.receiptItem}>Dinner</Text>
              <Text style={styles.receiptAmount}>₹980</Text>
            </View>
            <View style={styles.receiptDivider} />
            <View style={styles.receiptRow}>
              <Text style={styles.receiptTotalLabel}>TOTAL</Text>
              <Text style={styles.receiptTotalAmount}>₹1,450</Text>
            </View>
          </Animated.View>

          {/* 3D Vector Origami Plane Logo from Trailer */}
          <Animated.View
            style={[
              styles.planeContainer,
              {
                opacity: planeOpacity,
                transform: [
                  { translateY: Animated.add(planeY, planeHover) },
                  { scale: planeScale },
                  {
                    rotateZ: planeRotate.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0deg', '-16deg'],
                    }),
                  },
                ],
              },
            ]}
          >
            <Image
              source={require('../assets/images/split-logo.png')}
              style={styles.planeImage}
              resizeMode="contain"
            />
          </Animated.View>
        </View>

        <Animated.View
          style={[
            styles.textContainer,
            {
              opacity: textOpacity,
              transform: [{ translateY: textY }],
            },
          ]}
        >
          <Text style={[styles.brandTitle, { color: colors.text }]}>Split Your Trip</Text>
          <Text style={[styles.brandTagline, { color: colors.textSecondary }]}>
            Travel Together • Split Effortlessly
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
    marginBottom: 36,
  },
  stageBox: {
    width: 150,
    height: 150,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginBottom: 16,
  },
  receiptCard: {
    position: 'absolute',
    width: 110,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  receiptTopBorder: {
    height: 3,
    backgroundColor: '#6366F1',
    borderRadius: 2,
    marginBottom: 6,
  },
  receiptHeader: {
    fontSize: 9,
    fontWeight: '800',
    color: '#4F46E5',
    letterSpacing: 0.5,
    marginBottom: 4,
    textAlign: 'center',
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 1.5,
  },
  receiptItem: {
    fontSize: 8,
    color: '#475569',
    fontWeight: '500',
  },
  receiptAmount: {
    fontSize: 8,
    color: '#0F172A',
    fontWeight: '700',
  },
  receiptDivider: {
    height: 1,
    backgroundColor: '#94A3B8',
    borderStyle: 'dashed',
    marginVertical: 4,
  },
  receiptTotalLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#0F172A',
  },
  receiptTotalAmount: {
    fontSize: 9,
    fontWeight: '800',
    color: '#4F46E5',
  },
  planeContainer: {
    width: 130,
    height: 130,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
  },
  planeImage: {
    width: 130,
    height: 130,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 10,
  },
  flashAura: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(56, 189, 248, 0.45)',
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 35,
  },
  textContainer: {
    alignItems: 'center',
    marginTop: 6,
  },
  brandTitle: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  brandTagline: {
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
    letterSpacing: 0.2,
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
