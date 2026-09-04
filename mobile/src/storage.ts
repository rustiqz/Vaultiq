import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Argon2Params, EncryptedItem, WrappedVaultKey } from './nativeCryptoCore';

/**
 * Persisted, plain (non-secret) local state -- the mobile analogue of the
 * extension's `storage.local` + IndexedDB `VaultRecord`
 * (extension/src/lib/vault-db.ts). Nothing here needs OS-level encryption:
 * the vault record is only as sensitive as any other wrapped-key/ciphertext
 * blob (protected by AEAD already), and the one genuine secret -- the
 * device credential -- is sealed under the vault key before it ever reaches
 * this module, the same way extension/src/sync/state.ts seals it before
 * writing to `storage.local`. The unwrapped vault key itself never appears
 * here at all; it lives only in the native module's held handle.
 */
type VaultRecord = {
  saltB64: string;
  argon2: Argon2Params;
  wrappedVaultKey: WrappedVaultKey;
};

type EnrollmentState = {
  serverUrl: string;
  deviceId: string;
  sealedCredential: EncryptedItem;
  vault: VaultRecord;
};

const STORAGE_KEY = 'vaultiq:enrollment';

async function readEnrollment(): Promise<EnrollmentState | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw === null ? null : (JSON.parse(raw) as EnrollmentState);
}

async function writeEnrollment(state: EnrollmentState): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function clearEnrollment(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

export { clearEnrollment, readEnrollment, writeEnrollment };
export type { EnrollmentState, VaultRecord };
