import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { moderateScale } from '../theme/responsive';

interface FriendsListSkeletonProps {
  colors: {
    card: string;
    border: string;
    cardSecondary?: string;
    primary: string;
    primaryLight: string;
    textSecondary: string;
    textMuted: string;
    success?: string;
    danger?: string;
    successBg?: string;
    dangerBg?: string;
  };
  isDark?: boolean;
  count?: number;
  includeSummary?: boolean;
  includeSearch?: boolean;
}

export default function FriendsListSkeleton({
  colors,
  isDark = true,
  count = 6,
  includeSummary = false,
  includeSearch = false,
}: FriendsListSkeletonProps) {
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
      {/* Optional Top Summary Balance Card Skeleton */}
      {includeSummary && (
        <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryCol}>
              <Animated.View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: blockSecondary, opacity: pulseAnim, width: 75, height: 11 },
                ]}
              />
              <Animated.View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: colors.success || '#4ADE80', opacity: pulseAnim, width: 85, height: 20, marginTop: 4 },
                ]}
              />
            </View>

            <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />

            <View style={styles.summaryCol}>
              <Animated.View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: blockSecondary, opacity: pulseAnim, width: 65, height: 11 },
                ]}
              />
              <Animated.View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: colors.danger || '#F87171', opacity: pulseAnim, width: 85, height: 20, marginTop: 4 },
                ]}
              />
            </View>
          </View>

          {/* Centered Net Pill */}
          <View style={styles.netPillWrapper}>
            <Animated.View
              style={[
                styles.netPillSkeleton,
                { backgroundColor: blockSecondary, opacity: pulseAnim },
              ]}
            />
          </View>
        </View>
      )}

      {/* Optional Search & Filter Pills Skeleton */}
      {includeSearch && (
        <View style={styles.searchBlock}>
          <Animated.View
            style={[
              styles.searchBarSkeleton,
              { backgroundColor: colors.card, borderColor: colors.border, opacity: pulseAnim },
            ]}
          />
          <View style={styles.filterPillsRow}>
            <Animated.View
              style={[
                styles.filterPillSkeleton,
                { backgroundColor: colors.primary, opacity: pulseAnim, width: 72 },
              ]}
            />
            <Animated.View
              style={[
                styles.filterPillSkeleton,
                { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, opacity: pulseAnim, width: 80 },
              ]}
            />
            <Animated.View
              style={[
                styles.filterPillSkeleton,
                { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, opacity: pulseAnim, width: 76 },
              ]}
            />
          </View>
        </View>
      )}

      {/* Friends Cards Container */}
      <View style={[styles.cardsContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {Array.from({ length: count }).map((_, index) => (
          <View
            key={`friend_skel_${index}`}
            style={[
              styles.friendCard,
              index < count - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
            ]}
          >
            {/* Avatar circle + status dot */}
            <View style={styles.avatarContainer}>
              <Animated.View
                style={[
                  styles.avatarCircle,
                  { backgroundColor: blockColor, opacity: pulseAnim },
                ]}
              />
              <Animated.View
                style={[
                  styles.onlineDot,
                  {
                    backgroundColor: index % 3 === 0 ? '#F87171' : '#4ADE80',
                    borderColor: colors.card,
                    opacity: pulseAnim,
                  },
                ]}
              />
            </View>

            {/* Friend info middle column */}
            <View style={styles.friendInfoCol}>
              <View style={styles.nameRow}>
                <Animated.View
                  style={[
                    styles.skeletonLine,
                    {
                      backgroundColor: blockColor,
                      opacity: pulseAnim,
                      width: index % 2 === 0 ? '60%' : '45%',
                      height: 15,
                    },
                  ]}
                />
                {index === 1 && (
                  <Animated.View
                    style={[
                      styles.guestBadgeSkeleton,
                      { backgroundColor: colors.primaryLight, opacity: pulseAnim },
                    ]}
                  />
                )}
              </View>
              <Animated.View
                style={[
                  styles.skeletonLine,
                  {
                    backgroundColor: blockSecondary,
                    opacity: pulseAnim,
                    width: index % 2 === 0 ? 115 : 90,
                    height: 11,
                  },
                ]}
              />
            </View>

            {/* Right side amounts + chevron */}
            <View style={styles.rightAmountCol}>
              <Animated.View
                style={[
                  styles.skeletonLine,
                  {
                    backgroundColor: index % 2 === 0 ? (colors.success || '#4ADE80') : blockSecondary,
                    opacity: pulseAnim,
                    width: 78,
                    height: 12,
                  },
                ]}
              />
              <Animated.View
                style={[
                  styles.skeletonLine,
                  {
                    backgroundColor: index % 2 === 0 ? blockSecondary : (colors.danger || '#F87171'),
                    opacity: pulseAnim,
                    width: 68,
                    height: 11,
                  },
                ]}
              />
            </View>

            {/* Chevron placeholder */}
            <Animated.View
              style={[
                styles.chevronPlaceholder,
                { backgroundColor: blockSecondary, opacity: pulseAnim },
              ]}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingVertical: moderateScale(4),
  },
  summaryCard: {
    padding: moderateScale(16),
    borderRadius: moderateScale(16),
    borderWidth: 1,
    marginBottom: moderateScale(14),
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginBottom: moderateScale(10),
  },
  summaryCol: {
    alignItems: 'center',
    flex: 1,
  },
  summaryDivider: {
    width: 1,
    height: moderateScale(36),
  },
  netPillWrapper: {
    alignItems: 'center',
    marginTop: moderateScale(6),
  },
  netPillSkeleton: {
    width: moderateScale(110),
    height: moderateScale(22),
    borderRadius: moderateScale(11),
  },
  searchBlock: {
    marginBottom: moderateScale(14),
    gap: moderateScale(10),
  },
  searchBarSkeleton: {
    height: moderateScale(44),
    borderRadius: moderateScale(12),
    borderWidth: 1,
  },
  filterPillsRow: {
    flexDirection: 'row',
    gap: moderateScale(8),
  },
  filterPillSkeleton: {
    height: moderateScale(32),
    borderRadius: moderateScale(16),
  },
  cardsContainer: {
    borderRadius: moderateScale(16),
    borderWidth: 1,
    overflow: 'hidden',
  },
  friendCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: moderateScale(13),
    paddingHorizontal: moderateScale(14),
    gap: moderateScale(12),
  },
  avatarContainer: {
    position: 'relative',
  },
  avatarCircle: {
    width: moderateScale(44),
    height: moderateScale(44),
    borderRadius: moderateScale(22),
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: moderateScale(10),
    height: moderateScale(10),
    borderRadius: moderateScale(5),
    borderWidth: 1.5,
  },
  friendInfoCol: {
    flex: 1,
    gap: moderateScale(5),
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: moderateScale(6),
  },
  guestBadgeSkeleton: {
    width: moderateScale(38),
    height: moderateScale(14),
    borderRadius: moderateScale(4),
  },
  rightAmountCol: {
    alignItems: 'flex-end',
    gap: moderateScale(4),
  },
  chevronPlaceholder: {
    width: moderateScale(8),
    height: moderateScale(14),
    borderRadius: moderateScale(2),
  },
  skeletonLine: {
    borderRadius: moderateScale(5),
  },
});
