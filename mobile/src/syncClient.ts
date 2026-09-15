import type { Argon2Params, EncryptedItem, WrappedVaultKey } from './nativeCryptoCore';

/**
 * HTTP calls to the sync server's enrollment/auth/sync routes -- the mobile
 * analogue of extension/src/sync/client.ts.
 */
type KdfParams = {
  saltB64: string;
} & Argon2Params;

type DeviceCredential = {
  deviceId: string;
  credential: string;
};

type VaultBootstrap = KdfParams & {
  wrappedVaultKey: WrappedVaultKey;
};

type PullResult = {
  items: EncryptedItem[];
  cursor: string;
  more: boolean;
};

type PushResult = {
  accepted: string[];
  /** What the server holds for items it would not overwrite -- see push() below. */
  conflicts: EncryptedItem[];
  cursor: string;
};

type DeviceSummary = {
  id: string;
  name: string;
  enrolledAt: string;
  revokedAt: string | null;
  current: boolean;
};

class SyncServerError extends Error {}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string | string[] };
    if (typeof body.message === 'string') return body.message;
    if (Array.isArray(body.message)) return body.message.join(', ');
  } catch {
    // Not a JSON error body -- fall through to the status line.
  }
  return `${response.status} ${response.statusText}`;
}

async function postJson<T>(serverUrl: string, path: string, body: unknown, authHeader?: string): Promise<T> {
  const response = await fetch(`${serverUrl}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new SyncServerError(await readErrorMessage(response));
  return (await response.json()) as T;
}

async function getJson<T>(serverUrl: string, path: string, authHeader: string): Promise<T> {
  const response = await fetch(`${serverUrl}/${path}`, {
    headers: { Authorization: authHeader },
  });
  if (!response.ok) throw new SyncServerError(await readErrorMessage(response));
  return (await response.json()) as T;
}

async function deleteJson<T>(serverUrl: string, path: string, authHeader: string): Promise<T> {
  const response = await fetch(`${serverUrl}/${path}`, {
    method: 'DELETE',
    headers: { Authorization: authHeader },
  });
  if (!response.ok) throw new SyncServerError(await readErrorMessage(response));
  return (await response.json()) as T;
}

/** Creates a brand-new vault, given a valid account-creation token. */
function register(
  serverUrl: string,
  token: string,
  authKey: string,
  vault: VaultBootstrap,
  deviceName: string,
): Promise<DeviceCredential> {
  return postJson(serverUrl, 'auth/register', { token, authKey, vault, deviceName });
}

/** The salt and KDF costs an enrolling device needs to derive its auth key. */
function enrollmentParams(serverUrl: string, token: string): Promise<KdfParams> {
  return postJson(serverUrl, 'auth/enrollment-params', { token });
}

/** Mints a device-join token for a new device, from this already-trusted one. */
function createEnrollmentToken(
  serverUrl: string,
  deviceId: string,
  credential: string,
): Promise<{ token: string; expiresAt: string }> {
  return postJson(serverUrl, 'devices/enrollment-token', {}, `Bearer ${deviceId}.${credential}`);
}

/** Adds this device, given a token from an already-trusted one and the auth key. */
function enroll(serverUrl: string, token: string, authKey: string, deviceName: string): Promise<DeviceCredential> {
  return postJson(serverUrl, 'auth/enroll', { token, authKey, deviceName });
}

/** What this device needs to rebuild the vault key from the master password. */
function vaultBootstrap(serverUrl: string, deviceId: string, credential: string): Promise<VaultBootstrap> {
  return getJson(serverUrl, 'vault', `Bearer ${deviceId}.${credential}`);
}

/** Everything written after `since` (a bare integer cursor, "0" for everything). */
function pull(serverUrl: string, deviceId: string, credential: string, since: string): Promise<PullResult> {
  return getJson(serverUrl, `sync?since=${encodeURIComponent(since)}`, `Bearer ${deviceId}.${credential}`);
}

/**
 * Writes items, where the caller is not behind. Accepted ids land in
 * `accepted`; anything the server holds a newer or equal-but-different
 * version of comes back in `conflicts` rather than being overwritten -- see
 * server/src/sync/sync.service.ts's `push`.
 */
function push(serverUrl: string, deviceId: string, credential: string, items: EncryptedItem[]): Promise<PushResult> {
  return postJson(serverUrl, 'sync', { items }, `Bearer ${deviceId}.${credential}`);
}

/** Every device enrolled on this vault, this one flagged as `current`. */
function listDevices(serverUrl: string, deviceId: string, credential: string): Promise<DeviceSummary[]> {
  return getJson(serverUrl, 'devices', `Bearer ${deviceId}.${credential}`);
}

/** Revokes another device. The server refuses to revoke the caller's own. */
function revokeDevice(serverUrl: string, deviceId: string, credential: string, targetId: string): Promise<{ revoked: true }> {
  return deleteJson(serverUrl, `devices/${encodeURIComponent(targetId)}`, `Bearer ${deviceId}.${credential}`);
}

/**
 * Rotates the vault's auth key and stored wrapped-key record -- the mobile
 * analogue of extension/src/sync/client.ts's `changeMasterPassword`.
 * `currentAuthKey` proves the caller actually knows the current password;
 * `vault` is the already-rewrapped record other devices pick up on their
 * next sync.
 */
function changeMasterPassword(
  serverUrl: string,
  deviceId: string,
  credential: string,
  body: { currentAuthKey: string; newAuthKey: string; vault: VaultBootstrap },
): Promise<{ changed: true }> {
  return postJson(serverUrl, 'vault/master-password', body, `Bearer ${deviceId}.${credential}`);
}

export {
  changeMasterPassword,
  createEnrollmentToken,
  enroll,
  enrollmentParams,
  listDevices,
  pull,
  push,
  register,
  revokeDevice,
  SyncServerError,
  vaultBootstrap,
};
export type { DeviceCredential, DeviceSummary, KdfParams, PullResult, PushResult, VaultBootstrap };
