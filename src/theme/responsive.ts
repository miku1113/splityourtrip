import { Dimensions, PixelRatio, Platform } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Standard design baseline (iPhone 11/13/14 or 375x812dp mobile reference)
const BASE_WIDTH = 375;
const BASE_HEIGHT = 812;

// Horizontal scale
export const scale = (size: number): number => {
  return (SCREEN_WIDTH / BASE_WIDTH) * size;
};

// Vertical scale
export const verticalScale = (size: number): number => {
  return (SCREEN_HEIGHT / BASE_HEIGHT) * size;
};

/**
 * Moderate scale with dampening factor (default 0.5).
 * Useful for padding, margin, icons, border-radius.
 */
export const moderateScale = (size: number, factor = 0.5): number => {
  return Math.round(size + (scale(size) - size) * factor);
};

/**
 * Responsive font scale with strict boundary clamping.
 * - On small devices (e.g. 320px - 360px), smoothly scales down so long numbers/labels never wrap.
 * - On large devices / tablets (420px+), scales up moderately without ballooning.
 * - Minimum clamp of 0.82x and max clamp of 1.22x preserves pixel-perfect proportions across all Android/iOS screens.
 */
export const scaleFont = (size: number, factor = 0.35): number => {
  const scaled = size + (scale(size) - size) * factor;
  const ratio = scaled / size;
  const clampedRatio = Math.max(0.82, Math.min(1.22, ratio));
  const finalSize = Math.round(size * clampedRatio);
  // Ensure font is aligned to physical pixels
  return Math.round(PixelRatio.roundToNearestPixel(finalSize));
};

// Percentage of screen width
export const wp = (percentage: number): number => {
  return Math.round((percentage * SCREEN_WIDTH) / 100);
};

// Percentage of screen height
export const hp = (percentage: number): number => {
  return Math.round((percentage * SCREEN_HEIGHT) / 100);
};

// Device category flags
export const isSmallDevice = SCREEN_WIDTH < 375;
export const isMediumDevice = SCREEN_WIDTH >= 375 && SCREEN_WIDTH < 420;
export const isLargeDevice = SCREEN_WIDTH >= 420;
export const isTablet = SCREEN_WIDTH >= 600 || (SCREEN_HEIGHT / SCREEN_WIDTH < 1.45);

export const Device = {
  width: SCREEN_WIDTH,
  height: SCREEN_HEIGHT,
  isSmall: isSmallDevice,
  isMedium: isMediumDevice,
  isLarge: isLargeDevice,
  isTablet,
  isIOS: Platform.OS === 'ios',
  isAndroid: Platform.OS === 'android',
};

export default {
  scale,
  verticalScale,
  moderateScale,
  scaleFont,
  wp,
  hp,
  Device,
  isSmallDevice,
  isTablet,
};
