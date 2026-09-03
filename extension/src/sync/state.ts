// What this device remembers about its server.
//
// Three things, held differently on purpose. The address and the cursor are
// not secrets — a hostname and an integer. The device credential is: it pulls
// the whole vault and can revoke the other devices, so it is stored encrypted
// under the vault key.
//
// That costs nothing, because there is no moment when we want to sync but do
// not have the vault key — everything pulled is ciphertext we would have to
// decrypt anyway. A stolen disk therefore yields no working credential.

import { decryptItem, encryptItem, type VaultKeyHandle } from "../lib/crypto.js";
import type { StoredItem } from "../lib/vault-db.js";
import type { DeviceCredential } from "./client.js";

const KEY = "sync";
const CREDENTIAL_ID = "sync:credential";
const CREDENTIAL_TYPE = "sync";

export interface SyncState {
  /** Base address of the server, always https (or localhost). */
  server: string;
  /** How far this device has read the server's change sequence. */
  cursor: string;
  /** `{ deviceId, credential }`, encrypted under the vault key. */
  credential: StoredItem;
  lastSyncedAt?: number;
  /** The last failure, kept so the popup can say why nothing is syncing. */
  lastError?: string;
}

export async function readState(): Promise<SyncState | undefined> {
  const stored = (await browser.storage.local.get(KEY)) as Record<string, SyncState | undefined>;
  return stored[KEY];
}

export async function writeState(state: SyncState): Promise<void> {
  await browser.storage.local.set({ [KEY]: state });
}

export async function clearState(): Promise<void> {
  await browser.storage.local.remove(KEY);
}

export function sealCredential(
  credential: DeviceCredential,
  vaultKey: VaultKeyHandle,
): StoredItem {
  return encryptItem(
    JSON.stringify(credential),
    {
      id: CREDENTIAL_ID,
      item_type: CREDENTIAL_TYPE,
      version: 1,
      updated_at: Date.now(),
      deleted: false,
    },
    vaultKey,
  ) as StoredItem;
}

export function openCredential(state: SyncState, vaultKey: VaultKeyHandle): DeviceCredential {
  return JSON.parse(decryptItem(state.credential, vaultKey)) as DeviceCredential;
}
