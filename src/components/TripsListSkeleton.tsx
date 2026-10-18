import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { moderateScale } from '../theme/responsive';

interface TripsListSkeletonProps {
  colors: {
    card: string;
    border: string;
    cardSecondary?: string;
    primary: string;
    primaryLight: string;
    textSecondary: string;
    textMuted: string;
  };
  isDark?: boolean;
  count?: number;
  showHeader?: boolean;
}

export default function TripsListSkeleton({
  colors,
  isDark = true,
  count = 4,
  showHeader = false,
}: TripsListSkeletonProps) {
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
      {showHeader && (
        <View style={styles.headerBlock}>
          {/* Welcome greeting skeleton */}
          <View style={styles.headerRow}>
            <View style={{ flex: 1, gap: 6 }}>
              <Animated.View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: blockSecondary, opacity: pulseAnim, width: 90, height: 12 },
                ]}
              />
              <Animated.View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: blockColor, opacity: pulseAnim, width: '70%', height: 22 },
                ]}
              />
            </View>
            <Animated.View
              style={[
                styles.avatarSkeleton,
                { backgroundColor: blockColor, opacity: pulseAnim },
              ]}
            />
          </View>

          {/* Action buttons skeleton */}
          <View style={styles.actionButtonsRow}>
            <Animated.View
              style={[
                styles.actionBtnSkeleton,
                { backgroundColor: colors.primaryLight, opacity: pulseAnim, flex: 1 },
              ]}
            />
            <Animated.View
              style={[
                styles.actionBtnSkeleton,
                { backgroundColor: blockSecondary, borderColor: colors.border, borderWidth: 1, opacity: pulseAnim, flex: 1 },
              ]}
            />
          </View>
        </View>
      )}

      {/* Trip Cards Container / List */}
      <View style={[styles.cardsContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {Array.from({ length: count }).map((_, index) => (
          <View
            key={`trip_skel_${index}`}
            style={[
              styles.tripCard,
              index < count - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
            ]}
          >
            {/* Square trip image placeholder */}
            <Animated.View
              style={[
                styles.imageSquare,
                { backgroundColor: blockColor, opacity: pulseAnim },
              ]}
            />

            {/* Trip details middle */}
            <View style={styles.tripMetaCol}>
              <Animated.View
                style={[
                  styles.skeletonLine,
                  {
                    backgroundColor: blockColor,
                    opacity: pulseAnim,
                    width: index % 2 === 0 ? '65%' : '48%',
                    height: 16,
                  },
                ]}
              />
              <View style={styles.dateRow}>
                <Animated.View
                  style={[
                    styles.iconPlaceholder,
                    { backgroundColor: blockSecondary, opacity: pulseAnim },
                  ]}
                />
                <Animated.View
                  style={[
                    styles.skeletonLine,
                    {
                      backgroundColor: blockSecondary,
                      opacity: pulseAnim,
                      width: index % 2 === 0 ? 130 : 100,
                      height: 11,
                    },
                  ]}
                />
              </View>
            </View>

            {/* Right status badge + chevron */}
            <View style={styles.statusCol}>
              <View style={[styles.activePill, { backgroundColor: isDark ? 'rgba(74, 222, 128, 0.12)' : 'rgba(34, 197, 94, 0.12)' }]}>
                <Animated.View
                  style={[
                    styles.statusDot,
                    { backgroundColor: '#4ADE80', opacity: pulseAnim },
                  ]}
                />
                <Animated.View
                  style={[
                    styles.skeletonLine,
                    { backgroundColor: '#4ADE80', opacity: pulseAnim, width: 44, height: 8, borderRadius: 4 },
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
        ))}
      </View>

      {/* Showing count indicator line */}
      <View style={styles.footerRow}>
        <Animated.View
          style={[
            styles.skeletonLine,
            { backgroundColor: blockSecondary, opacity: pulseAnim, width: 110, height: 11 },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingVertical: moderateScale(8),
  },
  headerBlock: {
    marginBottom: moderateScale(16),
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: moderateScale(16),
  },
  avatarSkeleton: {
    width: moderateScale(44),
    height: moderateScale(44),
    borderRadius: moderateScale(22),
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: moderateScale(12),
  },
  actionBtnSkeleton: {
    height: moderateScale(46),
    borderRadius: moderateScale(12),
  },
  cardsContainer: {
    borderRadius: moderateScale(16),
    borderWidth: 1,
    overflow: 'hidden',
  },
  tripCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: moderateScale(14),
    paddingHorizontal: moderateScale(14),
    gap: moderateScale(12),
  },
  imageSquare: {
    width: moderateScale(48),
    height: moderateScale(48),
    borderRadius: moderateScale(12),
  },
  tripMetaCol: {
    flex: 1,
    gap: moderateScale(6),
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: moderateScale(6),
  },
  iconPlaceholder: {
    width: moderateScale(12),
    height: moderateScale(12),
    borderRadius: moderateScale(3),
  },
  statusCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: moderateScale(8),
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: moderateScale(5),
    paddingHorizontal: moderateScale(8),
    paddingVertical: moderateScale(4),
    borderRadius: moderateScale(12),
  },
  statusDot: {
    width: moderateScale(6),
    height: moderateScale(6),
    borderRadius: moderateScale(3),
  },
  chevronPlaceholder: {
    width: moderateScale(8),
    height: moderateScale(14),
    borderRadius: moderateScale(2),
  },
  footerRow: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: moderateScale(14),
  },
  skeletonLine: {
    borderRadius: moderateScale(6),
  },
});
