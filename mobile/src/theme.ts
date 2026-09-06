/**
 * Vaultiq mobile redesign v2 palette/type system, light mode only for now --
 * see CLAUDE.md §0. Sourced from the design canvas project ("Vaultiq Mobile
 * Redesign v2.dc.html"), not approximated from screenshots.
 *
 * There is no separate "muted" text color here (design rule 5: hierarchy
 * rides on size, not shade) -- secondary text is the same `ink`, just
 * smaller. Faded ink (`inkAlpha`) is for structural lines/borders only.
 */
export const colors = {
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

/** Ink at reduced opacity, for borders and dividers -- never for text. */
export function inkAlpha(opacity: number): string {
  return `rgba(103, 70, 54, ${opacity})`;
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
