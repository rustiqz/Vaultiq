import type { ColorValue } from 'react-native';
import type { PasswordStrength } from '../nativeCryptoCore';
import { colors } from '../theme';

/**
 * Label and color for a password strength level -- the mobile analogue of
 * the extension's STRENGTH_LABEL/level-* CSS (extension/src/popup/index.ts).
 * Levels come from pw-crypto-core's StrengthLevel via uniffi's Kotlin
 * bindings, which render as SCREAMING_SNAKE_CASE enum names
 * (CryptoCoreModule.kt's `strength.level.name`), not the kebab-case the
 * wasm/JSON boundary uses -- a different wire shape for the same value.
 */
const STRENGTH_LABEL: Record<string, string> = {
  VERY_WEAK: 'Very weak',
  WEAK: 'Weak',
  FAIR: 'Fair',
  STRONG: 'Strong',
  EXCELLENT: 'Excellent',
};

function strengthLabel(strength: PasswordStrength): string {
  return `${STRENGTH_LABEL[strength.level] ?? strength.level} · ~${String(strength.bits)} bits`;
}

/**
 * Text color for a strength readout -- a documented exception to design
 * rule 7 (state colors are icon/border-only, text stays ink): this reading
 * needs a legible text color and has nothing else to defer to, the same
 * exception the extension's password-strength meter already makes.
 */
function strengthColor(level: string): ColorValue {
  if (level === 'VERY_WEAK' || level === 'WEAK') return colors.rust;
  if (level === 'FAIR') return colors.amber;
  if (level === 'STRONG') return colors.sage;
  return colors.ink;
}

export { strengthColor, strengthLabel };
