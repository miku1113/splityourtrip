// ─────────────────────────────────────────────────────
// SplitYourTrip — Brand Color Palette
// Moonlight Silver + Charcoal Gray + Dull Red + Dull Green + Muted Amber
// ─────────────────────────────────────────────────────

export const lightColors = {
  primary: '#2B2F36',           // Charcoal Gray anchor
  primaryLight: 'rgba(43, 47, 54, 0.10)',
  primaryDark: '#1E2126',       // Deepest Charcoal
  secondary: '#B5504F',         // Dull Red — alerts, amounts owed
  success: '#5E8C6A',           // Dull Green — settled payments, active badges
  successBg: 'rgba(94, 140, 106, 0.12)',
  danger: '#B5504F',            // Dull Red
  dangerBg: 'rgba(181, 80, 79, 0.12)',
  warning: '#C9A15B',           // Muted Amber — pending, syncing
  warningBg: 'rgba(201, 161, 91, 0.14)',
  background: '#F1F3F7',        // Moonlight Silver White
  card: '#FFFFFF',
  cardSecondary: '#E5E8EE',
  text: '#1E2126',              // Charcoal Black
  textSecondary: '#64748B',     // Slate Silver secondary
  textMuted: '#94A3B8',
  border: '#D0D5DD',
  borderLight: '#E4E7EC',
  surfaceDark: '#1E2126',
  inputBackground: '#F8FAFC',
  silver: '#E8ECF2',            // Brighter Moonlight Silver
  silverBg: '#E8ECF2',
  textOnSilver: '#B5504F',      // Dull Red text / highlights on Moonlight Silver
  silverBadgeText: '#B5504F',
};

export const darkColors = {
  primary: '#E8ECF2',           // Brighter Moonlight Silver (RGB 232, 236, 242) — luminous buttons, key surfaces, icons
  primaryLight: 'rgba(232, 236, 242, 0.16)',
  primaryDark: '#C5CAD3',       // Metallic Silver gradient accent
  secondary: '#B5504F',         // Dull Red (RGB 181, 80, 79) — alerts, amounts owed, highlight
  success: '#5E8C6A',           // Dull Green (RGB 94, 140, 106) — settled payments, active badges
  successBg: 'rgba(94, 140, 106, 0.15)',
  danger: '#B5504F',            // Dull Red
  dangerBg: 'rgba(181, 80, 79, 0.15)',
  warning: '#C9A15B',           // Muted Amber (RGB 201, 161, 91) — pending, syncing
  warningBg: 'rgba(201, 161, 91, 0.15)',
  background: '#2B2F36',        // Charcoal Gray (RGB 43, 47, 54) — app backgrounds, nav bars
  card: '#323740',              // Elevated Charcoal card surface
  cardSecondary: '#3A3F49',     // Inset Charcoal surface
  text: '#F8FAFC',              // Moonlight White
  textSecondary: '#A0A7B5',     // Soft Silver secondary text
  textMuted: '#6B7280',         // Slate Charcoal
  border: '#3E4450',            // Charcoal border
  borderLight: '#343940',
  surfaceDark: '#1E2126',
  inputBackground: '#24272D',   // Deep Charcoal input field
  silver: '#E8ECF2',            // Brighter Moonlight Silver
  silverBg: '#E8ECF2',
  textOnSilver: '#B5504F',      // Dull Red text / highlights over Moonlight Silver
  silverBadgeText: '#B5504F',
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
