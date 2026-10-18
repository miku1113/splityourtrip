import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, ActivityIndicator, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { moderateScale, scaleFont } from '../theme/responsive';

interface ChatFeedSkeletonProps {
  colors: {
    card: string;
    border: string;
    cardSecondary: string;
    primary: string;
    primaryLight: string;
    textSecondary: string;
    textMuted: string;
    successBg?: string;
    success?: string;
  };
  isDark?: boolean;
}

export default function ChatFeedSkeleton({ colors, isDark }: ChatFeedSkeletonProps) {
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
      {/* 0. Subtle Top Sync Indicator */}
      <View style={styles.topStatusRow}>
        <View style={[styles.topStatusPill, { backgroundColor: colors.cardSecondary, borderColor: colors.border }]}>
          <ActivityIndicator size="small" color={colors.primary} style={{ transform: [{ scale: 0.72 }] }} />
          <Text style={[styles.topStatusText, { color: colors.textSecondary }]}>
            Loading messages & expenses...
          </Text>
        </View>
      </View>

      {/* 1. First Expense Card Skeleton */}
      <View style={styles.cardContainer}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Top Badge & Impact Row */}
          <View style={styles.badgeRow}>
            <View style={[styles.tripBadge, { backgroundColor: colors.primaryLight }]}>
              <Ionicons name="airplane" size={11} color={colors.primary} style={{ opacity: 0.8 }} />
              <Animated.View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: colors.primary, opacity: pulseAnim, width: 68, height: 10, borderRadius: 5 },
                ]}
              />
            </View>
            <Animated.View
              style={[
                styles.skeletonLine,
                { backgroundColor: blockSecondary, opacity: pulseAnim, width: 95, height: 12 },
              ]}
            />
          </View>

          {/* Main Expense Row */}
          <View style={styles.expenseMainRow}>
            <View style={[styles.iconBox, { backgroundColor: colors.successBg || colors.primaryLight }]}>
              <Ionicons name="receipt" size={20} color={colors.success || colors.primary} style={{ opacity: 0.6 }} />
            </View>
            <View style={{ flex: 1, gap: 5 }}>
              <Animated.View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: blockColor, opacity: pulseAnim, width: '58%', height: 15 },
                ]}
              />
              <Animated.View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: blockSecondary, opacity: pulseAnim, width: '82%', height: 11 },
                ]}
              />
            </View>
            <Animated.View
              style={[
                styles.skeletonLine,
                { backgroundColor: blockColor, opacity: pulseAnim, width: 64, height: 19 },
              ]}
            />
          </View>

          {/* Bottom Row: Timestamp & View Bill Button */}
          <View style={[styles.cardBottomRow, { borderTopColor: colors.border }]}>
            <Animated.View
              style={[
                styles.skeletonLine,
                { backgroundColor: blockSecondary, opacity: pulseAnim, width: 48, height: 11 },
              ]}
            />
            <View style={[styles.actionBtnPlaceholder, { backgroundColor: colors.primary }]}>
              <Animated.View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: '#FFFFFF', opacity: pulseAnim, width: 54, height: 11, borderRadius: 6 },
                ]}
              />
            </View>
          </View>
        </View>
      </View>

      {/* 2. Outgoing Chat Bubble Skeleton (Right-aligned) */}
      <View style={styles.bubbleRightContainer}>
        <View style={[styles.bubbleRight, { backgroundColor: colors.primary, opacity: 0.68 }]}>
          <Animated.View
            style={[
              styles.skeletonLine,
              { backgroundColor: '#FFFFFF', opacity: pulseAnim, width: 130, height: 13 },
            ]}
          />
          <Animated.View
            style={[
              styles.skeletonLine,
              { backgroundColor: '#FFFFFF', opacity: pulseAnim, width: 75, height: 11, marginTop: 4 },
            ]}
          />
          <View style={{ alignSelf: 'flex-end', marginTop: 5 }}>
            <Animated.View
              style={[
                styles.skeletonLine,
                { backgroundColor: 'rgba(255,255,255,0.7)', opacity: pulseAnim, width: 38, height: 9 },
              ]}
            />
          </View>
        </View>
      </View>

      {/* 3. Second Expense Card Skeleton */}
      <View style={styles.cardContainer}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Top Badge & Impact Row */}
          <View style={styles.badgeRow}>
            <View style={[styles.tripBadge, { backgroundColor: colors.primaryLight }]}>
              <Ionicons name="people" size={11} color={colors.primary} style={{ opacity: 0.8 }} />
              <Animated.View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: colors.primary, opacity: pulseAnim, width: 80, height: 10, borderRadius: 5 },
                ]}
              />
            </View>
            <Animated.View
              style={[
                styles.skeletonLine,
                { backgroundColor: blockSecondary, opacity: pulseAnim, width: 88, height: 12 },
              ]}
            />
          </View>

          {/* Main Expense Row */}
          <View style={styles.expenseMainRow}>
            <View style={[styles.iconBox, { backgroundColor: colors.successBg || colors.primaryLight }]}>
              <Ionicons name="receipt" size={20} color={colors.success || colors.primary} style={{ opacity: 0.6 }} />
            </View>
            <View style={{ flex: 1, gap: 5 }}>
              <Animated.View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: blockColor, opacity: pulseAnim, width: '68%', height: 15 },
                ]}
              />
              <Animated.View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: blockSecondary, opacity: pulseAnim, width: '75%', height: 11 },
                ]}
              />
            </View>
            <Animated.View
              style={[
                styles.skeletonLine,
                { backgroundColor: blockColor, opacity: pulseAnim, width: 72, height: 19 },
              ]}
            />
          </View>

          {/* Bottom Row: Timestamp & View Bill Button */}
          <View style={[styles.cardBottomRow, { borderTopColor: colors.border }]}>
            <Animated.View
              style={[
                styles.skeletonLine,
                { backgroundColor: blockSecondary, opacity: pulseAnim, width: 44, height: 11 },
              ]}
            />
            <View style={[styles.actionBtnPlaceholder, { backgroundColor: colors.primary }]}>
              <Animated.View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: '#FFFFFF', opacity: pulseAnim, width: 54, height: 11, borderRadius: 6 },
                ]}
              />
            </View>
          </View>
        </View>
      </View>

      {/* 4. Incoming Chat Bubble Skeleton (Left-aligned) */}
      <View style={styles.bubbleLeftContainer}>
        <View style={[styles.bubbleLeft, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Animated.View
            style={[
              styles.skeletonLine,
              { backgroundColor: blockColor, opacity: pulseAnim, width: 140, height: 13 },
            ]}
          />
          <View style={{ alignSelf: 'flex-start', marginTop: 5 }}>
            <Animated.View
              style={[
                styles.skeletonLine,
                { backgroundColor: blockSecondary, opacity: pulseAnim, width: 40, height: 9 },
              ]}
            />
          </View>
        </View>
      </View>

      {/* 5. Third Expense Card Skeleton */}
      <View style={styles.cardContainer}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.badgeRow}>
            <View style={[styles.tripBadge, { backgroundColor: colors.primaryLight }]}>
              <Ionicons name="airplane" size={11} color={colors.primary} style={{ opacity: 0.8 }} />
              <Animated.View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: colors.primary, opacity: pulseAnim, width: 62, height: 10, borderRadius: 5 },
                ]}
              />
            </View>
            <Animated.View
              style={[
                styles.skeletonLine,
                { backgroundColor: blockSecondary, opacity: pulseAnim, width: 80, height: 12 },
              ]}
            />
          </View>

          <View style={styles.expenseMainRow}>
            <View style={[styles.iconBox, { backgroundColor: colors.successBg || colors.primaryLight }]}>
              <Ionicons name="receipt" size={20} color={colors.success || colors.primary} style={{ opacity: 0.6 }} />
            </View>
            <View style={{ flex: 1, gap: 5 }}>
              <Animated.View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: blockColor, opacity: pulseAnim, width: '52%', height: 15 },
                ]}
              />
              <Animated.View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: blockSecondary, opacity: pulseAnim, width: '68%', height: 11 },
                ]}
              />
            </View>
            <Animated.View
              style={[
                styles.skeletonLine,
                { backgroundColor: blockColor, opacity: pulseAnim, width: 58, height: 19 },
              ]}
            />
          </View>

          <View style={[styles.cardBottomRow, { borderTopColor: colors.border }]}>
            <Animated.View
              style={[
                styles.skeletonLine,
                { backgroundColor: blockSecondary, opacity: pulseAnim, width: 40, height: 11 },
              ]}
            />
            <View style={[styles.actionBtnPlaceholder, { backgroundColor: colors.primary }]}>
              <Animated.View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: '#FFFFFF', opacity: pulseAnim, width: 54, height: 11, borderRadius: 6 },
                ]}
              />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: moderateScale(6),
    paddingBottom: moderateScale(20),
  },
  topStatusRow: {
    alignItems: 'center',
    marginVertical: 6,
  },
  topStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  topStatusText: {
    fontSize: scaleFont(11),
    fontWeight: '600',
  },
  cardContainer: {
    marginVertical: 6,
    alignItems: 'center',
    width: '100%',
  },
  card: {
    width: '94%',
    borderRadius: 16,
    borderWidth: 1,
    padding: moderateScale(14),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: moderateScale(10),
  },
  tripBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  expenseMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: moderateScale(12),
  },
  iconBox: {
    width: moderateScale(42),
    height: moderateScale(42),
    borderRadius: moderateScale(21),
    alignItems: 'center',
    justifyContent: 'center',
  },
  skeletonLine: {
    borderRadius: 6,
  },
  cardBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  actionBtnPlaceholder: {
    paddingHorizontal: moderateScale(14),
    paddingVertical: 6,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleRightContainer: {
    marginVertical: 5,
    paddingHorizontal: '4%',
    alignItems: 'flex-end',
    width: '100%',
  },
  bubbleRight: {
    maxWidth: '78%',
    borderRadius: 18,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleLeftContainer: {
    marginVertical: 5,
    paddingHorizontal: '4%',
    alignItems: 'flex-start',
    width: '100%',
  },
  bubbleLeft: {
    maxWidth: '78%',
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
});
