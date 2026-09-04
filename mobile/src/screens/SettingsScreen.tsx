import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as storage from '../storage';
import { colors, spacing } from '../theme';
import { Chip, PillButton } from '../ui';
import * as vault from '../vault';
import type { DeviceSummary } from '../syncClient';

const AUTO_LOCK_OPTIONS = [1, 5, 15, 30, 0] as const;

export default function SettingsScreen(props: { onLock: () => void }) {
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoLockMinutes, setAutoLockMinutes] = useState(15);

  const loadDevices = () => {
    vault
      .listDevices()
      .then(setDevices)
      .catch(thrown => setError(thrown instanceof Error ? thrown.message : String(thrown)));
  };

  useEffect(() => {
    vault.serverUrl().then(setServerUrl);
    storage.readAutoLockMinutes().then(setAutoLockMinutes);
    loadDevices();
  }, []);

  const updateAutoLockMinutes = (minutes: number) => {
    setAutoLockMinutes(minutes);
    storage.writeAutoLockMinutes(minutes);
  };

  const confirmRevoke = (device: DeviceSummary) => {
    Alert.alert('Revoke device?', `"${device.name}" will no longer be able to sync this vault.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: () =>
          vault
            .revokeDevice(device.id)
            .then(loadDevices)
            .catch(thrown => setError(thrown instanceof Error ? thrown.message : String(thrown))),
      },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Devices</Text>
      {error !== null && <Text style={styles.error}>error: {error}</Text>}
      {(devices ?? [])
        .filter(device => device.revokedAt === null)
        .map(device => (
          <View key={device.id} style={styles.deviceRow}>
            <View style={styles.rowText}>
              <Text style={styles.rowName}>
                {device.name}
                {device.current ? ' (this device)' : ''}
              </Text>
              <Text style={styles.secondary}>Enrolled {new Date(device.enrolledAt).toLocaleDateString()}</Text>
            </View>
            {!device.current && <Text style={styles.revoke} onPress={() => confirmRevoke(device)}>Revoke</Text>}
          </View>
        ))}

      <Text style={styles.title}>Auto-lock</Text>
      <View style={styles.chipRow}>
        {AUTO_LOCK_OPTIONS.map(minutes => (
          <Chip
            key={minutes}
            label={minutes === 0 ? 'Never' : `${minutes}m`}
            active={autoLockMinutes === minutes}
            onPress={() => updateAutoLockMinutes(minutes)}
          />
        ))}
      </View>

      <Text style={styles.title}>Server</Text>
      <Text style={styles.secondary}>{serverUrl ?? '—'}</Text>

      <PillButton title="Lock Vault" danger onPress={props.onLock} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.heading,
    marginTop: spacing.sm,
  },
  error: {
    color: colors.danger,
    fontSize: 12,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  rowText: {
    flex: 1,
  },
  rowName: {
    color: colors.text,
    fontWeight: '600',
  },
  secondary: {
    color: colors.muted,
    fontSize: 12,
  },
  revoke: {
    color: colors.danger,
    fontWeight: '600',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
