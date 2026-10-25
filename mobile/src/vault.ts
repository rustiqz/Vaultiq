import Biometric from './nativeBiometric';
import CryptoCore from './nativeCryptoCore';
import type { EncryptedItem, PasswordStrength } from './nativeCryptoCore';
import * as storage from './storage';
import type { EnrollmentState } from './storage';
import * as syncClient from './syncClient';
import { randomItemId } from './lib/id';
import { createLock, mergeEncrypted } from './lib/syncCache';
import { contentWithType } from './lib/itemType';
import { fromAnyBackup, toCanonicalBackup } from './lib/backupFormat';
import type { CanonicalBackup, InternalBackup } from './lib/backupFormat';
import type { ItemContent } from './itemContent';

/** Format version for {@link VaultBackup}. Bump on any layout change. */
const BACKUP_FORMAT = 1;

/** A parsed backup file is untrusted until fromAnyBackup validates it. */
export type VaultBackup = Record<string, unknown>;

/**
 * Vault enrollment/unlock orchestration -- the mobile analogue of
 * `enrollWithServer()` / `connectServer()` / `create()` / `unlock()` /
 * `lock()` in extension/src/background/vault.ts. See docs/STATUS.md.
 */
type Status = 'not-enrolled' | 'locked' | 'unlocked';

/** A decrypted item's outer fields plus its parsed plaintext content. */
type DecryptedItem = {
  id: string;
  itemType: string;
  version: number;
  /** In the trash. The content is still here and can be restored -- see trashItem/restoreItem below. */
  deleted: boolean;
  content: Record<string, unknown>;
  /**
   * Derived, login-only facts computed by pullItems -- never persisted.
   * These must stay siblings of `content`, not fields inside it: `content`
   * is exactly what a later `updateItem` pushes back verbatim (see
   * ItemEditScreen.tsx), so a derived field leaking in there would get
   * saved by accident on the next edit. Mirrors the extension's
   * `item.strength`/`item.reusedBy` (extension/src/background/vault.ts).
   */
  login?: { strength: PasswordStrength; reusedBy: number };
};

const CREDENTIAL_HEADER = {
  id: 'sync:credential',
  itemType: 'credential',
  version: 1,
  updatedAt: 0,
  deleted: false,
};

// The unsealed device credential, held only in JS memory for this session --
// not persisted (the sealed form in storage.ts is), same lifetime as the
// native module's held vault key. Needed for any authenticated server call
// after unlock (refreshItems below); cleared on lock.
let credential: { deviceId: string; credential: string } | null = null;

// Serialises read-modify-write of the sync cache (see syncCiphertext, pushOne).
const withCacheLock = createLock();

async function status(): Promise<Status> {
  const enrollment = await storage.readEnrollment();
  if (enrollment === null) return 'not-enrolled';
  return (await CryptoCore.isUnlocked()) ? 'unlocked' : 'locked';
}

/**
 * Joins an existing vault: exchanges the enrollment token for a device
 * credential, fetches the vault's bootstrap record, and unlocks it with the
 * same master password used to derive the auth key. A wrong password fails
 * at the unlock step below, identically to a tampered record.
 */
async function enrollAndUnlock(
  url: string,
  token: string,
  deviceName: string,
  password: string,
): Promise<void> {
  const normalizedDeviceName = deviceName.trim();
  if (normalizedDeviceName === '') throw new Error('Choose a name for this device.');

  const params = await syncClient.enrollmentParams(url, token);
  const authKey = await CryptoCore.deriveAuthKey(
    password,
    params.saltB64,
    params.memoryKib,
    params.iterations,
    params.parallelism,
  );
  const device = await syncClient.enroll(url, token, authKey, normalizedDeviceName);
  const bootstrap = await syncClient.vaultBootstrap(url, device.deviceId, device.credential);

  await CryptoCore.unlock(
    password,
    bootstrap.saltB64,
    bootstrap.memoryKib,
    bootstrap.iterations,
    bootstrap.parallelism,
    bootstrap.wrappedVaultKey,
  );

  const sealedCredential = await CryptoCore.encryptItem(
    JSON.stringify({ credential: device.credential }),
    CREDENTIAL_HEADER,
  );

  const enrollment: EnrollmentState = {
    mode: 'server',
    serverUrl: url,
    deviceId: device.deviceId,
    deviceName: normalizedDeviceName,
    sealedCredential,
    vault: {
      saltB64: bootstrap.saltB64,
      argon2: {
        memoryKib: bootstrap.memoryKib,
        iterations: bootstrap.iterations,
        parallelism: bootstrap.parallelism,
      },
      wrappedVaultKey: bootstrap.wrappedVaultKey,
    },
  };
  await storage.writeEnrollment(enrollment);
  credential = { deviceId: device.deviceId, credential: device.credential };
}

/**
 * Creates a brand-new vault: generates fresh crypto locally, registers it
 * with the server under an account-creation token, and unlocks immediately
 * -- the mobile analogue of extension/src/background/vault.ts's `create()`
 * followed by `connectServer()`, done as one step. `CryptoCore.createVault`
 * already leaves the module holding the new key, the same way `unlock`
 * does, so there's no separate unlock call after. See
 * `createLocalVaultAndUnlock` below for the vault-with-no-server sibling.
 */
async function createVaultAndUnlock(
  url: string,
  token: string,
  deviceName: string,
  password: string,
): Promise<void> {
  const normalizedDeviceName = deviceName.trim();
  if (normalizedDeviceName === '') throw new Error('Choose a name for this device.');

  const saltB64 = await CryptoCore.generateSalt();
  const argon2 = await CryptoCore.defaultArgon2Params();
  const { authKey, wrappedVaultKey } = await CryptoCore.createVault(
    password,
    saltB64,
    argon2.memoryKib,
    argon2.iterations,
    argon2.parallelism,
  );

  const device = await syncClient.register(
    url,
    token,
    authKey,
    { saltB64, ...argon2, wrappedVaultKey },
    normalizedDeviceName,
  );

  const sealedCredential = await CryptoCore.encryptItem(
    JSON.stringify({ credential: device.credential }),
    CREDENTIAL_HEADER,
  );

  const enrollment: EnrollmentState = {
    mode: 'server',
    serverUrl: url,
    deviceId: device.deviceId,
    deviceName: normalizedDeviceName,
    sealedCredential,
    vault: { saltB64, argon2, wrappedVaultKey },
  };
  await storage.writeEnrollment(enrollment);
  credential = { deviceId: device.deviceId, credential: device.credential };
}

/**
 * Creates a brand-new vault that lives on this device only -- no server,
 * ever. The same local crypto steps as `createVaultAndUnlock`'s first half
 * (`CryptoCore.createVault` already leaves the module holding the new key,
 * so there's no separate unlock call after), with everything server-shaped
 * skipped entirely: no registration call, no device credential, nothing to
 * seal. The device name is display-only here (there's no server to register
 * it with), so unlike the server-backed flow it's optional.
 */
async function createLocalVaultAndUnlock(deviceName: string, password: string): Promise<void> {
  const normalizedDeviceName = deviceName.trim();

  const saltB64 = await CryptoCore.generateSalt();
  const argon2 = await CryptoCore.defaultArgon2Params();
  const { wrappedVaultKey } = await CryptoCore.createVault(
    password,
    saltB64,
    argon2.memoryKib,
    argon2.iterations,
    argon2.parallelism,
  );

  const enrollment: EnrollmentState = {
    mode: 'local',
    ...(normalizedDeviceName === '' ? {} : { deviceName: normalizedDeviceName }),
    vault: { saltB64, argon2, wrappedVaultKey },
  };
  await storage.writeEnrollment(enrollment);
}

/**
 * A full, offline copy of the vault: the wrapped key, its salt and costs,
 * and every item in the canonical file layout.
 *
 * A local-only vault touches no key material to produce this -- its stored
 * ciphertext is converted to the canonical file layout after a straight read.
 * A server-backed vault has no guarantee its local cache
 * (`storage.ts`'s `SyncCache`) already holds every item -- only that it will,
 * once caught up -- so this calls the same `syncCiphertext` helper
 * `pullItems()` uses to catch it up first, which does need the vault
 * unlocked and a network round trip.
 */
async function exportBackup(masterPassword: string): Promise<CanonicalBackup> {
  const enrollment = await storage.readEnrollment();
  if (enrollment === null) throw new Error('not enrolled on this device yet');

  // The vault is unlocked to be here at all, but an unlocked, unattended phone
  // is exactly when a copy of the whole vault must not be one tap away. Asking
  // for the password again proves who is holding it, not just that it was
  // unlocked. This is the same call `unlock` makes, so a wrong password fails
  // identically; on success it simply re-holds the same vault key.
  await CryptoCore.unlock(
    masterPassword,
    enrollment.vault.saltB64,
    enrollment.vault.argon2.memoryKib,
    enrollment.vault.argon2.iterations,
    enrollment.vault.argon2.parallelism,
    enrollment.vault.wrappedVaultKey,
  );

  const items =
    enrollment.mode === 'local'
      ? await storage.readLocalItems()
      : (await authenticated((url, deviceId, cred) => syncCiphertext(url, deviceId, cred))).items;

  const internal: InternalBackup = {
    kind: 'vaultiq-backup',
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    vault: enrollment.vault,
    items,
  };
  return toCanonicalBackup(internal);
}

/**
 * Restores either the canonical or older mobile file layout onto a device
 * that does not have a vault yet.
 *
 * Always lands as a local-only vault (`mode: 'local'`), regardless of
 * whether the backup's original vault was server-backed -- simplest, needs
 * no invite token or network round trip, and matches exactly what
 * `createLocalVaultAndUnlock` already writes. The password is verified by
 * unlocking with the backup's own salt/costs/wrapped key -- identically to a
 * wrong password on a normal `unlock` -- before anything is written; items
 * are written first and the enrollment record last, so an interruption
 * between the two leaves the device reading as not-enrolled rather than as
 * an enrolled, empty vault.
 */
async function restoreBackup(backup: VaultBackup, masterPassword: string, deviceName?: string): Promise<void> {
  if ((await storage.readEnrollment()) !== null) throw new Error('This device already has a vault.');
  const internal = fromAnyBackup(backup);

  // A wrong password fails here, indistinguishably from a tampered record --
  // the same crypto-core error `unlock` surfaces for either -- and leaves
  // the module holding the key on success, exactly as a normal unlock does.
  await CryptoCore.unlock(
    masterPassword,
    internal.vault.saltB64,
    internal.vault.argon2.memoryKib,
    internal.vault.argon2.iterations,
    internal.vault.argon2.parallelism,
    internal.vault.wrappedVaultKey,
  );

  await storage.writeLocalItems(internal.items);
  const normalizedDeviceName = deviceName?.trim();
  const enrollment: EnrollmentState = {
    mode: 'local',
    ...(normalizedDeviceName ? { deviceName: normalizedDeviceName } : {}),
    vault: internal.vault,
  };
  await storage.writeEnrollment(enrollment);
}

/** Unlocks an already-enrolled vault with the master password. */
async function unlock(password: string): Promise<void> {
  const enrollment = await storage.readEnrollment();
  if (enrollment === null) throw new Error('not enrolled on this device yet');

  await CryptoCore.unlock(
    password,
    enrollment.vault.saltB64,
    enrollment.vault.argon2.memoryKib,
    enrollment.vault.argon2.iterations,
    enrollment.vault.argon2.parallelism,
    enrollment.vault.wrappedVaultKey,
  );

  // A local vault has no device credential to unseal -- `credential` stays
  // null, exactly as `lock()` leaves it, and `authenticated()` below refuses
  // any call that would need one.
  if (enrollment.mode === 'server') {
    const unsealed = JSON.parse(await CryptoCore.decryptItem(enrollment.sealedCredential)) as {
      credential: string;
    };
    credential = { deviceId: enrollment.deviceId, credential: unsealed.credential };
  }
}

async function lock(): Promise<void> {
  await CryptoCore.lock();
  credential = null;
}

/**
 * Scores a password. Needs no vault key, so it works while locked -- the
 * mobile analogue of the extension's `checkStrength`
 * (extension/src/background/vault.ts). `CryptoCore.estimateStrength` bridges
 * to pw-crypto-core's `estimate_strength_ffi` (CryptoCoreModule.kt); this
 * function was the only missing piece.
 */
function checkStrength(password: string): Promise<PasswordStrength> {
  return CryptoCore.estimateStrength(password);
}

/** Whether this device can even do biometric auth right now. */
function biometricAvailable(): Promise<boolean> {
  return Biometric.isAvailable();
}

/** Whether fingerprint unlock is turned on for this enrollment. */
async function biometricEnabled(): Promise<boolean> {
  return (await storage.readEnrollment())?.biometric !== undefined;
}

/**
 * Turns fingerprint unlock on: verifies [password] the same way a normal
 * unlock would (deliberately re-derives and re-unwraps rather than trusting
 * that the vault is already unlocked, so a stale session can't cause a
 * wrong password to get cached), then caches it behind one biometric
 * prompt. See BiometricModule.kt -- this never touches the vault key.
 */
async function enableBiometric(password: string): Promise<void> {
  const enrollment = await storage.readEnrollment();
  if (enrollment === null) throw new Error('not enrolled on this device yet');

  await CryptoCore.unlock(
    password,
    enrollment.vault.saltB64,
    enrollment.vault.argon2.memoryKib,
    enrollment.vault.argon2.iterations,
    enrollment.vault.argon2.parallelism,
    enrollment.vault.wrappedVaultKey,
  );

  const sealed = await Biometric.enable(password);
  await storage.writeEnrollment({ ...enrollment, biometric: sealed });
}

/**
 * `enrollment` with any cached biometric password forgotten.
 *
 * Sets the field to `undefined` rather than destructuring it away: this
 * still round-trips through `storage.writeEnrollment`'s `JSON.stringify`
 * exactly as an absent key would (`undefined` values are dropped), and it
 * sidesteps declaring a rest-sibling binding this project's lint config
 * would otherwise flag as unused.
 */
function withoutBiometric(enrollment: EnrollmentState): EnrollmentState {
  return { ...enrollment, biometric: undefined };
}

/** Turns fingerprint unlock back off. */
async function disableBiometric(): Promise<void> {
  await Biometric.disable();
  const enrollment = await storage.readEnrollment();
  if (enrollment === null) return;
  await storage.writeEnrollment(withoutBiometric(enrollment));
}

/**
 * Recovers the cached master password behind one biometric prompt, then
 * unlocks with it exactly as [unlock] would with a typed one. A device
 * whose enrolled biometrics changed since [enableBiometric] surfaces as
 * `biometric_key_invalidated` (BiometricModule.kt) -- caught here and
 * turned into forgetting the cached password rather than a confusing
 * crypto error, since it can never be recovered again regardless.
 */
async function recoverBiometricPassword(): Promise<string> {
  const enrollment = await storage.readEnrollment();
  if (enrollment === null) throw new Error('not enrolled on this device yet');
  if (enrollment.biometric === undefined) throw new Error('fingerprint unlock is not turned on');

  try {
    return await Biometric.unlock(enrollment.biometric.ciphertextB64, enrollment.biometric.ivB64);
  } catch (thrown) {
    // React Native's native-module bridge attaches the code passed to
    // Promise.reject(code, message, ...) as `.code` on the resulting JS
    // error -- distinct from `.message`, which is BiometricModule.kt's
    // human-readable string.
    const code = thrown !== null && typeof thrown === 'object' && 'code' in thrown ? (thrown as { code?: unknown }).code : undefined;
    if (code === 'biometric_key_invalidated') {
      await storage.writeEnrollment(withoutBiometric(enrollment));
      throw new Error('Your device’s fingerprints changed. Unlock with your password once to turn this back on.');
    }
    throw thrown;
  }
}

async function unlockWithBiometric(): Promise<void> {
  await unlock(await recoverBiometricPassword());
}

/**
 * Exports a backup after a fingerprint instead of a typed password. The
 * fingerprint only releases the cached master password, which then goes
 * through exactly the check a typed one does -- so this is no weaker, just
 * quicker.
 */
async function exportBackupWithBiometric(): Promise<CanonicalBackup> {
  return exportBackup(await recoverBiometricPassword());
}

/**
 * Rotates the master password -- the mobile analogue of
 * extension/src/background/vault.ts's `changeMasterPassword`. A fresh salt,
 * the same Argon2 costs the vault already had (see
 * CryptoCoreModule.kt::rewrapVaultKey). The vault key itself never changes,
 * so no item is re-encrypted and the sealed device credential (wrapped
 * under the vault key, not the master key) needs no resealing either.
 *
 * The server is written first, deliberately: it holds the record every
 * other device reads, so if only one of the two writes lands it should be
 * that one -- this device would still open with the old password and adopt
 * the new record on its next sync, rather than the reverse (this device on
 * the new password, every other device silently handed back the old one).
 */
async function changeMasterPassword(currentPassword: string, newPassword: string): Promise<void> {
  const enrollment = await storage.readEnrollment();
  if (enrollment === null) throw new Error('not enrolled on this device yet');
  if (newPassword === '') throw new Error('Choose a new master password.');

  const { vault } = enrollment;
  const newSaltB64 = await CryptoCore.generateSalt();

  const newWrappedVaultKey = await CryptoCore.rewrapVaultKey(
    currentPassword,
    vault.saltB64,
    vault.argon2.memoryKib,
    vault.argon2.iterations,
    vault.argon2.parallelism,
    vault.wrappedVaultKey,
    newPassword,
    newSaltB64,
    vault.argon2.memoryKib,
    vault.argon2.iterations,
    vault.argon2.parallelism,
  );

  const newVault = { saltB64: newSaltB64, argon2: vault.argon2, wrappedVaultKey: newWrappedVaultKey };

  // A local vault has no server to tell, and therefore no auth key to
  // derive for one -- the same reason the extension only derives it "when
  // `state`" in its own `changeMasterPassword`.
  if (enrollment.mode === 'server') {
    const [currentAuthKey, newAuthKey] = await Promise.all([
      CryptoCore.deriveAuthKey(currentPassword, vault.saltB64, vault.argon2.memoryKib, vault.argon2.iterations, vault.argon2.parallelism),
      CryptoCore.deriveAuthKey(newPassword, newSaltB64, vault.argon2.memoryKib, vault.argon2.iterations, vault.argon2.parallelism),
    ]);

    await authenticated((url, deviceId, cred) =>
      syncClient.changeMasterPassword(url, deviceId, cred, { currentAuthKey, newAuthKey, vault: { saltB64: newVault.saltB64, ...newVault.argon2, wrappedVaultKey: newVault.wrappedVaultKey } }),
    );
  }

  await storage.writeEnrollment({ ...enrollment, vault: newVault });
}

/** The server this device is enrolled with, for display -- null if there isn't one. */
async function serverUrl(): Promise<string | null> {
  const enrollment = await storage.readEnrollment();
  return enrollment?.mode === 'server' ? enrollment.serverUrl : null;
}

/** Whether this vault is local-only -- created with no server relationship at all. */
async function isLocalOnly(): Promise<boolean> {
  return (await storage.readEnrollment())?.mode === 'local';
}

/** The name chosen for this device during enrollment, when locally known. */
async function enrolledDeviceName(): Promise<string | null> {
  return (await storage.readEnrollment())?.deviceName ?? null;
}

/** Fails the same way pullItems does if called before unlock, or at all for a local-only vault. */
async function authenticated<T>(call: (url: string, deviceId: string, credential: string) => Promise<T>): Promise<T> {
  const enrollment = await storage.readEnrollment();
  if (enrollment === null) throw new Error('not enrolled on this device yet');
  if (enrollment.mode !== 'server') throw new Error('this vault has no server');
  if (credential === null) throw new Error('vault is locked');
  return call(enrollment.serverUrl, credential.deviceId, credential.credential);
}

/** The connected server's version, or null if it cannot be read (offline, or an older server without the route). */
async function serverVersion(): Promise<string | null> {
  try {
    return await authenticated(async (url, deviceId, cred) => (await syncClient.serverVersion(url, deviceId, cred)).version);
  } catch {
    return null;
  }
}

function listDevices(): Promise<syncClient.DeviceSummary[]> {
  return authenticated((url, deviceId, cred) => syncClient.listDevices(url, deviceId, cred));
}

function revokeDevice(targetId: string): Promise<void> {
  return authenticated(async (url, deviceId, cred) => {
    await syncClient.revokeDevice(url, deviceId, cred, targetId);
  });
}

/**
 * Mints a device-join invite for a new device -- available from any
 * unlocked device, not only the extension (the server route already allows
 * this; this app just never had UI for it before).
 */
function newEnrollmentToken(): Promise<{ token: string; expiresAt: string }> {
  return authenticated((url, deviceId, cred) => syncClient.createEnrollmentToken(url, deviceId, cred));
}

/**
 * Decrypts a ciphertext batch into the shared `DecryptedItem` shape.
 *
 * Keeps trashed items (`deleted: true`, content intact) so a Trash screen
 * has something to show and restore -- only a purged tombstone (content
 * `{purged: true}`) is dropped, the same distinction the extension's
 * `listItems` draws (extension/src/background/vault.ts). Callers that want
 * the live vault filter `!item.deleted` themselves.
 */
async function decryptAll(items: EncryptedItem[]): Promise<DecryptedItem[]> {
  // Together rather than one await at a time: each is a native bridge call, and
  // the round trips, not the decryption, are what a long vault spends time on.
  const results = await Promise.all(
    items.map(async (item): Promise<DecryptedItem | null> => {
      const content = JSON.parse(await CryptoCore.decryptItem(item)) as Record<string, unknown> & {
        purged?: boolean;
      };
      if (content.purged === true) return null;
      return { id: item.id, itemType: item.itemType, version: item.version, deleted: item.deleted, content: contentWithType(item.itemType, content) };
    }),
  );
  return results.filter((item): item is DecryptedItem => item !== null);
}

/**
 * Attaches derived, non-persisted strength/reuse facts to login items --
 * mutates and returns the same array. Applied once over the *whole* decrypted
 * set (both vault modes), never per-page: reuse is counted across the
 * entire vault, not one server pull page at a time.
 *
 * Reuse is counted over live logins only -- a password sitting in the trash
 * isn't one you're relying on anywhere. Mirrors the extension's `listItems`
 * (extension/src/background/vault.ts).
 */
async function withLoginFacts(items: DecryptedItem[]): Promise<DecryptedItem[]> {
  const shared = new Map<string, number>();
  for (const item of items) {
    if (item.deleted || item.itemType !== 'login') continue;
    const password = typeof item.content.password === 'string' ? item.content.password : '';
    if (password) shared.set(password, (shared.get(password) ?? 0) + 1);
  }
  await Promise.all(
    items.map(async item => {
      if (item.itemType !== 'login') return;
      const password = typeof item.content.password === 'string' ? item.content.password : '';
      item.login = {
        strength: await CryptoCore.estimateStrength(password),
        reusedBy: item.deleted ? 0 : Math.max((shared.get(password) ?? 1) - 1, 0),
      };
    }),
  );
  return items;
}

/**
 * Pulls everything new since the cache's cursor and folds it into the cached
 * ciphertext (storage.ts's readSyncCache/writeSyncCache) by id. Follows the
 * server's `more` flag until caught up, the same loop
 * extension/src/sync/engine.ts's pull side runs. Server-backed vaults only --
 * a local-only vault's `storage.readLocalItems()` already is the one full
 * copy, nothing to cache incrementally.
 *
 * `changed` is whether the caller has anything new to show: the cursor moved,
 * or this is the first sync that ever completed. When nothing arrived the
 * cache is not rewritten, so a quiet refresh costs one request and no storage
 * write.
 *
 * The network pull happens outside the cache lock and the merge inside it, on
 * a fresh read: a push that finished while the pull was in flight has already
 * put its item in the cache, and merging into a stale copy would drop it.
 */
async function syncCiphertext(
  url: string,
  deviceId: string,
  cred: string,
): Promise<{ items: EncryptedItem[]; changed: boolean }> {
  const start = await storage.readSyncCache();
  let cursor = start.cursor;
  const arrived: EncryptedItem[] = [];
  for (;;) {
    const page = await syncClient.pull(url, deviceId, cred, cursor);
    arrived.push(...page.items);
    cursor = page.cursor;
    if (!page.more) break;
  }

  return withCacheLock(async () => {
    const cache = await storage.readSyncCache();
    const changed = cursor !== start.cursor || start.synced !== true;
    if (!changed && arrived.length === 0) return { items: cache.items, changed: false };
    const merged = mergeEncrypted(cache.items, arrived);
    await storage.writeSyncCache({ cursor, items: merged, synced: true });
    return { items: merged, changed };
  });
}

/**
 * Brings the cached ciphertext up to date, and says whether anything arrived.
 *
 * What the foreground sync calls. It pulls and merges but decrypts nothing: the
 * screens decrypt for themselves when they are told to re-read. A local-only
 * vault has no server and nothing to catch up on. Needs the vault unlocked,
 * since the device credential is sealed under the vault key.
 */
async function catchUp(): Promise<boolean> {
  const enrollment = await storage.readEnrollment();
  if (enrollment === null || enrollment.mode === 'local') return false;

  const { changed } = await authenticated((url, deviceId, cred) => syncCiphertext(url, deviceId, cred));
  return changed;
}

/**
 * Decrypts a server vault's cached ciphertext, rebuilding the cache from a
 * full pull once if something in it will not decrypt (e.g. the vault key
 * rotated via changeMasterPassword since it was written). No special error is
 * surfaced for that, same DecryptionFailed-for-everything rule as any other
 * tampered or mismatched ciphertext.
 */
async function decryptCached(items: EncryptedItem[]): Promise<DecryptedItem[]> {
  try {
    return await withLoginFacts(await decryptAll(items));
  } catch {
    await storage.clearSyncCache();
    return authenticated(async (url, deviceId, cred) => {
      const fresh = await syncCiphertext(url, deviceId, cred);
      return withLoginFacts(await decryptAll(fresh.items));
    });
  }
}

/**
 * The vault's current items from what is already on this device -- no
 * network. A screen can draw immediately, including the empty one, instead of
 * waiting on a round trip to learn that nothing changed; `refreshItems`
 * follows up for anything newer.
 *
 * A local-only vault reads its one item store. A server-backed vault reads
 * the ciphertext cache, except before its first sync has ever completed: an
 * empty cache then is not an answer yet, so that one call syncs first.
 *
 * Nothing decrypted is kept here between calls: the plaintext lives in the
 * calling screen's state and goes when the screen does. Holding the whole
 * vault in a module-level variable would keep every password in JS memory
 * for the session, with no way to scrub it (strings are immutable and the GC
 * decides when they go).
 */
async function loadItems(): Promise<DecryptedItem[]> {
  const enrollment = await storage.readEnrollment();
  if (enrollment === null) throw new Error('not enrolled on this device yet');

  if (enrollment.mode === 'local') return withLoginFacts(await decryptAll(await storage.readLocalItems()));

  const cache = await storage.readSyncCache();
  if (cache.synced !== true) return (await refreshItems()) ?? [];
  return decryptCached(cache.items);
}

/**
 * Syncs with the server and returns the decrypted items only if something new
 * arrived; null means what `loadItems` already returned is still current (and
 * always for a local-only vault, which has no server).
 */
async function refreshItems(): Promise<DecryptedItem[] | null> {
  const enrollment = await storage.readEnrollment();
  if (enrollment === null) throw new Error('not enrolled on this device yet');
  if (enrollment.mode === 'local') return null;

  return authenticated(async (url, deviceId, cred) => {
    const { items, changed } = await syncCiphertext(url, deviceId, cred);
    return changed ? decryptCached(items) : null;
  });
}

/**
 * A conflict here means the server holds a version of this item this device
 * hadn't seen -- another device wrote it first. There's no local cache to
 * reconcile against (see pullItems above), so unlike the extension's
 * fork-and-keep-both (extension/src/sync/engine.ts), this just fails loudly:
 * the caller's screen stays open with whatever the user typed still in it,
 * and they can pull the latest and retry rather than silently losing either
 * copy.
 */
async function pushOne(item: EncryptedItem): Promise<void> {
  const result = await authenticated((url, deviceId, cred) => syncClient.push(url, deviceId, cred, [item]));
  if (!result.accepted.includes(item.id)) {
    throw new Error('This item changed on another device. Pull the latest and try again.');
  }
  // Into the cache now, not at the next pull: a screen that draws from the
  // cache first would otherwise show the old version of what was just saved.
  // The cursor stays put, so the next pull returns this item again and
  // overwrites it with the same bytes.
  await withCacheLock(async () => {
    const cache = await storage.readSyncCache();
    await storage.writeSyncCache({ ...cache, items: mergeEncrypted(cache.items, [item]) });
  });
}

/** Writes one item into the local item store, replacing any existing record for its id. */
async function writeLocalItem(item: EncryptedItem): Promise<void> {
  const items = await storage.readLocalItems();
  const index = items.findIndex((existing) => existing.id === item.id);
  if (index === -1) items.push(item);
  else items[index] = item;
  await storage.writeLocalItems(items);
}

/** Persists a freshly-encrypted item: locally for a local-only vault, pushed otherwise. */
async function persist(item: EncryptedItem): Promise<void> {
  const enrollment = await storage.readEnrollment();
  if (enrollment === null) throw new Error('not enrolled on this device yet');
  if (enrollment.mode === 'local') await writeLocalItem(item);
  else await pushOne(item);
}

/** Encrypts and saves a brand-new item at version 1. */
async function addItem(content: ItemContent): Promise<void> {
  const now = Date.now();
  const stamped = { ...content, createdAt: now, lastModifiedAt: now };
  const header = { id: randomItemId(), itemType: content.type, version: 1, updatedAt: now, deleted: false };
  const encrypted = await CryptoCore.encryptItem(JSON.stringify(stamped), header);
  await persist(encrypted);
}

/**
 * Rewrites an item at the next version -- `version` and `deleted` are bound
 * into the authentication tag (pw-crypto-core/src/vault_item.rs), so an
 * edit is always a fresh encryption, never an in-place field change. Callers
 * pass the version they last saw (from the item as it was pulled or just
 * created); for a server-backed vault the server is the one that decides
 * whether that was current -- see pushOne. A local-only vault has no other
 * writer to race against, so its version is never actually disputed; the
 * same AEAD/AAD discipline still applies regardless.
 */
async function updateItem(id: string, version: number, content: ItemContent): Promise<void> {
  const header = { id, itemType: content.type, version: version + 1, updatedAt: Date.now(), deleted: false };
  const stamped = { ...content, lastModifiedAt: Date.now() };
  const encrypted = await CryptoCore.encryptItem(JSON.stringify(stamped), header);
  await persist(encrypted);
}

/**
 * Moves an item to the trash: the same content, re-encrypted at the next
 * version with `deleted: true` -- the mobile analogue of the extension's
 * `trashItem` (extension/src/background/vault.ts). Recoverable via
 * restoreItem below, unlike purgeItem's permanent tombstone. Callers pass
 * the content they already have (from a just-pulled DecryptedItem) since
 * there is no local store of server-vault ciphertext to re-read it from.
 * Works the same for both vault modes -- `persist` already routes to the
 * local item store or the server as appropriate.
 */
async function trashItem(id: string, version: number, itemType: string, content: Record<string, unknown>): Promise<void> {
  const header = { id, itemType, version: version + 1, updatedAt: Date.now(), deleted: true };
  const encrypted = await CryptoCore.encryptItem(JSON.stringify(content), header);
  await persist(encrypted);
}

/** Restores a trashed item: the same content, re-encrypted with `deleted: false`. */
async function restoreItem(id: string, version: number, itemType: string, content: Record<string, unknown>): Promise<void> {
  const header = { id, itemType, version: version + 1, updatedAt: Date.now(), deleted: false };
  const encrypted = await CryptoCore.encryptItem(JSON.stringify(content), header);
  await persist(encrypted);
}

/**
 * Permanently erases an item: a tombstone (`deleted: true`) with its content
 * replaced, the mobile analogue of the extension's `purgeItem`. The record
 * itself is kept (with the new version and tombstone), for a server-backed
 * vault so the deletion still propagates to other devices, and for a
 * local-only one for the same reason `vault_item.rs` never hard-deletes
 * anywhere: a version number that could vanish and be reused is a rollback
 * vulnerability, not a storage saving.
 */
async function purgeItem(id: string, version: number, itemType: string): Promise<void> {
  const header = { id, itemType, version: version + 1, updatedAt: Date.now(), deleted: true };
  const encrypted = await CryptoCore.encryptItem(JSON.stringify({ purged: true }), header);
  await persist(encrypted);
}

export {
  addItem,
  biometricAvailable,
  catchUp,
  biometricEnabled,
  changeMasterPassword,
  checkStrength,
  createLocalVaultAndUnlock,
  createVaultAndUnlock,
  purgeItem,
  enrolledDeviceName,
  disableBiometric,
  enableBiometric,
  enrollAndUnlock,
  exportBackup,
  exportBackupWithBiometric,
  isLocalOnly,
  listDevices,
  lock,
  newEnrollmentToken,
  loadItems,
  refreshItems,
  restoreBackup,
  restoreItem,
  revokeDevice,
  serverUrl,
  serverVersion,
  status,
  trashItem,
  unlock,
  unlockWithBiometric,
  updateItem,
};
export type { DecryptedItem, Status };
