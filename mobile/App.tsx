/**
 * Vaultiq mobile -- proving-ground shell.
 *
 * Not the designed vault UI. Covers enrollment, unlock, a read-only item
 * list, and idle auto-lock (CLAUDE.md §0, phase 4), plus the original
 * native-bridge smoke test kept as a diagnostic once unlocked.
 *
 * @format
 */

import { useEffect, useRef, useState } from 'react';
import {
  Button,
  FlatList,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import CryptoCore from './src/nativeCryptoCore';
import * as storage from './src/storage';
import * as vault from './src/vault';
import type { DecryptedItem, Status } from './src/vault';

// A fixed, obviously-fake string -- never a real password (CLAUDE.md §2.6).
const TEST_PASSWORD = 'correct horse battery staple';

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const [status, setStatus] = useState<Status | 'loading'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [autoLockMinutes, setAutoLockMinutes] = useState(15);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    vault.status().then(setStatus);
    storage.readAutoLockMinutes().then(setAutoLockMinutes);
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

  const doLock = run(async () => {
    await vault.lock();
    setStatus('locked');
  });

  // Idle auto-lock: a simple foreground-only timer, reset on any touch.
  // Not full parity with the extension's background alarm (CLAUDE.md §0) --
  // Android backgrounding this app already tends to kill the process,
  // wiping the held vault key regardless, so this covers the gap that
  // matters: staying unlocked while foregrounded and untouched.
  const resetIdleTimer = () => {
    if (idleTimer.current !== null) clearTimeout(idleTimer.current);
    if (status !== 'unlocked' || autoLockMinutes <= 0) return;
    idleTimer.current = setTimeout(doLock, autoLockMinutes * 60_000);
  };

  useEffect(() => {
    resetIdleTimer();
    return () => {
      if (idleTimer.current !== null) clearTimeout(idleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, autoLockMinutes]);

  const updateAutoLockMinutes = (minutes: number) => {
    setAutoLockMinutes(minutes);
    storage.writeAutoLockMinutes(minutes);
  };

  if (status === 'unlocked') {
    return (
      <SafeAreaView style={styles.container} onTouchStart={resetIdleTimer}>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        <UnlockedPanel
          onLock={doLock}
          error={error}
          setError={setError}
          autoLockMinutes={autoLockMinutes}
          onChangeAutoLockMinutes={updateAutoLockMinutes}
        />
      </SafeAreaView>
    );
  }

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

/**
 * Bare item list -- not the designed Vault Home screen. Proves the sync
 * pipeline (pull -> decrypt) works; per-type detail views and real styling
 * are a separate, later slice once there is a design to build against
 * (CLAUDE.md §0).
 */
const AUTO_LOCK_OPTIONS = [1, 5, 15, 30, 0] as const;

function UnlockedPanel(props: {
  onLock: () => void;
  error: string | null;
  setError: (error: string | null) => void;
  autoLockMinutes: number;
  onChangeAutoLockMinutes: (minutes: number) => void;
}) {
  const [items, setItems] = useState<DecryptedItem[] | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [salt, setSalt] = useState<string | null>(null);
  const [strength, setStrength] = useState<string | null>(null);

  const sync = async () => {
    props.setError(null);
    setSyncing(true);
    try {
      setItems(await vault.pullItems());
    } catch (thrown) {
      props.setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSmokeTest = async () => {
    const [generatedSalt, estimated] = await Promise.all([
      CryptoCore.generateSalt(),
      CryptoCore.estimateStrength(TEST_PASSWORD),
    ]);
    setSalt(generatedSalt);
    setStrength(`${estimated.level} (${estimated.bits} bits)`);
  };

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={items ?? []}
      keyExtractor={item => item.id}
      ListHeaderComponent={
        <View style={styles.form}>
          <Text style={styles.title}>Vault unlocked</Text>
          <Button title="Lock" onPress={props.onLock} />
          <Button title={syncing ? 'Syncing…' : 'Sync'} disabled={syncing} onPress={sync} />
          {props.error !== null && <Text style={styles.error}>error: {props.error}</Text>}
          {items !== null && <Text>{items.length} item(s)</Text>}
          <Text style={styles.title}>Auto-lock</Text>
          <View style={styles.row}>
            {AUTO_LOCK_OPTIONS.map(minutes => (
              <Button
                key={minutes}
                title={minutes === 0 ? 'Never' : `${minutes}m`}
                color={props.autoLockMinutes === minutes ? undefined : '#888'}
                onPress={() => props.onChangeAutoLockMinutes(minutes)}
              />
            ))}
          </View>
        </View>
      }
      renderItem={({ item }) => {
        const name =
          (typeof item.content.name === 'string' && item.content.name) ||
          (typeof item.content.username === 'string' && item.content.username) ||
          item.id;
        return (
          <View style={styles.listRow}>
            <Text>{name}</Text>
            <Text style={styles.secondary}>{item.itemType}</Text>
          </View>
        );
      }}
      ListFooterComponent={
        <View style={styles.form}>
          <Text style={styles.title}>pw-crypto-core FFI smoke test</Text>
          <Button title="Run" onPress={runSmokeTest} />
          {salt !== null && <Text>salt: {salt}</Text>}
          {strength !== null && <Text>test password strength: {strength}</Text>}
        </View>
      }
    />
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
  list: {
    flex: 1,
  },
  listContent: {
    padding: 24,
    gap: 12,
  },
  listRow: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#888',
  },
  secondary: {
    color: '#888',
    fontSize: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
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
