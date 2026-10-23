import {
  LENGTH_MAX,
  LENGTH_MIN,
  WORDS_MAX,
  WORDS_MIN,
  defaultGeneratorSettings,
  parseGeneratorSettings,
  strengthLabel,
} from './generator';

describe('parseGeneratorSettings', () => {
  it('starts from the defaults when nothing is stored', () => {
    expect(parseGeneratorSettings(null)).toEqual(defaultGeneratorSettings());
  });

  it('falls back to the defaults for something that is not JSON or not an object', () => {
    expect(parseGeneratorSettings('not json')).toEqual(defaultGeneratorSettings());
    expect(parseGeneratorSettings('42')).toEqual(defaultGeneratorSettings());
    expect(parseGeneratorSettings('null')).toEqual(defaultGeneratorSettings());
  });

  it('reads back what was saved', () => {
    const saved = {
      mode: 'passphrase',
      password: { length: 32, lowercase: true, uppercase: false, digits: true, symbols: false, avoidAmbiguous: true },
      passphrase: { words: 8, separator: '.', capitalize: true, includeNumber: true },
    };

    expect(parseGeneratorSettings(JSON.stringify(saved))).toEqual(saved);
  });

  it('clamps a length or word count that is out of range', () => {
    const settings = parseGeneratorSettings(
      JSON.stringify({
        password: { length: 9999, lowercase: true },
        passphrase: { words: 1, separator: '-' },
      }),
    );

    expect(settings.password.length).toBe(LENGTH_MAX);
    expect(settings.passphrase.words).toBe(WORDS_MIN);
    expect(parseGeneratorSettings(JSON.stringify({ password: { length: 1, lowercase: true } })).password.length).toBe(
      LENGTH_MIN,
    );
    expect(parseGeneratorSettings(JSON.stringify({ passphrase: { words: 500 } })).passphrase.words).toBe(WORDS_MAX);
  });

  it('refuses a stored set with every character type off', () => {
    const settings = parseGeneratorSettings(
      JSON.stringify({ password: { length: 30, lowercase: false, uppercase: false, digits: false, symbols: false } }),
    );

    expect(settings.password).toEqual(defaultGeneratorSettings().password);
  });

  it('only accepts a separator from the offered list', () => {
    expect(parseGeneratorSettings(JSON.stringify({ passphrase: { separator: '<script>' } })).passphrase.separator).toBe('-');
    expect(parseGeneratorSettings(JSON.stringify({ passphrase: { separator: '' } })).passphrase.separator).toBe('');
  });

  it('does not trust a value of the wrong type', () => {
    const settings = parseGeneratorSettings(
      JSON.stringify({
        mode: 7,
        password: { length: '20', lowercase: 'yes', digits: true },
        passphrase: { words: '6', capitalize: 'true' },
      }),
    );

    expect(settings.mode).toBe('password');
    expect(settings.password.lowercase).toBe(false);
    expect(settings.password.length).toBe(20);
    expect(settings.passphrase.capitalize).toBe(false);
  });
});

describe('strengthLabel', () => {
  it('turns the native levels into words', () => {
    expect(strengthLabel('VeryWeak')).toBe('Very weak');
    expect(strengthLabel('Excellent')).toBe('Excellent');
  });

  it('passes an unknown level through rather than hiding it', () => {
    expect(strengthLabel('Mystery')).toBe('Mystery');
  });
});
