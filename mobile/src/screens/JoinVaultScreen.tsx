import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
      <View style={styles.header}>
        <Text style={styles.title}>Join Vault</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Field
          label="Server URL"
          placeholder="https://vault.example.com"
          autoCapitalize="none"
          value={serverUrl}
          onChangeText={setServerUrl}
        />
        <Field
          label="Enrollment Token"
          placeholder="0x9F82A…"
          autoCapitalize="none"
          value={token}
          onChangeText={setToken}
          error={props.error ?? undefined}
        />
        <Field label="Device Name" value={deviceName} onChangeText={setDeviceName} />
        <Field label="Master Password" secure value={password} onChangeText={setPassword} />
      </ScrollView>
      <View style={styles.footer}>
        <PillButton
          title={props.busy ? 'Joining…' : 'Join'}
          disabled={props.busy}
          onPress={() => props.onSubmit(serverUrl, token, deviceName, password)}
        />
        <Text style={styles.footnote}>
          Vault enrollment tokens must be generated on a previously-trusted device running Vaultiq.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  footer: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  footnote: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
  },
});
