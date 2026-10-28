import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  PanResponder,
  LayoutChangeEvent,
  Dimensions,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatCurrencyAmount } from '../services/currency';
import { scaleFont, useResponsive } from '../theme/responsive';

export type LineChartTimeframe = 'week' | 'month' | 'year';

export interface ChartExpenseItem {
  id: string;
  amount: number; // in paise
  dateObj: Date;
  description?: string;
  category?: string;
}

interface DataPoint {
  index: number;
  key: string;
  label: string;
  axisLabel: string;
  fullDate: string;
  totalPaise: number;
  count: number;
}

interface SpendingLineChartProps {
  expenses: ChartExpenseItem[];
  userCurrency: string;
  colors: any;
  isDark: boolean;
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const FULL_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function SpendingLineChart({
  expenses,
  userCurrency,
  colors,
  isDark,
}: SpendingLineChartProps) {
  const { width: windowWidth, isSmall, scaleFont: sf } = useResponsive();
  const [timeframe, setTimeframe] = useState<LineChartTimeframe>('week');
  const [offset, setOffset] = useState<number>(0); // 0 = current, -1 = previous, etc.
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);

  const initialWidth = Math.max(windowWidth - 32, 280);
  const [chartWidth, setChartWidth] = useState<number>(initialWidth);

  useEffect(() => {
    if (windowWidth > 0) {
      setChartWidth(prev => {
        const target = Math.max(windowWidth - 32, 280);
        return Math.abs(prev - target) > 5 ? target : prev;
      });
    }
  }, [windowWidth]);

  const chartHeight = 170;
  const paddingTop = 24;
  const paddingBottom = 30;
  const paddingHorizontal = 24;

  const touchSurfaceRef = useRef<View>(null);
  const surfaceLayoutRef = useRef<{ pageX: number; width: number }>({
    pageX: 0,
    width: initialWidth,
  });

  const updateSurfacePosition = () => {
    touchSurfaceRef.current?.measure((_x, _y, width, _height, pageX) => {
      if (width > 0) {
        surfaceLayoutRef.current = { pageX, width };
      }
    });
  };

  // Build aggregated data points based on selected timeframe & offset
  const chartData = useMemo<{
    points: DataPoint[];
    totalPaise: number;
    peakPoint: DataPoint | null;
    avgPaise: number;
    timeframeSubtitle: string;
  }>(() => {
    const now = new Date();

    if (timeframe === 'week') {
      // 7 days ending on target date (now shifted by offset * 7 days)
      const baseEnd = new Date(now.getTime());
      baseEnd.setDate(baseEnd.getDate() + offset * 7);

      const pts: DataPoint[] = [];
      const daysCount = 7;
      let total = 0;

      for (let i = daysCount - 1; i >= 0; i--) {
        const d = new Date(baseEnd.getTime());
        d.setDate(baseEnd.getDate() - i);
        d.setHours(0, 0, 0, 0);

        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dayStr = String(d.getDate()).padStart(2, '0');
        const key = `${y}-${m}-${dayStr}`;

        let dayLabel = d.toLocaleDateString(undefined, { weekday: 'short' });
        if (d.toDateString() === now.toDateString()) {
          dayLabel = 'Today';
        }

        const fullDate = d.toLocaleDateString(undefined, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        });

        pts.push({
          index: pts.length,
          key,
          label: dayLabel,
          axisLabel: dayLabel,
          fullDate,
          totalPaise: 0,
          count: 0,
        });
      }

      // Aggregate matching expenses
      for (const exp of expenses) {
        if (!exp.dateObj) continue;
        const eDate = new Date(exp.dateObj);
        const y = eDate.getFullYear();
        const m = String(eDate.getMonth() + 1).padStart(2, '0');
        const dayStr = String(eDate.getDate()).padStart(2, '0');
        const key = `${y}-${m}-${dayStr}`;

        const match = pts.find(p => p.key === key);
        if (match) {
          match.totalPaise += exp.amount || 0;
          match.count += 1;
          total += exp.amount || 0;
        }
      }

      let peak: DataPoint | null = null;
      for (const p of pts) {
        if (p.totalPaise > 0 && (!peak || p.totalPaise > peak.totalPaise)) {
          peak = p;
        }
      }

      const activeDays = pts.filter(p => p.totalPaise > 0).length;
      const avg = activeDays > 0 ? Math.round(total / activeDays) : 0;

      const firstD = pts[0].fullDate.split(',')[1]?.trim() || pts[0].label;
      const lastD = pts[pts.length - 1].fullDate.split(',')[1]?.trim() || pts[pts.length - 1].label;
      const timeframeSubtitle = `${firstD} – ${lastD}`;

      return {
        points: pts,
        totalPaise: total,
        peakPoint: peak,
        avgPaise: avg,
        timeframeSubtitle,
      };
    }

    if (timeframe === 'month') {
      // Month shifted by offset
      const targetMonthDate = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const targetYear = targetMonthDate.getFullYear();
      const targetMonth = targetMonthDate.getMonth();
      const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();

      const pts: DataPoint[] = [];
      let total = 0;

      for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(targetYear, targetMonth, day);
        const y = targetYear;
        const m = String(targetMonth + 1).padStart(2, '0');
        const dayStr = String(day).padStart(2, '0');
        const key = `${y}-${m}-${dayStr}`;

        // Only display axis labels periodically to prevent clutter
        const isAxisMarker =
          day === 1 ||
          day === 5 ||
          day === 10 ||
          day === 15 ||
          day === 20 ||
          day === 25 ||
          day === daysInMonth;
        const axisLabel = isAxisMarker ? `${day}` : '';

        const fullDate = d.toLocaleDateString(undefined, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        });

        pts.push({
          index: pts.length,
          key,
          label: `${day}`,
          axisLabel,
          fullDate,
          totalPaise: 0,
          count: 0,
        });
      }

      // Aggregate matching expenses
      for (const exp of expenses) {
        if (!exp.dateObj) continue;
        const eDate = new Date(exp.dateObj);
        if (eDate.getFullYear() === targetYear && eDate.getMonth() === targetMonth) {
          const day = eDate.getDate();
          const match = pts[day - 1];
          if (match) {
            match.totalPaise += exp.amount || 0;
            match.count += 1;
            total += exp.amount || 0;
          }
        }
      }

      let peak: DataPoint | null = null;
      for (const p of pts) {
        if (p.totalPaise > 0 && (!peak || p.totalPaise > peak.totalPaise)) {
          peak = p;
        }
      }

      const activeDays = pts.filter(p => p.totalPaise > 0).length;
      const avg = activeDays > 0 ? Math.round(total / activeDays) : 0;
      const timeframeSubtitle = `${FULL_MONTH_NAMES[targetMonth]} ${targetYear}`;

      return {
        points: pts,
        totalPaise: total,
        peakPoint: peak,
        avgPaise: avg,
        timeframeSubtitle,
      };
    }

    // timeframe === 'year'
    // 12 months of year shifted by offset
    const targetYear = now.getFullYear() + offset;
    const pts: DataPoint[] = [];
    let total = 0;

    for (let month = 0; month < 12; month++) {
      const key = `${targetYear}-${String(month + 1).padStart(2, '0')}`;
      const label = MONTH_NAMES[month];
      const fullDate = `${FULL_MONTH_NAMES[month]} ${targetYear}`;

      pts.push({
        index: pts.length,
        key,
        label,
        axisLabel: label,
        fullDate,
        totalPaise: 0,
        count: 0,
      });
    }

    // Aggregate matching expenses
    for (const exp of expenses) {
      if (!exp.dateObj) continue;
      const eDate = new Date(exp.dateObj);
      if (eDate.getFullYear() === targetYear) {
        const month = eDate.getMonth();
        const match = pts[month];
        if (match) {
          match.totalPaise += exp.amount || 0;
          match.count += 1;
          total += exp.amount || 0;
        }
      }
    }

    let peak: DataPoint | null = null;
    for (const p of pts) {
      if (p.totalPaise > 0 && (!peak || p.totalPaise > peak.totalPaise)) {
        peak = p;
      }
    }

    const activeMonths = pts.filter(p => p.totalPaise > 0).length;
    const avg = activeMonths > 0 ? Math.round(total / activeMonths) : 0;
    const timeframeSubtitle = `Year ${targetYear}`;

    return {
      points: pts,
      totalPaise: total,
      peakPoint: peak,
      avgPaise: avg,
      timeframeSubtitle,
    };
  }, [expenses, timeframe, offset]);

  // Compute SVG coordinates and curve paths
  const svgGeometry = useMemo(() => {
    const points = chartData.points;
    if (points.length === 0) {
      return {
        linePath: '',
        areaPath: '',
        coords: [],
        maxVal: 1,
        bottomY: chartHeight - paddingBottom,
      };
    }

    const maxSpend = Math.max(...points.map(p => p.totalPaise), 0);
    // Add 18% headroom above peak spend so top points don't hit the ceiling
    const maxVal = maxSpend > 0 ? maxSpend * 1.18 : 10000;

    const usableWidth = Math.max(chartWidth - paddingHorizontal * 2, 100);
    const usableHeight = chartHeight - paddingTop - paddingBottom;
    const bottomY = chartHeight - paddingBottom;

    const coords = points.map((p, i) => {
      const x = paddingHorizontal + (i / Math.max(points.length - 1, 1)) * usableWidth;
      const ratio = p.totalPaise / maxVal;
      const y = bottomY - ratio * usableHeight;
      return { x, y, point: p };
    });

    if (coords.length === 1) {
      const linePath = `M ${coords[0].x} ${coords[0].y}`;
      return { linePath, areaPath: '', coords, maxVal, bottomY };
    }

    // Build smooth Catmull-Rom spline converted to cubic Bezier curves
    let linePath = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
    for (let i = 0; i < coords.length - 1; i++) {
      const p0 = coords[i === 0 ? 0 : i - 1];
      const p1 = coords[i];
      const p2 = coords[i + 1];
      const p3 = coords[i + 2 < coords.length ? i + 2 : i + 1];

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = Math.min(Math.max(p1.y + (p2.y - p0.y) / 6, paddingTop), bottomY);
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = Math.min(Math.max(p2.y - (p3.y - p1.y) / 6, paddingTop), bottomY);

      linePath += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }

    const first = coords[0];
    const last = coords[coords.length - 1];
    const areaPath = `${linePath} L ${last.x.toFixed(1)} ${bottomY} L ${first.x.toFixed(1)} ${bottomY} Z`;

    return { linePath, areaPath, coords, maxVal, bottomY };
  }, [chartData.points, chartWidth]);

  // Touch & scrubbing coordinate matcher
  const handleTouchAtX = (rawX: number) => {
    const coords = svgGeometry.coords;
    if (coords.length === 0) return;

    const firstX = coords[0].x;
    const lastX = coords[coords.length - 1].x;
    const clampedX = Math.max(firstX, Math.min(rawX, lastX));

    let closestIndex = 0;
    let minDiff = Infinity;

    for (let i = 0; i < coords.length; i++) {
      const diff = Math.abs(coords[i].x - clampedX);
      if (diff < minDiff) {
        minDiff = diff;
        closestIndex = i;
      }
    }

    setSelectedPointIndex(closestIndex);
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          // Capture horizontal scrub smoothly
          return Math.abs(gestureState.dx) > 2;
        },
        // IMPORTANT: Prevent parent vertical ScrollView from canceling our horizontal hover/scrub!
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: evt => {
          setIsScrubbing(true);
          updateSurfacePosition();
          handleTouchAtX(evt.nativeEvent.locationX);
        },
        onPanResponderMove: (evt, gestureState) => {
          const measuredPageX = surfaceLayoutRef.current.pageX;
          let relX = evt.nativeEvent.locationX;
          if (measuredPageX > 0 && gestureState.moveX > 0) {
            relX = gestureState.moveX - measuredPageX;
          }
          handleTouchAtX(relX);
        },
        onPanResponderRelease: () => {
          setIsScrubbing(false);
        },
        onPanResponderTerminate: () => {
          setIsScrubbing(false);
        },
      }),
    [svgGeometry.coords]
  );

  // Active highlighted point
  const activePoint = useMemo(() => {
    if (selectedPointIndex !== null && chartData.points[selectedPointIndex]) {
      const pt = chartData.points[selectedPointIndex];
      const coord = svgGeometry.coords[selectedPointIndex];
      return { ...pt, x: coord?.x ?? 0, y: coord?.y ?? 0 };
    }
    // Fallback to peak point if spend exists
    if (chartData.peakPoint && chartData.peakPoint.totalPaise > 0) {
      const idx = chartData.peakPoint.index;
      const coord = svgGeometry.coords[idx];
      return { ...chartData.peakPoint, x: coord?.x ?? 0, y: coord?.y ?? 0 };
    }
    // Or latest point
    const lastPt = chartData.points[chartData.points.length - 1];
    if (lastPt) {
      const idx = lastPt.index;
      const coord = svgGeometry.coords[idx];
      return { ...lastPt, x: coord?.x ?? 0, y: coord?.y ?? 0 };
    }
    return null;
  }, [selectedPointIndex, chartData.points, chartData.peakPoint, svgGeometry.coords]);

  const onContainerLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (width > 0 && Math.abs(width - chartWidth) > 4) {
      setChartWidth(width);
    }
    updateSurfacePosition();
  };

  return (
    <View
      style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}
      onLayout={onContainerLayout}
    >
      {/* 1. Header: Total Spend for Period + Segmented Timeframe Switcher */}
      <View style={styles.topHeaderRow}>
        <View style={styles.headerLeftCol}>
          <Text style={[styles.headerPeriodLabel, { color: colors.textSecondary }]}>
            {timeframe === 'week' ? 'Past 7 Days' : timeframe === 'month' ? 'Monthly Spend' : 'Yearly Spend'}
          </Text>
          <Text
            style={[styles.headerSpendAmount, { color: colors.text, fontSize: isSmall ? sf(20) : sf(24) }]}
            numberOfLines={1}
            adjustsFontSizeToFit={true}
            minimumFontScale={0.75}
          >
            {formatCurrencyAmount(chartData.totalPaise, userCurrency)}
          </Text>
        </View>

        {/* Timeframe Switcher: [ Week | Month | Year ] */}
        <View
          style={[
            styles.timeframePillsRow,
            {
              backgroundColor: isDark ? 'rgba(30, 41, 59, 0.85)' : '#F1F5F9',
              borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
              padding: isSmall ? 2 : 2.5,
            },
          ]}
        >
          {(['week', 'month', 'year'] as LineChartTimeframe[]).map(tf => {
            const isSelected = timeframe === tf;
            return (
              <TouchableOpacity
                key={tf}
                style={[
                  styles.timeframePill,
                  isSmall && { paddingHorizontal: 8, paddingVertical: 4.5 },
                  isSelected && {
                    backgroundColor: colors.primary,
                    shadowColor: colors.primary,
                    shadowOffset: { width: 0, height: 1.5 },
                    shadowOpacity: 0.28,
                    shadowRadius: 3,
                    elevation: 2,
                  },
                ]}
                onPress={() => {
                  setTimeframe(tf);
                  setOffset(0);
                  setSelectedPointIndex(null);
                }}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.timeframePillText,
                    {
                      color: isSelected ? '#FFFFFF' : colors.textSecondary,
                      fontWeight: isSelected ? '700' : '600',
                      fontSize: isSmall ? sf(10.5) : sf(11.5),
                    },
                  ]}
                >
                  {tf.charAt(0).toUpperCase() + tf.slice(1)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* 2. Date Navigator Sub-header (Row 2, spacious & never clipped) */}
      <View style={styles.dateNavigatorRow}>
        <View style={styles.navControls}>
          <TouchableOpacity
            onPress={() => {
              setOffset(prev => prev - 1);
              setSelectedPointIndex(null);
            }}
            style={[styles.navArrowBtn, { backgroundColor: isDark ? '#2D3748' : '#F1F5F9' }]}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={15} color={colors.text} />
          </TouchableOpacity>

          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
            {chartData.timeframeSubtitle}
          </Text>

          <TouchableOpacity
            onPress={() => {
              setOffset(prev => Math.min(prev + 1, 0));
              setSelectedPointIndex(null);
            }}
            disabled={offset >= 0}
            style={[
              styles.navArrowBtn,
              {
                backgroundColor: isDark ? '#2D3748' : '#F1F5F9',
                opacity: offset >= 0 ? 0.3 : 1,
              },
            ]}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-forward" size={15} color={colors.text} />
          </TouchableOpacity>
        </View>

        {offset !== 0 && (
          <TouchableOpacity
            onPress={() => {
              setOffset(0);
              setSelectedPointIndex(null);
            }}
            style={[styles.resetTodayBtn, { backgroundColor: colors.primary + '20' }]}
            activeOpacity={0.7}
          >
            <Ionicons name="refresh" size={11} color={colors.primary} style={{ marginRight: 3 }} />
            <Text style={[styles.resetTodayText, { color: colors.primary }]}>Current</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 3. Active Point Callout Banner */}
      {activePoint && (
        <View
          style={[
            styles.activePointBanner,
            {
              backgroundColor: isDark ? '#1E293B' : '#F8FAFC',
              borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
            },
          ]}
        >
          <View style={styles.activePointLeft}>
            <View
              style={[
                styles.activePointDot,
                {
                  backgroundColor: activePoint.totalPaise > 0
                    ? (chartData.peakPoint?.key === activePoint.key ? '#EF4444' : colors.primary)
                    : colors.textMuted,
                },
              ]}
            />
            <View style={{ flex: 1, marginRight: 6 }}>
              <Text style={[styles.activePointDate, { color: colors.text, fontSize: sf(12) }]} numberOfLines={1}>
                {activePoint.fullDate}
              </Text>
              <Text style={[styles.activePointHint, { color: colors.textMuted, fontSize: sf(9.5) }]} numberOfLines={1}>
                {isScrubbing ? 'Scrubbing...' : 'Touch & drag chart to inspect'}
              </Text>
            </View>
          </View>

          <View style={styles.activePointRight}>
            <Text
              style={[
                styles.activePointAmount,
                {
                  color: activePoint.totalPaise > 0
                    ? (isDark ? '#38BDF8' : colors.primary)
                    : colors.textMuted,
                  fontSize: sf(13.5),
                },
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit={true}
              minimumFontScale={0.75}
            >
              {formatCurrencyAmount(activePoint.totalPaise, userCurrency)}
            </Text>
            {activePoint.count > 0 ? (
              <View style={[styles.expenseCountPill, { backgroundColor: colors.primary + '18' }]}>
                <Text style={[styles.activePointCount, { color: colors.primary, fontSize: sf(10) }]} numberOfLines={1}>
                  {activePoint.count} {activePoint.count === 1 ? 'exp' : 'exps'}
                </Text>
              </View>
            ) : (
              <Text style={[styles.activePointCount, { color: colors.textMuted, fontSize: sf(10) }]} numberOfLines={1}>
                (0 exps)
              </Text>
            )}
          </View>
        </View>
      )}

      {/* 4. Line Chart Area + Interactive Pure Touch Surface */}
      <View style={styles.chartSvgArea}>
        {/* Visual Layer (Vector Line Chart) */}
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {/* Reference Horizontal Grid Lines */}
          {[0.25, 0.5, 0.75].map(ratio => {
            const usableH = chartHeight - paddingTop - paddingBottom;
            const y = svgGeometry.bottomY - ratio * usableH;
            return (
              <View
                key={ratio}
                style={{
                  position: 'absolute',
                  left: paddingHorizontal,
                  right: paddingHorizontal,
                  top: y,
                  height: 1,
                  backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
                }}
              />
            );
          })}

          {/* Active Point Vertical Guideline */}
          {activePoint && (
            <View
              style={{
                position: 'absolute',
                left: activePoint.x - 0.75,
                top: paddingTop - 6,
                height: Math.max(0, svgGeometry.bottomY - (paddingTop - 6)),
                width: 1.5,
                backgroundColor: colors.primary,
                opacity: 0.65,
              }}
            />
          )}

          {/* Connected Line Segments between consecutive data points */}
          {svgGeometry.coords.map((curr, idx) => {
            if (idx === svgGeometry.coords.length - 1) return null;
            const next = svgGeometry.coords[idx + 1];
            const dx = next.x - curr.x;
            const dy = next.y - curr.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx) * (180 / Math.PI);
            const cx = (curr.x + next.x) / 2;
            const cy = (curr.y + next.y) / 2;

            return (
              <View
                key={`line-seg-${idx}`}
                style={{
                  position: 'absolute',
                  left: cx - length / 2,
                  top: cy - 1.5,
                  width: length,
                  height: 3,
                  backgroundColor: colors.primary,
                  borderRadius: 1.5,
                  transform: [{ rotate: `${angle}deg` }],
                }}
              />
            );
          })}

          {/* Data Points on Line */}
          {svgGeometry.coords.map(({ x, y, point }) => {
            const isSelected = activePoint?.key === point.key;
            const hasSpend = point.totalPaise > 0;
            const isPeak = chartData.peakPoint?.key === point.key && hasSpend;

            // In month view, only draw dots for points that have spend or are selected to keep clean
            if (timeframe === 'month' && !hasSpend && !isSelected) {
              return null;
            }

            return (
              <React.Fragment key={point.key}>
                {isSelected && (
                  <View
                    style={{
                      position: 'absolute',
                      left: x - 11,
                      top: y - 11,
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      backgroundColor: isPeak ? '#EF4444' : colors.primary,
                      opacity: 0.22,
                    }}
                  />
                )}
                <View
                  style={{
                    position: 'absolute',
                    left: x - (isSelected ? 6 : hasSpend ? 4.5 : 3),
                    top: y - (isSelected ? 6 : hasSpend ? 4.5 : 3),
                    width: isSelected ? 12 : hasSpend ? 9 : 6,
                    height: isSelected ? 12 : hasSpend ? 9 : 6,
                    borderRadius: 99,
                    backgroundColor: isPeak ? '#EF4444' : colors.primary,
                    borderWidth: isSelected ? 2.2 : 1.5,
                    borderColor: isDark ? '#1E293B' : '#FFFFFF',
                  }}
                />
              </React.Fragment>
            );
          })}
        </View>

        {/* Floating Tooltip Bubble directly above active scrub position */}
        {activePoint && isScrubbing && (
          <View
            pointerEvents="none"
            style={[
              styles.floatingTooltip,
              {
                left: Math.max(12, Math.min(activePoint.x - 48, chartWidth - 108)),
                top: Math.max(6, activePoint.y - 38),
                backgroundColor: isDark ? '#0F172A' : '#1E293B',
                borderColor: colors.primary,
              },
            ]}
          >
            <Text style={styles.floatingTooltipText}>
              {formatCurrencyAmount(activePoint.totalPaise, userCurrency)}
            </Text>
          </View>
        )}

        {/* X-Axis Labels positioned under points */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {svgGeometry.coords.map(({ x, point }) => {
            if (!point.axisLabel) return null;
            const isSelected = activePoint?.key === point.key;
            return (
              <View
                key={point.key}
                style={[
                  styles.xAxisLabelBox,
                  {
                    left: Math.max(Math.min(x - 22, chartWidth - 44), 0),
                  },
                ]}
              >
                <View
                  style={[
                    styles.xAxisPill,
                    isSelected && {
                      backgroundColor: colors.primary + '20',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.xAxisLabel,
                      {
                        color: isSelected ? colors.primary : colors.textSecondary,
                        fontWeight: isSelected ? '700' : '500',
                        fontSize: timeframe === 'month' ? scaleFont(9) : scaleFont(11),
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {point.axisLabel}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        {/* Isolated Pure Gesture Touch Surface on top of everything */}
        <View
          ref={touchSurfaceRef}
          style={StyleSheet.absoluteFill}
          pointerEvents="box-only"
          onLayout={updateSurfacePosition}
          {...panResponder.panHandlers}
        />
      </View>

      {/* 5. Footer Meta Row: Peak Spend & Average */}
      <View style={[styles.footerMetaRow, { borderTopColor: colors.borderLight }]}>
        {chartData.peakPoint && chartData.peakPoint.totalPaise > 0 ? (
          <View style={styles.peakHighlightRow}>
            <Ionicons name="flame" size={13} color="#EF4444" style={{ marginRight: 4 }} />
            <Text style={[styles.peakHighlightText, { color: colors.textSecondary, fontSize: sf(10.5) }]} numberOfLines={1}>
              Peak: <Text style={{ color: colors.text, fontWeight: '700' }}>{formatCurrencyAmount(chartData.peakPoint.totalPaise, userCurrency)}</Text> ({chartData.peakPoint.label})
            </Text>
          </View>
        ) : (
          <Text style={[styles.emptyMetaText, { color: colors.textMuted, fontSize: sf(10.5) }]} numberOfLines={1}>
            No spending in this period
          </Text>
        )}

        <View style={styles.avgContainer}>
          <Text style={[styles.avgText, { color: colors.primary, fontSize: sf(10.5) }]} numberOfLines={1}>
            Avg: {formatCurrencyAmount(chartData.avgPaise, userCurrency)}/{timeframe === 'year' ? 'mo' : 'day'}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 18,
    borderWidth: 1,
    paddingTop: 16,
    paddingBottom: 10,
    marginBottom: 16,
    overflow: 'hidden',
  },
  topHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  headerLeftCol: {
    flex: 1,
    marginRight: 12,
  },
  headerPeriodLabel: {
    fontSize: scaleFont(11.5),
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  headerSpendAmount: {
    fontSize: scaleFont(24),
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  timeframePillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 11,
    borderWidth: 1,
    padding: 2.5,
  },
  timeframePill: {
    paddingHorizontal: 11,
    paddingVertical: 5.5,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeframePillText: {
    fontSize: scaleFont(11.5),
  },
  dateNavigatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  navControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  navArrowBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSubtitle: {
    fontSize: scaleFont(12.5),
    fontWeight: '600',
  },
  resetTodayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  resetTodayText: {
    fontSize: scaleFont(10.5),
    fontWeight: '700',
  },
  activePointBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 6,
  },
  activePointLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  activePointDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginRight: 8,
  },
  activePointDate: {
    fontSize: scaleFont(12.5),
    fontWeight: '700',
  },
  activePointHint: {
    fontSize: scaleFont(10),
    marginTop: 1,
  },
  activePointRight: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  activePointAmount: {
    fontSize: scaleFont(14),
    fontWeight: '800',
  },
  expenseCountPill: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 5,
    marginTop: 2,
  },
  activePointCount: {
    fontSize: scaleFont(10.5),
    fontWeight: '600',
  },
  chartSvgArea: {
    position: 'relative',
    width: '100%',
    height: 170,
  },
  floatingTooltip: {
    position: 'absolute',
    width: 96,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
    zIndex: 10,
  },
  floatingTooltipText: {
    color: '#FFFFFF',
    fontSize: scaleFont(11.5),
    fontWeight: '800',
  },
  xAxisLabelBox: {
    position: 'absolute',
    bottom: 3,
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  xAxisPill: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  xAxisLabel: {
    textAlign: 'center',
  },
  footerMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 8,
    marginTop: 4,
    borderTopWidth: 1,
  },
  peakHighlightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 6,
  },
  peakHighlightText: {
    fontSize: scaleFont(11),
  },
  emptyMetaText: {
    fontSize: scaleFont(11),
    fontStyle: 'italic',
  },
  avgContainer: {
    alignItems: 'flex-end',
  },
  avgText: {
    fontSize: scaleFont(11),
    fontWeight: '700',
  },
});
