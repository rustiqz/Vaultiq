/**
 * What the password generator is set to, and how a stored copy of that is read
 * back. Pure on purpose: the screen draws it, the native module makes the
 * password, and this is only the choosing in between.
 *
 * Mirrors `extension/src/popup/index.ts`'s generator (ported, not shared, the
 * same relationship every other lib/ file here has with the extension).
 */

export const LENGTH_MIN = 8;
export const LENGTH_MAX = 64;
export const WORDS_MIN = 3;
export const WORDS_MAX = 12;

/** What can sit between the words of a passphrase. */
export const SEPARATORS: { value: string; label: string }[] = [
  { value: '-', label: '-' },
  { value: ' ', label: 'space' },
  { value: '.', label: '.' },
  { value: '_', label: '_' },
  { value: ',', label: ',' },
  { value: '', label: 'none' },
];

export type PasswordSettings = {
  length: number;
  lowercase: boolean;
  uppercase: boolean;
  digits: boolean;
  symbols: boolean;
  avoidAmbiguous: boolean;
};

export type PassphraseSettings = {
  words: number;
  separator: string;
  capitalize: boolean;
  includeNumber: boolean;
};

export type GeneratorSettings = {
  mode: 'password' | 'passphrase';
  password: PasswordSettings;
  passphrase: PassphraseSettings;
};

export function defaultGeneratorSettings(): GeneratorSettings {
  return {
    mode: 'password',
    password: { length: 20, lowercase: true, uppercase: true, digits: true, symbols: true, avoidAmbiguous: false },
    passphrase: { words: 6, separator: '-', capitalize: false, includeNumber: false },
  };
}

function clampWhole(value: unknown, fallback: number, min: number, max: number): number {
  const whole = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, whole));
}

/**
 * Reads stored settings back, trusting none of it: anything that does not read
 * as a valid setting falls back to its default. A stored set with every
 * character type off would never generate anything, so that falls back too.
 */
export function parseGeneratorSettings(raw: string | null): GeneratorSettings {
  const settings = defaultGeneratorSettings();
  if (raw === null) return settings;

  let saved: unknown;
  try {
    saved = JSON.parse(raw);
  } catch {
    return settings;
  }
  if (typeof saved !== 'object' || saved === null) return settings;
  const record = saved as Record<string, unknown>;

  if (record.mode === 'passphrase') settings.mode = 'passphrase';

  const pw = record.password;
  if (typeof pw === 'object' && pw !== null) {
    const p = pw as Record<string, unknown>;
    const candidate: PasswordSettings = {
      length: clampWhole(p.length, settings.password.length, LENGTH_MIN, LENGTH_MAX),
      lowercase: p.lowercase === true,
      uppercase: p.uppercase === true,
      digits: p.digits === true,
      symbols: p.symbols === true,
      avoidAmbiguous: p.avoidAmbiguous === true,
    };
    if (candidate.lowercase || candidate.uppercase || candidate.digits || candidate.symbols) {
      settings.password = candidate;
    }
  }

  const phrase = record.passphrase;
  if (typeof phrase === 'object' && phrase !== null) {
    const p = phrase as Record<string, unknown>;
    const separator = SEPARATORS.find(each => each.value === p.separator)?.value;
    settings.passphrase = {
      words: clampWhole(p.words, settings.passphrase.words, WORDS_MIN, WORDS_MAX),
      separator: separator ?? settings.passphrase.separator,
      capitalize: p.capitalize === true,
      includeNumber: p.includeNumber === true,
    };
  }
  return settings;
}

/** The native strength levels, as words. */
export function strengthLabel(level: string): string {
  switch (level) {
    case 'VeryWeak':
      return 'Very weak';
    case 'Weak':
      return 'Weak';
    case 'Fair':
      return 'Fair';
    case 'Strong':
      return 'Strong';
    case 'Excellent':
      return 'Excellent';
    default:
      return level;
  }
}
