/**
 * Fall/autumn palette, light mode only for now -- the colors are ours (the
 * Figma set uses teal), but layout/spacing/components now follow the real
 * Figma exports (~/Downloads/screen-*.svg, rasterized and reviewed) rather
 * than approximated screenshots. A dark variant is a deliberate later
 * addition, not attempted here: RN has no built-in theme provider, and
 * building one is its own piece of work.
 */
export const colors = {
  background: '#FFF8E8',
  surface: '#FFFDF6',
  // Card rows sit on `surface`-tinted `background`, one step lighter than
  // both, matching the Figma set's white-cards-on-off-white pattern.
  card: '#FFFFFF',
  badge: '#F1E7D3',
  border: '#E4D5B7',
  text: '#3A2A20',
  heading: '#674636',
  muted: '#8A7060',
  primary: '#674636',
  onPrimary: '#FFF8E8',
  secondary: '#AAB396',
  danger: '#B3492F',
  dangerTint: '#F6D9CE',
} as const;

export const radii = {
  input: 10,
  button: 24,
  chip: 16,
  card: 16,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
} as const;
