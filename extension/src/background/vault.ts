// Everything the vault can do. No browser wiring lives here — that is
// `index.ts` — so these operations can be exercised without a browser.
//
// Both Manifest V3 background flavours are suspended when idle: Chrome's
// service worker and Firefox's event page alike. Nothing here may assume it
// is still warm; the vault key is recovered from `storage.session`, which
// survives suspension but not the browser closing.

import {
  assertSessionStorage,
  clearStashedVaultKey,
  decryptItem,
  deriveMasterKey,
  encryptItem,
  generateSalt,
  generateVaultKey,
  loadCrypto,
  generatePassword,
  recommendedParams,
  recommendedPasswordOptions,
  scorePassword,
  stashVaultKey,
  takeStashedVaultKey,
  unwrapVaultKey,
  wrapVaultKey,
  type MasterKeyHandle,
  type VaultKeyHandle,
} from "../lib/crypto.js";

export { assertSessionStorage, loadCrypto };
import type {
  DecryptedItem,
  LoginContent,
  PasswordOptions,
  PasswordStrength,
  VaultStatus,
} from "../lib/messages.js";
import {
  allItems,
  getItem,
  getVault,
  putItem,
  putVault,
  type StoredItem,
} from "../lib/vault-db.js";

/** Idle minutes before the vault locks itself. */
const AUTO_LOCK_MINUTES = 15;
export const AUTO_LOCK_ALARM = "vaultiq-auto-lock";
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
export async function extendAutoLock(): Promise<void> {
  await browser.alarms.clear(AUTO_LOCK_ALARM);
  browser.alarms.create(AUTO_LOCK_ALARM, { delayInMinutes: AUTO_LOCK_MINUTES });
}

export async function lock(): Promise<void> {
  await browser.alarms.clear(AUTO_LOCK_ALARM);
  await clearStashedVaultKey();
  // Handles are not garbage collected: without free() the key would sit in
  // wasm memory until the context is torn down.
  warmVaultKey?.free();
  warmVaultKey = undefined;
}

export async function status(): Promise<VaultStatus> {
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

export async function create(masterPassword: string): Promise<void> {
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

export async function unlock(masterPassword: string): Promise<void> {
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

export async function addItem(content: LoginContent): Promise<string> {
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

/**
 * Rewrites an item: decrypt, change, re-encrypt at the next version.
 *
 * Every mutation goes through here because none of them can be a field edit.
 * `version` and `deleted` are bound into the authentication tag, so changing
 * either on a stored record makes it fail to decrypt — which is the whole
 * point of binding them. A change is therefore always a fresh encryption.
 *
 * The version increment is not bookkeeping either: without it a new
 * ciphertext would be interchangeable with the old one, and a server could
 * roll you back to a previous password undetected.
 */
async function rewriteItem(
  id: string,
  change: (current: LoginContent) => { content: string; deleted: boolean },
): Promise<void> {
  const vaultKey = await requireUnlocked();

  const stored = await getItem(id);
  if (!stored) throw new Error("No such item.");

  const current = JSON.parse(decryptItem(stored, vaultKey)) as LoginContent;
  const { content, deleted } = change(current);

  const encrypted: StoredItem = encryptItem(
    content,
    {
      id,
      item_type: stored.item_type,
      version: stored.version + 1,
      updated_at: Date.now(),
      deleted,
    },
    vaultKey,
  ) as StoredItem;

  await putItem(encrypted);
}

export async function updateItem(id: string, content: LoginContent): Promise<void> {
  await rewriteItem(id, () => ({ content: JSON.stringify(content), deleted: false }));
}

export async function trashItem(id: string): Promise<void> {
  // The content is kept, so this is recoverable.
  await rewriteItem(id, (current) => ({
    content: JSON.stringify(current),
    deleted: true,
  }));
}

export async function restoreItem(id: string): Promise<void> {
  await rewriteItem(id, (current) => ({
    content: JSON.stringify(current),
    deleted: false,
  }));
}

export async function purgeItem(id: string): Promise<void> {
  // The record survives — a deletion has to be able to propagate to other
  // devices — but its content is replaced, so the secret is genuinely gone.
  // The marker lives inside the ciphertext, so a server cannot tell a purged
  // item from any other.
  await rewriteItem(id, () => ({
    content: JSON.stringify({ purged: true }),
    deleted: true,
  }));
}

/**
 * Generates a password.
 *
 * Needs no vault key and works while locked: a user filling a signup form has
 * no reason to unlock first.
 */
export function newPassword(options?: PasswordOptions): string {
  return generatePassword(options ?? recommendedPasswordOptions());
}

/** Scores a password. Needs no vault key, so it works while locked. */
export function checkStrength(password: string): PasswordStrength {
  return scorePassword(password);
}

export async function listItems(): Promise<DecryptedItem[]> {
  const vaultKey = await requireUnlocked();
  const stored = await allItems();

  const decrypted = stored.flatMap((item) => {
    const content = JSON.parse(decryptItem(item, vaultKey)) as Partial<LoginContent> & {
      purged?: boolean;
    };
    // A purged record is a tombstone with nothing left in it; it exists for
    // sync, not for the user.
    if (content.purged === true) return [];

    return [
      {
        // `name` is absent on anything saved before the field existed.
        ...(content.name === undefined ? {} : { name: content.name }),
        username: content.username ?? "",
        password: content.password ?? "",
        url: content.url ?? "",
        notes: content.notes ?? "",
        id: item.id,
        updatedAt: item.updated_at,
        deleted: item.deleted,
        strength: scorePassword(content.password ?? ""),
      },
    ];
  });

  // Storage order is by id, which is a random UUID — effectively shuffled.
  // Sort by what the user actually reads, so a list of several logins for one
  // site stays put between openings.
  return decrypted.sort((a, b) =>
    displayName(a).localeCompare(displayName(b), undefined, { sensitivity: "base" }),
  );
}

/** What the list shows for an item, and therefore what it sorts on. */
function displayName(item: DecryptedItem): string {
  return item.name?.trim() || item.username;
}
