import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Icon from '../icons';
import { copyForAWhile } from '../lib/clipboard';
import {
  LENGTH_MAX,
  LENGTH_MIN,
  SEPARATORS,
  WORDS_MAX,
  WORDS_MIN,
  type GeneratorSettings,
  defaultGeneratorSettings,
  strengthLabel,
} from '../lib/generator';
import CryptoCore from '../nativeCryptoCore';
import Slider from '../Slider';
import * as storage from '../storage';
import { colors, fonts, inkAlpha, radii, spacing } from '../theme';
import { Card, SectionLabel } from '../ui';

const TYPES = [
  { key: 'lowercase', label: 'a–z' },
  { key: 'uppercase', label: 'A–Z' },
  { key: 'digits', label: '0–9' },
  { key: 'symbols', label: '!@#' },
] as const;

/**
 * A password or passphrase generator, reachable from the button on Vault Home.
 *
 * Needs no unlocked vault -- it only asks the crypto core for something random
 * -- and nothing it makes is stored. The settings are, because they are not
 * secret and are tedious to set again.
 */
export default function GeneratorScreen() {
  const [settings, setSettings] = useState<GeneratorSettings>(defaultGeneratorSettings());
  const [loaded, setLoaded] = useState(false);
  const [result, setResult] = useState('');
  const [rating, setRating] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState('');
  const latest = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    let live = true;
    storage.readGeneratorSettings().then(saved => {
      if (!live) return;
      setSettings(saved);
      setLoaded(true);
    });
    const pending = timers.current;
    return () => {
      live = false;
      pending.forEach(clearTimeout);
    };
  }, []);

  const generate = useCallback(async (current: GeneratorSettings) => {
    const mine = ++latest.current;
    setError(null);
    try {
      if (current.mode === 'passphrase') {
        const [phrase, bits] = await Promise.all([
          CryptoCore.generatePassphrase(current.passphrase),
          CryptoCore.passphraseBits(current.passphrase),
        ]);
        if (mine !== latest.current) return;
        setResult(phrase);
        // The entropy of how it was drawn, not a score of the text.
        setRating(`~${bits} bits · ${current.passphrase.words} words`);
        return;
      }
      const password = await CryptoCore.generatePassword(current.password);
      // Overtaken while waiting: scoring what nobody will see is wasted work.
      if (mine !== latest.current) return;
      const strength = await CryptoCore.estimateStrength(password);
      if (mine !== latest.current) return;
      setResult(password);
      setRating(`${strengthLabel(strength.level)} · ~${strength.bits} bits`);
    } catch (thrown) {
      if (mine === latest.current) setError(thrown instanceof Error ? thrown.message : String(thrown));
    }
  }, []);

  // Makes one as soon as the saved settings are in, and again on every change.
  useEffect(() => {
    if (loaded) generate(settings);
  }, [loaded, settings, generate]);

  const change = (next: GeneratorSettings) => {
    setSettings(next);
    storage.writeGeneratorSettings(next).catch(() => {
      // Not remembered; the generator still works.
    });
  };

  const toggleType = (key: (typeof TYPES)[number]['key']) => {
    const next = { ...settings.password, [key]: !settings.password[key] };
    // The core refuses a password with nothing to draw from, so the last type
    // cannot be switched off -- say why instead of silently ignoring the tap.
    if (!TYPES.some(type => next[type.key])) {
      setNote('Keep at least one type selected.');
      timers.current.push(setTimeout(() => setNote(''), 2200));
      return;
    }
    change({ ...settings, password: next });
  };

  const copy = () => {
    if (result === '') return;
    copyForAWhile(result);
    setCopied(true);
    timers.current.push(setTimeout(() => setCopied(false), 1600));
  };

  const phrase = settings.mode === 'passphrase';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.tabs}>
        {(['password', 'passphrase'] as const).map(mode => (
          <Pressable
            key={mode}
            style={[styles.tab, settings.mode === mode && styles.tabActive]}
            onPress={() => change({ ...settings, mode })}
            accessibilityRole="tab"
            accessibilityState={{ selected: settings.mode === mode }}
          >
            <Text style={styles.tabText}>{mode === 'password' ? 'Password' : 'Passphrase'}</Text>
          </Pressable>
        ))}
      </View>

      <Card style={styles.result}>
        <Text style={styles.resultText} selectable>
          {result === '' ? '—' : result}
        </Text>
        <View style={styles.resultActions}>
          <Pressable style={styles.iconButton} onPress={() => generate(settings)} accessibilityRole="button" accessibilityLabel="Generate another">
            <Icon name="regenerate" size={20} color={colors.ink} />
          </Pressable>
          <Pressable style={styles.iconButton} onPress={copy} accessibilityRole="button" accessibilityLabel="Copy">
            {copied ? <Text style={styles.copied}>Copied</Text> : <Icon name="copy" size={20} color={colors.ink} />}
          </Pressable>
        </View>
      </Card>
      <Text style={styles.rating}>{error ?? rating}</Text>

      {phrase ? (
        <>
          <View style={styles.sliderBlock}>
            <View style={styles.sliderLabel}>
              <SectionLabel>Words</SectionLabel>
              <Text style={styles.sliderValue}>{settings.passphrase.words}</Text>
            </View>
            <Slider
              label="Words"
              value={settings.passphrase.words}
              min={WORDS_MIN}
              max={WORDS_MAX}
              onChange={words => change({ ...settings, passphrase: { ...settings.passphrase, words } })}
            />
          </View>

          <SectionLabel>Separator</SectionLabel>
          <View style={styles.chips}>
            {SEPARATORS.map(separator => {
              const on = settings.passphrase.separator === separator.value;
              return (
                <Pressable
                  key={separator.label}
                  style={[styles.chip, on && styles.chipOn]}
                  onPress={() => change({ ...settings, passphrase: { ...settings.passphrase, separator: separator.value } })}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={styles.chipText}>{separator.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <ToggleRow
            label="Capitalize each word"
            value={settings.passphrase.capitalize}
            onValueChange={capitalize => change({ ...settings, passphrase: { ...settings.passphrase, capitalize } })}
          />
          <ToggleRow
            label="Add a number"
            hint="One digit on one word"
            value={settings.passphrase.includeNumber}
            onValueChange={includeNumber => change({ ...settings, passphrase: { ...settings.passphrase, includeNumber } })}
          />
          <Text style={styles.hint}>
            Words come from the EFF long list. Six is plenty for most accounts; use eight or more for a master password.
          </Text>
        </>
      ) : (
        <>
          <View style={styles.sliderBlock}>
            <View style={styles.sliderLabel}>
              <SectionLabel>Length</SectionLabel>
              <Text style={styles.sliderValue}>{settings.password.length}</Text>
            </View>
            <Slider
              label="Length"
              value={settings.password.length}
              min={LENGTH_MIN}
              max={LENGTH_MAX}
              onChange={length => change({ ...settings, password: { ...settings.password, length } })}
            />
          </View>

          <SectionLabel>Include</SectionLabel>
          <View style={styles.chips}>
            {TYPES.map(type => {
              const on = settings.password[type.key];
              return (
                <Pressable
                  key={type.key}
                  style={[styles.chip, on && styles.chipOn]}
                  onPress={() => toggleType(type.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.chipText, styles.chipMono]}>{type.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {note !== '' && <Text style={styles.note}>{note}</Text>}

          <ToggleRow
            label="Avoid look-alike characters"
            hint="0 O o 1 l I"
            value={settings.password.avoidAmbiguous}
            onValueChange={avoidAmbiguous => change({ ...settings, password: { ...settings.password, avoidAmbiguous } })}
          />
        </>
      )}
    </ScrollView>
  );
}

/** An on/off setting with its switch right beside its words. */
function ToggleRow(props: { label: string; hint?: string; value: boolean; onValueChange: (value: boolean) => void }) {
  return (
    <View style={styles.toggleRow}>
      <Switch
        value={props.value}
        onValueChange={props.onValueChange}
        trackColor={{ false: inkAlpha(0.2), true: colors.ink }}
        thumbColor={colors.card}
        accessibilityLabel={props.label}
      />
      <View style={styles.toggleText}>
        <Text style={styles.toggleLabel}>{props.label}</Text>
        {props.hint !== undefined && <Text style={styles.toggleHint}>{props.hint}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.screen, paddingBottom: spacing.lg * 2, gap: spacing.md },
  tabs: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: inkAlpha(0.16),
    backgroundColor: colors.surface,
  },
  tab: { flex: 1, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radii.input - 4 },
  tabActive: { backgroundColor: colors.card, borderWidth: 1, borderColor: inkAlpha(0.2) },
  tabText: { fontFamily: fonts.semiCondensedSemiBold, fontSize: 15, color: colors.ink },
  result: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
  resultText: { flex: 1, fontFamily: fonts.mono, fontSize: 19, lineHeight: 27, color: colors.ink },
  resultActions: { flexDirection: 'row', gap: 4 },
  iconButton: { minWidth: 40, height: 40, borderRadius: radii.input, alignItems: 'center', justifyContent: 'center' },
  copied: { fontFamily: fonts.semiCondensedSemiBold, fontSize: 12, color: colors.ink },
  rating: { fontFamily: fonts.body, fontSize: 13, color: colors.ink, marginTop: -spacing.sm },
  sliderBlock: { gap: 2 },
  sliderLabel: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  sliderValue: { fontFamily: fonts.mono, fontSize: 16, color: colors.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minWidth: 56,
    height: 42,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: inkAlpha(0.3),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
  chipOn: { borderColor: colors.ink, backgroundColor: colors.surface },
  chipText: { fontFamily: fonts.semiCondensedSemiBold, fontSize: 14, color: colors.ink },
  chipMono: { fontFamily: fonts.mono },
  note: { fontFamily: fonts.body, fontSize: 13, color: colors.rust },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 4 },
  toggleText: { flex: 1 },
  toggleLabel: { fontFamily: fonts.semiCondensedSemiBold, fontSize: 15, color: colors.ink },
  toggleHint: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink },
  hint: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.ink },
});
