import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '../icons';
import type { SettingsStackScreenProps } from '../navigation';
import { colors, fonts, inkAlpha, spacing } from '../theme';
import { Button, SecretField } from '../ui';
import * as vault from '../vault';

/**
 * Re-wraps the vault key under a new password -- see vault.ts's
 * changeMasterPassword. Nothing is re-encrypted and there is no way back:
 * the old password opens nothing once this succeeds.
 */
export default function ChangeMasterPasswordScreen({ navigation }: SettingsStackScreenProps<'ChangeMasterPassword'>) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirm !== '' && next !== confirm;
  const canSubmit = current !== '' && next !== '' && next === confirm && !busy;

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await vault.changeMasterPassword(current, next);
      navigation.goBack();
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.appBar}>
        <Pressable style={styles.back} onPress={() => navigation.goBack()} hitSlop={8}>
          <Icon name="chevronLeft" size={22} color={colors.ink} />
        </Pressable>
        <Text style={styles.appBarTitle}>Change master password</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          Re-wraps the vault key, so no item is re-encrypted and nothing has to re-sync. Other devices pick the change up the
          next time they sync. The old password then opens nothing, and there is no way back.
        </Text>
        <SecretField label="Current password" value={current} onChangeText={value => { setCurrent(value); setError(null); }} />
        <SecretField label="New password" value={next} onChangeText={value => { setNext(value); setError(null); }} />
        <SecretField label="Confirm new password" value={confirm} onChangeText={value => { setConfirm(value); setError(null); }} />
        {mismatch ? <Text style={styles.error}>Passwords don't match.</Text> : error !== null ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
      <View style={styles.footer}>
        <Button title={busy ? 'Changing…' : 'Change password'} disabled={!canSubmit} onPress={submit} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  appBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: inkAlpha(0.12),
  },
  back: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appBarTitle: {
    fontFamily: fonts.condensedBold,
    fontSize: 22,
    color: colors.ink,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  intro: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.ink,
  },
  error: {
    fontFamily: fonts.body,
    color: colors.rust,
    fontSize: 12.5,
  },
  footer: {
    padding: spacing.lg,
    paddingTop: spacing.sm + 2,
    borderTopWidth: 1,
    borderTopColor: inkAlpha(0.12),
  },
});
