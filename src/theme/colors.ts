// ─────────────────────────────────────────────────────
// SplitYourTrip — Charcoal Gray + Moonlight Silver + Signal Red Palette
// ─────────────────────────────────────────────────────

export const lightColors = {
  primary: '#1E2229',           // Charcoal Gray — bold, confident anchor
  primaryLight: 'rgba(30, 34, 41, 0.10)',
  primaryDark: '#121418',       // Deepest Charcoal — pressed / emphasis
  secondary: '#DC2626',         // Signal Red — bold, high-visibility highlight
  success: '#10B981',           // Emerald 500 — crisp, confident green
  successBg: 'rgba(16, 185, 129, 0.10)',
  danger: '#DC2626',            // Signal Red
  dangerBg: 'rgba(220, 38, 38, 0.08)',
  warning: '#F59E0B',           // Warm Amber
  warningBg: 'rgba(245, 158, 11, 0.10)',
  background: '#F1F3F7',        // Moonlight Silver White
  card: '#FFFFFF',
  cardSecondary: '#E4E7EC',     // Soft Silver secondary card
  text: '#111318',              // Charcoal Black — maximum legibility
  textSecondary: '#64748B',     // Slate Silver secondary
  textMuted: '#94A3B8',         // Muted Silver
  border: '#D0D5DD',            // Polished Silver border
  borderLight: '#E4E7EC',
  surfaceDark: '#111318',
  inputBackground: '#F8FAFC',   // Crisp Silver White input field
  silver: '#E2E8F0',            // Moonlight Silver surface
  silverBg: '#E2E8F0',
  textOnSilver: '#DC2626',      // Signal Red text / icons over Moonlight Silver
  silverBadgeText: '#DC2626',
};

export const darkColors = {
  primary: '#E2E8F0',           // Moonlight Silver — luminous, clean metallic sheen
  primaryLight: 'rgba(226, 232, 240, 0.14)',
  primaryDark: '#CBD5E1',       // Polished Silver
  secondary: '#EF4444',         // Signal Red — high-contrast vibrant highlight
  success: '#34D399',           // Emerald 400
  successBg: 'rgba(52, 211, 153, 0.14)',
  danger: '#EF4444',            // Signal Red
  dangerBg: 'rgba(239, 68, 68, 0.14)',
  warning: '#FBBF24',           // Amber 400
  warningBg: 'rgba(251, 191, 36, 0.14)',
  background: '#14161A',        // Matte Charcoal Gray
  card: '#1E2229',              // Elevated Charcoal card surface
  cardSecondary: '#272C35',     // Inset Charcoal surface
  text: '#F8FAFC',              // Clean Moonlight White
  textSecondary: '#94A3B8',     // Silver Mist secondary text
  textMuted: '#64748B',         // Slate Charcoal
  border: '#2E3440',            // Charcoal border
  borderLight: '#242832',
  surfaceDark: '#0D0E12',
  inputBackground: '#1A1D24',   // Deep Charcoal input field
  silver: '#E2E8F0',            // Moonlight Silver surface
  silverBg: '#E2E8F0',
  textOnSilver: '#EF4444',      // Signal Red text / icons over Moonlight Silver
  silverBadgeText: '#EF4444',
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
