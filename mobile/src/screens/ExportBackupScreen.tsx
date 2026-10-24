import { errorCodes, isErrorWithCode, saveDocuments } from '@react-native-documents/picker';
import * as RNFS from '@dr.pogodin/react-native-fs';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '../icons';
import type { SettingsStackScreenProps } from '../navigation';
import { colors, fonts, inkAlpha, spacing } from '../theme';
import { Button, SecretField } from '../ui';
import * as vault from '../vault';

type Backup = Awaited<ReturnType<typeof vault.exportBackup>>;

/**
 * Exports a full, offline copy of the vault -- but only after the master
 * password (or the fingerprint that releases it) is confirmed again. The file
 * is ciphertext, yet it is the whole vault; see vault.ts's `exportBackup`.
 *
 * `saveDocuments` only saves an *existing* source file, not raw bytes, so the
 * backup is written to an app-private temp file first and removed again once
 * the save completes, fails, or is cancelled.
 */
export default function ExportBackupScreen({ navigation }: SettingsStackScreenProps<'ExportBackup'>) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([vault.biometricAvailable(), vault.biometricEnabled()]).then(([available, enabled]) => {
      if (live) setFingerprint(available && enabled);
    });
    return () => {
      live = false;
    };
  }, []);

  const run = async (build: () => Promise<Backup>) => {
    setError(null);
    setBusy(true);
    const tempPath = `${RNFS.CachesDirectoryPath}/vaultiq-backup.json`;
    try {
      const backup = await build();
      await RNFS.writeFile(tempPath, JSON.stringify(backup, null, 2), 'utf8');
      const [saved] = await saveDocuments({
        sourceUris: [`file://${tempPath}`],
        mimeType: 'application/json',
        fileName: `vaultiq-backup-${backup.exportedAt.slice(0, 10)}.json`,
      });
      if (saved.error !== null) throw new Error(saved.error);
      setPassword('');
      navigation.goBack();
    } catch (thrown) {
      // A dismissed system dialog or fingerprint prompt is "nothing happened".
      const code = thrown !== null && typeof thrown === 'object' && 'code' in thrown ? (thrown as { code?: unknown }).code : undefined;
      const cancelled = (isErrorWithCode(thrown) && thrown.code === errorCodes.OPERATION_CANCELED) || code === 'biometric_cancelled';
      if (!cancelled) setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      await RNFS.unlink(tempPath).catch(() => {});
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.appBar}>
        <Pressable style={styles.back} onPress={() => navigation.goBack()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="chevronLeft" size={22} color={colors.ink} />
        </Pressable>
        <Text style={styles.appBarTitle}>Export backup</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          The file holds your whole vault, still encrypted, and opens with your master password. Confirm it is you before it
          leaves the app.
        </Text>
        <SecretField label="Master password" value={password} onChangeText={value => { setPassword(value); setError(null); }} />
        {error !== null && <Text style={styles.error}>{error}</Text>}
        {fingerprint && (
          <Button title="Use fingerprint instead" variant="outline" disabled={busy} onPress={() => run(vault.exportBackupWithBiometric)} />
        )}
      </ScrollView>
      <View style={styles.footer}>
        <Button
          title={busy ? 'Exporting…' : 'Export'}
          disabled={password === '' || busy}
          onPress={() => run(() => vault.exportBackup(password))}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  appBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: inkAlpha(0.12),
  },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  appBarTitle: { fontFamily: fonts.condensedBold, fontSize: 22, color: colors.ink },
  content: { padding: spacing.lg, gap: spacing.md },
  intro: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.ink },
  error: { fontFamily: fonts.body, color: colors.rust, fontSize: 12.5 },
  footer: { padding: spacing.lg, paddingTop: spacing.sm + 2, borderTopWidth: 1, borderTopColor: inkAlpha(0.12) },
});
