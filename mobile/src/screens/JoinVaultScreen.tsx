import Clipboard from '@react-native-clipboard/clipboard';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DEV_DEVICE_NAME, DEV_SERVER_URL } from '../devConfig';
import Icon from '../icons';
import { colors, fonts, spacing } from '../theme';
import { Button, Field, SecretField } from '../ui';

type Step = 'welcome' | 'device' | 'password';
const STEP_INDEX: Record<Step, number> = { welcome: 0, device: 1, password: 2 };

export default function JoinVaultScreen(props: {
  busy: boolean;
  error: string | null;
  onSubmit: (serverUrl: string, token: string, deviceName: string, password: string) => void;
}) {
  const [step, setStep] = useState<Step>('welcome');
  const [serverUrl, setServerUrl] = useState(DEV_SERVER_URL);
  const [token, setToken] = useState('');
  const [deviceName, setDeviceName] = useState(DEV_DEVICE_NAME);
  const [password, setPassword] = useState('');

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.appBar}>
        {step !== 'welcome' && (
          <Pressable style={styles.back} onPress={() => setStep(step === 'password' ? 'device' : 'welcome')} hitSlop={8}>
            <Icon name="chevronLeft" size={22} color={colors.ink} />
          </Pressable>
        )}
        <Text style={styles.appBarTitle}>Join vault</Text>
      </View>

      {step !== 'welcome' && (
        <View style={styles.progressWrap}>
          <View style={styles.progressTrack}>
            {[0, 1, 2].map(index => (
              <View key={index} style={[styles.progressSegment, index <= STEP_INDEX[step] && styles.progressSegmentFilled]} />
            ))}
          </View>
          <View style={styles.progressLabelRow}>
            <Text style={styles.stepLabel}>
              Step {STEP_INDEX[step] + 1} of 3 · {step === 'device' ? 'Device' : 'Master password'}
            </Text>
            {step === 'device' && <Text style={styles.stepLabel}>3 fields</Text>}
          </View>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {step === 'welcome' && (
          <View style={styles.welcome}>
            <Text style={styles.welcomeTitle}>Join an existing vault</Text>
            <Text style={styles.welcomeBody}>
              You'll need an enrollment token from a device already trusted on that vault, and the vault's master
              password. Nothing leaves this device unencrypted.
            </Text>
          </View>
        )}

        {step === 'device' && (
          <View style={styles.stepBody}>
            <Text style={styles.stepTitle}>Connect this device</Text>
            <Text style={styles.stepSubtitle}>Paste the invite token from your server admin.</Text>
            <Field label="Server URL" placeholder="https://vault.example.com" autoCapitalize="none" value={serverUrl} onChangeText={setServerUrl} />
            <View>
              <Field
                label="Enrollment token"
                placeholder="0x9F82A…"
                autoCapitalize="none"
                value={token}
                onChangeText={setToken}
                error={props.error ?? undefined}
              />
              <Pressable style={styles.pasteButton} onPress={() => Clipboard.getString().then(setToken)}>
                <Icon name="copy" size={18} color={colors.ink} />
              </Pressable>
            </View>
            <Field label="Device name" value={deviceName} onChangeText={setDeviceName} />
          </View>
        )}

        {step === 'password' && (
          <View style={styles.stepBody}>
            <Text style={styles.stepTitle}>Set the master password</Text>
            <Text style={styles.stepSubtitle}>The same one used to create this vault -- it never leaves this device.</Text>
            <SecretField label="Master password" value={password} onChangeText={setPassword} />
            {props.error !== null && <Text style={styles.error}>{props.error}</Text>}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {step === 'welcome' && <Button title="Get started" onPress={() => setStep('device')} />}
        {step === 'device' && (
          <>
            <Button title="Continue" onPress={() => setStep('password')} disabled={serverUrl === '' || token === '' || deviceName === ''} />
            <Text style={styles.footNote}>Next · set master password</Text>
          </>
        )}
        {step === 'password' && (
          <Button
            title={props.busy ? 'Joining…' : 'Join'}
            disabled={props.busy || password === ''}
            onPress={() => props.onSubmit(serverUrl, token, deviceName, password)}
          />
        )}
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
  appBarTitle: {
    fontFamily: fonts.condensedBold,
    fontSize: 24,
    color: colors.ink,
  },
  progressWrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: 9,
  },
  progressTrack: {
    flexDirection: 'row',
    gap: 6,
  },
  progressSegment: {
    flex: 1,
    height: 4,
    backgroundColor: 'rgba(103, 70, 54, 0.18)',
  },
  progressSegmentFilled: {
    backgroundColor: colors.ink,
  },
  progressLabelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  stepLabel: {
    fontFamily: fonts.condensedBold,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: colors.ink,
  },
  content: {
    padding: spacing.lg,
    paddingTop: 0,
    gap: spacing.md,
  },
  welcome: {
    gap: spacing.sm,
    paddingTop: spacing.lg,
  },
  welcomeTitle: {
    fontFamily: fonts.condensedSemiBold,
    fontSize: 30,
    color: colors.ink,
  },
  welcomeBody: {
    fontFamily: fonts.body,
    fontSize: 14.5,
    lineHeight: 22,
    color: colors.ink,
  },
  stepBody: {
    gap: spacing.md,
  },
  stepTitle: {
    fontFamily: fonts.condensedSemiBold,
    fontSize: 30,
    lineHeight: 33,
    color: colors.ink,
  },
  stepSubtitle: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    lineHeight: 20,
    color: colors.ink,
    marginTop: -8,
  },
  error: {
    fontFamily: fonts.body,
    color: colors.rust,
    fontSize: 12.5,
  },
  pasteButton: {
    position: 'absolute',
    right: 0,
    top: 22,
    width: 44,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    padding: spacing.lg,
    paddingTop: spacing.sm + 2,
    borderTopWidth: 1,
    borderTopColor: 'rgba(103, 70, 54, 0.12)',
    gap: spacing.sm + 2,
  },
  footNote: {
    fontFamily: fonts.condensedBold,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.ink,
    textAlign: 'center',
  },
});
