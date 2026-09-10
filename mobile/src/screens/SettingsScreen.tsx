import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Icon from '../icons';
import LogoMark from '../LogoMark';
import type { SettingsStackScreenProps } from '../navigation';
import * as storage from '../storage';
import { colors, fonts, spacing } from '../theme';
import { Button, Card, SectionLabel, useConfirmDialog } from '../ui';
import * as vault from '../vault';
import type { DeviceSummary } from '../syncClient';

const AUTO_LOCK_LABELS: Record<number, string> = {
  0: 'Never',
  1: 'After 1 minute',
  5: 'After 5 minutes',
  15: 'After 15 minutes',
  30: 'After 30 minutes',
};

export default function SettingsScreen({ navigation, onLock, themeMode, onThemeChange }: SettingsStackScreenProps<'SettingsHome'> & {
  onLock: () => void;
  themeMode: storage.ThemeMode;
  onThemeChange: (mode: storage.ThemeMode) => void;
}) {
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoLockMinutes, setAutoLockMinutes] = useState(15);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const { show, dialog } = useConfirmDialog();

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
      vault.biometricAvailable().then(setBiometricAvailable);
      vault.biometricEnabled().then(setBiometricEnabled);
      loadDevices();
    }, [loadDevices]),
  );

  const toggleBiometric = () => {
    if (biometricEnabled) {
      show('Turn off fingerprint unlock?', 'Your cached password is forgotten. You can turn it back on any time.', [
        { text: 'Cancel' },
        {
          text: 'Turn off',
          destructive: true,
          onPress: () =>
            vault
              .disableBiometric()
              .then(() => setBiometricEnabled(false))
              .catch(thrown => setError(thrown instanceof Error ? thrown.message : String(thrown))),
        },
      ]);
      return;
    }
    navigation.navigate('EnableBiometric');
  };

  const confirmRevoke = (device: DeviceSummary) => {
    show('Revoke device?', `"${device.name}" will no longer be able to sync this vault.`, [
      { text: 'Cancel' },
      {
        text: 'Revoke device',
        destructive: true,
        onPress: () =>
          vault
            .revokeDevice(device.id)
            .then(loadDevices)
            .catch(thrown => setError(thrown instanceof Error ? thrown.message : String(thrown))),
      },
    ]);
  };

  const activeDevices = (devices ?? []).filter(device => device.revokedAt === null);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {dialog}
      {error !== null && <Text style={styles.error}>error: {error}</Text>}

      <View style={styles.section}>
        <SectionLabel>This vault</SectionLabel>
        <Card style={styles.vaultRow}>
          <LogoMark variant={devices === null ? 'syncing' : 'compact'} size={34} color={colors.ink} stateColor={colors.sage} />
          <View style={styles.rowText}>
            <Text style={styles.rowName}>{serverUrl ?? '—'}</Text>
            <Text style={styles.mono}>{activeDevices.length} device{activeDevices.length === 1 ? '' : 's'} enrolled</Text>
          </View>
          <View style={styles.syncDot} />
        </Card>
      </View>

      <View style={styles.section}>
        <SectionLabel>Security</SectionLabel>
        <Card style={styles.group}>
          <Pressable style={styles.groupRow} onPress={() => navigation.navigate('AutoLock')}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Auto-lock timeout</Text>
              <Text style={styles.mono}>{AUTO_LOCK_LABELS[autoLockMinutes] ?? `${autoLockMinutes}m`}</Text>
            </View>
            <Icon name="chevronRight" size={16} color={colors.ink} />
          </Pressable>
          {biometricAvailable && (
            <Pressable style={[styles.groupRow, styles.groupRowDivider]} onPress={toggleBiometric}>
              <Text style={[styles.rowLabel, styles.groupRowFlex]}>Unlock with fingerprint</Text>
              <View style={[styles.toggleOff, biometricEnabled && styles.toggleOn]}>
                <View style={styles.toggleThumb} />
              </View>
            </Pressable>
          )}
          <Pressable style={[styles.groupRow, styles.groupRowDivider]} onPress={() => navigation.navigate('ChangeMasterPassword')}>
            <Text style={[styles.rowLabel, styles.groupRowFlex]}>Change master password</Text>
            <Icon name="chevronRight" size={16} color={colors.ink} />
          </Pressable>
        </Card>
      </View>

      <View style={styles.section}>
        <SectionLabel>Appearance</SectionLabel>
        <Card style={styles.group}>
          <Pressable style={styles.groupRow} onPress={() => onThemeChange(themeMode === 'dark' ? 'light' : 'dark')}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Dark theme</Text>
              <Text style={styles.mono}>{themeMode === 'dark' ? 'On' : 'Off'}</Text>
            </View>
            <View style={[styles.toggleOff, themeMode === 'dark' && styles.toggleOn]}>
              <View style={styles.toggleThumb} />
            </View>
          </Pressable>
        </Card>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <SectionLabel>{`Devices · ${activeDevices.length}`}</SectionLabel>
          <View style={styles.sectionRule} />
        </View>
        <Card style={styles.group}>
          {activeDevices.map((device, index) => (
            <View key={device.id} style={[styles.deviceRow, index > 0 && styles.groupRowDivider]}>
              <Icon name={device.current ? 'smartphone' : 'monitor'} size={20} color={colors.ink} />
              <View style={styles.rowText}>
                <View style={styles.deviceNameRow}>
                  <Text style={styles.rowLabel}>{device.name}</Text>
                  {device.current && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>This device</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.mono}>Enrolled {new Date(device.enrolledAt).toLocaleDateString()}</Text>
              </View>
              {!device.current && (
                <Pressable style={styles.revokeButton} onPress={() => confirmRevoke(device)}>
                  <Text style={styles.revokeButtonText}>Revoke</Text>
                </Pressable>
              )}
            </View>
          ))}
        </Card>
      </View>

      <Button title="Lock vault now" variant="outline" onPress={onLock} />
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
    gap: spacing.lg - 4,
  },
  error: {
    fontFamily: fonts.body,
    color: colors.rust,
    fontSize: 12,
  },
  section: {
    gap: spacing.sm + 2,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionRule: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(103, 70, 54, 0.16)',
  },
  vaultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
  },
  group: {
    overflow: 'hidden',
  },
  groupRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
  },
  groupRowFlex: {
    flex: 1,
  },
  groupRowDivider: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(103, 70, 54, 0.1)',
  },
  rowText: {
    flex: 1,
    gap: 3,
  },
  rowName: {
    fontFamily: fonts.semiCondensedSemiBold,
    fontSize: 15,
    color: colors.ink,
  },
  rowLabel: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
  },
  mono: {
    fontFamily: fonts.mono,
    fontSize: 11.5,
    color: colors.ink,
  },
  syncDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.sage,
  },
  toggleOff: {
    width: 46,
    height: 27,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.ink,
    justifyContent: 'center',
    alignItems: 'flex-start',
    padding: 3,
  },
  toggleOn: {
    backgroundColor: colors.ink,
    borderWidth: 0,
    alignItems: 'flex-end',
  },
  toggleThumb: {
    width: 21,
    height: 21,
    borderRadius: 999,
    backgroundColor: colors.background,
  },
  deviceRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
  },
  deviceNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  badge: {
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    fontFamily: fonts.condensedBold,
    color: colors.ink,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  revokeButton: {
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.rust,
    alignItems: 'center',
    justifyContent: 'center',
  },
  revokeButtonText: {
    fontFamily: fonts.semiCondensedBold,
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.rust,
  },
});
