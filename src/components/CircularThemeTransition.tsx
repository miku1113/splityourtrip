import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Animated,
  Easing,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore, ThemeMode, ThemeTransitionOrigin } from '../theme/useThemeStore';
import { darkColors, lightColors } from '../theme/colors';

export default function CircularThemeTransition() {
  const { width, height } = useWindowDimensions();
  const transitionMode = useThemeStore(state => state.transitionMode);
  const transitionOrigin = useThemeStore(state => state.transitionOrigin);

  const [activeTransition, setActiveTransition] = useState<{
    mode: ThemeMode;
    origin: ThemeTransitionOrigin;
  } | null>(null);

  // Animated values
  const circleScale = useRef(new Animated.Value(0)).current;
  const ringScale = useRef(new Animated.Value(0)).current;
  const ringOpacity = useRef(new Animated.Value(0.9)).current;
  const badgeScale = useRef(new Animated.Value(0)).current;
  const badgeRotate = useRef(new Animated.Value(0)).current;
  const overlayOpacity = useRef(new Animated.Value(1)).current;

  // Track currently animating mode to prevent duplicate runs
  const isAnimatingRef = useRef(false);

  useEffect(() => {
    if (!transitionMode || isAnimatingRef.current) return;
    isAnimatingRef.current = true;

    // Determine origin: use provided coordinates or fallback to responsive top-center/right
    const origin: ThemeTransitionOrigin = transitionOrigin || {
      x: width * 0.85,
      y: Math.max(height * 0.12, 90),
    };

    const targetMode = transitionMode;

    setActiveTransition({
      mode: targetMode,
      origin,
    });

    // Reset values
    circleScale.setValue(0);
    ringScale.setValue(0);
    ringOpacity.setValue(0.9);
    badgeScale.setValue(0);
    badgeRotate.setValue(0);
    overlayOpacity.setValue(1);

    // Run parallel circular expansion
    const animation = Animated.parallel([
      // Main expanding circle
      Animated.timing(circleScale, {
        toValue: 1,
        duration: 480,
        easing: Easing.bezier(0.2, 0.9, 0.3, 1),
        useNativeDriver: true,
      }),
      // Leading ripple ring (shockwave)
      Animated.timing(ringScale, {
        toValue: 1.05,
        duration: 520,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      // Ring fades as it expands
      Animated.timing(ringOpacity, {
        toValue: 0,
        duration: 500,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      // Center/origin badge pops up with spring
      Animated.spring(badgeScale, {
        toValue: 1,
        friction: 6,
        tension: 80,
        useNativeDriver: true,
      }),
      // Badge spins 360 degrees
      Animated.timing(badgeRotate, {
        toValue: 1,
        duration: 480,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    // Switch underlying app theme at 380ms right as circle covers the viewport
    const switchTimer = setTimeout(() => {
      useThemeStore.setState({ themeMode: targetMode });
    }, 380);

    animation.start(() => {
      // Fade out overlay smoothly to reveal the newly themed underlying screen
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        useThemeStore.getState().finishThemeTransition().catch(() => {});
        setActiveTransition(null);
        isAnimatingRef.current = false;
      });
    });

    return () => {
      clearTimeout(switchTimer);
    };
  }, [transitionMode, transitionOrigin, width, height]);

  if (!activeTransition) return null;

  const { mode: targetMode, origin } = activeTransition;
  const isTargetDark = targetMode === 'dark';

  // Calculate radius needed to cover all four screen corners from origin
  const d1 = Math.hypot(origin.x, origin.y);
  const d2 = Math.hypot(width - origin.x, origin.y);
  const d3 = Math.hypot(origin.x, height - origin.y);
  const d4 = Math.hypot(width - origin.x, height - origin.y);
  const maxCornerDist = Math.max(d1, d2, d3, d4);
  const radius = Math.ceil(maxCornerDist + 40);
  const diameter = radius * 2;

  // Clamp badge location so it never renders off-screen
  const badgeX = Math.min(Math.max(origin.x, 38), width - 38);
  const badgeY = Math.min(Math.max(origin.y, 70), height - 70);

  const targetBg = isTargetDark ? darkColors.background : lightColors.background;
  const accentColor = isTargetDark ? '#818CF8' : '#F59E0B';
  const glowColor = isTargetDark ? 'rgba(99, 102, 241, 0.35)' : 'rgba(245, 158, 11, 0.35)';

  const spin = badgeRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        {
          overflow: 'hidden',
          zIndex: 999999,
          elevation: 999999,
        },
      ]}
    >
      <Animated.View style={[StyleSheet.absoluteFillObject, { opacity: overlayOpacity }]}>
        {/* Expanding Main Circle */}
        <Animated.View
          style={{
            position: 'absolute',
            width: diameter,
            height: diameter,
            left: origin.x - radius,
            top: origin.y - radius,
            borderRadius: radius,
            backgroundColor: targetBg,
            borderWidth: 2,
            borderColor: glowColor,
            shadowColor: accentColor,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.4,
            shadowRadius: 24,
            elevation: 12,
            transform: [{ scale: circleScale }],
          }}
        />

        {/* Circular Shockwave Ripple Ring */}
        <Animated.View
          style={{
            position: 'absolute',
            width: diameter,
            height: diameter,
            left: origin.x - radius,
            top: origin.y - radius,
            borderRadius: radius,
            borderWidth: 3.5,
            borderColor: accentColor,
            opacity: ringOpacity,
            transform: [{ scale: ringScale }],
          }}
        />

        {/* Floating Sun / Moon Circular Badge */}
        <Animated.View
          style={{
            position: 'absolute',
            width: 64,
            height: 64,
            left: badgeX - 32,
            top: badgeY - 32,
            borderRadius: 32,
            backgroundColor: isTargetDark ? '#1E293B' : '#FFFFFF',
            borderWidth: 2,
            borderColor: accentColor,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: accentColor,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.45,
            shadowRadius: 14,
            elevation: 16,
            transform: [{ scale: badgeScale }, { rotate: spin }],
          }}
        >
          <Ionicons
            name={isTargetDark ? 'moon' : 'sunny'}
            size={32}
            color={accentColor}
          />
        </Animated.View>
      </Animated.View>
    </View>
  );
}
