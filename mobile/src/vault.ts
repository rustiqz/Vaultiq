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

const CREDENTIAL_HEADER = {
  id: 'sync:credential',
  itemType: 'credential',
  version: 1,
  updatedAt: 0,
  deleted: false,
};

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
  serverUrl: string,
  token: string,
  deviceName: string,
  password: string,
): Promise<void> {
  const params = await syncClient.enrollmentParams(serverUrl, token);
  const authKey = await CryptoCore.deriveAuthKey(
    password,
    params.saltB64,
    params.memoryKib,
    params.iterations,
    params.parallelism,
  );
  const device = await syncClient.enroll(serverUrl, token, authKey, deviceName);
  const bootstrap = await syncClient.vaultBootstrap(serverUrl, device.deviceId, device.credential);

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
    serverUrl,
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
}

/**
 * Unlocks an already-enrolled vault with the master password.
 *
 * Does not yet unseal the stored device credential -- nothing in this app
 * makes an authenticated server call after enrollment yet, so there is
 * nothing to unseal it for. That belongs with the item-sync work that reads
 * it (CLAUDE.md §0).
 */
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
}

async function lock(): Promise<void> {
  await CryptoCore.lock();
}

export { enrollAndUnlock, lock, status, unlock };
export type { Status };
