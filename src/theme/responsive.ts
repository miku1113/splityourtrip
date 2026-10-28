import { Dimensions, PixelRatio, Platform, useWindowDimensions } from 'react-native';

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
 * - On small/older devices (e.g. 320px - 360px), smoothly scales down so long numbers/labels never wrap.
 * - Neutralizes excessive OS fontScale inflation (> 1.0) so text never balloons.
 * - Minimum clamp of 0.78x and max clamp of 1.10x preserves pixel-perfect proportions across all Android/iOS screens.
 */
export const scaleFont = (size: number, factor = 0.45): number => {
  const fontScale = PixelRatio.getFontScale() || 1.0;
  const widthRatio = SCREEN_WIDTH / BASE_WIDTH;
  
  // On devices narrower than 375 (e.g. 320px - 360px old phones), gently scale down so layouts never break
  const widthScaled = size * (1 + (widthRatio - 1) * factor);
  
  // If the OS fontScale is > 1.0, counteract the excess multiplier so text doesn't balloon
  const compensated = fontScale > 1.0 ? widthScaled / fontScale : widthScaled;
  
  // Strict clamp: min 78% on ultra-compact screens, max 110% on large tablets
  const clamped = Math.max(size * 0.78, Math.min(size * 1.10, compensated));
  return Math.round(PixelRatio.roundToNearestPixel(clamped));
};

export const defaultFontProps = {
  allowFontScaling: false,
  maxFontSizeMultiplier: 1.0,
} as const;

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

/**
 * Hook to provide dynamically responsive dimensions and scaling functions
 * that update automatically on rotation, foldable unfolding, tablet split screen, or window resizing.
 */
export const useResponsive = () => {
  const { width, height } = useWindowDimensions();
  const isSmall = width < 375;
  const isMedium = width >= 375 && width < 420;
  const isLarge = width >= 420 && width < 768;
  const isTabletDevice = width >= 768 || (height / width < 1.45 && width >= 600);

  const fontScale = PixelRatio.getFontScale() || 1.0;
  const widthRatio = width / BASE_WIDTH;

  const sf = (size: number, factor = 0.45): number => {
    const widthScaled = size * (1 + (widthRatio - 1) * factor);
    const compensated = fontScale > 1.0 ? widthScaled / fontScale : widthScaled;
    const clamped = Math.max(size * 0.78, Math.min(size * 1.15, compensated));
    return Math.round(PixelRatio.roundToNearestPixel(clamped));
  };

  const ms = (size: number, factor = 0.5): number => {
    return Math.round(size + ((width / BASE_WIDTH) * size - size) * factor);
  };

  const sc = (size: number): number => {
    return (width / BASE_WIDTH) * size;
  };

  const wpDyn = (percentage: number): number => {
    return Math.round((percentage * width) / 100);
  };

  const hpDyn = (percentage: number): number => {
    return Math.round((percentage * height) / 100);
  };

  return {
    width,
    height,
    isSmall,
    isMedium,
    isLarge,
    isTablet: isTabletDevice,
    scale: sc,
    moderateScale: ms,
    scaleFont: sf,
    wp: wpDyn,
    hp: hpDyn,
  };
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
  useResponsive,
};
