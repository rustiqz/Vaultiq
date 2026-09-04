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

export type { VaultStackParamList, VaultStackScreenProps };
