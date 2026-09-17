import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Argon2Params, EncryptedItem, WrappedVaultKey } from './nativeCryptoCore';
import type { SealedPassword } from './nativeBiometric';

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

/**
 * The one thing every enrollment has: a wrapped vault key and the costs it
 * was wrapped with, plus the master password's biometric cache when that's
 * on. Everything else -- the server this device talks to, the device
 * credential that authenticates it there -- only exists for a vault that
 * has a server at all.
 */
type CommonEnrollmentState = {
  /** Human-readable name chosen during enrollment. Optional for older installs. */
  deviceName?: string;
  vault: VaultRecord;
  /**
   * The master password, encrypted under a Keystore key that only decrypts
   * behind biometric auth (BiometricModule.kt) -- absent when fingerprint
   * unlock is off. Storing ciphertext here is no different from
   * `sealedCredential` below: it's only as sensitive as any other
   * AEAD-protected blob, and this one is gated by hardware besides.
   */
  biometric?: SealedPassword;
};

/** A vault created and kept entirely on this device -- no server, ever. */
type LocalEnrollmentState = CommonEnrollmentState & { mode: 'local' };

type ServerEnrollmentState = CommonEnrollmentState & {
  mode: 'server';
  serverUrl: string;
  deviceId: string;
  sealedCredential: EncryptedItem;
};

type EnrollmentState = LocalEnrollmentState | ServerEnrollmentState;

const STORAGE_KEY = 'vaultiq:enrollment';

async function readEnrollment(): Promise<EnrollmentState | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  const parsed = JSON.parse(raw) as Partial<EnrollmentState>;
  // Every record written before `mode` existed was server-backed -- the only
  // kind that existed then. Not a migration: nothing is written back, this
  // just fills in a field the record always implicitly had.
  return parsed.mode === 'local'
    ? (parsed as LocalEnrollmentState)
    : ({ ...parsed, mode: 'server' } as ServerEnrollmentState);
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

const THEME_MODE_KEY = 'vaultiq:themeMode';
type ThemeMode = 'system' | 'light' | 'dark';

async function readAutoLockMinutes(): Promise<number> {
  const raw = await AsyncStorage.getItem(AUTO_LOCK_KEY);
  return raw === null ? DEFAULT_AUTO_LOCK_MINUTES : Number(raw);
}

async function writeAutoLockMinutes(minutes: number): Promise<void> {
  await AsyncStorage.setItem(AUTO_LOCK_KEY, String(minutes));
}

async function readThemeMode(): Promise<ThemeMode> {
  const raw = await AsyncStorage.getItem(THEME_MODE_KEY);
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

async function writeThemeMode(mode: ThemeMode): Promise<void> {
  await AsyncStorage.setItem(THEME_MODE_KEY, mode);
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

// The local item store for a mode: 'local' vault -- the mobile analogue of
// the extension's IndexedDB `items` store (extension/src/lib/vault-db.ts).
// A server-backed vault has no use for this: `vault.pullItems()` re-pulls
// and re-decrypts from the server on every call instead, deliberately (see
// its own doc comment). `EncryptedItem`'s shape here is exactly the wire
// shape `nativeCryptoCore.ts` already defines -- base64 ciphertext/nonce,
// matching the server sync DTO -- so nothing here invents a second format.
const LOCAL_ITEMS_KEY = 'vaultiq:localItems';

async function readLocalItems(): Promise<EncryptedItem[]> {
  const raw = await AsyncStorage.getItem(LOCAL_ITEMS_KEY);
  return raw === null ? [] : (JSON.parse(raw) as EncryptedItem[]);
}

async function writeLocalItems(items: EncryptedItem[]): Promise<void> {
  await AsyncStorage.setItem(LOCAL_ITEMS_KEY, JSON.stringify(items));
}

async function clearLocalItems(): Promise<void> {
  await AsyncStorage.removeItem(LOCAL_ITEMS_KEY);
}

export {
  clearEnrollment,
  clearLocalItems,
  readAutoLockMinutes,
  readEnrollment,
  readLastUsed,
  readLocalItems,
  readThemeMode,
  recordItemUsed,
  writeAutoLockMinutes,
  writeLocalItems,
  writeThemeMode,
  writeEnrollment,
};
export type { EnrollmentState, LocalEnrollmentState, ServerEnrollmentState, ThemeMode, VaultRecord };
