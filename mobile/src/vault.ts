import CryptoCore from './nativeCryptoCore';
import * as storage from './storage';
import type { EnrollmentState } from './storage';
import * as syncClient from './syncClient';

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
  const params = await syncClient.enrollmentParams(url, token);
  const authKey = await CryptoCore.deriveAuthKey(
    password,
    params.saltB64,
    params.memoryKib,
    params.iterations,
    params.parallelism,
  );
  const device = await syncClient.enroll(url, token, authKey, deviceName);
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

/** The server this device is enrolled with, for display -- null if not enrolled. */
async function serverUrl(): Promise<string | null> {
  return (await storage.readEnrollment())?.serverUrl ?? null;
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
        decrypted.push({ id: item.id, itemType: item.itemType, content });
      }
      cursor = page.cursor;
      if (!page.more) break;
    }
    return decrypted;
  });
}

export { enrollAndUnlock, listDevices, lock, pullItems, revokeDevice, serverUrl, status, unlock };
export type { DecryptedItem, Status };
