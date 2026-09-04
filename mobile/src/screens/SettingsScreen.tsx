import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import Icon from '../icons';
import type { SettingsStackScreenProps } from '../navigation';
import * as storage from '../storage';
import { colors, spacing } from '../theme';
import { Card, PillButton, SectionLabel } from '../ui';
import * as vault from '../vault';
import type { DeviceSummary } from '../syncClient';

const AUTO_LOCK_LABELS: Record<number, string> = {
  0: 'Never',
  1: 'After 1 minute',
  5: 'After 5 minutes',
  15: 'After 15 minutes',
  30: 'After 30 minutes',
};

function notYetAvailable(feature: string) {
  Alert.alert('Not yet available', `${feature} isn't implemented yet.`);
}

export default function SettingsScreen({ navigation, onLock }: SettingsStackScreenProps<'SettingsHome'> & { onLock: () => void }) {
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoLockMinutes, setAutoLockMinutes] = useState(15);

  const loadDevices = useCallback(() => {
    vault
      .listDevices()
      .then(setDevices)
      .catch(thrown => setError(thrown instanceof Error ? thrown.message : String(thrown)));
  }, []);

  useFocusEffect(
    useCallback(() => {
      vault.serverUrl().then(setServerUrl);
      storage.readAutoLockMinutes().then(setAutoLockMinutes);
      loadDevices();
    }, [loadDevices]),
  );

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
      <SectionLabel>Devices</SectionLabel>
      {error !== null && <Text style={styles.error}>error: {error}</Text>}
      {(devices ?? [])
        .filter(device => device.revokedAt === null)
        .map(device => (
          <Card key={device.id}>
            <View style={styles.deviceRow}>
              <View style={styles.deviceIcon}>
                <Icon name={device.current ? 'smartphone' : 'monitor'} size={18} color={colors.heading} />
              </View>
              <View style={styles.rowText}>
                <View style={styles.deviceNameRow}>
                  <Text style={styles.rowName}>{device.name}</Text>
                  {device.current && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>This device</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.secondary}>Enrolled {new Date(device.enrolledAt).toLocaleDateString()}</Text>
              </View>
              {!device.current && (
                <Text style={styles.revoke} onPress={() => confirmRevoke(device)}>
                  Revoke
                </Text>
              )}
            </View>
          </Card>
        ))}

      <SectionLabel>Security</SectionLabel>
      <Card onPress={() => navigation.navigate('AutoLock')}>
        <View style={styles.navRow}>
          <View style={styles.rowText}>
            <Text style={styles.rowName}>Auto-lock timeout</Text>
            <Text style={styles.secondary}>{AUTO_LOCK_LABELS[autoLockMinutes] ?? `${autoLockMinutes}m`}</Text>
          </View>
          <Icon name="chevron-right" size={18} color={colors.muted} />
        </View>
      </Card>
      <Card onPress={() => notYetAvailable('Changing the master password')}>
        <View style={styles.navRow}>
          <Text style={styles.rowName}>Change master password</Text>
          <Icon name="chevron-right" size={18} color={colors.muted} />
        </View>
      </Card>

      <SectionLabel>Server Settings</SectionLabel>
      <Card>
        <View style={styles.infoRow}>
          <Text style={styles.rowName}>Server URL</Text>
          <Text style={styles.secondary}>{serverUrl ?? '—'}</Text>
        </View>
      </Card>

      <PillButton title="Lock Vault" variant="outline" onPress={onLock} />
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
  error: {
    color: colors.danger,
    fontSize: 12,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  deviceIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.badge,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  badge: {
    backgroundColor: colors.badge,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    color: colors.heading,
    fontSize: 11,
    fontWeight: '600',
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
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  infoRow: {
    gap: spacing.xs,
  },
});
