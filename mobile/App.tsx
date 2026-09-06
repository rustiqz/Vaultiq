/**
 * Vaultiq mobile -- redesign v2 shell (CLAUDE.md §0).
 *
 * Bottom tabs once unlocked: Vault (Logins-first, Browse tiles for the rest
 * -- IA restructure), Codes (live TOTP, grouped by account), Settings.
 * Vault's own stack: Home -> per-type list (Cards/Identities/Notes) ->
 * Item Detail -> Item Edit. Item Detail's edit/delete header icons are
 * wired to a real create/edit form and a real (permanent) delete; favorite
 * stays visual fidelity only, and Autofill has no plumbing and doesn't
 * exist as a screen -- see CLAUDE.md §0 for the full list of what the
 * redesign's mockups assume that isn't built yet.
 *
 * @format
 */

import { NavigationContainer, getFocusedRouteNameFromRoute, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Icon, { type IconName } from './src/icons';
import LogoMark from './src/LogoMark';
import * as storage from './src/storage';
import { colors, fonts } from './src/theme';
import { showComingSoon, useConfirmDialog } from './src/ui';
import * as vault from './src/vault';
import type { DecryptedItem, Status } from './src/vault';
import type { SettingsStackParamList, VaultStackParamList, VaultStackScreenProps } from './src/navigation';
import JoinVaultScreen from './src/screens/JoinVaultScreen';
import UnlockScreen from './src/screens/UnlockScreen';
import VaultHomeScreen from './src/screens/VaultHomeScreen';
import TypeListScreen from './src/screens/TypeListScreen';
import ItemDetailScreen from './src/screens/ItemDetailScreen';
import ItemEditScreen from './src/screens/ItemEditScreen';
import AuthenticatorScreen from './src/screens/AuthenticatorScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import AutoLockScreen from './src/screens/AutoLockScreen';

const navigationTheme: Theme = {
  dark: false,
  colors: {
    primary: colors.ink,
    background: colors.background,
    card: colors.background,
    text: colors.ink,
    border: colors.background,
    notification: colors.rust,
  },
  fonts: {
    regular: { fontFamily: fonts.body, fontWeight: '400' },
    medium: { fontFamily: fonts.body, fontWeight: '500' },
    bold: { fontFamily: fonts.semiCondensedBold, fontWeight: '700' },
    heavy: { fontFamily: fonts.semiCondensedBold, fontWeight: '700' },
  },
};

const ITEM_TYPE_TITLES: Record<string, string> = {
  login: 'Login',
  card: 'Card',
  identity: 'Identity',
  note: 'Secure Note',
  totp: 'Authenticator',
};

const TYPE_LIST_TITLES: Record<'card' | 'identity' | 'note', string> = {
  card: 'Cards',
  identity: 'Identities',
  note: 'Secure notes',
};

/** Favorite stays visual fidelity only (see file header); edit/delete are real. */
function ItemDetailHeaderActions(props: { item: DecryptedItem; navigation: VaultStackScreenProps<'ItemDetail'>['navigation'] }) {
  const { show, dialog } = useConfirmDialog();

  return (
    <View style={styles.headerActions}>
      <Pressable onPress={() => showComingSoon(show, 'Favoriting')} hitSlop={8}>
        <Icon name="heart" size={20} color={colors.ink} />
      </Pressable>
      <Pressable onPress={() => props.navigation.navigate('ItemEdit', { mode: 'edit', item: props.item })} hitSlop={8}>
        <Icon name="edit" size={20} color={colors.ink} />
      </Pressable>
      <Pressable
        onPress={() =>
          show('Delete this item?', 'This permanently removes it. It cannot be recovered.', [
            { text: 'Keep it' },
            {
              text: 'Delete forever',
              destructive: true,
              onPress: async () => {
                try {
                  await vault.deleteItem(props.item.id, props.item.version, props.item.itemType);
                  props.navigation.navigate('VaultHome');
                } catch (thrown) {
                  show('Could not delete', thrown instanceof Error ? thrown.message : String(thrown), [{ text: 'OK' }]);
                }
              },
            },
          ])
        }
        hitSlop={8}
      >
        <Icon name="trash" size={20} color={colors.ink} />
      </Pressable>
      {dialog}
    </View>
  );
}

const VaultStack = createNativeStackNavigator<VaultStackParamList>();

function VaultTab() {
  return (
    <VaultStack.Navigator screenOptions={{ headerTintColor: colors.ink, headerShadowVisible: false, headerTitleStyle: { fontFamily: fonts.condensedBold, fontSize: 24 } }}>
      <VaultStack.Screen name="VaultHome" component={VaultHomeScreen} options={{ headerShown: false }} />
      <VaultStack.Screen
        name="TypeList"
        component={TypeListScreen}
        options={({ route }) => ({ title: TYPE_LIST_TITLES[route.params.itemType] })}
      />
      <VaultStack.Screen
        name="ItemDetail"
        component={ItemDetailScreen}
        options={({ route, navigation }) => ({
          title: ITEM_TYPE_TITLES[route.params.item.itemType] ?? route.params.item.itemType,
          // eslint-disable-next-line react/no-unstable-nested-components -- react-navigation's own documented headerRight shape.
          headerRight: () => <ItemDetailHeaderActions item={route.params.item} navigation={navigation} />,
        })}
      />
      <VaultStack.Screen
        name="ItemEdit"
        component={ItemEditScreen}
        options={{ headerShown: false }}
      />
    </VaultStack.Navigator>
  );
}

const SettingsStack = createNativeStackNavigator<SettingsStackParamList>();

function SettingsTab(props: { onLock: () => void }) {
  return (
    <SettingsStack.Navigator screenOptions={{ headerTintColor: colors.ink, headerShadowVisible: false, headerTitleStyle: { fontFamily: fonts.condensedBold, fontSize: 24 } }}>
      <SettingsStack.Screen name="SettingsHome" options={{ title: 'Settings' }}>
        {screenProps => <SettingsScreen {...screenProps} onLock={props.onLock} />}
      </SettingsStack.Screen>
      <SettingsStack.Screen
        name="AutoLock"
        component={AutoLockScreen}
        options={{ headerShown: false, presentation: 'transparentModal', animation: 'fade' }}
      />
    </SettingsStack.Navigator>
  );
}

const Tab = createBottomTabNavigator();
const TAB_ICONS: Record<string, IconName> = {
  Vault: 'grid',
  Codes: 'totp',
  Settings: 'settingsGear',
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
          // Matches the native splash (6a) exactly, and continues it rather
          // than popping in something different -- no spinner, per the
          // design's own note on that mockup.
          <View style={styles.loading}>
            <LogoMark variant="detailed" size={104} color={colors.onInk} tickColor={colors.sage} />
            <Text style={styles.loadingWordmark}>Vaultiq</Text>
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
                tabBarActiveTintColor: colors.ink,
                tabBarInactiveTintColor: colors.ink,
                tabBarLabelStyle: styles.tabLabel,
                tabBarStyle: styles.tabBar,
                // eslint-disable-next-line react/no-unstable-nested-components -- React Navigation's own documented tabBarIcon shape.
                tabBarIcon: ({ focused }) => (
                  <View style={[styles.tabIconWrap, focused && styles.tabIconWrapActive]}>
                    <Icon name={TAB_ICONS[route.name] ?? 'grid'} size={17} color={focused ? colors.onInk : colors.ink} strokeWidth={focused ? 1.9 : 1.7} />
                  </View>
                ),
              })}
            >
              <Tab.Screen
                name="Vault"
                component={VaultTab}
                options={({ route }) => ({
                  // Item Detail/Edit and the per-type lists are full-screen
                  // pushed routes in the mockups -- nested-stack-in-tabs
                  // otherwise keeps the tab bar visible underneath them by
                  // default, which the design never shows.
                  tabBarStyle: (getFocusedRouteNameFromRoute(route) ?? 'VaultHome') === 'VaultHome' ? styles.tabBar : { display: 'none' },
                })}
              />
              <Tab.Screen name="Codes" component={AuthenticatorScreen} />
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
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 26,
  },
  loadingWordmark: {
    fontFamily: fonts.semiCondensedBold,
    fontSize: 30,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: colors.onInk,
  },
  tabRoot: {
    flex: 1,
  },
  tabBar: {
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: 'rgba(103, 70, 54, 0.12)',
    elevation: 0,
    height: 68,
  },
  tabIconWrap: {
    width: 46,
    height: 26,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIconWrapActive: {
    backgroundColor: colors.ink,
  },
  tabLabel: {
    fontFamily: fonts.condensedBold,
    fontSize: 11,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 16,
    paddingRight: 4,
  },
});

export default App;
