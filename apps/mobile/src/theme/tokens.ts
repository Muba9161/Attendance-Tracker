import { Platform } from 'react-native';
import { STATUS_REGISTRY, getStatusDescriptor, type StatusCategory } from '@vorldx/shared';

export { STATUS_REGISTRY, getStatusDescriptor, type StatusCategory };

// -----------------------------------------------------------------------------
// VORLDX company palette adapted for the existing dark mobile theme.
// -----------------------------------------------------------------------------
export const brandColors = {
  oceanBlue: '#147FB5',
  tealGreen: '#32BDA8',
  deepBlue: '#263D59',
  charcoalGrey: '#62666B',
  white: '#FFFFFF',
  lightBackground: '#F3F8FA',
} as const;

export const colors = {
  brand: brandColors,
  bg: '#142538',
  bgRaised: '#1D354B',
  sidebar: '#172A3E',
  surface: 'rgba(38, 61, 89, 0.72)',
  surfaceStrong: 'rgba(29, 53, 75, 0.96)',
  surfaceSoft: 'rgba(50, 77, 104, 0.52)',
  indigoDeep: '#263D59',
  indigo: brandColors.oceanBlue,
  indigoSoft: '#55A8CC',
  lavender: '#B8CCD6',
  text: '#FFFFFF',
  textSecondary: '#D4E0E8',
  muted: '#A9BAC7',
  success: brandColors.tealGreen,
  warning: '#F5C76B',
  danger: '#FF6B83',
  info: '#147FB5',
  leave: brandColors.tealGreen,
  border: 'rgba(184, 204, 214, 0.18)',
  borderActive: 'rgba(20, 127, 181, 0.58)',
  white: '#FFFFFF',
  black: '#000000',

  // Backward-compatible nested mappings for existing colleague references
  background: {
    base: '#142538',
    surface: 'rgba(38, 61, 89, 0.72)',
    elevated: 'rgba(29, 53, 75, 0.96)',
    hover: 'rgba(50, 77, 104, 0.52)',
    border: 'rgba(184, 204, 214, 0.18)',
    borderLight: 'rgba(184, 204, 214, 0.28)',
  },
  accent: {
    blue: brandColors.oceanBlue,
    blueHover: '#116B99',
    cyan: brandColors.tealGreen,
    cyanMuted: 'rgba(50, 189, 168, 0.15)',
    indigo: brandColors.oceanBlue,
    indigoMuted: 'rgba(20, 127, 181, 0.18)',
  },
  status: {
    present: brandColors.tealGreen,
    presentBg: 'rgba(50, 189, 168, 0.14)',
    late: '#F5C76B',
    lateBg: 'rgba(245, 199, 107, 0.14)',
    absent: '#FF6B83',
    absentBg: 'rgba(255, 107, 131, 0.14)',
    wfh: '#147FB5',
    wfhBg: 'rgba(20, 127, 181, 0.14)',
    demo: brandColors.tealGreen,
    demoBg: 'rgba(50, 189, 168, 0.14)',
    warning: '#F5C76B',
    danger: '#FF6B83',
    success: '#32BDA8',
  },
} as const;

export const alpha = {
  indigo08: 'rgba(20, 127, 181, 0.08)',
  indigo12: 'rgba(20, 127, 181, 0.12)',
  indigo18: 'rgba(20, 127, 181, 0.18)',
  success12: 'rgba(50, 189, 168, 0.12)',
  warning12: 'rgba(245, 199, 107, 0.12)',
  danger12: 'rgba(255, 107, 131, 0.12)',
  info12: 'rgba(20, 127, 181, 0.12)',
  leave12: 'rgba(50, 189, 168, 0.12)',
  white06: 'rgba(255, 255, 255, 0.06)',
  white10: 'rgba(255, 255, 255, 0.1)',
} as const;

export const gradients = {
  primary: ['#147FB5', '#32BDA8'] as const,
  primaryDeep: ['#14597D', '#147FB5'] as const,
  orb: ['#263D59', '#147FB5'] as const,
  success: ['#249D8C', '#32BDA8'] as const,
  danger: ['#D94261', '#FF6B83'] as const,
  screen: ['#142538', '#172A3E', '#142538'] as const,
  card: ['rgba(38, 61, 89, 0.88)', 'rgba(29, 53, 75, 0.92)'] as const,
} as const;

export const fonts = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  mono: 'SpaceMono_400Regular',
  monoBold: 'SpaceMono_700Bold',
} as const;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  giant: 56,
} as const;

export const radii = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  xxl: 30,
  pill: 999,
  full: 9999,
} as const;

export const layout = {
  maxWidth: 760,
  phoneGutter: 18,
  tabBarHeight: 62,
  sidebarWidth: 104,
} as const;

export const shadows = {
  card: Platform.select({
    ios: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 18 },
      shadowOpacity: 0.28,
      shadowRadius: 28,
    },
    android: { elevation: 4 },
    default: {},
  }),
  glow: Platform.select({
    ios: {
    shadowColor: colors.accent.blue,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.45,
      shadowRadius: 24,
    },
    android: { elevation: 8 },
    default: {},
  }),
  glowBlue: {
    shadowColor: '#147FB5',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  glowCyan: {
    shadowColor: '#32BDA8',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
} as const;

export const tones = {
  neutral: { fg: colors.textSecondary, bg: alpha.white06, border: colors.border },
  indigo: { fg: colors.indigoSoft, bg: alpha.indigo12, border: 'rgba(20, 127, 181, 0.42)' },
  success: { fg: colors.success, bg: alpha.success12, border: 'rgba(50, 189, 168, 0.3)' },
  warning: { fg: colors.warning, bg: alpha.warning12, border: 'rgba(245, 199, 107, 0.3)' },
  danger: { fg: colors.danger, bg: alpha.danger12, border: 'rgba(255, 107, 131, 0.3)' },
  info: { fg: colors.info, bg: alpha.info12, border: 'rgba(20, 127, 181, 0.3)' },
  leave: { fg: colors.leave, bg: alpha.leave12, border: 'rgba(50, 189, 168, 0.3)' },
} as const;

export type Tone = keyof typeof tones;

export const typography = {
  xs: { fontSize: 11, lineHeight: 15, fontFamily: fonts.regular },
  sm: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular },
  md: { fontSize: 15, lineHeight: 21, fontFamily: fonts.regular },
  lg: { fontSize: 17, lineHeight: 24, fontFamily: fonts.medium },
  xl: { fontSize: 20, lineHeight: 28, fontFamily: fonts.semibold },
  xxl: { fontSize: 24, lineHeight: 32, fontFamily: fonts.bold },
  hero: { fontSize: 32, lineHeight: 40, fontFamily: fonts.bold },
  sizes: {
    xs: 11,
    sm: 13,
    md: 15,
    lg: 17,
    xl: 20,
    xxl: 24,
  },
} as const;

export function getMobileStatusTheme(status: string | StatusCategory) {
  const descriptor = getStatusDescriptor(status);
  return {
    label: descriptor.label,
    icon: descriptor.icon,
    solidColor: descriptor.solidColor,
    color: descriptor.dark.text,
    bg: descriptor.dark.bg,
    border: descriptor.dark.border,
    ariaLabel: descriptor.ariaLabel,
  };
}
