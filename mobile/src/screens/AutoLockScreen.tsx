import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as storage from '../storage';
import { colors, fonts } from '../theme';
import type { SettingsStackScreenProps } from '../navigation';
import { useState, useEffect } from 'react';

const OPTIONS = [
  { minutes: 1, sub: 'Tightest -- for a shared or public device.' },
  { minutes: 5, sub: 'A short step away is still a lock.' },
  { minutes: 15, sub: 'The usual balance of safety and friction.' },
  { minutes: 30, sub: 'For a device that stays with you.' },
  { minutes: 0, sub: 'Only locks when you ask it to.' },
] as const;

export default function AutoLockScreen({ navigation }: SettingsStackScreenProps<'AutoLock'>) {
  const [minutes, setMinutes] = useState<number | null>(null);

  useEffect(() => {
    storage.readAutoLockMinutes().then(setMinutes);
  }, []);

  const choose = (value: number) => {
    setMinutes(value);
    storage.writeAutoLockMinutes(value);
    navigation.goBack();
  };

  return (
    <Pressable style={styles.backdrop} onPress={() => navigation.goBack()}>
      <Pressable style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.intro}>
          <Text style={styles.title}>Auto-lock timeout</Text>
          <Text style={styles.subtitle}>Vaultiq locks itself after this much inactivity.</Text>
        </View>
        {OPTIONS.map(option => (
          <Pressable key={option.minutes} style={styles.row} onPress={() => choose(option.minutes)}>
            <View style={[styles.radio, minutes === option.minutes && styles.radioSelected]} />
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{option.minutes === 0 ? 'Never' : `After ${option.minutes} minute${option.minutes === 1 ? '' : 's'}`}</Text>
              <Text style={styles.rowSub}>{option.sub}</Text>
            </View>
          </Pressable>
        ))}
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(103, 70, 54, 0.34)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 16,
    paddingBottom: 24,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(103, 70, 54, 0.3)',
    alignSelf: 'center',
    marginBottom: 12,
  },
  intro: {
    gap: 3,
    paddingHorizontal: 6,
    paddingBottom: 12,
  },
  title: {
    fontFamily: fonts.condensedSemiBold,
    fontSize: 26,
    color: colors.ink,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink,
  },
  row: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(103, 70, 54, 0.1)',
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 999,
    borderWidth: 1.8,
    borderColor: colors.ink,
  },
  radioSelected: {
    backgroundColor: colors.ink,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    fontFamily: fonts.body,
    fontSize: 15.5,
    color: colors.ink,
  },
  rowSub: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink,
  },
});
