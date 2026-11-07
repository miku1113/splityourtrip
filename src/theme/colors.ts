// ─────────────────────────────────────────────────────
// SplitYourTrip — Vibrant Indigo + Warm Amber Palette
// ─────────────────────────────────────────────────────

export const lightColors = {
  primary: '#6366F1',           // Indigo 500 — signature brand
  primaryLight: 'rgba(99, 102, 241, 0.10)',
  primaryDark: '#4F46E5',       // Indigo 600 — pressed / emphasis
  secondary: '#F59E0B',         // Amber 500 — warm accent
  success: '#10B981',           // Emerald 500 — crisp, confident green
  successBg: 'rgba(16, 185, 129, 0.10)',
  danger: '#EF4444',            // Red 500 — clear, unambiguous
  dangerBg: 'rgba(239, 68, 68, 0.08)',
  warning: '#F59E0B',           // Amber 500
  warningBg: 'rgba(245, 158, 11, 0.10)',
  background: '#F5F6FA',        // Cool off-white with faint indigo tint
  card: '#FFFFFF',
  cardSecondary: '#EEEEF6',     // Subtle indigo-tinted secondary surface
  text: '#111827',              // Gray 900 — near-black for contrast
  textSecondary: '#6B7280',     // Gray 500
  textMuted: '#9CA3AF',         // Gray 400
  border: '#E5E7EB',            // Gray 200
  borderLight: '#F3F4F6',       // Gray 100
  surfaceDark: '#111827',
  inputBackground: '#F9FAFB',   // Gray 50 — barely-there tint
};

export const darkColors = {
  primary: '#818CF8',           // Indigo 400 — brighter on dark
  primaryLight: 'rgba(129, 140, 248, 0.14)',
  primaryDark: '#6366F1',       // Indigo 500
  secondary: '#FBBF24',         // Amber 400 — warm pop on dark
  success: '#34D399',           // Emerald 400
  successBg: 'rgba(52, 211, 153, 0.14)',
  danger: '#F87171',            // Red 400
  dangerBg: 'rgba(248, 113, 113, 0.14)',
  warning: '#FBBF24',           // Amber 400
  warningBg: 'rgba(251, 191, 36, 0.14)',
  background: '#0B0F1A',       // Deep midnight — richer than generic #151B25
  card: '#151926',              // Indigo-tinted card — NOT gray
  cardSecondary: '#111528',     // Even deeper inset surface
  text: '#F3F4F6',              // Gray 100 — clean white
  textSecondary: '#9CA3AF',     // Gray 400
  textMuted: '#6B7280',         // Gray 500
  border: '#1E2235',            // Indigo-tinted border — not slate
  borderLight: '#181C2E',
  surfaceDark: '#070A14',
  inputBackground: '#121629',   // Deep indigo input field
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
