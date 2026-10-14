export const lightColors = {
  primary: '#5B789A', // Muted Cobalt (deepened for light mode contrast)
  primaryLight: 'rgba(120, 149, 183, 0.15)',
  primaryDark: '#445D78',
  secondary: '#789B80', // Supporting accent sage green
  success: '#689272',
  successBg: 'rgba(104, 146, 114, 0.15)',
  danger: '#D9534F',
  dangerBg: 'rgba(217, 83, 79, 0.12)',
  warning: '#D99B43',
  warningBg: 'rgba(217, 155, 67, 0.12)',
  background: '#F4F6F8',
  card: '#FFFFFF',
  cardSecondary: '#EAEFF5',
  text: '#151B25',
  textSecondary: '#556274',
  textMuted: '#8492A6',
  border: '#D7DEE8',
  borderLight: '#EBF0F6',
  surfaceDark: '#151B25',
  inputBackground: '#FFFFFF',
};

export const darkColors = {
  primary: '#7895B7', // Muted Cobalt Primary
  primaryLight: 'rgba(120, 149, 183, 0.20)',
  primaryDark: '#5B789A',
  secondary: '#9BB4A1', // Supporting Accent Sage Green
  success: '#9BB4A1', // Harmonious supporting accent
  successBg: 'rgba(155, 180, 161, 0.18)',
  danger: '#E07A7A', // Muted soft coral red
  dangerBg: 'rgba(224, 122, 122, 0.18)',
  warning: '#E5B887', // Muted warm sand amber
  warningBg: 'rgba(229, 184, 135, 0.18)',
  background: '#151B25', // Muted Cobalt Deep Background
  card: '#242D3B', // Muted Cobalt Card Surface
  cardSecondary: '#1D2431', // Subtle inset surface
  text: '#F0F2E9', // Crisp light mist text
  textSecondary: '#A3AFC2', // Soft cobalt secondary text
  textMuted: '#6C7A8E', // Dimmed cobalt text
  border: '#2E3A4B', // Subtle slate-cobalt border
  borderLight: '#242D3B',
  surfaceDark: '#0F141C',
  inputBackground: '#1B2330', // Elegant input surface
};

export { scale, verticalScale, moderateScale, scaleFont, wp, hp, isSmallDevice, isTablet, Device } from './responsive';
import { scaleFont, moderateScale } from './responsive';

export const typography = {
  h1: scaleFont(26),
  h2: scaleFont(20),
  h3: scaleFont(18),
  title: scaleFont(16),
  body: scaleFont(14),
  caption: scaleFont(12),
  tiny: scaleFont(10),
};

export const theme = {
  colors: darkColors, // Default to dark as requested!
  typography,
  spacing: {
    xs: moderateScale(4),
    sm: moderateScale(8),
    md: moderateScale(16),
    lg: moderateScale(24),
    xl: moderateScale(32),
  },
  borderRadius: {
    sm: 6,
    md: 12,
    lg: 16,
    xl: 24,
    full: 9999,
  },
};
