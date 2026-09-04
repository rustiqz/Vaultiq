import { useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text } from 'react-native';
import { DEV_DEVICE_NAME, DEV_SERVER_URL } from '../devConfig';
import { colors, spacing } from '../theme';
import { Field, PillButton } from '../ui';

export default function JoinVaultScreen(props: {
  busy: boolean;
  error: string | null;
  onSubmit: (serverUrl: string, token: string, deviceName: string, password: string) => void;
}) {
  const [serverUrl, setServerUrl] = useState(DEV_SERVER_URL);
  const [token, setToken] = useState('');
  const [deviceName, setDeviceName] = useState(DEV_DEVICE_NAME);
  const [password, setPassword] = useState('');

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Join Vault</Text>
        <Field
          label="Server URL"
          placeholder="https://vault.example.com"
          autoCapitalize="none"
          value={serverUrl}
          onChangeText={setServerUrl}
        />
        <Field
          label="Enrollment Token"
          placeholder="From an already-enrolled device"
          autoCapitalize="none"
          value={token}
          onChangeText={setToken}
          error={props.error ?? undefined}
        />
        <Field label="Device Name" value={deviceName} onChangeText={setDeviceName} />
        <Field label="Master Password" secure value={password} onChangeText={setPassword} />
        <PillButton
          title={props.busy ? 'Joining…' : 'Join'}
          disabled={props.busy}
          onPress={() => props.onSubmit(serverUrl, token, deviceName, password)}
        />
        <Text style={styles.footnote}>
          Vault enrollment tokens must be generated on a previously-trusted device running Vaultiq.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.heading,
  },
  footnote: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
