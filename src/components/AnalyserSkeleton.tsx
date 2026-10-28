import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { moderateScale, useResponsive } from '../theme/responsive';

interface AnalyserSkeletonProps {
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
    warning?: string;
  };
  isDark?: boolean;
}

export default function AnalyserSkeleton({
  colors,
  isDark = true,
}: AnalyserSkeletonProps) {
  const { width } = useResponsive();
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

  // Bar chart simulated heights for 7 days
  const barHeights = [18, 30, 48, 14, 96, 26, 68];
  const barDays = ['Sat', 'Sun', 'Wed', 'Thu', 'Sun', 'Tue', 'Yest'];

  return (
    <View style={styles.container}>
      {/* 1. Trip Selector Horizontal Chips */}
      <View style={styles.tripFilterRow}>
        <Animated.View
          style={[
            styles.chipPill,
            { backgroundColor: colors.primary, opacity: pulseAnim, width: 100 },
          ]}
        />
        <Animated.View
          style={[
            styles.chipPill,
            { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, opacity: pulseAnim, width: 95 },
          ]}
        />
        <Animated.View
          style={[
            styles.chipPill,
            { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, opacity: pulseAnim, width: 75 },
          ]}
        />
        <Animated.View
          style={[
            styles.chipPill,
            { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, opacity: pulseAnim, width: 85 },
          ]}
        />
      </View>

      {/* 2. Hero Overview Card (Spending Analyser) */}
      <View
        style={[
          styles.heroCard,
          {
            backgroundColor: isDark ? '#1E2738' : '#F0F4FF',
            borderColor: isDark ? 'rgba(120, 149, 183, 0.3)' : '#DDE5F8',
          },
        ]}
      >
        <View style={styles.heroTopBar}>
          <View style={styles.heroTagBadge}>
            <Animated.View
              style={[
                styles.iconMini,
                { backgroundColor: colors.primary, opacity: pulseAnim },
              ]}
            />
            <Animated.View
              style={[
                styles.skeletonLine,
                { backgroundColor: colors.primary, opacity: pulseAnim, width: 130, height: 11 },
              ]}
            />
          </View>
          <Animated.View
            style={[
              styles.shareBtnSkeleton,
              { backgroundColor: blockSecondary, opacity: pulseAnim },
            ]}
          />
        </View>

        {/* Large Amount Placeholder */}
        <View style={styles.heroAmountRow}>
          <Animated.View
            style={[
              styles.skeletonLine,
              { backgroundColor: blockColor, opacity: pulseAnim, width: 170, height: 38, borderRadius: 8 },
            ]}
          />
        </View>

        {/* 4-Stat Hero Matrix (2x2 on <360, 4-col on >=360) */}
        {width < 360 ? (
          <View style={{ width: '100%', paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.06)' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8 }}>
              <View style={styles.heroStatCol}>
                <Animated.View
                  style={[
                    styles.skeletonLine,
                    { backgroundColor: blockSecondary, opacity: pulseAnim, width: 50, height: 10 },
                  ]}
                />
                <Animated.View
                  style={[
                    styles.skeletonLine,
                    { backgroundColor: colors.success || '#4ADE80', opacity: pulseAnim, width: 62, height: 14, marginTop: 4 },
                  ]}
                />
              </View>
              <View style={[styles.heroDivider, { backgroundColor: colors.border }]} />
              <View style={styles.heroStatCol}>
                <Animated.View
                  style={[
                    styles.skeletonLine,
                    { backgroundColor: blockSecondary, opacity: pulseAnim, width: 58, height: 10 },
                  ]}
                />
                <Animated.View
                  style={[
                    styles.skeletonLine,
                    { backgroundColor: blockColor, opacity: pulseAnim, width: 68, height: 14, marginTop: 4 },
                  ]}
                />
              </View>
            </View>
            <View style={{ height: 1, backgroundColor: 'rgba(0,0,0,0.06)', width: '100%' }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8 }}>
              <View style={styles.heroStatCol}>
                <Animated.View
                  style={[
                    styles.skeletonLine,
                    { backgroundColor: blockSecondary, opacity: pulseAnim, width: 52, height: 10 },
                  ]}
                />
                <Animated.View
                  style={[
                    styles.skeletonLine,
                    { backgroundColor: blockColor, opacity: pulseAnim, width: 32, height: 14, marginTop: 4 },
                  ]}
                />
              </View>
              <View style={[styles.heroDivider, { backgroundColor: colors.border }]} />
              <View style={styles.heroStatCol}>
                <Animated.View
                  style={[
                    styles.skeletonLine,
                    { backgroundColor: blockSecondary, opacity: pulseAnim, width: 50, height: 10 },
                  ]}
                />
                <Animated.View
                  style={[
                    styles.skeletonLine,
                    { backgroundColor: colors.warning || '#F59E0B', opacity: pulseAnim, width: 58, height: 14, marginTop: 4 },
                  ]}
                />
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.heroSubRow}>
            <View style={styles.heroStatCol}>
              <Animated.View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: blockSecondary, opacity: pulseAnim, width: 50, height: 10 },
                ]}
              />
              <Animated.View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: colors.success || '#4ADE80', opacity: pulseAnim, width: 62, height: 15, marginTop: 4 },
                ]}
              />
            </View>

            <View style={[styles.heroDivider, { backgroundColor: colors.border }]} />

            <View style={styles.heroStatCol}>
              <Animated.View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: blockSecondary, opacity: pulseAnim, width: 58, height: 10 },
                ]}
              />
              <Animated.View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: blockColor, opacity: pulseAnim, width: 68, height: 15, marginTop: 4 },
                ]}
              />
            </View>

            <View style={[styles.heroDivider, { backgroundColor: colors.border }]} />

            <View style={styles.heroStatCol}>
              <Animated.View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: blockSecondary, opacity: pulseAnim, width: 52, height: 10 },
                ]}
              />
              <Animated.View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: blockColor, opacity: pulseAnim, width: 32, height: 15, marginTop: 4 },
                ]}
              />
            </View>

            <View style={[styles.heroDivider, { backgroundColor: colors.border }]} />

            <View style={styles.heroStatCol}>
              <Animated.View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: blockSecondary, opacity: pulseAnim, width: 52, height: 10 },
                ]}
              />
              <Animated.View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: colors.warning || '#F59E0B', opacity: pulseAnim, width: 64, height: 15, marginTop: 4 },
                ]}
              />
            </View>
          </View>
        )}
      </View>

      {/* 3. Search, Filter & Sort Controls Row */}
      <View style={styles.controlsRow}>
        <Animated.View
          style={[
            styles.searchBarSkeleton,
            { backgroundColor: colors.card, borderColor: colors.border, opacity: pulseAnim },
          ]}
        />
        <Animated.View
          style={[
            styles.iconActionBtnSkeleton,
            { backgroundColor: colors.card, borderColor: colors.border, opacity: pulseAnim },
          ]}
        />
        <Animated.View
          style={[
            styles.iconActionBtnSkeleton,
            { backgroundColor: colors.card, borderColor: colors.border, opacity: pulseAnim },
          ]}
        />
      </View>

      {/* View Mode Chips Row */}
      <View style={styles.viewModeChipsRow}>
        <Animated.View
          style={[
            styles.viewModeChipSkeleton,
            { backgroundColor: colors.primary, opacity: pulseAnim, width: 110 },
          ]}
        />
        <Animated.View
          style={[
            styles.viewModeChipSkeleton,
            { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, opacity: pulseAnim, width: 135 },
          ]}
        />
        <Animated.View
          style={[
            styles.viewModeChipSkeleton,
            { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, opacity: pulseAnim, width: 105 },
          ]}
        />
      </View>

      {/* 4. Daily Expense & Trends Card */}
      <View style={[styles.chartCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.chartHeaderRow}>
          <View style={{ gap: 4 }}>
            <Animated.View
              style={[
                styles.skeletonLine,
                { backgroundColor: blockColor, opacity: pulseAnim, width: 145, height: 15 },
              ]}
            />
            <Animated.View
              style={[
                styles.skeletonLine,
                { backgroundColor: blockSecondary, opacity: pulseAnim, width: 190, height: 11 },
              ]}
            />
          </View>
          <Animated.View
            style={[
              styles.chartBadgeSkeleton,
              { backgroundColor: blockSecondary, opacity: pulseAnim },
            ]}
          />
        </View>

        {/* 7-Day Simulated Bar Columns */}
        <View style={styles.barChartRow}>
          {barHeights.map((h, i) => (
            <View key={`b_col_${i}`} style={styles.barColumn}>
              <Animated.View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: blockSecondary, opacity: pulseAnim, width: 26, height: 8 },
                ]}
              />
              <View style={styles.barTrack}>
                <Animated.View
                  style={[
                    styles.barCapsule,
                    {
                      height: moderateScale(h),
                      backgroundColor: i === 4 ? '#EF4444' : (i % 2 === 0 ? blockColor : colors.primaryLight),
                      opacity: pulseAnim,
                    },
                  ]}
                />
              </View>
              <Animated.View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: blockSecondary, opacity: pulseAnim, width: 22, height: 9 },
                ]}
              />
            </View>
          ))}
        </View>

        {/* Peak spend alert pill */}
        <View style={styles.peakSpendPillWrapper}>
          <Animated.View
            style={[
              styles.peakSpendPillSkeleton,
              { backgroundColor: blockSecondary, opacity: pulseAnim },
            ]}
          />
        </View>
      </View>

      {/* 5. Expense Group Card Skeleton */}
      <View style={[styles.expenseGroupCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.groupCardHeader}>
          <Animated.View
            style={[
              styles.calendarIconSquare,
              { backgroundColor: blockSecondary, opacity: pulseAnim },
            ]}
          />
          <View style={{ flex: 1, gap: 4 }}>
            <Animated.View
              style={[
                styles.skeletonLine,
                { backgroundColor: blockColor, opacity: pulseAnim, width: 85, height: 14 },
              ]}
            />
            <Animated.View
              style={[
                styles.skeletonLine,
                { backgroundColor: blockSecondary, opacity: pulseAnim, width: 125, height: 10 },
              ]}
            />
          </View>
          <Animated.View
            style={[
              styles.skeletonLine,
              { backgroundColor: blockColor, opacity: pulseAnim, width: 68, height: 16 },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    maxWidth: 840,
    alignSelf: 'center',
    paddingVertical: moderateScale(4),
  },
  tripFilterRow: {
    flexDirection: 'row',
    gap: moderateScale(8),
    marginBottom: moderateScale(14),
  },
  chipPill: {
    height: moderateScale(34),
    borderRadius: moderateScale(17),
  },
  heroCard: {
    borderRadius: moderateScale(20),
    borderWidth: 1,
    padding: moderateScale(16),
    marginBottom: moderateScale(14),
  },
  heroTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: moderateScale(12),
  },
  heroTagBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: moderateScale(6),
  },
  iconMini: {
    width: moderateScale(14),
    height: moderateScale(14),
    borderRadius: moderateScale(3),
  },
  shareBtnSkeleton: {
    width: moderateScale(95),
    height: moderateScale(28),
    borderRadius: moderateScale(14),
  },
  heroAmountRow: {
    alignItems: 'center',
    marginVertical: moderateScale(8),
  },
  heroSubRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: moderateScale(12),
    paddingTop: moderateScale(12),
  },
  heroStatCol: {
    alignItems: 'center',
    flex: 1,
  },
  heroDivider: {
    width: 1,
    height: moderateScale(26),
  },
  controlsRow: {
    flexDirection: 'row',
    gap: moderateScale(8),
    alignItems: 'center',
    marginBottom: moderateScale(12),
  },
  searchBarSkeleton: {
    flex: 1,
    height: moderateScale(42),
    borderRadius: moderateScale(12),
    borderWidth: 1,
  },
  iconActionBtnSkeleton: {
    width: moderateScale(42),
    height: moderateScale(42),
    borderRadius: moderateScale(12),
    borderWidth: 1,
  },
  viewModeChipsRow: {
    flexDirection: 'row',
    gap: moderateScale(8),
    marginBottom: moderateScale(16),
  },
  viewModeChipSkeleton: {
    height: moderateScale(32),
    borderRadius: moderateScale(16),
  },
  chartCard: {
    borderRadius: moderateScale(18),
    borderWidth: 1,
    padding: moderateScale(14),
    marginBottom: moderateScale(14),
  },
  chartHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: moderateScale(16),
  },
  chartBadgeSkeleton: {
    width: moderateScale(90),
    height: moderateScale(22),
    borderRadius: moderateScale(11),
  },
  barChartRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: moderateScale(130),
    paddingHorizontal: moderateScale(4),
  },
  barColumn: {
    alignItems: 'center',
    gap: moderateScale(6),
    flex: 1,
  },
  barTrack: {
    height: moderateScale(100),
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  barCapsule: {
    width: moderateScale(16),
    borderRadius: moderateScale(8),
  },
  peakSpendPillWrapper: {
    alignItems: 'center',
    marginTop: moderateScale(14),
  },
  peakSpendPillSkeleton: {
    width: '75%',
    height: moderateScale(24),
    borderRadius: moderateScale(12),
  },
  expenseGroupCard: {
    borderRadius: moderateScale(14),
    borderWidth: 1,
    padding: moderateScale(14),
    marginBottom: moderateScale(12),
  },
  groupCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: moderateScale(10),
  },
  calendarIconSquare: {
    width: moderateScale(36),
    height: moderateScale(36),
    borderRadius: moderateScale(10),
  },
  skeletonLine: {
    borderRadius: moderateScale(5),
  },
});
