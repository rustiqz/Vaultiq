// The background context. Owns the vault key and performs every crypto
// operation; nothing else in the extension ever sees key material.
//
// Both MV3 background flavours are suspended when idle — Chrome's service
// worker and Firefox's event page alike — so this module is written to be
// re-entered from cold at any moment. The vault key is recovered from
// `storage.session`, which survives suspension but not the browser closing.

import {
  assertSessionStorage,
  clearStashedVaultKey,
  decryptItem,
  deriveMasterKey,
  encryptItem,
  generateSalt,
  generateVaultKey,
  loadCrypto,
  recommendedParams,
  stashVaultKey,
  takeStashedVaultKey,
  unwrapVaultKey,
  wrapVaultKey,
  type MasterKeyHandle,
  type VaultKeyHandle,
} from "../lib/crypto.js";
import type {
  DecryptedItem,
  LoginContent,
  Request,
  Response,
  VaultStatus,
} from "../lib/messages.js";
import { allItems, getVault, putItem, putVault, type StoredItem } from "../lib/vault-db.js";

/** Idle minutes before the vault locks itself. */
const AUTO_LOCK_MINUTES = 15;
const AUTO_LOCK_ALARM = "vaultiq-auto-lock";
const ITEM_TYPE = "login";
const VAULT_FORMAT = 1;

/**
 * The unlocked key, when this context happens to be alive and warm.
 *
 * Only ever a cache. The authority is `storage.session`, because this
 * variable is gone the moment the browser suspends us.
 */
let warmVaultKey: VaultKeyHandle | undefined;

async function currentVaultKey(): Promise<VaultKeyHandle | undefined> {
  warmVaultKey ??= await takeStashedVaultKey();
  return warmVaultKey;
}

/** Pushes the auto-lock deadline out. Called on every successful request. */
async function extendAutoLock(): Promise<void> {
  await browser.alarms.clear(AUTO_LOCK_ALARM);
  browser.alarms.create(AUTO_LOCK_ALARM, { delayInMinutes: AUTO_LOCK_MINUTES });
}

async function lock(): Promise<void> {
  await browser.alarms.clear(AUTO_LOCK_ALARM);
  await clearStashedVaultKey();
  // Handles are not garbage collected: without free() the key would sit in
  // wasm memory until the context is torn down.
  warmVaultKey?.free();
  warmVaultKey = undefined;
}

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_LOCK_ALARM) void lock();
});

async function status(): Promise<VaultStatus> {
  if (!(await getVault())) return "empty";
  return (await currentVaultKey()) ? "unlocked" : "locked";
}

/** Derives the master key and immediately frees it — it is never cached. */
function withMasterKey<T>(
  masterPassword: string,
  saltB64: string,
  params: { memory_kib: number; iterations: number; parallelism: number },
  work: (key: MasterKeyHandle) => T,
): T {
  const masterKey = deriveMasterKey(
    masterPassword,
    saltB64,
    params.memory_kib,
    params.iterations,
    params.parallelism,
  );
  try {
    return work(masterKey);
  } finally {
    masterKey.free();
  }
}

async function create(masterPassword: string): Promise<void> {
  if (await getVault()) throw new Error("A vault already exists.");

  const saltB64 = generateSalt();
  const params = recommendedParams();
  const vaultKey = generateVaultKey();

  // The wasm boundary hands back a JsValue, which is `any` to TypeScript.
  // Kept as `unknown` so nothing downstream can quietly assume a shape —
  // it is opaque to us and only ever handed back to the crypto core.
  const wrapped = withMasterKey<unknown>(masterPassword, saltB64, params, (masterKey) =>
    wrapVaultKey(vaultKey, masterKey) as unknown,
  );

  await putVault({
    id: "vault",
    format: VAULT_FORMAT,
    saltB64,
    memoryKib: params.memory_kib,
    iterations: params.iterations,
    parallelism: params.parallelism,
    wrappedVaultKey: wrapped,
  });

  await stashVaultKey(vaultKey);
  warmVaultKey = vaultKey;
}

async function unlock(masterPassword: string): Promise<void> {
  const vault = await getVault();
  if (!vault) throw new Error("No vault on this device yet.");

  // A wrong password fails here, indistinguishably from a tampered record —
  // the crypto core returns one opaque error for both.
  const vaultKey = withMasterKey(
    masterPassword,
    vault.saltB64,
    { memory_kib: vault.memoryKib, iterations: vault.iterations, parallelism: vault.parallelism },
    (masterKey) => unwrapVaultKey(vault.wrappedVaultKey, masterKey),
  );

  await stashVaultKey(vaultKey);
  warmVaultKey = vaultKey;
}

async function requireUnlocked(): Promise<VaultKeyHandle> {
  const vaultKey = await currentVaultKey();
  if (!vaultKey) throw new Error("Vault is locked.");
  return vaultKey;
}

async function addItem(content: LoginContent): Promise<string> {
  const vaultKey = await requireUnlocked();
  const id = crypto.randomUUID();
  const updatedAt = Date.now();

  const encrypted: StoredItem = encryptItem(
    JSON.stringify(content),
    { id, item_type: ITEM_TYPE, version: 1, updated_at: updatedAt, deleted: false },
    vaultKey,
  ) as StoredItem;

  await putItem(encrypted);
  return id;
}

async function listItems(): Promise<DecryptedItem[]> {
  const vaultKey = await requireUnlocked();
  const stored = await allItems();

  return stored.map((item) => {
    const content = JSON.parse(decryptItem(item, vaultKey)) as LoginContent;
    return { ...content, id: item.id, updatedAt: item.updated_at };
  });
}

async function handle(request: Request): Promise<Response> {
  await loadCrypto();

  switch (request.kind) {
    case "status":
      return { ok: true, kind: "status", status: await status() };
    case "create":
      await create(request.masterPassword);
      await extendAutoLock();
      return { ok: true, kind: "create" };
    case "unlock":
      await unlock(request.masterPassword);
      await extendAutoLock();
      return { ok: true, kind: "unlock" };
    case "lock":
      await lock();
      return { ok: true, kind: "lock" };
    case "addItem": {
      const id = await addItem(request.content);
      await extendAutoLock();
      return { ok: true, kind: "addItem", id };
    }
    case "listItems": {
      const items = await listItems();
      await extendAutoLock();
      return { ok: true, kind: "listItems", items };
    }
  }
}

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  assertSessionStorage();
  handle(message as Request)
    .then(sendResponse)
    .catch((error: unknown) => {
      // The message is whatever the crypto core chose to say, which for any
      // decryption failure is one opaque string. Nothing is added here.
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "failed" });
    });
  return true; // keeps the channel open for the async reply
});
