import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { moderateScale } from '../theme/responsive';

interface ProfileSkeletonProps {
  colors: {
    card: string;
    border: string;
    cardSecondary?: string;
    primary: string;
    primaryLight: string;
    textSecondary: string;
    textMuted: string;
    danger?: string;
    inputBackground?: string;
  };
  isDark?: boolean;
}

export default function ProfileSkeleton({
  colors,
  isDark = true,
}: ProfileSkeletonProps) {
  const pulseAnim = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.88,
          duration: 750,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.35,
          duration: 750,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  const blockColor = isDark ? '#2A3649' : '#E2E8F0';
  const blockSecondary = isDark ? '#1F2937' : '#EDF2F7';

  return (
    <View style={styles.container}>
      {/* 1. Header Profile Card */}
      <View style={[styles.headerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {/* Avatar with camera badge */}
        <View style={styles.avatarWrapper}>
          <Animated.View
            style={[
              styles.avatarImageSkeleton,
              { backgroundColor: blockColor, opacity: pulseAnim },
            ]}
          />
          <Animated.View
            style={[
              styles.cameraBadgeSkeleton,
              { backgroundColor: colors.primary, opacity: pulseAnim, borderColor: colors.card },
            ]}
          />
        </View>

        {/* Change photo link */}
        <Animated.View
          style={[
            styles.skeletonLine,
            { backgroundColor: colors.primaryLight, opacity: pulseAnim, width: 130, height: 12, marginTop: 12 },
          ]}
        />

        {/* Name and Email */}
        <Animated.View
          style={[
            styles.skeletonLine,
            { backgroundColor: blockColor, opacity: pulseAnim, width: 220, height: 20, marginTop: 12 },
          ]}
        />
        <Animated.View
          style={[
            styles.skeletonLine,
            { backgroundColor: blockSecondary, opacity: pulseAnim, width: 170, height: 13, marginTop: 6 },
          ]}
        />
      </View>

      {/* 2. Payment & Profile Details Card */}
      <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Animated.View
          style={[
            styles.skeletonLine,
            { backgroundColor: blockColor, opacity: pulseAnim, width: 180, height: 18, marginBottom: 18 },
          ]}
        />

        {/* Field 1: Display Name */}
        <View style={styles.fieldBlock}>
          <Animated.View
            style={[
              styles.skeletonLine,
              { backgroundColor: blockSecondary, opacity: pulseAnim, width: 85, height: 11 },
            ]}
          />
          <Animated.View
            style={[
              styles.inputBoxSkeleton,
              { backgroundColor: colors.inputBackground || blockSecondary, borderColor: colors.border, opacity: pulseAnim },
            ]}
          />
        </View>

        {/* Field 2: UPI ID */}
        <View style={styles.fieldBlock}>
          <Animated.View
            style={[
              styles.skeletonLine,
              { backgroundColor: blockSecondary, opacity: pulseAnim, width: 230, height: 11 },
            ]}
          />
          <Animated.View
            style={[
              styles.inputBoxSkeleton,
              { backgroundColor: colors.inputBackground || blockSecondary, borderColor: colors.border, opacity: pulseAnim },
            ]}
          />
          <Animated.View
            style={[
              styles.skeletonLine,
              { backgroundColor: blockSecondary, opacity: pulseAnim, width: '90%', height: 10, marginTop: 2 },
            ]}
          />
        </View>

        {/* Field 3: Mobile Number */}
        <View style={styles.fieldBlock}>
          <Animated.View
            style={[
              styles.skeletonLine,
              { backgroundColor: blockSecondary, opacity: pulseAnim, width: 95, height: 11 },
            ]}
          />
          <View style={styles.phoneInputRow}>
            <Animated.View
              style={[
                styles.countryBoxSkeleton,
                { backgroundColor: colors.inputBackground || blockSecondary, borderColor: colors.border, opacity: pulseAnim },
              ]}
            />
            <Animated.View
              style={[
                styles.inputBoxSkeleton,
                { backgroundColor: colors.inputBackground || blockSecondary, borderColor: colors.border, opacity: pulseAnim, flex: 1 },
              ]}
            />
          </View>
          <Animated.View
            style={[
              styles.skeletonLine,
              { backgroundColor: blockSecondary, opacity: pulseAnim, width: '85%', height: 10, marginTop: 2 },
            ]}
          />
        </View>

        {/* Field 4: Preferred Currency & Country */}
        <View style={styles.fieldBlock}>
          <Animated.View
            style={[
              styles.skeletonLine,
              { backgroundColor: blockSecondary, opacity: pulseAnim, width: 175, height: 11 },
            ]}
          />
          <View
            style={[
              styles.currencyCardSkeleton,
              { backgroundColor: colors.inputBackground || blockSecondary, borderColor: colors.border },
            ]}
          >
            <Animated.View
              style={[
                styles.flagSquare,
                { backgroundColor: blockColor, opacity: pulseAnim },
              ]}
            />
            <View style={{ flex: 1, gap: 5 }}>
              <Animated.View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: blockColor, opacity: pulseAnim, width: 140, height: 13 },
                ]}
              />
              <Animated.View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: blockSecondary, opacity: pulseAnim, width: 110, height: 10 },
                ]}
              />
            </View>
            <Animated.View
              style={[
                styles.chevronPlaceholder,
                { backgroundColor: blockSecondary, opacity: pulseAnim },
              ]}
            />
          </View>
        </View>
      </View>

      {/* 3. Sign Out Button Skeleton */}
      <Animated.View
        style={[
          styles.logoutBtnSkeleton,
          { backgroundColor: colors.card, borderColor: colors.border, opacity: pulseAnim },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingVertical: moderateScale(4),
  },
  headerCard: {
    padding: moderateScale(20),
    borderRadius: moderateScale(20),
    alignItems: 'center',
    borderWidth: 1,
    marginBottom: moderateScale(16),
  },
  avatarWrapper: {
    position: 'relative',
    width: moderateScale(88),
    height: moderateScale(88),
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImageSkeleton: {
    width: moderateScale(88),
    height: moderateScale(88),
    borderRadius: moderateScale(44),
  },
  cameraBadgeSkeleton: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: moderateScale(28),
    height: moderateScale(28),
    borderRadius: moderateScale(14),
    borderWidth: 2,
  },
  sectionCard: {
    padding: moderateScale(18),
    borderRadius: moderateScale(20),
    borderWidth: 1,
    marginBottom: moderateScale(16),
  },
  fieldBlock: {
    marginBottom: moderateScale(16),
    gap: moderateScale(6),
  },
  inputBoxSkeleton: {
    height: moderateScale(46),
    borderRadius: moderateScale(12),
    borderWidth: 1,
  },
  phoneInputRow: {
    flexDirection: 'row',
    gap: moderateScale(8),
  },
  countryBoxSkeleton: {
    width: moderateScale(70),
    height: moderateScale(46),
    borderRadius: moderateScale(12),
    borderWidth: 1,
  },
  currencyCardSkeleton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: moderateScale(12),
    borderRadius: moderateScale(12),
    borderWidth: 1,
    gap: moderateScale(10),
  },
  flagSquare: {
    width: moderateScale(30),
    height: moderateScale(22),
    borderRadius: moderateScale(4),
  },
  chevronPlaceholder: {
    width: moderateScale(8),
    height: moderateScale(14),
    borderRadius: moderateScale(2),
  },
  logoutBtnSkeleton: {
    height: moderateScale(48),
    borderRadius: moderateScale(14),
    borderWidth: 1,
    marginBottom: moderateScale(24),
  },
  skeletonLine: {
    borderRadius: moderateScale(5),
  },
});
