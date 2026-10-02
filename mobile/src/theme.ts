import { DynamicColorIOS, Platform, PlatformColor, type ColorValue } from 'react-native';

/**
 * Vaultiq mobile redesign v2 palette/type system -- see docs/STATUS.md.
 * The light values come from the design canvas project ("Vaultiq Mobile
 * Redesign v2.dc.html"). The dark values keep the same warm cream/brown
 * identity and invert the foreground relationship rather than introducing
 * a second visual language.
 *
 * There is no separate "muted" text color here (design rule 5: hierarchy
 * rides on size, not shade) -- secondary text is the same `ink`, just
 * smaller. Faded ink (`inkAlpha`) is for structural lines/borders only.
 */
export const lightColors = {
  background: '#FFF8E8',
  surface: '#F7EED3',
  card: '#FFFFFF',
  ink: '#674636',
  onInk: '#FFF8E8',
  // State color, not decoration -- see design rule 7.
  sage: '#AAB396', // healthy/in-progress. Never carries text.
  amber: '#B98332', // needs attention, not urgent. Border/icon only, text stays ink.
  rust: '#A63D22', // compromised. Always paired with one action.
} as const;

export const darkColors = {
  background: '#211915',
  surface: '#30241E',
  card: '#3A2B24',
  ink: '#FFF1D6',
  onInk: '#211915',
  sage: '#B8C1A5',
  amber: '#E0AE62',
  rust: '#E17B60',
} as const;

/** Fixed production colors for branded art that should not follow UI mode. */
export const brandColors = {
  ink: lightColors.ink,
  paper: lightColors.onInk,
  sage: lightColors.sage,
} as const;

function dynamicColor(name: string, light: string, dark: string): ColorValue {
  if (Platform.OS === 'ios') return DynamicColorIOS({ light, dark });
  if (Platform.OS === 'android') return PlatformColor(`@color/vaultiq_${name}`);
  return light;
}

export const colors = {
  background: dynamicColor('background', lightColors.background, darkColors.background),
  surface: dynamicColor('surface', lightColors.surface, darkColors.surface),
  card: dynamicColor('card', lightColors.card, darkColors.card),
  ink: dynamicColor('ink', lightColors.ink, darkColors.ink),
  onInk: dynamicColor('on_ink', lightColors.onInk, darkColors.onInk),
  sage: dynamicColor('sage', lightColors.sage, darkColors.sage),
  amber: dynamicColor('amber', lightColors.amber, darkColors.amber),
  rust: dynamicColor('rust', lightColors.rust, darkColors.rust),
  scrim: 'rgba(0, 0, 0, 0.42)',
} as const;

/** Ink at reduced opacity, for borders and dividers -- never for text. */
export function inkAlpha(opacity: number): ColorValue {
  const suffix = String(Math.round(opacity * 100)).padStart(2, '0');
  return dynamicColor(
    `ink_alpha_${suffix}`,
    `rgba(103, 70, 54, ${opacity})`,
    `rgba(255, 241, 214, ${opacity})`,
  );
}

export const radii = {
  input: 12,
  button: 12,
  pill: 999,
  card: 14,
  sheet: 22,
  dialog: 18,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  screen: 20,
  lg: 24,
} as const;

/**
 * Archivo is used as a variable font in the design (continuous `wdth`/`wght`
 * axes); React Native's TextStyle has no `fontVariationSettings` axis, so
 * each combination actually used is bundled as its own pre-instanced static
 * file instead (fetched from Google Fonts' legacy static-instance endpoint,
 * not hand-instanced) -- see android/app/src/main/assets/fonts. This is an
 * approximation of the two width steps the design uses (wdth 79 and 88),
 * not true continuous interpolation.
 */
export const fonts = {
  body: 'SpaceGrotesk-Regular',
  mono: 'IBMPlexMono-Regular',
  // wdth 79, wght 640/700 -- screen titles, section rules, tab/button chrome.
  condensedSemiBold: 'ArchivoCondensed-SemiBold',
  condensedBold: 'ArchivoCondensed-Bold',
  // wdth 88, wght 600/640/700 (640 collapsed into the 600 file -- visually
  // indistinguishable at UI text sizes) -- row names, field labels, wordmark.
  semiCondensedSemiBold: 'ArchivoSemiCondensed-SemiBold',
  semiCondensedBold: 'ArchivoSemiCondensed-Bold',
} as const;
