import Biometric from './nativeBiometric';
import CryptoCore from './nativeCryptoCore';
import type { EncryptedItem } from './nativeCryptoCore';
import * as storage from './storage';
import type { EnrollmentState } from './storage';
import * as syncClient from './syncClient';
import { randomItemId } from './lib/id';
import type { ItemContent } from './itemContent';

/**
 * Vault enrollment/unlock orchestration -- the mobile analogue of
 * `enrollWithServer()` / `unlock()` / `lock()` in
 * extension/src/background/vault.ts, scoped to what this app implements so
 * far: joining an existing vault and unlocking it. See CLAUDE.md §0.
 */
type Status = 'not-enrolled' | 'locked' | 'unlocked';

/** A decrypted item's outer fields plus its parsed plaintext content. */
type DecryptedItem = {
  id: string;
  itemType: string;
  version: number;
  content: Record<string, unknown>;
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
// after unlock (pullItems below); cleared on lock.
let credential: { deviceId: string; credential: string } | null = null;

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

  const unsealed = JSON.parse(await CryptoCore.decryptItem(enrollment.sealedCredential)) as {
    credential: string;
  };
  credential = { deviceId: enrollment.deviceId, credential: unsealed.credential };
}

async function lock(): Promise<void> {
  await CryptoCore.lock();
  credential = null;
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

/** `enrollment` with any cached biometric password forgotten. */
function withoutBiometric(enrollment: EnrollmentState): EnrollmentState {
  return {
    serverUrl: enrollment.serverUrl,
    deviceId: enrollment.deviceId,
    deviceName: enrollment.deviceName,
    sealedCredential: enrollment.sealedCredential,
    vault: enrollment.vault,
  };
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
async function unlockWithBiometric(): Promise<void> {
  const enrollment = await storage.readEnrollment();
  if (enrollment === null) throw new Error('not enrolled on this device yet');
  if (enrollment.biometric === undefined) throw new Error('fingerprint unlock is not turned on');

  let password: string;
  try {
    password = await Biometric.unlock(enrollment.biometric.ciphertextB64, enrollment.biometric.ivB64);
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

  await unlock(password);
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

  const [currentAuthKey, newAuthKey] = await Promise.all([
    CryptoCore.deriveAuthKey(currentPassword, vault.saltB64, vault.argon2.memoryKib, vault.argon2.iterations, vault.argon2.parallelism),
    CryptoCore.deriveAuthKey(newPassword, newSaltB64, vault.argon2.memoryKib, vault.argon2.iterations, vault.argon2.parallelism),
  ]);

  const newVault = { saltB64: newSaltB64, argon2: vault.argon2, wrappedVaultKey: newWrappedVaultKey };

  await authenticated((url, deviceId, cred) =>
    syncClient.changeMasterPassword(url, deviceId, cred, { currentAuthKey, newAuthKey, vault: { saltB64: newVault.saltB64, ...newVault.argon2, wrappedVaultKey: newVault.wrappedVaultKey } }),
  );

  await storage.writeEnrollment({ ...enrollment, vault: newVault });
}

/** The server this device is enrolled with, for display -- null if not enrolled. */
async function serverUrl(): Promise<string | null> {
  return (await storage.readEnrollment())?.serverUrl ?? null;
}

/** The name chosen for this device during enrollment, when locally known. */
async function enrolledDeviceName(): Promise<string | null> {
  return (await storage.readEnrollment())?.deviceName ?? null;
}

/** Fails the same way pullItems does if called before unlock. */
async function authenticated<T>(call: (url: string, deviceId: string, credential: string) => Promise<T>): Promise<T> {
  const enrollment = await storage.readEnrollment();
  if (enrollment === null) throw new Error('not enrolled on this device yet');
  if (credential === null) throw new Error('vault is locked');
  return call(enrollment.serverUrl, credential.deviceId, credential.credential);
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
 * Pulls and decrypts the vault's current items.
 *
 * Always pulls from the beginning rather than tracking a cursor: this app
 * does not keep a local item cache yet (nothing is persisted here but
 * ciphertext-free enrollment state -- see storage.ts), so every call needs
 * the full set to render from anyway. A cursor only pays for itself once
 * there is a cache to advance incrementally; premature here. Follows the
 * server's `more` flag until caught up, the same loop
 * extension/src/sync/engine.ts's pull side runs.
 */
function pullItems(): Promise<DecryptedItem[]> {
  return authenticated(async (url, deviceId, cred) => {
    const decrypted: DecryptedItem[] = [];
    let cursor = '0';
    for (;;) {
      const page = await syncClient.pull(url, deviceId, cred, cursor);
      for (const item of page.items) {
        if (item.deleted) continue;
        const content = JSON.parse(await CryptoCore.decryptItem(item)) as Record<string, unknown>;
        decrypted.push({ id: item.id, itemType: item.itemType, version: item.version, content });
      }
      cursor = page.cursor;
      if (!page.more) break;
    }
    return decrypted;
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
}

/** Encrypts and pushes a brand-new item at version 1. */
async function addItem(content: ItemContent): Promise<void> {
  const now = Date.now();
  const stamped = { ...content, createdAt: now, lastModifiedAt: now };
  const header = { id: randomItemId(), itemType: content.type, version: 1, updatedAt: now, deleted: false };
  const encrypted = await CryptoCore.encryptItem(JSON.stringify(stamped), header);
  await pushOne(encrypted);
}

/**
 * Rewrites an item at the next version -- `version` and `deleted` are bound
 * into the authentication tag (pw-crypto-core/src/vault_item.rs), so an
 * edit is always a fresh encryption, never an in-place field change. Callers
 * pass the version they last saw (from the item as it was pulled or just
 * created); the server is the one that decides whether that was current --
 * see pushOne.
 */
async function updateItem(id: string, version: number, content: ItemContent): Promise<void> {
  const header = { id, itemType: content.type, version: version + 1, updatedAt: Date.now(), deleted: false };
  const stamped = { ...content, lastModifiedAt: Date.now() };
  const encrypted = await CryptoCore.encryptItem(JSON.stringify(stamped), header);
  await pushOne(encrypted);
}

/**
 * Permanently erases an item: a tombstone (`deleted: true`) with its content
 * replaced, the mobile analogue of the extension's `purgeItem` -- there's no
 * trash/restore screen here to make a recoverable soft-delete meaningful, so
 * this is the only kind of delete. The record itself is kept (with the new
 * version and tombstone) so the deletion still propagates to other devices.
 */
async function deleteItem(id: string, version: number, itemType: string): Promise<void> {
  const header = { id, itemType, version: version + 1, updatedAt: Date.now(), deleted: true };
  const encrypted = await CryptoCore.encryptItem(JSON.stringify({ purged: true }), header);
  await pushOne(encrypted);
}

export {
  addItem,
  biometricAvailable,
  biometricEnabled,
  changeMasterPassword,
  deleteItem,
  enrolledDeviceName,
  disableBiometric,
  enableBiometric,
  enrollAndUnlock,
  listDevices,
  lock,
  pullItems,
  revokeDevice,
  serverUrl,
  status,
  unlock,
  unlockWithBiometric,
  updateItem,
};
export type { DecryptedItem, Status };
