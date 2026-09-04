/**
 * Fall/autumn palette, light mode only for now -- matches the mockups this
 * was built from (screenshots, not a live Figma connection; spacing and
 * type scale are approximated by eye, not pulled from exact values).
 * A dark variant is a deliberate later addition, not attempted here: RN has
 * no built-in theme provider, and building one is its own piece of work.
 */
export const colors = {
  background: '#FFF8E8',
  surface: '#FFFDF6',
  border: '#E4D5B7',
  text: '#3A2A20',
  heading: '#674636',
  muted: '#8A7060',
  primary: '#674636',
  onPrimary: '#FFF8E8',
  secondary: '#AAB396',
  danger: '#B3492F',
} as const;

export const radii = {
  input: 10,
  button: 24,
  chip: 16,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
} as const;
