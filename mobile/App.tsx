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
import { useEffect, useMemo, useRef, useState } from 'react';
import { Appearance, Pressable, StatusBar, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Icon, { type IconName } from './src/icons';
import type { ItemContent } from './src/itemContent';
import LogoMark from './src/LogoMark';
import * as storage from './src/storage';
import { brandColors, colors, darkColors, fonts, inkAlpha, lightColors } from './src/theme';
import { useConfirmDialog } from './src/ui';
import * as vault from './src/vault';
import type { DecryptedItem, Status } from './src/vault';
import type { RootTabParamList, SettingsStackParamList, VaultStackParamList, VaultStackScreenProps } from './src/navigation';
import JoinVaultScreen from './src/screens/JoinVaultScreen';
import UnlockScreen from './src/screens/UnlockScreen';
import VaultHomeScreen from './src/screens/VaultHomeScreen';
import TypeListScreen from './src/screens/TypeListScreen';
import ItemDetailScreen from './src/screens/ItemDetailScreen';
import ItemEditScreen from './src/screens/ItemEditScreen';
import QrScanScreen from './src/screens/QrScanScreen';
import AuthenticatorScreen from './src/screens/AuthenticatorScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import AutoLockScreen from './src/screens/AutoLockScreen';
import ChangeMasterPasswordScreen from './src/screens/ChangeMasterPasswordScreen';
import EnableBiometricScreen from './src/screens/EnableBiometricScreen';
import AutofillFillScreen from './src/screens/AutofillFillScreen';
import AutofillSaveScreen from './src/screens/AutofillSaveScreen';

/** Present only when launched via AutofillActivity (see its getLaunchOptions). */
type AutofillRequest = {
  mode: 'fill' | 'save';
  domain: string;
  /** Browser-verified webDomain when there is one, otherwise the requesting app's label -- see VaultiqAutofillService.kt's callerFor. */
  caller: string;
  callerVerified: boolean;
  username?: string;
  password?: string;
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

function ItemDetailHeaderActions(props: { item: DecryptedItem; navigation: VaultStackScreenProps<'ItemDetail'>['navigation'] }) {
  const { show, dialog } = useConfirmDialog();
  const [favorite, setFavorite] = useState(props.item.content.favorite === true);
  const [togglingFavorite, setTogglingFavorite] = useState(false);

  const toggleFavorite = async () => {
    if (togglingFavorite) return;
    setTogglingFavorite(true);
    const next = !favorite;
    try {
      await vault.updateItem(props.item.id, props.item.version, { ...props.item.content, favorite: next } as ItemContent);
      setFavorite(next);
    } catch (thrown) {
      show('Could not update', thrown instanceof Error ? thrown.message : String(thrown), [{ text: 'OK' }]);
    } finally {
      setTogglingFavorite(false);
    }
  };

  return (
    <View style={styles.headerActions}>
      {/* Filled vs outline only -- no color change. Rust/amber/sage are reserved
          state colors (design rule 7); favoriting isn't one of those states. */}
      <Pressable style={styles.headerAction} onPress={toggleFavorite} disabled={togglingFavorite}>
        <Icon name="heart" size={20} color={colors.ink} filled={favorite} />
      </Pressable>
      <Pressable style={styles.headerAction} onPress={() => props.navigation.navigate('ItemEdit', { mode: 'edit', item: props.item })}>
        <Icon name="edit" size={20} color={colors.ink} />
      </Pressable>
      <Pressable
        style={styles.headerAction}
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
      >
        <Icon name="trash" size={20} color={colors.ink} />
      </Pressable>
      {dialog}
    </View>
  );
}

const VaultStack = createNativeStackNavigator<VaultStackParamList>();

function VaultTab() {
  const palette = useColorScheme() === 'dark' ? darkColors : lightColors;
  return (
    <VaultStack.Navigator screenOptions={{ headerTintColor: palette.ink, headerShadowVisible: false, headerTitleStyle: { fontFamily: fonts.condensedBold, fontSize: 24 } }}>
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
      <VaultStack.Screen name="QrScan" component={QrScanScreen} options={{ headerShown: false }} />
    </VaultStack.Navigator>
  );
}

const SettingsStack = createNativeStackNavigator<SettingsStackParamList>();

function SettingsTab(props: { onLock: () => void; themeMode: storage.ThemeMode; onThemeChange: (mode: storage.ThemeMode) => void }) {
  const palette = useColorScheme() === 'dark' ? darkColors : lightColors;
  return (
    <SettingsStack.Navigator screenOptions={{ headerTintColor: palette.ink, headerShadowVisible: false, headerTitleStyle: { fontFamily: fonts.condensedBold, fontSize: 24 } }}>
      <SettingsStack.Screen name="SettingsHome" options={{ title: 'Settings' }}>
        {screenProps => <SettingsScreen {...screenProps} onLock={props.onLock} themeMode={props.themeMode} onThemeChange={props.onThemeChange} />}
      </SettingsStack.Screen>
      <SettingsStack.Screen
        name="AutoLock"
        component={AutoLockScreen}
        options={{ headerShown: false, presentation: 'transparentModal', animation: 'fade' }}
      />
      <SettingsStack.Screen name="ChangeMasterPassword" component={ChangeMasterPasswordScreen} options={{ headerShown: false }} />
      <SettingsStack.Screen name="EnableBiometric" component={EnableBiometricScreen} options={{ headerShown: false }} />
    </SettingsStack.Navigator>
  );
}

const Tab = createBottomTabNavigator<RootTabParamList>();
const TAB_ICONS: Record<keyof RootTabParamList, IconName> = {
  Vault: 'grid',
  Codes: 'totp',
  Settings: 'settingsGear',
};

function App(props: { autofillRequest?: AutofillRequest }) {
  const colorScheme = useColorScheme();
  const activePalette = colorScheme === 'dark' ? darkColors : lightColors;
  const navigationTheme = useMemo<Theme>(() => {
    const palette = colorScheme === 'dark' ? darkColors : lightColors;
    return {
      dark: colorScheme === 'dark',
      colors: {
        primary: palette.ink,
        background: palette.background,
        card: palette.background,
        text: palette.ink,
        border: palette.background,
        notification: palette.rust,
      },
      fonts: {
        regular: { fontFamily: fonts.body, fontWeight: '400' },
        medium: { fontFamily: fonts.body, fontWeight: '500' },
        bold: { fontFamily: fonts.semiCondensedBold, fontWeight: '700' },
        heavy: { fontFamily: fonts.semiCondensedBold, fontWeight: '700' },
      },
    };
  }, [colorScheme]);
  const [status, setStatus] = useState<Status | 'loading'>('loading');
  const [enrolledDeviceName, setEnrolledDeviceName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [autoLockMinutes, setAutoLockMinutes] = useState(15);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [themeMode, setThemeMode] = useState<storage.ThemeMode>('system');
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    vault.status().then(setStatus);
    vault.enrolledDeviceName().then(setEnrolledDeviceName);
    storage.readAutoLockMinutes().then(setAutoLockMinutes);
    storage.readThemeMode().then(mode => {
      setThemeMode(mode);
      Appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
    });
  }, []);

  const changeTheme = (mode: storage.ThemeMode) => {
    setThemeMode(mode);
    Appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
    storage.writeThemeMode(mode).catch(() => undefined);
  };

  useEffect(() => {
    if (status === 'locked') {
      Promise.all([vault.biometricEnabled(), vault.biometricAvailable()]).then(([enabled, available]) => setBiometricEnabled(enabled && available));
    }
  }, [status]);

  const runBiometricUnlock = () => {
    setError(null);
    setBusy(true);
    // The locked screen can be mounted in the same frame as a native activity
    // resume. Waiting for the transition to settle prevents the first prompt
    // from being launched against a not-yet-resumed FragmentActivity.
    setTimeout(() => {
      vault
        .unlockWithBiometric()
        .then(() => setStatus('unlocked'))
        .catch((thrown: unknown) => {
          // React Native attaches the native Promise.reject code as `.code` --
          // a user simply backing out of the fingerprint prompt isn't an error
          // worth a red banner, unlike every other unlock failure.
          const code = thrown !== null && typeof thrown === 'object' && 'code' in thrown ? (thrown as { code?: unknown }).code : undefined;
          if (code !== 'biometric_cancelled') setError(thrown instanceof Error ? thrown.message : String(thrown));
        })
        .finally(() => setBusy(false));
    }, 80);
  };

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
      <StatusBar barStyle={status === 'loading' || colorScheme === 'dark' ? 'light-content' : 'dark-content'} />
      <NavigationContainer theme={navigationTheme}>
        {status === 'loading' && (
          // Matches the native splash (6a) exactly, and continues it rather
          // than popping in something different -- no spinner, per the
          // design's own note on that mockup.
          <View style={styles.loading}>
            <LogoMark variant="primary" size={104} color={brandColors.paper} stateColor={brandColors.sage} />
            <Text style={styles.loadingWordmark}>Vaultiq</Text>
            <Text style={styles.loadingTagline}>Zero-knowledge</Text>
          </View>
        )}
        {status === 'not-enrolled' && (
          <JoinVaultScreen
            busy={busy}
            error={error}
            onSubmit={(serverUrl, token, submittedDeviceName, password) =>
              run(async () => {
                await vault.enrollAndUnlock(serverUrl, token, submittedDeviceName, password);
                setEnrolledDeviceName(submittedDeviceName.trim());
                setStatus('unlocked');
              })()
            }
          />
        )}
        {status === 'locked' && (
          <UnlockScreen
            busy={busy}
            error={error}
            biometricEnabled={biometricEnabled}
            deviceName={enrolledDeviceName}
            onBiometric={runBiometricUnlock}
            onSubmit={password =>
              run(async () => {
                await vault.unlock(password);
                setStatus('unlocked');
              })()
            }
          />
        )}
        {status === 'unlocked' && props.autofillRequest?.mode === 'fill' && (
          <AutofillFillScreen
            domain={props.autofillRequest.domain}
            caller={props.autofillRequest.caller}
            callerVerified={props.autofillRequest.callerVerified}
          />
        )}
        {status === 'unlocked' && props.autofillRequest?.mode === 'save' && (
          <AutofillSaveScreen
            domain={props.autofillRequest.domain}
            caller={props.autofillRequest.caller}
            callerVerified={props.autofillRequest.callerVerified}
            username={props.autofillRequest.username ?? ''}
            password={props.autofillRequest.password ?? ''}
          />
        )}
        {status === 'unlocked' && props.autofillRequest === undefined && (
            <View key={`theme-${themeMode}-${colorScheme ?? 'light'}`} style={styles.tabRoot} onTouchStart={resetIdleTimer}>
            <Tab.Navigator
              screenOptions={({ route }) => ({
                headerShown: false,
                tabBarActiveTintColor: activePalette.ink,
                tabBarInactiveTintColor: activePalette.ink,
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
              <Tab.Screen name="Settings">{() => <SettingsTab onLock={doLock} themeMode={themeMode} onThemeChange={changeTheme} />}</Tab.Screen>
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
    backgroundColor: brandColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 26,
  },
  loadingWordmark: {
    fontFamily: fonts.semiCondensedBold,
    fontSize: 30,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: brandColors.paper,
  },
  loadingTagline: {
    position: 'absolute',
    bottom: 56,
    fontFamily: fonts.condensedBold,
    fontSize: 12,
    letterSpacing: 2.16,
    textTransform: 'uppercase',
    color: brandColors.paper,
  },
  tabRoot: {
    flex: 1,
  },
  tabBar: {
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: inkAlpha(0.12),
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
    marginRight: -8,
  },
  headerAction: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default App;
