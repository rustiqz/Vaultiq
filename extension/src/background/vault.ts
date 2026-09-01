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
import { matchesSite, siteScope } from "../lib/site.js";
import type {
  AuditEvent,
  DecryptedItem,
  DeviceIdentity,
  ItemUsage,
  UsageEvent,
  LoginContent,
  PasswordOptions,
  PasswordStrength,
  VaultStatus,
} from "../lib/messages.js";
import { renameDevice as storeDeviceName, thisDevice } from "../lib/device.js";
import {
  allItems,
  allUsage,
  getItem,
  getUsage,
  getVault,
  putItem,
  putUsage,
  putVault,
  type StoredItem,
} from "../lib/vault-db.js";

/** Idle minutes before the vault locks itself. */
const AUTO_LOCK_MINUTES = 15;
export const AUTO_LOCK_ALARM = "vaultiq-auto-lock";
const ITEM_TYPE = "login";
const USAGE_TYPE = "usage";

/** How many recent events one device keeps. Enough to be useful, bounded. */
const AUDIT_LIMIT = 200;

function emptyUsage(): ItemUsage {
  return { useCount: 0, counts: {}, devices: [] };
}
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

/** What one device has recorded: per-item counters, plus recent events. */
interface DeviceRecord {
  device: DeviceIdentity;
  items: Record<string, Partial<Record<UsageEvent, { count: number; lastAt: number }>>>;
  events: AuditEvent[];
}

function emptyRecord(device: DeviceIdentity): DeviceRecord {
  return { device, items: {}, events: [] };
}

async function readDeviceRecord(
  vaultKey: VaultKeyHandle,
  device: DeviceIdentity,
): Promise<DeviceRecord> {
  const stored = await getUsage(device.id);
  if (!stored) return emptyRecord(device);
  try {
    const parsed = JSON.parse(decryptItem(stored.item, vaultKey)) as DeviceRecord;
    // The name can change; the record keeps whatever it was called last.
    return { ...parsed, device };
  } catch {
    // A usage record that will not decrypt is a statistic, not a vault.
    // Losing it must never stop the vault opening.
    return emptyRecord(device);
  }
}

async function writeDeviceRecord(
  vaultKey: VaultKeyHandle,
  record: DeviceRecord,
): Promise<void> {
  const previous = await getUsage(record.device.id);
  const item: StoredItem = encryptItem(
    JSON.stringify(record),
    {
      id: `usage:${record.device.id}`,
      item_type: USAGE_TYPE,
      version: (previous?.item.version ?? 0) + 1,
      updated_at: Date.now(),
      deleted: false,
    },
    vaultKey,
  ) as StoredItem;

  await putUsage({ id: `usage:${record.device.id}`, deviceId: record.device.id, item });
}

/** Every device's record, decrypted, for merging into one view. */
async function readAllRecords(vaultKey: VaultKeyHandle): Promise<DeviceRecord[]> {
  const records: DeviceRecord[] = [];
  for (const stored of await allUsage()) {
    try {
      records.push(JSON.parse(decryptItem(stored.item, vaultKey)) as DeviceRecord);
    } catch {
      // Skip a record that will not decrypt rather than failing the list.
    }
  }
  return records;
}

/** Notes that something was done with an item, on this device. */
export async function recordUse(id: string, event: UsageEvent = "autofilled"): Promise<void> {
  const vaultKey = await requireUnlocked();
  const device = await thisDevice();
  const record = await readDeviceRecord(vaultKey, device);
  const now = Date.now();

  const forItem = record.items[id] ?? {};
  const previous = forItem[event] ?? { count: 0, lastAt: 0 };
  forItem[event] = { count: previous.count + 1, lastAt: now };
  record.items[id] = forItem;

  // Newest first, and bounded — an unbounded history is a growing liability
  // as much as a growing file.
  record.events = [{ at: now, itemId: id, kind: event }, ...record.events].slice(0, AUDIT_LIMIT);

  await writeDeviceRecord(vaultKey, record);
}

/** This device, as the audit trail names it. */
export async function device(): Promise<DeviceIdentity> {
  return await thisDevice();
}

export async function renameDevice(name: string): Promise<void> {
  const renamed = await storeDeviceName(name);
  // Carried into this device's own record, so the new name shows up in the
  // merged view without waiting for the next use.
  const vaultKey = await currentVaultKey();
  if (!vaultKey) return;
  await writeDeviceRecord(vaultKey, await readDeviceRecord(vaultKey, renamed));
}

/** Recent activity across every device, newest first. */
export async function auditLog(): Promise<{ events: AuditEvent[]; devices: DeviceIdentity[] }> {
  const vaultKey = await requireUnlocked();
  const records = await readAllRecords(vaultKey);

  return {
    events: records
      .flatMap((record) => record.events)
      .sort((a, b) => b.at - a.at)
      .slice(0, AUDIT_LIMIT),
    devices: records.map((record) => record.device),
  };
}

/** Folds every device's record into one view per item. */
function mergeUsage(records: DeviceRecord[]): Map<string, ItemUsage> {
  const merged = new Map<string, ItemUsage>();

  for (const record of records) {
    for (const [itemId, events] of Object.entries(record.items)) {
      const usage = merged.get(itemId) ?? emptyUsage();

      let deviceCount = 0;
      let deviceLast = 0;

      for (const [kind, tally] of Object.entries(events) as [
        UsageEvent,
        { count: number; lastAt: number },
      ][]) {
        usage.counts[kind] = (usage.counts[kind] ?? 0) + tally.count;
        usage.useCount += tally.count;
        deviceCount += tally.count;
        deviceLast = Math.max(deviceLast, tally.lastAt);

        if (tally.lastAt > (usage.lastUsedAt ?? 0)) usage.lastUsedAt = tally.lastAt;
        if (kind === "autofilled" && tally.lastAt > (usage.lastAutofilledAt ?? 0)) {
          usage.lastAutofilledAt = tally.lastAt;
        }
      }

      usage.devices.push({
        deviceId: record.device.id,
        deviceName: record.device.name,
        count: deviceCount,
        lastAt: deviceLast,
      });
      merged.set(itemId, usage);
    }
  }

  for (const usage of merged.values()) usage.devices.sort((a, b) => b.lastAt - a.lastAt);
  return merged;
}

export async function addItem(content: LoginContent): Promise<string> {
  const vaultKey = await requireUnlocked();
  const id = crypto.randomUUID();
  const updatedAt = Date.now();

  const stamped: LoginContent = { ...content, createdAt: updatedAt, lastModifiedAt: updatedAt };

  const encrypted: StoredItem = encryptItem(
    JSON.stringify(stamped),
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
  await rewriteItem(id, (current) => ({
    content: JSON.stringify({
      ...content,
      // Preserved across an edit; only a fresh save sets it.
      ...(current.createdAt === undefined ? {} : { createdAt: current.createdAt }),
      lastModifiedAt: Date.now(),
    }),
    deleted: false,
  }));
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
  const usage = mergeUsage(await readAllRecords(vaultKey));

  // Counted over live items only: a password still sitting in the trash is
  // not one you are relying on anywhere.
  const shared = new Map<string, number>();
  for (const item of stored) {
    if (item.deleted) continue;
    try {
      const parsed = JSON.parse(decryptItem(item, vaultKey)) as Partial<LoginContent>;
      const password = parsed.password ?? "";
      if (password) shared.set(password, (shared.get(password) ?? 0) + 1);
    } catch {
      // A record that will not decrypt cannot contribute to the count. It is
      // surfaced elsewhere, not swallowed into a wrong statistic.
    }
  }

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
        usage: usage.get(item.id) ?? emptyUsage(),
        reusedBy: item.deleted
          ? 0
          : Math.max((shared.get(content.password ?? "") ?? 1) - 1, 0),
        ...(content.email === undefined ? {} : { email: content.email }),
        ...(content.mobile === undefined ? {} : { mobile: content.mobile }),
        ...(content.createdAt === undefined ? {} : { createdAt: content.createdAt }),
        ...(content.lastModifiedAt === undefined
          ? {}
          : { lastModifiedAt: content.lastModifiedAt }),
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

/**
 * The logins that belong to a given page.
 *
 * The URL is supplied by the *caller inside the extension* — the background
 * reads it from the active tab or from a message sender, never from anything
 * a web page could influence. A page that could name its own site could ask
 * for any credential in the vault.
 */
export async function itemsForUrl(
  url: string | undefined,
): Promise<{ site: string | null; items: DecryptedItem[] }> {
  if (!url) return { site: null, items: [] };

  const all = await listItems();
  return {
    site: siteScope(url),
    // Trashed items are not offered: deleting one should stop it turning up.
    items: all.filter((item) => !item.deleted && matchesSite(item.url, url)),
  };
}

/**
 * The credential for one item, for filling into a page.
 *
 * The only path by which a password leaves the background. It looks the item
 * up *within the set already filtered by site*, so an id belonging to another
 * site is refused however it was obtained — a compromised page cannot ask for
 * credentials it was not going to be offered anyway.
 */
export async function credentialForFill(
  id: string,
  url: string | undefined,
): Promise<{ username: string; password: string }> {
  const { items } = await itemsForUrl(url);
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new Error("No such item for this site.");

  // Recorded here rather than in the content script: the fill is the event
  // worth counting, and this is the only place it is known to have happened.
  await recordUse(id, "autofilled");

  return { username: item.username, password: item.password };
}

/**
 * Whether a just-submitted login is worth offering to save.
 *
 * Declines silently when the vault is locked or the page has no site: a
 * banner the user cannot act on is worse than none. Declines when an
 * identical login is already stored, so signing in every day does not ask
 * every day.
 *
 * When the same username exists for this site with a *different* password,
 * this reports the existing id so the banner can offer to update rather than
 * quietly add a duplicate.
 */
export async function shouldOfferToSave(
  submitted: { username: string; password: string },
  url: string | undefined,
): Promise<{ offer: false } | { offer: true; site: string; existingId: string | null }> {
  if (!submitted.password) return { offer: false };
  if (!url) return { offer: false };

  const site = siteScope(url);
  if (!site) return { offer: false };

  // Locked is a decline, not an error: the page did nothing wrong.
  if (!(await currentVaultKey())) return { offer: false };

  const { items } = await itemsForUrl(url);
  const sameUsername = items.find((item) => item.username === submitted.username);

  if (sameUsername && sameUsername.password === submitted.password) return { offer: false };

  return { offer: true, site, existingId: sameUsername?.id ?? null };
}

/**
 * Saves a login the user has just confirmed in the page banner.
 *
 * The site is taken from the tab, never from the page — the same rule as
 * everywhere else. Updates an existing login for this site and username
 * rather than adding a second one that differs only by password.
 */
export async function saveSubmitted(
  submitted: { username: string; password: string; name?: string; notes?: string },
  url: string | undefined,
): Promise<void> {
  const decision = await shouldOfferToSave(submitted, url);
  if (!decision.offer) throw new Error("Nothing to save for this site.");

  const content: LoginContent = {
    ...(submitted.name?.trim() ? { name: submitted.name.trim() } : {}),
    username: submitted.username,
    password: submitted.password,
    url: url ?? "",
    notes: submitted.notes ?? "",
  };

  if (decision.existingId) await updateItem(decision.existingId, content);
  else await addItem(content);
}

/**
 * The page the user is looking at, as the browser reports it.
 *
 * `lastFocusedWindow`, not `currentWindow`: "current" means the window
 * containing the code that is asking, and a background event page is not in a
 * browser window at all — so the query matched nothing and the popup never
 * showed a "for this site" section.
 */
export async function activeTabUrl(): Promise<string | undefined> {
  const [focused] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (focused?.url) return focused.url;

  // Falls back for the case `lastFocusedWindow` cannot answer — no browser
  // window focused, which happens when the popup itself has focus on some
  // platforms.
  const [current] = await browser.tabs.query({ active: true, currentWindow: true });
  return current?.url;
}

/** What the list shows for an item, and therefore what it sorts on. */
function displayName(item: DecryptedItem): string {
  return item.name?.trim() || item.username;
}
