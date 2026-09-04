/**
 * Vaultiq mobile -- proving-ground shell.
 *
 * Not the vault UI. Covers enrollment and unlock only (CLAUDE.md §0, phase
 * 4) plus the original native-bridge smoke test, kept as a diagnostic once
 * unlocked.
 *
 * @format
 */

import { useEffect, useState } from 'react';
import {
  Button,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import CryptoCore from './src/nativeCryptoCore';
import * as vault from './src/vault';
import type { Status } from './src/vault';

// A fixed, obviously-fake string -- never a real password (CLAUDE.md §2.6).
const TEST_PASSWORD = 'correct horse battery staple';

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const [status, setStatus] = useState<Status | 'loading'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    vault.status().then(setStatus);
  }, []);

  const run = (task: () => Promise<void>) => async () => {
    setError(null);
    setBusy(true);
    try {
      await task();
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <View style={styles.content}>
        {status === 'loading' && <Text>loading…</Text>}
        {status === 'not-enrolled' && (
          <EnrollForm
            busy={busy}
            onSubmit={(serverUrl, token, deviceName, password) =>
              run(async () => {
                await vault.enrollAndUnlock(serverUrl, token, deviceName, password);
                setStatus('unlocked');
              })()
            }
          />
        )}
        {status === 'locked' && (
          <UnlockForm
            busy={busy}
            onSubmit={password =>
              run(async () => {
                await vault.unlock(password);
                setStatus('unlocked');
              })()
            }
          />
        )}
        {status === 'unlocked' && (
          <UnlockedPanel
            onLock={run(async () => {
              await vault.lock();
              setStatus('locked');
            })}
          />
        )}
        {error !== null && <Text style={styles.error}>error: {error}</Text>}
      </View>
    </SafeAreaView>
  );
}

function EnrollForm(props: {
  busy: boolean;
  onSubmit: (serverUrl: string, token: string, deviceName: string, password: string) => void;
}) {
  const [serverUrl, setServerUrl] = useState('');
  const [token, setToken] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [password, setPassword] = useState('');

  return (
    <View style={styles.form}>
      <Text style={styles.title}>Join your vault</Text>
      <Text>Server URL</Text>
      <TextInput
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="https://vault.example.com"
        value={serverUrl}
        onChangeText={setServerUrl}
      />
      <Text>Enrollment token (from an already-enrolled device)</Text>
      <TextInput style={styles.input} autoCapitalize="none" autoCorrect={false} value={token} onChangeText={setToken} />
      <Text>Device name</Text>
      <TextInput style={styles.input} value={deviceName} onChangeText={setDeviceName} />
      <Text>Master password</Text>
      <TextInput style={styles.input} secureTextEntry value={password} onChangeText={setPassword} />
      <Button
        title={props.busy ? 'Joining…' : 'Join'}
        disabled={props.busy}
        onPress={() => props.onSubmit(serverUrl, token, deviceName, password)}
      />
    </View>
  );
}

function UnlockForm(props: { busy: boolean; onSubmit: (password: string) => void }) {
  const [password, setPassword] = useState('');

  return (
    <View style={styles.form}>
      <Text style={styles.title}>Unlock</Text>
      <TextInput style={styles.input} secureTextEntry value={password} onChangeText={setPassword} />
      <Button
        title={props.busy ? 'Unlocking…' : 'Unlock'}
        disabled={props.busy}
        onPress={() => props.onSubmit(password)}
      />
    </View>
  );
}

function UnlockedPanel(props: { onLock: () => void }) {
  const [salt, setSalt] = useState<string | null>(null);
  const [strength, setStrength] = useState<string | null>(null);

  const runSmokeTest = async () => {
    const [generatedSalt, estimated] = await Promise.all([
      CryptoCore.generateSalt(),
      CryptoCore.estimateStrength(TEST_PASSWORD),
    ]);
    setSalt(generatedSalt);
    setStrength(`${estimated.level} (${estimated.bits} bits)`);
  };

  return (
    <View style={styles.form}>
      <Text style={styles.title}>Vault unlocked</Text>
      <Button title="Lock" onPress={props.onLock} />
      <Text style={styles.title}>pw-crypto-core FFI smoke test</Text>
      <Button title="Run" onPress={runSmokeTest} />
      {salt !== null && <Text>salt: {salt}</Text>}
      {strength !== null && <Text>test password strength: {strength}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  form: {
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#888',
    borderRadius: 4,
    padding: 8,
  },
  error: {
    color: 'red',
  },
});

export default App;
