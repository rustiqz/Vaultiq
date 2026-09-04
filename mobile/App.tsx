/**
 * Vaultiq mobile -- proving-ground shell.
 *
 * Join Vault, Unlock, Vault Home, Item Detail, Authenticator and Settings
 * are laid out against the real Figma exports (~/Downloads/screen-*.svg,
 * rasterized and reviewed -- see src/theme.ts for what carried over vs.
 * what stayed ours: the fall palette is ours, layout/components/icons now
 * follow Figma). Real navigation throughout: bottom tabs once unlocked,
 * a stack for Vault Home -> Item Detail and one for Settings -> Auto-lock,
 * native back gesture/button support. New Item and Autofill have no
 * plumbing behind them yet and don't exist as screens; the item-detail
 * header's favorite/edit/delete icons are shown for visual fidelity but are
 * not wired to anything real yet (same reason).
 *
 * Covers enrollment, unlock, a read-only item list with detail viewing, a
 * live-code authenticator tab, device management, and idle auto-lock
 * (CLAUDE.md §0, phase 4).
 *
 * @format
 */

import { NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Icon, { type FeatherName } from './src/icons';
import * as storage from './src/storage';
import { colors } from './src/theme';
import * as vault from './src/vault';
import type { Status } from './src/vault';
import type { SettingsStackParamList, VaultStackParamList } from './src/navigation';
import JoinVaultScreen from './src/screens/JoinVaultScreen';
import UnlockScreen from './src/screens/UnlockScreen';
import VaultHomeScreen from './src/screens/VaultHomeScreen';
import ItemDetailScreen from './src/screens/ItemDetailScreen';
import AuthenticatorScreen from './src/screens/AuthenticatorScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import AutoLockScreen from './src/screens/AutoLockScreen';

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

const ITEM_TYPE_TITLES: Record<string, string> = {
  login: 'Login',
  card: 'Payment Card',
  identity: 'Identity',
  note: 'Secure Note',
  totp: 'Authenticator',
};

function notYetAvailable(feature: string) {
  Alert.alert('Not yet available', `${feature} isn't implemented yet.`);
}

/** Favorite/edit/delete: shown for visual fidelity, not wired to anything real (see file header). */
function ItemDetailHeaderActions() {
  return (
    <View style={styles.headerActions}>
      <Pressable onPress={() => notYetAvailable('Favoriting')}>
        <Icon name="heart" />
      </Pressable>
      <Pressable onPress={() => notYetAvailable('Editing')}>
        <Icon name="edit-2" />
      </Pressable>
      <Pressable onPress={() => notYetAvailable('Deleting')}>
        <Icon name="trash-2" />
      </Pressable>
    </View>
  );
}

const VaultStack = createNativeStackNavigator<VaultStackParamList>();

function VaultTab() {
  return (
    <VaultStack.Navigator screenOptions={{ headerTintColor: colors.text, headerShadowVisible: false }}>
      <VaultStack.Screen name="VaultHome" component={VaultHomeScreen} options={{ title: 'Vaultiq' }} />
      <VaultStack.Screen
        name="ItemDetail"
        component={ItemDetailScreen}
        options={({ route }) => ({
          title: ITEM_TYPE_TITLES[route.params.item.itemType] ?? route.params.item.itemType,
          headerRight: ItemDetailHeaderActions,
        })}
      />
    </VaultStack.Navigator>
  );
}

const SettingsStack = createNativeStackNavigator<SettingsStackParamList>();

function SettingsTab(props: { onLock: () => void }) {
  return (
    <SettingsStack.Navigator screenOptions={{ headerTintColor: colors.text, headerShadowVisible: false }}>
      <SettingsStack.Screen name="SettingsHome" options={{ title: 'Settings' }}>
        {screenProps => <SettingsScreen {...screenProps} onLock={props.onLock} />}
      </SettingsStack.Screen>
      <SettingsStack.Screen name="AutoLock" component={AutoLockScreen} options={{ title: 'Auto-lock timeout' }} />
    </SettingsStack.Navigator>
  );
}

const Tab = createBottomTabNavigator();
const TAB_ICONS: Record<string, FeatherName> = {
  Vault: 'grid',
  Authenticator: 'shield',
  Settings: 'settings',
};

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
            <View style={styles.brandMark}>
              <Icon name="shield" size={28} color={colors.onPrimary} />
            </View>
            <ActivityIndicator color={colors.primary} style={styles.spinner} />
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
              screenOptions={({ route }) => ({
                headerShown: false,
                tabBarActiveTintColor: colors.primary,
                tabBarInactiveTintColor: colors.muted,
                // No border/shadow -- the tab bar is the same surface as the
                // content above it, not a separate boxed strip.
                tabBarStyle: { backgroundColor: colors.background, borderTopWidth: 0, elevation: 0 },
                // eslint-disable-next-line react/no-unstable-nested-components -- React Navigation's own documented tabBarIcon shape.
                tabBarIcon: ({ color, size }) => <Icon name={TAB_ICONS[route.name] ?? 'circle'} color={color} size={size} />,
              })}
            >
              <Tab.Screen name="Vault" component={VaultTab} />
              <Tab.Screen name="Authenticator" component={AuthenticatorScreen} options={{ headerShown: true, title: 'Authenticator' }} />
              <Tab.Screen name="Settings">{() => <SettingsTab onLock={doLock} />}</Tab.Screen>
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
    gap: 16,
  },
  brandMark: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    marginTop: 8,
  },
  tabRoot: {
    flex: 1,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 16,
    paddingRight: 4,
  },
});

export default App;
