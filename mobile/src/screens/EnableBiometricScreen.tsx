import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '../icons';
import type { SettingsStackScreenProps } from '../navigation';
import { colors, fonts, spacing } from '../theme';
import { Button, SecretField } from '../ui';
import * as vault from '../vault';

/**
 * Confirms the master password once, then caches it behind one biometric
 * prompt (vault.ts's enableBiometric / BiometricModule.kt) so it can be
 * recovered by fingerprint later without ever asking again -- until it's
 * turned back off, the device's biometrics change, or the password itself
 * changes (which re-wraps the vault key, not this cache, so a stale cached
 * password would silently stop working -- turning fingerprint unlock back
 * on after a password change re-caches the new one).
 */
export default function EnableBiometricScreen({ navigation }: SettingsStackScreenProps<'EnableBiometric'>) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await vault.enableBiometric(password);
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
        <Text style={styles.appBarTitle}>Unlock with fingerprint</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          Confirm your master password once. It's then cached on this device, unlockable only by your fingerprint.
        </Text>
        <SecretField label="Master password" value={password} onChangeText={setPassword} />
        {error !== null && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
      <View style={styles.footer}>
        <Button title={busy ? 'Confirming…' : 'Turn on'} disabled={password === '' || busy} onPress={submit} />
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
    borderBottomColor: 'rgba(103, 70, 54, 0.12)',
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
    borderTopColor: 'rgba(103, 70, 54, 0.12)',
  },
});
