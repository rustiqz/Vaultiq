import type { NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ItemContent } from './itemContent';
import type { DecryptedItem } from './vault';

/**
 * The Vault tab's own stack -- Home (Logins-first, per the redesign's IA:
 * everything else is a Browse tile), a list screen per browsed type, the
 * shared detail screen, and the create/edit form.
 */
type VaultStackParamList = {
  VaultHome: undefined;
  TypeList: { itemType: 'card' | 'identity' | 'note' };
  ItemDetail: { item: DecryptedItem };
  ItemEdit: { mode: 'create'; itemType: ItemContent['type'] } | { mode: 'edit'; item: DecryptedItem };
  /**
   * Takes no params and hands its result back via lib/qrScanResult.ts's
   * pending-callback pair rather than a route param -- React Navigation's
   * typed `navigate({..., merge: true})` can't express "these params merge
   * into whatever's already on the ItemEdit route" without widening every
   * other param on that screen to optional too.
   */
  QrScan: undefined;
};

type VaultStackScreenProps<Screen extends keyof VaultStackParamList> = NativeStackScreenProps<
  VaultStackParamList,
  Screen
>;

/** The Settings tab's own stack -- the settings list, and the auto-lock timeout picker it pushes. */
type SettingsStackParamList = {
  SettingsHome: undefined;
  AutoLock: undefined;
  ChangeMasterPassword: undefined;
  EnableBiometric: undefined;
  Import: undefined;
};

type SettingsStackScreenProps<Screen extends keyof SettingsStackParamList> = NativeStackScreenProps<
  SettingsStackParamList,
  Screen
>;

/**
 * The bottom-tab shell, typed so a screen outside the Vault tab (the Codes
 * tab's "add an authenticator" button) can navigate into it --
 * `NavigatorScreenParams` is React Navigation's own shape for addressing a
 * nested navigator's screen from outside it.
 */
type RootTabParamList = {
  Vault: NavigatorScreenParams<VaultStackParamList>;
  Codes: undefined;
  Settings: NavigatorScreenParams<SettingsStackParamList>;
};

export type { RootTabParamList, SettingsStackParamList, SettingsStackScreenProps, VaultStackParamList, VaultStackScreenProps };
