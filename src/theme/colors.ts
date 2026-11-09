// ─────────────────────────────────────────────────────
// SplitYourTrip — Powdered Blue + Soft Lavender White + Warm Sunset Peach
// ─────────────────────────────────────────────────────

export const lightColors = {
  primary: '#4A85B6',           // Powdered Blue — soothing, clean signature brand
  primaryLight: 'rgba(74, 133, 182, 0.12)',
  primaryDark: '#386B94',       // Powdered Blue Deep — pressed / emphasis
  secondary: '#F27A59',         // Warm Sunset Peach — radiant energetic accent
  success: '#10B981',           // Emerald 500 — crisp, confident green
  successBg: 'rgba(16, 185, 129, 0.10)',
  danger: '#EF4444',            // Red 500 — clear, unambiguous
  dangerBg: 'rgba(239, 68, 68, 0.08)',
  warning: '#F27A59',           // Warm Sunset Peach
  warningBg: 'rgba(242, 122, 89, 0.12)',
  background: '#F7F5FA',        // Soft Lavender White
  card: '#FFFFFF',
  cardSecondary: '#EFEBF5',     // Soft lavender-tinted secondary surface
  text: '#1A1A24',              // Deep obsidian — high contrast
  textSecondary: '#6B6D82',     // Slate lavender secondary
  textMuted: '#9E9EB2',         // Muted lavender gray
  border: '#E3DFEC',            // Delicate lavender-tinted border
  borderLight: '#EFEBFA',
  surfaceDark: '#141522',
  inputBackground: '#FAF8FD',   // Barely-there lavender white input field
};

export const darkColors = {
  primary: '#7AAFD6',           // Powdered Blue — bright, luminous on dark surfaces
  primaryLight: 'rgba(122, 175, 214, 0.16)',
  primaryDark: '#5890BA',       // Powdered Blue Medium
  secondary: '#FFA38A',         // Warm Sunset Peach — vibrant glow on dark
  success: '#34D399',           // Emerald 400
  successBg: 'rgba(52, 211, 153, 0.14)',
  danger: '#F87171',            // Red 400
  dangerBg: 'rgba(248, 113, 113, 0.14)',
  warning: '#FFA38A',           // Warm Sunset Peach
  warningBg: 'rgba(255, 163, 138, 0.15)',
  background: '#0E0F1A',        // Deep midnight lavender
  card: '#161726',              // Lavender-tinted dark card surface
  cardSecondary: '#1D1E30',     // Inset surface
  text: '#F3F4F8',              // Clean off-white
  textSecondary: '#9DA0B5',     // Cool muted slate
  textMuted: '#686B80',
  border: '#26283E',            // Midnight lavender border
  borderLight: '#1D1F32',
  surfaceDark: '#090A12',
  inputBackground: '#171829',   // Deep lavender input field
};

export { scale, verticalScale, moderateScale, scaleFont, wp, hp, isSmallDevice, isTablet, Device, useResponsive } from './responsive';
import { scaleFont, moderateScale } from './responsive';

export const typography = {
  h1: scaleFont(28),      // Hero headings — bigger, bolder
  h2: scaleFont(22),      // Section headers
  h3: scaleFont(18),      // Card titles
  title: scaleFont(16),   // List item names
  body: scaleFont(14),    // Default body
  caption: scaleFont(12), // Supporting text
  tiny: scaleFont(10),    // Badges, timestamps
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
    xs: 6,        // Tiny badges, status dots
    sm: 8,        // Pills, chips, small tags
    md: 12,       // Inputs, small buttons
    lg: 16,       // Main buttons, action cards
    xl: 22,       // Container cards, modals
    full: 9999,   // Avatars, circular buttons
  },
};
