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
  LayoutAnimation,
  UIManager,
} from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, usePathname } from 'expo-router';
import { useAuthStore } from '../src/features/auth/useAuthStore';
import { useTripStore } from '../src/features/trips/useTripStore';
import { useTheme, ThemeMode } from '../src/theme/useThemeStore';
import { getNativeSharedData } from '../src/services/receiptOcr';

export default function SplashScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { user, isLoading: authLoading } = useAuthStore();
  const fetchTrips = useTripStore(state => state.fetchTrips);
  const initTrips = useTripStore(state => state.initTrips);
  const { colors, isDark, themeMode, hasChosenTheme, completeThemeOnboarding, isHydrated, setThemeMode } = useTheme();

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

  // Smooth theme transition animation values
  const themeAnim = useRef(new Animated.Value(isDark ? 0 : 1)).current;
  const darkCardScale = useRef(new Animated.Value(selectedMode === 'dark' ? 1.02 : 0.98)).current;
  const lightCardScale = useRef(new Animated.Value(selectedMode === 'light' ? 1.02 : 0.98)).current;

  // Smooth color transitions (0 = Dark, 1 = Light)
  const containerBg = themeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#151B25', '#F4F6F8'],
  });

  const cardBg = themeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#242D3B', '#FFFFFF'],
  });

  const cardBorder = themeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#2E3A4B', '#D7DEE8'],
  });

  const titleTextColor = themeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#F0F2E9', '#151B25'],
  });

  const subtitleTextColor = themeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#A3AFC2', '#556274'],
  });

  const glowTopBg = themeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(99, 102, 241, 0.12)', 'rgba(91, 120, 154, 0.15)'],
  });

  const glowBottomBg = themeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(56, 189, 248, 0.08)', 'rgba(120, 155, 128, 0.15)'],
  });

  const badgeBg = themeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(99, 102, 241, 0.15)', 'rgba(91, 120, 154, 0.08)'],
  });

  const badgeBorder = themeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(99, 102, 241, 0.30)', 'rgba(91, 120, 154, 0.20)'],
  });

  const continueBtnBg = themeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#7895B7', '#5B789A'],
  });

  useEffect(() => {
    let isCancelled = false;

    // Check immediately if native shared data (screenshot / text from Android share sheet) was received
    getNativeSharedData().then(async (shared) => {
      if (isCancelled) return;
      try {
        if (shared.imageUri || shared.sharedText) {
          console.log('[SplashScreen] Native shared launch detected on mount:', shared);
          navigatingRef.current = true;
          if (splashTimerRef.current) {
            clearTimeout(splashTimerRef.current);
            splashTimerRef.current = null;
          }
          router.replace({
            pathname: '/shared-payment',
            params: {
              imageUri: shared.imageUri || undefined,
              sharedText: shared.sharedText || undefined,
            },
          });
          return;
        }
      } catch {}
    }).catch(() => {});

    // Register device push token with Supabase profiles for closed-app notifications
    try {
      const { registerForPushNotificationsAsync } = require('../src/services/pushNotificationService');
      const authUser = useAuthStore.getState().user;
      if (authUser?.id) {
        registerForPushNotificationsAsync(authUser.id).catch(() => {});
      }
    } catch {}

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
      // Check for incoming shared screenshot or text from Android Share sheet
      const shared = await getNativeSharedData();
      if (shared.imageUri || shared.sharedText) {
        console.log('[SplashScreen] Native shared data detected in proceedNext, routing to /shared-payment:', shared);
        navigatingRef.current = true;
        if (splashTimerRef.current) {
          clearTimeout(splashTimerRef.current);
          splashTimerRef.current = null;
        }
        router.replace({
          pathname: '/shared-payment',
          params: {
            imageUri: shared.imageUri || undefined,
            sharedText: shared.sharedText || undefined,
          },
        });
        return;
      }

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

    // Only show prompt for first-time unauthenticated users who have never selected a theme
    if (!hasChosenTheme && !user) {
      setShowThemePrompt(true);
      return;
    }

    // Returning user or authenticated user: ensure onboarding is permanently marked complete
    if (!hasChosenTheme) {
      completeThemeOnboarding(themeMode || 'dark').catch(() => {});
    }

    // Automatically transition after logo presentation
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

  // Failsafe timer: If auth loading or hydration takes longer than 4 seconds, force transition to prevent infinite loading
  useEffect(() => {
    const failsafeTimer = setTimeout(() => {
      if (!navigatingRef.current) {
        console.log('[SplashScreen] Failsafe timer triggered after 4s');
        completeThemeOnboarding(selectedMode).catch(() => {});
        proceedNext();
      }
    }, 4000);

    return () => clearTimeout(failsafeTimer);
  }, [selectedMode]);

  const handleSelectMode = (mode: ThemeMode) => {
    if (selectedMode === mode) return;
    setSelectedMode(mode);

    Animated.parallel([
      Animated.timing(themeAnim, {
        toValue: mode === 'light' ? 1 : 0,
        duration: 450,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.spring(mode === 'dark' ? darkCardScale : lightCardScale, {
        toValue: 1.02,
        friction: 6,
        tension: 60,
        useNativeDriver: true,
      }),
      Animated.spring(mode === 'dark' ? lightCardScale : darkCardScale, {
        toValue: 0.98,
        friction: 6,
        tension: 60,
        useNativeDriver: true,
      }),
    ]).start();

    // Sync theme store smoothly
    setThemeMode(mode);
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
    <Animated.View style={[styles.container, { backgroundColor: containerBg }]}>
      <StatusBar
        barStyle={selectedMode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent={Platform.OS === 'android'}
        animated={true}
      />

      {/* Decorative background glow */}
      <Animated.View style={[styles.glowTop, { backgroundColor: glowTopBg }]} />
      <Animated.View style={[styles.glowBottom, { backgroundColor: glowBottomBg }]} />

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
          <Animated.Text style={[styles.brandTitle, { color: titleTextColor }]}>Split Your Trip</Animated.Text>
          <Animated.Text style={[styles.brandTagline, { color: subtitleTextColor }]}>
            Travel Together • Split Effortlessly
          </Animated.Text>

          {/* Made by MJ Studios Badge */}
          <Animated.View style={[styles.madeByBadge, { backgroundColor: badgeBg, borderColor: badgeBorder }]}>
            <Animated.Text style={[styles.madeByText, { color: subtitleTextColor }]}>
              Made by <Animated.Text style={[styles.madeByStudio, { color: continueBtnBg }]}>MJ Studios</Animated.Text>
            </Animated.Text>
          </Animated.View>
        </Animated.View>
      </Animated.View>

      {/* First-time Theme Selection Card */}
      {showThemePrompt ? (
        <Animated.View style={[styles.themeCard, { backgroundColor: cardBg, borderColor: cardBorder, shadowOpacity: selectedMode === 'dark' ? 0.35 : 0.08 }]}>
          <Animated.Text style={[styles.themeCardTitle, { color: titleTextColor }]}>Choose Your Theme</Animated.Text>
          <Animated.Text style={[styles.themeCardSub, { color: subtitleTextColor }]}>
            Personalize your experience. Tap an option below to preview.
          </Animated.Text>

          <View style={styles.themeOptionsRow}>
            {/* Dark Mode Option */}
            <Animated.View style={{ flex: 1, transform: [{ scale: darkCardScale }] }}>
              <TouchableOpacity
                style={[
                  styles.themeOptionBtn,
                  {
                    backgroundColor: '#151B25',
                    borderColor: selectedMode === 'dark' ? '#7895B7' : '#2E3A4B',
                  },
                  selectedMode === 'dark' && [
                    styles.themeOptionActive,
                    { borderColor: '#7895B7', shadowColor: '#7895B7' },
                  ],
                ]}
                onPress={() => handleSelectMode('dark')}
                activeOpacity={0.85}
              >
                <Text style={styles.themeEmoji}>🌙</Text>
                <Text style={[styles.themeOptionTitle, { color: '#F0F2E9' }]}>Dark Theme</Text>
                <Text style={[styles.themeOptionBadge, selectedMode === 'dark' ? { color: '#34D399', fontWeight: '700' } : { color: '#94A3B8' }]}>
                  {selectedMode === 'dark' ? '✓ Active' : 'Default'}
                </Text>
              </TouchableOpacity>
            </Animated.View>

            {/* Light Mode Option */}
            <Animated.View style={{ flex: 1, transform: [{ scale: lightCardScale }] }}>
              <TouchableOpacity
                style={[
                  styles.themeOptionBtn,
                  {
                    backgroundColor: '#FFFFFF',
                    borderColor: selectedMode === 'light' ? '#5B789A' : '#D7DEE8',
                  },
                  selectedMode === 'light' && [
                    styles.themeOptionActive,
                    { borderColor: '#5B789A', shadowColor: '#5B789A' },
                  ],
                ]}
                onPress={() => handleSelectMode('light')}
                activeOpacity={0.85}
              >
                <Text style={styles.themeEmoji}>☀️</Text>
                <Text style={[styles.themeOptionTitle, { color: '#0F172A' }]}>Light Theme</Text>
                <Text style={[styles.themeOptionSub, selectedMode === 'light' ? { color: '#5B789A', fontWeight: '700' } : { color: '#64748B' }]}>
                  {selectedMode === 'light' ? '✓ Active' : 'Classic'}
                </Text>
              </TouchableOpacity>
            </Animated.View>
          </View>

          <TouchableOpacity
            style={{ width: '100%' }}
            onPress={() => handleConfirmTheme()}
            disabled={isConfirming}
            activeOpacity={0.85}
          >
            <Animated.View
              style={[styles.continueBtn, { backgroundColor: continueBtnBg, opacity: isConfirming ? 0.75 : 1 }]}
            >
              {isConfirming ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.continueBtnText}>Continue →</Text>
              )}
            </Animated.View>
          </TouchableOpacity>
        </Animated.View>
      ) : (
        /* Loading indicator for standard transition */
        <View style={[styles.footer, { bottom: Math.max(insets.bottom, 24) + 16 }]}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.footerText, { color: colors.textMuted }]}>
            by MJ Studios • Loading your travel experience...
          </Text>
        </View>
      )}
    </Animated.View>
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
    paddingVertical: 18,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    width: '100%',
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
  madeByBadge: {
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    alignSelf: 'center',
  },
  madeByText: {
    fontSize: 12,
    fontWeight: '500',
  },
  madeByStudio: {
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
