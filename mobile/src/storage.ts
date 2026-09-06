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

// Device-local preference, not vault state -- unrelated to enrollment, kept
// under its own key so it survives independently (e.g. a re-enroll doesn't
// reset it). 0 means "never", matching the extension's setting.
const AUTO_LOCK_KEY = 'vaultiq:autoLockMinutes';
const DEFAULT_AUTO_LOCK_MINUTES = 15;

async function readAutoLockMinutes(): Promise<number> {
  const raw = await AsyncStorage.getItem(AUTO_LOCK_KEY);
  return raw === null ? DEFAULT_AUTO_LOCK_MINUTES : Number(raw);
}

async function writeAutoLockMinutes(minutes: number): Promise<void> {
  await AsyncStorage.setItem(AUTO_LOCK_KEY, String(minutes));
}

// Device-local "last opened" timestamps, for Vault Home's login sort. Not
// synced -- the extension has a real cross-device usage record
// (extension/src/lib/vault-db.ts's per-device `usage` blob, pushed to
// /sync) that also drives password-reuse detection; this is a smaller,
// local-only stand-in for the one thing this redesign needs from it. A full
// synced usage record is a later, deliberate addition, not an oversight.
const LAST_USED_KEY = 'vaultiq:lastUsed';

async function readLastUsed(): Promise<Record<string, number>> {
  const raw = await AsyncStorage.getItem(LAST_USED_KEY);
  return raw === null ? {} : (JSON.parse(raw) as Record<string, number>);
}

async function recordItemUsed(itemId: string): Promise<void> {
  const lastUsed = await readLastUsed();
  lastUsed[itemId] = Date.now();
  await AsyncStorage.setItem(LAST_USED_KEY, JSON.stringify(lastUsed));
}

export {
  clearEnrollment,
  readAutoLockMinutes,
  readEnrollment,
  readLastUsed,
  recordItemUsed,
  writeAutoLockMinutes,
  writeEnrollment,
};
export type { EnrollmentState, VaultRecord };
