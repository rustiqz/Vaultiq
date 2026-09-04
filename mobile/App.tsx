/**
 * Vaultiq mobile -- proving-ground shell.
 *
 * Join Vault, Unlock, and Vault Home are styled against the real mockups
 * (fall palette -- see src/theme.ts); everything past that -- item detail,
 * New Item, Settings, Autofill -- has no plumbing behind it yet and stays
 * unstyled. Covers enrollment, unlock, a read-only item list, and idle
 * auto-lock (CLAUDE.md §0, phase 4), plus the original native-bridge smoke
 * test kept as a diagnostic once unlocked.
 *
 * @format
 */

import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  FlatList,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import CryptoCore from './src/nativeCryptoCore';
import { DEV_DEVICE_NAME, DEV_SERVER_URL } from './src/devConfig';
import * as storage from './src/storage';
import { colors, radii, spacing } from './src/theme';
import * as vault from './src/vault';
import type { DecryptedItem, Status } from './src/vault';

// A fixed, obviously-fake string -- never a real password (CLAUDE.md §2.6).
const TEST_PASSWORD = 'correct horse battery staple';

function App() {
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
        <StatusBar barStyle="dark-content" />
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
      <StatusBar barStyle="dark-content" />
      <View style={styles.content}>
        {status === 'loading' && <ActivityIndicator color={colors.primary} />}
        {status === 'not-enrolled' && (
          <EnrollForm
            busy={busy}
            error={error}
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
            error={error}
            onSubmit={password =>
              run(async () => {
                await vault.unlock(password);
                setStatus('unlocked');
              })()
            }
          />
        )}
      </View>
    </SafeAreaView>
  );
}

/** A labelled input, styled per the mockups -- optionally maskable with a Show/Hide toggle. */
function Field(props: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secure?: boolean;
  error?: string;
  autoCapitalize?: 'none' | 'sentences';
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, props.error !== undefined && styles.inputError]}
          autoCapitalize={props.autoCapitalize ?? 'sentences'}
          autoCorrect={false}
          placeholder={props.placeholder}
          placeholderTextColor={colors.muted}
          secureTextEntry={props.secure === true && !revealed}
          value={props.value}
          onChangeText={props.onChangeText}
        />
        {props.secure === true && (
          <Pressable style={styles.reveal} onPress={() => setRevealed(r => !r)}>
            <Text style={styles.revealText}>{revealed ? 'Hide' : 'Show'}</Text>
          </Pressable>
        )}
      </View>
      {props.error !== undefined && <Text style={styles.fieldError}>{props.error}</Text>}
    </View>
  );
}

function PillButton(props: { title: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      style={[styles.pillButton, props.disabled === true && styles.pillButtonDisabled]}
      disabled={props.disabled}
      onPress={props.onPress}
    >
      <Text style={styles.pillButtonText}>{props.title}</Text>
    </Pressable>
  );
}

function EnrollForm(props: {
  busy: boolean;
  error: string | null;
  onSubmit: (serverUrl: string, token: string, deviceName: string, password: string) => void;
}) {
  const [serverUrl, setServerUrl] = useState(DEV_SERVER_URL);
  const [token, setToken] = useState('');
  const [deviceName, setDeviceName] = useState(DEV_DEVICE_NAME);
  const [password, setPassword] = useState('');

  return (
    <View style={styles.form}>
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
    </View>
  );
}

function UnlockForm(props: { busy: boolean; error: string | null; onSubmit: (password: string) => void }) {
  const [password, setPassword] = useState('');

  return (
    <View style={styles.form}>
      {props.error !== null && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>⚠ Unable to unlock vault</Text>
        </View>
      )}
      <View style={styles.brand}>
        <View style={styles.brandMark}>
          <Text style={styles.brandMarkText}>V</Text>
        </View>
        <Text style={styles.brandTitle}>Vaultiq</Text>
      </View>
      <Field label="Master Password" secure value={password} onChangeText={setPassword} />
      <PillButton title={props.busy ? 'Unlocking…' : 'Unlock'} disabled={props.busy} onPress={() => props.onSubmit(password)} />
      <View style={styles.infoBox}>
        <Text style={styles.infoBoxText}>
          Zero-knowledge vault — no password recovery is possible.
        </Text>
      </View>
    </View>
  );
}

const AUTO_LOCK_OPTIONS = [1, 5, 15, 30, 0] as const;
const ITEM_TYPES = ['login', 'card', 'identity', 'note', 'totp'] as const;
const ITEM_TYPE_LABELS: Record<string, string> = {
  login: 'Logins',
  card: 'Cards',
  identity: 'Identities',
  note: 'Notes',
  totp: 'Authenticators',
};

/**
 * Vault Home, styled against the mockup -- search + type filter chips over
 * the real (currently empty) synced item list -- plus the diagnostics
 * (auto-lock settings, FFI smoke test) that have no mockup of their own yet.
 */
function UnlockedPanel(props: {
  onLock: () => void;
  error: string | null;
  setError: (error: string | null) => void;
  autoLockMinutes: number;
  onChangeAutoLockMinutes: (minutes: number) => void;
}) {
  const [items, setItems] = useState<DecryptedItem[] | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
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

  const visible = (items ?? []).filter(item => {
    if (typeFilter !== null && item.itemType !== typeFilter) return false;
    if (query.trim() === '') return true;
    const name = typeof item.content.name === 'string' ? item.content.name : '';
    const username = typeof item.content.username === 'string' ? item.content.username : '';
    return `${name} ${username}`.toLowerCase().includes(query.trim().toLowerCase());
  });

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={visible}
      keyExtractor={item => item.id}
      ListHeaderComponent={
        <View>
          <View style={styles.homeHeader}>
            <View style={styles.brandMarkSmall}>
              <Text style={styles.brandMarkTextSmall}>V</Text>
            </View>
            <Text style={styles.brandTitleSmall}>Vaultiq</Text>
          </View>
          <TextInput
            style={styles.search}
            placeholder="Search vault items"
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={setQuery}
          />
          <FlatList
            horizontal
            data={[null, ...ITEM_TYPES]}
            keyExtractor={type => type ?? 'all'}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
            renderItem={({ item: type }) => (
              <Pressable
                style={[styles.chip, typeFilter === type && styles.chipActive]}
                onPress={() => setTypeFilter(type)}
              >
                <Text style={[styles.chipText, typeFilter === type && styles.chipTextActive]}>
                  {type === null ? 'All' : ITEM_TYPE_LABELS[type]}
                </Text>
              </Pressable>
            )}
          />
          {props.error !== null && <Text style={styles.fieldError}>error: {props.error}</Text>}
          {items !== null && visible.length === 0 && (
            <Text style={styles.emptyState}>
              {items.length === 0 ? 'No items in this vault yet.' : 'No items match.'}
            </Text>
          )}
        </View>
      }
      renderItem={({ item }) => {
        const name =
          (typeof item.content.name === 'string' && item.content.name) ||
          (typeof item.content.username === 'string' && item.content.username) ||
          item.id;
        const secondary = typeof item.content.username === 'string' ? item.content.username : item.itemType;
        return (
          <View style={styles.listRow}>
            <View style={styles.rowIcon}>
              <Text style={styles.rowIconText}>{item.itemType.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowName}>{name}</Text>
              <Text style={styles.secondary}>{secondary}</Text>
            </View>
          </View>
        );
      }}
      ListFooterComponent={
        <View style={styles.form}>
          <PillButton title="Lock Vault" onPress={props.onLock} />
          <PillButton title={syncing ? 'Syncing…' : 'Sync'} disabled={syncing} onPress={sync} />

          <Text style={styles.title}>Auto-lock</Text>
          <View style={styles.chipRow}>
            {AUTO_LOCK_OPTIONS.map(minutes => (
              <Pressable
                key={minutes}
                style={[styles.chip, props.autoLockMinutes === minutes && styles.chipActive]}
                onPress={() => props.onChangeAutoLockMinutes(minutes)}
              >
                <Text style={[styles.chipText, props.autoLockMinutes === minutes && styles.chipTextActive]}>
                  {minutes === 0 ? 'Never' : `${minutes}m`}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.title}>pw-crypto-core FFI smoke test</Text>
          <Button title="Run" color={colors.primary} onPress={runSmokeTest} />
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
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  form: {
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  field: {
    gap: spacing.xs,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.heading,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    padding: spacing.sm + 4,
    backgroundColor: colors.surface,
    color: colors.text,
  },
  inputError: {
    borderColor: colors.danger,
  },
  reveal: {
    position: 'absolute',
    right: spacing.sm + 4,
  },
  revealText: {
    color: colors.primary,
    fontWeight: '600',
    fontSize: 13,
  },
  fieldError: {
    color: colors.danger,
    fontSize: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.heading,
    marginTop: spacing.sm,
  },
  footnote: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  pillButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.button,
    paddingVertical: spacing.sm + 4,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  pillButtonDisabled: {
    opacity: 0.6,
  },
  pillButtonText: {
    color: colors.onPrimary,
    fontWeight: '700',
    fontSize: 16,
  },
  brand: {
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  brandMark: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandMarkText: {
    color: colors.onPrimary,
    fontSize: 24,
    fontWeight: '700',
  },
  brandTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.heading,
  },
  brandMarkSmall: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandMarkTextSmall: {
    color: colors.onPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  homeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  brandTitleSmall: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.heading,
  },
  errorBanner: {
    backgroundColor: '#F6D9CE',
    borderRadius: radii.input,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  errorBannerText: {
    color: colors.danger,
    fontWeight: '600',
  },
  infoBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    padding: spacing.sm + 4,
    marginTop: spacing.md,
  },
  infoBoxText: {
    color: colors.muted,
    fontSize: 12,
  },
  search: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.button,
    padding: spacing.sm + 4,
    backgroundColor: colors.surface,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  chipRow: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    backgroundColor: colors.surface,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextActive: {
    color: colors.onPrimary,
  },
  emptyState: {
    color: colors.muted,
    textAlign: 'center',
    padding: spacing.lg,
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: spacing.lg,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconText: {
    color: colors.onPrimary,
    fontWeight: '700',
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
});

export default App;
