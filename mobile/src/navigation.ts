import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { DecryptedItem } from './vault';

/** The Vault tab's own stack -- Home, and the detail screen a tap on a row pushes. */
type VaultStackParamList = {
  VaultHome: undefined;
  ItemDetail: { item: DecryptedItem };
};

type VaultStackScreenProps<Screen extends keyof VaultStackParamList> = NativeStackScreenProps<
  VaultStackParamList,
  Screen
>;

/** The Settings tab's own stack -- the settings list, and the auto-lock timeout picker it pushes. */
type SettingsStackParamList = {
  SettingsHome: undefined;
  AutoLock: undefined;
};

type SettingsStackScreenProps<Screen extends keyof SettingsStackParamList> = NativeStackScreenProps<
  SettingsStackParamList,
  Screen
>;

export type { SettingsStackParamList, SettingsStackScreenProps, VaultStackParamList, VaultStackScreenProps };
