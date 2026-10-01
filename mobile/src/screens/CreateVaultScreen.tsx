import Clipboard from '@react-native-clipboard/clipboard';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DEV_DEVICE_NAME, DEV_SERVER_URL } from '../devConfig';
import Icon from '../icons';
import { parseEnrollmentQr } from '../lib/enrollmentQr';
import QrScannerView from '../QrScannerView';
import { colors, fonts, inkAlpha, spacing } from '../theme';
import { Button, Field, SecretField } from '../ui';
import { useHardwareBack } from '../useHardwareBack';

type Step = 'welcome' | 'device' | 'password';
const STEP_INDEX: Record<Step, number> = { welcome: 0, device: 1, password: 2 };

/**
 * Creates a brand-new vault -- the mobile analogue of the extension's "Set
 * up a new server" (extension/src/popup/sync-panel.ts), reshaped into the
 * same three-step wizard JoinVaultScreen already uses so the two entry
 * points read as one flow rather than two unrelated screens. The essential
 * difference from joining: this device generates its own fresh crypto
 * (there's nothing to match), and the last step asks the user to *choose* a
 * password rather than enter one that already exists -- no confirmation
 * field, matching the extension's own "Create your vault" screen, which
 * warns instead of double-entry.
 */
export default function CreateVaultScreen(props: {
  busy: boolean;
  error: string | null;
  onSubmit: (serverUrl: string, token: string, deviceName: string, password: string) => void;
  /** Back out to the join-or-create choice, from the welcome step. */
  onExit?: () => void;
}) {
  const [step, setStep] = useState<Step>('welcome');
  const [serverUrl, setServerUrl] = useState(DEV_SERVER_URL);
  const [token, setToken] = useState('');
  const [deviceName, setDeviceName] = useState(DEV_DEVICE_NAME);
  const [password, setPassword] = useState('');
  const [scanning, setScanning] = useState(false);
  useHardwareBack(() => {
    if (scanning) return false;
    if (step === 'password') { setStep('device'); return true; }
    if (step === 'device') { setStep('welcome'); return true; }
    if (props.onExit !== undefined) { props.onExit(); return true; }
    return false;
  });

  if (scanning) {
    return (
      <QrScannerView
        title="Scan registration QR"
        invalidMessage="That QR code is not a Vaultiq registration invite."
        onCancel={() => setScanning(false)}
        onScan={value => {
          const invite = parseEnrollmentQr(value);
          if (invite === null || invite.kind !== 'account') return false;
          setServerUrl(invite.serverUrl);
          setToken(invite.token);
          setScanning(false);
          return true;
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {(step !== 'welcome' || props.onExit !== undefined) && (
        <View style={styles.appBar}>
          <Pressable
            style={styles.back}
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => (step === 'welcome' ? props.onExit?.() : setStep(step === 'password' ? 'device' : 'welcome'))}
            hitSlop={8}
          >
            <Icon name="chevronLeft" size={22} color={colors.ink} />
          </Pressable>
        </View>
      )}

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
            <Text style={styles.welcomeTitle}>Create a new vault</Text>
            <Text style={styles.welcomeBody}>
              You'll need a registration token -- from the server's admin, or logged at boot on a fresh server. This
              device becomes the vault's first, with a password only you choose.
            </Text>
          </View>
        )}

        {step === 'device' && (
          <View style={styles.stepBody}>
            <Text style={styles.stepTitle}>Connect this device</Text>
            <Text style={styles.stepSubtitle}>Scan the registration invite, or enter its details below.</Text>
            <Pressable style={styles.scanButton} onPress={() => setScanning(true)}>
              <Icon name="scan" size={23} color={colors.ink} />
              <View style={styles.scanButtonText}>
                <Text style={styles.scanButtonTitle}>Scan registration QR</Text>
                <Text style={styles.scanButtonHint}>Fills the server URL and token.</Text>
              </View>
            </Pressable>
            <Field label="Server URL" placeholder="https://vault.example.com" autoCapitalize="none" value={serverUrl} onChangeText={setServerUrl} />
            <View>
              <Field
                label="Registration token"
                placeholder="0x9F82A…"
                autoCapitalize="none"
                value={token}
                onChangeText={setToken}
                error={props.error ?? undefined}
              />
              <Pressable style={styles.pasteButton} onPress={() => Clipboard.getString().then(setToken)} accessibilityRole="button" accessibilityLabel="Paste from clipboard">
                <Icon name="copy" size={18} color={colors.ink} />
              </Pressable>
            </View>
            <Field label="Device name" value={deviceName} onChangeText={setDeviceName} />
          </View>
        )}

        {step === 'password' && (
          <View style={styles.stepBody}>
            <Text style={styles.stepTitle}>Choose a master password</Text>
            <Text style={styles.stepSubtitle}>
              Never stored or sent anywhere. If it's lost, this vault cannot be recovered -- there is no reset.
            </Text>
            <SecretField label="Master password" value={password} onChangeText={setPassword} />
            {props.error !== null && <Text style={styles.error}>{props.error}</Text>}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {step === 'welcome' && <Button title="Get started" onPress={() => setStep('device')} />}
        {step === 'device' && (
          <>
            <Button title="Continue" onPress={() => setStep('password')} disabled={serverUrl.trim() === '' || token.trim() === '' || deviceName.trim() === ''} />
            <Text style={styles.footNote}>Next · choose master password</Text>
          </>
        )}
        {step === 'password' && (
          <Button
            title={props.busy ? 'Creating…' : 'Create vault'}
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
    backgroundColor: inkAlpha(0.18),
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
  scanButton: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.ink,
    borderRadius: 12,
  },
  scanButtonText: { flex: 1, gap: 2 },
  scanButtonTitle: { fontFamily: fonts.semiCondensedBold, fontSize: 15, color: colors.ink },
  scanButtonHint: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink },
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
    borderTopColor: inkAlpha(0.12),
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
