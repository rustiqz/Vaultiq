import { errorCodes, isErrorWithCode, pick } from '@react-native-documents/picker';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '../icons';
import type { VaultBackup } from '../vault';
import { colors, fonts, inkAlpha, spacing } from '../theme';
import { Button, Field, SecretField } from '../ui';
import { useHardwareBack } from '../useHardwareBack';

/**
 * Restores a vault from a file made with Settings' "Export backup" -- on
 * this device or any other, extension or mobile, since the backup format is
 * shared. Always lands as a local-only vault (see vault.ts's
 * `restoreBackup`), so unlike JoinVaultScreen/CreateVaultScreen there is no
 * server address or invite token to collect, only the file and the
 * password that unlocks it.
 */
export default function RestoreBackupScreen(props: {
  busy: boolean;
  error: string | null;
  onSubmit: (backup: VaultBackup, password: string, deviceName: string) => void;
  /** Back out to the join-or-create choice. */
  onExit?: () => void;
}) {
  const [backup, setBackup] = useState<VaultBackup | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [deviceName, setDeviceName] = useState('');
  useHardwareBack(() => {
    if (props.onExit !== undefined) { props.onExit(); return true; }
    return false;
  });

  const choose = async () => {
    setPickError(null);
    try {
      const [picked] = await pick({ type: ['application/json', 'text/plain'] });
      // Same as ImportScreen's CSV read: fetch handles a content:///file://
      // uri directly, no filesystem dependency needed just to read one.
      const text = await (await fetch(picked.uri)).text();
      const parsed = JSON.parse(text) as VaultBackup;
      if (parsed.kind !== 'vaultiq-backup') throw new Error('not-a-backup');
      setBackup(parsed);
      setFileName(picked.name ?? 'backup.json');
    } catch (thrown) {
      if (isErrorWithCode(thrown) && thrown.code === errorCodes.OPERATION_CANCELED) return;
      setBackup(null);
      setFileName(null);
      setPickError('That file is not a Vaultiq backup.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.appBar}>
        <Pressable style={styles.back} onPress={() => props.onExit?.()} hitSlop={8}>
          <Icon name="chevronLeft" size={22} color={colors.ink} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Restore backup</Text>
        <Text style={styles.body}>
          Restores a vault from a file made with "Export backup." Every item comes back exactly as it was, as a
          local-only vault on this device -- nothing is uploaded anywhere unless you connect it to a server
          afterward.
        </Text>

        <Button title={fileName ?? 'Choose backup file'} variant="outline" onPress={choose} />
        {pickError !== null && <Text style={styles.error}>{pickError}</Text>}

        {backup !== null && (
          <>
            <SecretField label="Master password" value={password} onChangeText={setPassword} />
            <Field label="Device name" optional value={deviceName} onChangeText={setDeviceName} />
          </>
        )}
        {props.error !== null && <Text style={styles.error}>{props.error}</Text>}
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={props.busy ? 'Restoring…' : 'Restore vault'}
          disabled={props.busy || backup === null || password === ''}
          onPress={() => backup !== null && props.onSubmit(backup, password, deviceName)}
        />
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
  },
  back: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  title: {
    fontFamily: fonts.condensedSemiBold,
    fontSize: 30,
    lineHeight: 33,
    color: colors.ink,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 14.5,
    lineHeight: 22,
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
    gap: spacing.sm + 2,
  },
});
