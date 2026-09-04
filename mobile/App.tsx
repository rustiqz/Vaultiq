/**
 * Vaultiq mobile -- proving-ground shell.
 *
 * Join Vault, Unlock, Vault Home, Item Detail and Settings are styled
 * against real mockups (fall palette -- see src/theme.ts) and wired with
 * real navigation (bottom tabs once unlocked, a stack for Vault Home ->
 * Item Detail, native back gesture/button support throughout). New Item
 * and Autofill have no plumbing behind them yet and don't exist as screens.
 * Covers enrollment, unlock, a read-only item list with detail viewing,
 * device management, and idle auto-lock (CLAUDE.md §0, phase 4).
 *
 * @format
 */

import { NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as storage from './src/storage';
import { colors } from './src/theme';
import * as vault from './src/vault';
import type { Status } from './src/vault';
import type { VaultStackParamList } from './src/navigation';
import JoinVaultScreen from './src/screens/JoinVaultScreen';
import UnlockScreen from './src/screens/UnlockScreen';
import VaultHomeScreen from './src/screens/VaultHomeScreen';
import ItemDetailScreen from './src/screens/ItemDetailScreen';
import SettingsScreen from './src/screens/SettingsScreen';

// `card` matches `background` exactly (not the slightly-lighter `surface`)
// so the header has no visible seam against the content below it -- a flat,
// borderless look rather than boxed 2000s-style chrome.
const navigationTheme: Theme = {
  dark: false,
  colors: {
    primary: colors.primary,
    background: colors.background,
    card: colors.background,
    text: colors.text,
    border: colors.background,
    notification: colors.danger,
  },
  fonts: {
    regular: { fontFamily: 'System', fontWeight: '400' },
    medium: { fontFamily: 'System', fontWeight: '500' },
    bold: { fontFamily: 'System', fontWeight: '700' },
    heavy: { fontFamily: 'System', fontWeight: '900' },
  },
};

const VaultStack = createNativeStackNavigator<VaultStackParamList>();

function VaultTab() {
  return (
    <VaultStack.Navigator screenOptions={{ headerTintColor: colors.heading, headerShadowVisible: false }}>
      <VaultStack.Screen name="VaultHome" component={VaultHomeScreen} options={{ title: 'Vaultiq' }} />
      <VaultStack.Screen name="ItemDetail" component={ItemDetailScreen} options={({ route }) => ({ title: route.params.item.itemType })} />
    </VaultStack.Navigator>
  );
}

const Tab = createBottomTabNavigator();

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

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <NavigationContainer theme={navigationTheme}>
        {status === 'loading' && (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        )}
        {status === 'not-enrolled' && (
          <JoinVaultScreen
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
          <UnlockScreen
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
        {status === 'unlocked' && (
          <View style={styles.tabRoot} onTouchStart={resetIdleTimer}>
            <Tab.Navigator
              screenOptions={{
                headerShown: false,
                tabBarActiveTintColor: colors.primary,
                tabBarInactiveTintColor: colors.muted,
                // No border/shadow -- the tab bar is the same surface as the
                // content above it, not a separate boxed strip.
                tabBarStyle: { backgroundColor: colors.background, borderTopWidth: 0, elevation: 0 },
              }}
            >
              <Tab.Screen name="Vault" component={VaultTab} />
              <Tab.Screen
                name="Settings"
                options={{ headerShown: true, headerTintColor: colors.heading, headerShadowVisible: false }}
              >
                {() => <SettingsScreen onLock={doLock} />}
              </Tab.Screen>
            </Tab.Navigator>
          </View>
        )}
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabRoot: {
    flex: 1,
  },
});

export default App;
