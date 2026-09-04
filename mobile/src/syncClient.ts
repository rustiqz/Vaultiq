import type { Argon2Params, WrappedVaultKey } from './nativeCryptoCore';

/**
 * HTTP calls to the sync server's enrollment/auth routes -- the mobile
 * analogue of extension/src/sync/client.ts, covering only the subset this
 * app currently uses: joining an *existing* vault as a new device and
 * fetching its bootstrap record. Vault creation (`auth/register`) and item
 * sync (`sync`) are not implemented here; see CLAUDE.md §0.
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

/** The salt and KDF costs an enrolling device needs to derive its auth key. */
function enrollmentParams(serverUrl: string, token: string): Promise<KdfParams> {
  return postJson(serverUrl, 'auth/enrollment-params', { token });
}

/** Adds this device, given a token from an already-trusted one and the auth key. */
function enroll(serverUrl: string, token: string, authKey: string, deviceName: string): Promise<DeviceCredential> {
  return postJson(serverUrl, 'auth/enroll', { token, authKey, deviceName });
}

/** What this device needs to rebuild the vault key from the master password. */
function vaultBootstrap(serverUrl: string, deviceId: string, credential: string): Promise<VaultBootstrap> {
  return getJson(serverUrl, 'vault', `Bearer ${deviceId}.${credential}`);
}

export { enroll, enrollmentParams, SyncServerError, vaultBootstrap };
export type { DeviceCredential, KdfParams, VaultBootstrap };
