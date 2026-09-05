import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Icon from '../icons';
import * as storage from '../storage';
import { colors, spacing } from '../theme';

const OPTIONS = [1, 5, 15, 30, 0] as const;

function label(minutes: number): string {
  return minutes === 0 ? 'Never' : `After ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

export default function AutoLockScreen() {
  const [minutes, setMinutes] = useState<number | null>(null);

  useEffect(() => {
    storage.readAutoLockMinutes().then(setMinutes);
  }, []);

  const choose = (value: number) => {
    setMinutes(value);
    storage.writeAutoLockMinutes(value);
  };

  return (
    <View style={styles.container}>
      {OPTIONS.map(value => (
        <Pressable key={value} style={styles.row} onPress={() => choose(value)}>
          <Text style={styles.rowText}>{label(value)}</Text>
          {minutes === value && <Icon name="check" size={18} color={colors.primary} />}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  rowText: {
    color: colors.text,
    fontSize: 15,
  },
});
