import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ItemContent } from './itemContent';
import type { DecryptedItem } from './vault';

/** The Vault tab's own stack -- Home, its detail screen, and the create/edit form. */
type VaultStackParamList = {
  VaultHome: undefined;
  ItemDetail: { item: DecryptedItem };
  ItemEdit: { mode: 'create'; itemType: ItemContent['type'] } | { mode: 'edit'; item: DecryptedItem };
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
