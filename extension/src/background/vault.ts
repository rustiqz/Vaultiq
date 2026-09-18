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
  deriveAuthKey,
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
  totpCode,
  totpSecondsRemaining,
  unwrapVaultKey,
  wrapVaultKey,
  type MasterKeyHandle,
  type VaultKeyHandle,
} from "../lib/crypto.js";

export { assertSessionStorage, loadCrypto };
export type { SyncSummary };
import { cardBrand, lastFour, normalizeCardNumber } from "../lib/card.js";
import { TOTP_DEFAULTS } from "../lib/otpauth.js";
import { matchesSite, siteScope } from "../lib/site.js";
import type {
  AuditEvent,
  CommonContent,
  DecryptedItem,
  DecryptedLogin,
  DeviceIdentity,
  FillSuggestion,
  ItemContent,
  ItemType,
  ItemFacts,
  ItemUsage,
  TotpAlgorithmName,
  TotpFacts,
  UsageEvent,
  LoginContent,
  PasswordOptions,
  PasswordStrength,
  SyncSummary,
  VaultBackup,
  VaultStatus,
} from "../lib/messages.js";
import { renameDevice as storeDeviceName, thisDevice } from "../lib/device.js";
import {
  armQuickUnlock,
  disarmQuickUnlock,
  quickUnlock as openWithPin,
  quickUnlockReady,
} from "../lib/quick-unlock.js";
import { assertUsableServer, SyncClient, type RemoteDevice } from "../sync/client.js";
import { reconcile, type SyncOutcome } from "../sync/engine.js";
import {
  clearState,
  openCredential,
  readState,
  sealCredential,
  writeState,
  type SyncState,
} from "../sync/state.js";
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
  type VaultRecord,
} from "../lib/vault-db.js";

/** Idle minutes before the vault locks itself, unless configured otherwise. */
const DEFAULT_AUTO_LOCK_MINUTES = 15;
const AUTO_LOCK_SETTING = "autoLockMinutes";
export const AUTO_LOCK_ALARM = "vaultiq-auto-lock";
const USAGE_TYPE = "usage";

/** How many recent events one device keeps. Enough to be useful, bounded. */
const AUDIT_LIMIT = 200;

function emptyUsage(): ItemUsage {
  return { useCount: 0, counts: {}, devices: [] };
}
const VAULT_FORMAT = 1;

/** Format version for {@link VaultBackup}. Bump on any layout change. */
const BACKUP_FORMAT = 1;

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

/** How long the vault waits before locking. Zero means never. */
export async function autoLockMinutes(): Promise<number> {
  const stored = await browser.storage.local.get(AUTO_LOCK_SETTING);
  const value: unknown = stored[AUTO_LOCK_SETTING];
  return typeof value === "number" && value >= 0 ? value : DEFAULT_AUTO_LOCK_MINUTES;
}

export async function setAutoLockMinutes(minutes: number): Promise<void> {
  await browser.storage.local.set({ [AUTO_LOCK_SETTING]: Math.max(0, Math.round(minutes)) });
  await extendAutoLock();
}

/** Whether this vault has committed to never syncing. Off by default. */
const LOCAL_ONLY_SETTING = "localOnly";

export async function isLocalOnly(): Promise<boolean> {
  const stored = await browser.storage.local.get(LOCAL_ONLY_SETTING);
  return stored[LOCAL_ONLY_SETTING] === true;
}

/**
 * Commits this vault to never syncing, or reverses that.
 *
 * Refuses to turn it on while a server is connected — the caller disconnects
 * first, explicitly, rather than this silently doing both at once.
 */
export async function setLocalOnly(value: boolean): Promise<void> {
  if (value && (await readState())) {
    throw new Error("Disconnect from the server before going local-only.");
  }
  await browser.storage.local.set({ [LOCAL_ONLY_SETTING]: value });
}

/** Pushes the auto-lock deadline out. Called on every successful request. */
export async function extendAutoLock(): Promise<void> {
  await browser.alarms.clear(AUTO_LOCK_ALARM);
  const minutes = await autoLockMinutes();
  if (minutes > 0) browser.alarms.create(AUTO_LOCK_ALARM, { delayInMinutes: minutes });
}

/**
 * Locks the vault.
 *
 * `forget` also tears down the PIN, which is what "Lock" in the popup does.
 * The idle alarm leaves it armed on purpose — being asked for a PIN after
 * twenty minutes is the point of having one.
 */
export async function lock(forget = false): Promise<void> {
  await browser.alarms.clear(AUTO_LOCK_ALARM);
  if (forget) await disarmQuickUnlock();
  await clearStashedVaultKey();
  // Handles are not garbage collected: without free() the key would sit in
  // wasm memory until the context is torn down.
  warmVaultKey?.free();
  warmVaultKey = undefined;
}

export async function status(): Promise<VaultStatus> {
  if (!(await getVault())) return "empty";
  if (await currentVaultKey()) return "unlocked";
  return (await quickUnlockReady()) ? "quick" : "locked";
}

/** Arms a PIN for this browser session. Requires an unlocked vault. */
export async function setPin(pin: string): Promise<void> {
  const vaultKey = await requireUnlocked();
  await armQuickUnlock(pin, vaultKey, generateSalt);
}

export async function forgetPin(): Promise<void> {
  await disarmQuickUnlock();
}

/** Reopens the vault with a PIN rather than the master password. */
export async function unlockWithPin(pin: string): Promise<void> {
  const vaultKey = await openWithPin(pin);
  await stashVaultKey(vaultKey);
  warmVaultKey = vaultKey;
  syncOnUnlock();
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

/**
 * A full, offline copy of the vault: the wrapped key, its salt and costs,
 * and every item exactly as stored — restorable with the master password
 * alone, on this device or any other.
 *
 * No key material is touched. Every field here is already ciphertext or a
 * wrapped key, so this reads IndexedDB straight through and needs no unlock
 * — the same reason it needs no crypto import. Local-only bookkeeping
 * (`synced_version`, `conflict_of`) describes this device's relationship to
 * a server, not the vault's content, so it is stripped rather than carried
 * into the file.
 */
export async function exportBackup(): Promise<VaultBackup> {
  const vault = await getVault();
  if (!vault) throw new Error("No vault on this device yet.");

  const items = await allItems();
  return {
    kind: "vaultiq-backup",
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    vault: {
      saltB64: vault.saltB64,
      memoryKib: vault.memoryKib,
      iterations: vault.iterations,
      parallelism: vault.parallelism,
      wrappedVaultKey: vault.wrappedVaultKey,
    },
    items: items.map(({ id, item_type, format, ciphertext, nonce, version, updated_at, deleted }) => ({
      id,
      item_type,
      format,
      ciphertext,
      nonce,
      version,
      updated_at,
      deleted,
    })),
  };
}

function isVaultBackup(value: unknown): value is VaultBackup {
  if (typeof value !== "object" || value === null) return false;
  const backup = value as Partial<VaultBackup>;
  return (
    backup.kind === "vaultiq-backup" &&
    typeof backup.format === "number" &&
    typeof backup.vault === "object" &&
    backup.vault !== null &&
    typeof backup.vault.saltB64 === "string" &&
    Array.isArray(backup.items)
  );
}

/**
 * Restores a vault from {@link exportBackup}'s output, onto a device that
 * does not have one yet.
 *
 * The password is verified by unwrapping the backup's own wrapped key —
 * identically to a wrong password on `unlock` — before a single record is
 * written, and the vault is left unlocked afterward exactly as `create`
 * leaves a fresh one, since the caller just proved they know the password.
 * Every item is written exactly as the backup carries it: this is a restore
 * of specific ciphertext records, not a re-encryption, so ids, versions and
 * tombstones must round-trip unchanged or their authentication tags stop
 * matching.
 */
export async function restoreBackup(backup: VaultBackup, masterPassword: string): Promise<void> {
  if (await getVault()) throw new Error("A vault already exists.");
  if (!isVaultBackup(backup)) throw new Error("That file is not a Vaultiq backup.");
  if (backup.format !== BACKUP_FORMAT) {
    throw new Error("This backup was made by a version of Vaultiq this build cannot read.");
  }

  const params = {
    memory_kib: backup.vault.memoryKib,
    iterations: backup.vault.iterations,
    parallelism: backup.vault.parallelism,
  };
  // A wrong password fails here, indistinguishably from a tampered record —
  // the same crypto-core error `unlock` surfaces for either.
  const vaultKey = withMasterKey(masterPassword, backup.vault.saltB64, params, (masterKey) =>
    unwrapVaultKey(backup.vault.wrappedVaultKey, masterKey),
  );

  await putVault({
    id: "vault",
    format: VAULT_FORMAT,
    saltB64: backup.vault.saltB64,
    memoryKib: backup.vault.memoryKib,
    iterations: backup.vault.iterations,
    parallelism: backup.vault.parallelism,
    wrappedVaultKey: backup.vault.wrappedVaultKey,
  });
  for (const item of backup.items) {
    await putItem(item);
  }

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
  syncOnUnlock();
}

/**
 * Changes the master password.
 *
 * The vault key is not touched: it is unwrapped with the old password and
 * wrapped again with the new one, so every item stays exactly as it is and
 * nothing has to be re-encrypted. That indirection is the reason this
 * operation is cheap enough to do whenever it is wanted.
 *
 * There is no recovery path and there is no going back — the old password
 * opens nothing afterwards, on this device or any other.
 */
export async function changeMasterPassword(current: string, next: string): Promise<void> {
  const vault = await getVault();
  if (!vault) throw new Error("No vault on this device yet.");
  if (!next) throw new Error("Choose a new master password.");

  const state = await readState();

  // Verifies the current password by doing the one thing only it can do. A
  // wrong one fails here, indistinguishably from a tampered record.
  const opened = withMasterKey(
    current,
    vault.saltB64,
    { memory_kib: vault.memoryKib, iterations: vault.iterations, parallelism: vault.parallelism },
    (masterKey) => ({
      vaultKey: unwrapVaultKey(vault.wrappedVaultKey, masterKey),
      // Derived only to prove the current password to the server; a vault
      // with no server never needs it.
      authKey: state ? deriveAuthKey(masterKey) : "",
    }),
  );

  try {
    // A fresh salt, and today's costs rather than the ones this vault was
    // created with. A rotation is the natural moment to raise them, and the
    // parameters travel with the record, so nothing older breaks.
    const saltB64 = generateSalt();
    const params = recommendedParams();

    const rewrapped = withMasterKey(next, saltB64, params, (masterKey) => ({
      wrappedVaultKey: wrapVaultKey(opened.vaultKey, masterKey) as unknown,
      authKey: deriveAuthKey(masterKey),
    }));

    const record: VaultRecord = {
      id: "vault",
      format: VAULT_FORMAT,
      saltB64,
      memoryKib: params.memory_kib,
      iterations: params.iterations,
      parallelism: params.parallelism,
      wrappedVaultKey: rewrapped.wrappedVaultKey,
    };

    // The server is written first, deliberately. It holds the record every
    // other device reads, so if only one of the two writes lands it has to be
    // that one: this device would still open with the old password and adopt
    // the new record on its next sync. The other order leaves this device on
    // the new password and the next sync quietly handing back the old record.
    if (state) {
      const client = new SyncClient(state.server, openCredential(state, opened.vaultKey));
      await client.changeMasterPassword({
        currentAuthKey: opened.authKey,
        newAuthKey: rewrapped.authKey,
        vault: {
          saltB64: record.saltB64,
          memoryKib: record.memoryKib,
          iterations: record.iterations,
          parallelism: record.parallelism,
          wrappedVaultKey: record.wrappedVaultKey,
        },
      });
    }

    await putVault(record);
  } finally {
    // A handle of its own, separate from whatever the session holds: without
    // free() the key would sit in wasm memory until the context is torn down.
    opened.vaultKey.free();
  }
}

/**
 * Pulls in the background once the vault opens.
 *
 * Not awaited: an unreachable server must not hold the vault shut. The
 * failure is recorded on the sync state and reported by the popup.
 */
/** Runs a sync, unless this vault has committed to never syncing. */
async function syncIfAllowed(): Promise<SyncOutcome | undefined> {
  if (await isLocalOnly()) return undefined;
  return await syncNow();
}

function syncOnUnlock(): void {
  void syncIfAllowed().catch(() => {});
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
  scheduleSync();
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

/**
 * The stored form of an item's content: every field except the discriminator.
 *
 * The type is not written into the ciphertext because it is already in the
 * record header, where it is bound into the authentication tag. Storing it
 * twice would be two places for one fact to disagree with itself, and only
 * one of the two would be tamper-evident.
 */
function toStoredContent(content: ItemContent): string {
  const { type: _type, ...fields } = normalized(content);
  return JSON.stringify(fields);
}

/**
 * Content as it should be stored, rather than exactly as it was typed.
 *
 * Only the card number needs this: it is normalized once, on the way in, so
 * that everything downstream — the last four, and later a fill into a
 * checkout form — works from one representation instead of re-deriving it.
 */
function normalized(content: ItemContent): ItemContent {
  if (content.type !== "card") return content;
  return { ...content, number: normalizeCardNumber(content.number) };
}

export async function addItem(content: ItemContent): Promise<string> {
  const vaultKey = await requireUnlocked();
  const id = crypto.randomUUID();
  const updatedAt = Date.now();

  const stamped: ItemContent = { ...content, createdAt: updatedAt, lastModifiedAt: updatedAt };

  const encrypted: StoredItem = encryptItem(
    toStoredContent(stamped),
    { id, item_type: content.type, version: 1, updated_at: updatedAt, deleted: false },
    vaultKey,
  ) as StoredItem;

  await putItem(encrypted);
  scheduleSync();
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
  change: (
    current: Record<string, unknown>,
    itemType: string,
  ) => { content: string; deleted: boolean },
): Promise<void> {
  const vaultKey = await requireUnlocked();

  const stored = await getItem(id);
  if (!stored) throw new Error("No such item.");

  const current = JSON.parse(decryptItem(stored, vaultKey)) as Record<string, unknown>;
  const { content, deleted } = change(current, stored.item_type);

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
  scheduleSync();
}

export async function updateItem(id: string, content: ItemContent): Promise<void> {
  await rewriteItem(id, (current, itemType) => {
    // An item does not change what it is. The type is bound into the
    // authentication tag, so a rewrite under a different one would produce a
    // record whose header and content disagree — and the header is the half
    // that is authenticated.
    if (itemType !== content.type) {
      throw new Error("An item cannot change its type.");
    }

    const createdAt = current.createdAt;
    return {
      content: toStoredContent({
        ...content,
        // Preserved across an edit; only a fresh save sets it.
        ...(typeof createdAt === "number" ? { createdAt } : {}),
        lastModifiedAt: Date.now(),
      }),
      deleted: false,
    };
  });
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

/** A string field, or nothing if the record does not carry one. */
function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Spreads a field only when it has a value, never as an explicit undefined. */
function optional<K extends string, V>(key: K, value: V | undefined): Record<K, V> | object {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

/** A positive whole number, or nothing if the record does not carry one. */
function whole(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** The stored algorithm, or the RFC default for anything unrecognised. */
function algorithmName(value: unknown): TotpAlgorithmName {
  const named = text(value)?.toUpperCase();
  return named === "SHA256" || named === "SHA512" ? named : "SHA1";
}

/**
 * The code showing right now, and how long it lasts.
 *
 * A secret that will not decode yields an empty code rather than an
 * exception: one mistyped account must not empty the whole list, and a row
 * that says nothing is showing is something the user can act on.
 */
function currentCode(account: {
  secret: string;
  algorithm: TotpAlgorithmName;
  digits: number;
  period: number;
}): TotpFacts {
  const now = Date.now() / 1000;
  try {
    return {
      code: totpCode(account.secret, account.algorithm, account.digits, account.period, now),
      secondsRemaining: totpSecondsRemaining(account.period, now),
    };
  } catch {
    return { code: "", secondsRemaining: 0 };
  }
}

/**
 * The fields every item has, read defensively.
 *
 * Any of them can be absent: a record written before a field existed simply
 * does not have it, and nothing is migrated because the AEAD layout and the
 * associated data never changed.
 */
function readCommon(content: Record<string, unknown>): CommonContent {
  const createdAt = content.createdAt;
  const lastModifiedAt = content.lastModifiedAt;
  return {
    ...optional("name", text(content.name)),
    notes: text(content.notes) ?? "",
    ...optional("createdAt", typeof createdAt === "number" ? createdAt : undefined),
    ...optional(
      "lastModifiedAt",
      typeof lastModifiedAt === "number" ? lastModifiedAt : undefined,
    ),
  };
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
    // Only logins have a password to share with another login.
    if (item.item_type !== "login") continue;
    try {
      const parsed = JSON.parse(decryptItem(item, vaultKey)) as Partial<LoginContent>;
      const password = parsed.password ?? "";
      if (password) shared.set(password, (shared.get(password) ?? 0) + 1);
    } catch {
      // A record that will not decrypt cannot contribute to the count. It is
      // surfaced elsewhere, not swallowed into a wrong statistic.
    }
  }

  const decrypted = stored.flatMap((item): DecryptedItem[] => {
    const content = JSON.parse(decryptItem(item, vaultKey)) as Record<string, unknown> & {
      purged?: boolean;
    };
    // A purged record is a tombstone with nothing left in it; it exists for
    // sync, not for the user.
    if (content.purged === true) return [];

    const facts: ItemFacts = {
      id: item.id,
      updatedAt: item.updated_at,
      deleted: item.deleted,
      usage: usage.get(item.id) ?? emptyUsage(),
    };
    const common = readCommon(content);

    switch (item.item_type) {
      case "login": {
        const password = text(content.password) ?? "";
        return [
          {
            type: "login",
            ...common,
            username: text(content.username) ?? "",
            password,
            url: text(content.url) ?? "",
            ...optional("email", text(content.email)),
            ...optional("mobile", text(content.mobile)),
            ...facts,
            strength: scorePassword(password),
            reusedBy: item.deleted ? 0 : Math.max((shared.get(password) ?? 1) - 1, 0),
          },
        ];
      }
      case "note":
        return [{ type: "note", ...common, ...facts }];
      case "totp": {
        const digits = whole(content.digits) ?? TOTP_DEFAULTS.digits;
        const period = whole(content.period) ?? TOTP_DEFAULTS.period;
        return [
          {
            type: "totp",
            ...common,
            issuer: text(content.issuer) ?? "",
            account: text(content.account) ?? "",
            secret: text(content.secret) ?? "",
            algorithm: algorithmName(content.algorithm),
            digits,
            period,
            ...facts,
            ...currentCode({
              secret: text(content.secret) ?? "",
              algorithm: algorithmName(content.algorithm),
              digits,
              period,
            }),
          },
        ];
      }
      case "identity":
        return [
          {
            type: "identity",
            ...common,
            firstName: text(content.firstName) ?? "",
            lastName: text(content.lastName) ?? "",
            email: text(content.email) ?? "",
            phone: text(content.phone) ?? "",
            street: text(content.street) ?? "",
            ...optional("street2", text(content.street2)),
            city: text(content.city) ?? "",
            state: text(content.state) ?? "",
            postalCode: text(content.postalCode) ?? "",
            country: text(content.country) ?? "",
            ...optional("company", text(content.company)),
            ...optional("dateOfBirth", text(content.dateOfBirth)),
            ...optional("nationalId", text(content.nationalId)),
            ...facts,
          },
        ];
      case "card": {
        const number = text(content.number) ?? "";
        return [
          {
            type: "card",
            ...common,
            cardholder: text(content.cardholder) ?? "",
            number,
            expiryMonth: text(content.expiryMonth) ?? "",
            expiryYear: text(content.expiryYear) ?? "",
            securityCode: text(content.securityCode) ?? "",
            ...optional("pin", text(content.pin)),
            ...facts,
            brand: cardBrand(number),
            last4: lastFour(number),
          },
        ];
      }
      default:
        // An item type this build does not know: written by a newer client
        // and synced down. The record itself is kept and passed on untouched
        // — dropping it would delete another device's data — but there is
        // nothing sensible to render for it here.
        return [];
    }
  });

  // Storage order is by id, which is a random UUID — effectively shuffled.
  // Sort by what the user actually reads, so a list of several logins for one
  // site stays put between openings.
  return decrypted.sort((a, b) =>
    displayName(a).localeCompare(displayName(b), undefined, { sensitivity: "base" }),
  );
}

/**
 * The code for one authenticator account.
 *
 * Its own request rather than a re-list: the popup refreshes a countdown once
 * a second, and re-listing would decrypt every item in the vault to produce
 * six digits.
 */
export async function totpCodeFor(id: string): Promise<TotpFacts> {
  const vaultKey = await requireUnlocked();

  const stored = await getItem(id);
  if (!stored || stored.item_type !== "totp") throw new Error("No such authenticator account.");

  const content = JSON.parse(decryptItem(stored, vaultKey)) as Record<string, unknown>;
  return currentCode({
    secret: text(content.secret) ?? "",
    algorithm: algorithmName(content.algorithm),
    digits: whole(content.digits) ?? TOTP_DEFAULTS.digits,
    period: whole(content.period) ?? TOTP_DEFAULTS.period,
  });
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
): Promise<{ site: string | null; items: DecryptedLogin[] }> {
  if (!url) return { site: null, items: [] };

  const all = await listItems();
  return {
    site: siteScope(url),
    // Logins only, and never a trashed one: a secure note has no site to
    // belong to, and deleting a login should stop it turning up. The
    // predicate narrows the element type as well as filtering, so everything
    // downstream — autofill included — is holding a login by construction.
    items: all.filter(
      (item): item is DecryptedLogin =>
        !item.deleted && item.type === "login" && matchesSite(item.url, url),
    ),
  };
}

/**
 * The credential for one item, for filling into a page.
 *
 * One of the two paths by which a password leaves the background — see
 * `fillValues` for the other, which applies the same site check. Both look
 * the item up *within the set already filtered by site*, so an id belonging
 * to another site is refused however it was obtained: a compromised page
 * cannot ask for credentials it was not going to be offered anyway.
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
    type: "login",
    ...(submitted.name?.trim() ? { name: submitted.name.trim() } : {}),
    username: submitted.username,
    password: submitted.password,
    url: url ?? "",
    notes: submitted.notes ?? "",
  };

  if (decision.existingId) await updateItem(decision.existingId, content);
  else await addItem(content);
}

// ---------------------------------------------------------------------------
// Autofill beyond logins
//
// A login is offered for the site it belongs to and nowhere else. A card, an
// address and a one-time code have no site: the same card is used at every
// shop. That removes the protection site-scoping gives a password, so these
// are governed by a different rule — nothing is ever offered without the user
// focusing a field that asks for it, and no value leaves this file until the
// user has picked one item by hand. There is no path here that fills on load.

/** What the picker shows for one item: names, never values. */
function suggestionFor(item: DecryptedItem): FillSuggestion {
  const named = item.name?.trim();
  switch (item.type) {
    case "login":
      return {
        id: item.id,
        type: item.type,
        label: named || item.username || "(untitled)",
        detail: named ? item.username : item.url,
      };
    case "card": {
      const scheme = item.brand ?? "Card";
      const tail = item.last4 ? ` ···· ${item.last4}` : "";
      return {
        id: item.id,
        type: item.type,
        label: named || `${scheme}${tail}`,
        // The expiry, not the number: enough to tell two cards apart.
        detail: [item.cardholder, item.expiryMonth && `${item.expiryMonth}/${item.expiryYear}`]
          .filter(Boolean)
          .join(" · "),
      };
    }
    case "identity":
      return {
        id: item.id,
        type: item.type,
        label: named || [item.firstName, item.lastName].filter(Boolean).join(" ") || "(unnamed)",
        detail: [item.city, item.country].filter(Boolean).join(", "),
      };
    case "totp":
      return {
        id: item.id,
        type: item.type,
        // Never the code: it would be stale before it could be read, and the
        // picker is a list of names.
        label: named || [item.issuer, item.account].filter(Boolean).join(" · ") || "(unnamed)",
        detail: named ? item.issuer : "",
      };
    case "note":
      return { id: item.id, type: item.type, label: named || "(untitled note)", detail: "" };
  }
}

/**
 * What to offer for the field that was just focused.
 *
 * `wants` says what the *form* is asking for, worked out from its fields.
 * Logins are still filtered to the sender's own site; everything else is not
 * site-scoped, because it is not a credential for a site.
 *
 * Secure notes are never offered: there is no field on any page that a note
 * is the answer to.
 */
export async function fillSuggestions(
  wants: ItemType[],
  url: string | undefined,
): Promise<{ site: string | null; suggestions: FillSuggestion[] }> {
  const vaultKey = await currentVaultKey();
  // Locked is an empty list, not an error: the page did nothing wrong. Nor is
  // a page the browser reports no URL for.
  if (!vaultKey || !url) return { site: null, suggestions: [] };

  const asked = new Set<ItemType>(wants.filter((type) => type !== "note"));
  const site = siteScope(url);

  const all = await listItems();
  const offered = all.filter((item) => {
    if (item.deleted || !asked.has(item.type)) return false;
    // A login is only ever offered to the site it belongs to.
    return item.type !== "login" || matchesSite(item.url, url);
  });

  return { site, suggestions: offered.map(suggestionFor) };
}

/**
 * The values for one item, keyed by autocomplete token.
 *
 * Reached only after the user picked this item from the picker. A login is
 * looked up within the set already filtered by site, exactly as
 * `credentialForFill` does, so an id belonging to another site is refused
 * however it was obtained.
 */
export async function fillValues(
  id: string,
  url: string | undefined,
): Promise<Record<string, string>> {
  const items = await listItems();
  const item = items.find((candidate) => candidate.id === id && !candidate.deleted);
  if (!item) throw new Error("No such item.");

  if (item.type === "login" && (!url || !matchesSite(item.url, url))) {
    throw new Error("No such item for this site.");
  }

  const values = valuesFor(item);
  if (!values) throw new Error("Nothing on this page to fill from that.");

  // The fill is the event worth counting, and this is the only place it is
  // known to have happened.
  await recordUse(id, "autofilled");
  return values;
}

/** One item's fields, named the way a form names them. */
function valuesFor(item: DecryptedItem): Record<string, string> | undefined {
  switch (item.type) {
    case "card":
      return withoutEmpty({
        "cc-name": item.cardholder,
        "cc-number": item.number,
        "cc-exp-month": item.expiryMonth,
        "cc-exp-year": item.expiryYear,
        "cc-csc": item.securityCode,
      });
    case "identity":
      return withoutEmpty({
        "given-name": item.firstName,
        "family-name": item.lastName,
        organization: item.company ?? "",
        email: item.email,
        tel: item.phone,
        // Both spellings: a form asks for one line or two, never both.
        "street-address": [item.street, item.street2].filter(Boolean).join("\\n"),
        "address-line1": item.street,
        "address-line2": item.street2 ?? "",
        "address-level2": item.city,
        "address-level1": item.state,
        "postal-code": item.postalCode,
        "country-name": item.country,
        bday: item.dateOfBirth ?? "",
      });
    case "totp": {
      const { code } = currentCode(item);
      // An unreadable secret fills nothing rather than an empty box.
      return code ? { "one-time-code": code } : undefined;
    }
    case "login":
      return withoutEmpty({ username: item.username, password: item.password });
    case "note":
      return undefined;
  }
}

/** Drops the fields this item does not have, so nothing is filled blank. */
function withoutEmpty(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ""));
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
  const named = item.name?.trim();
  if (named) return named;
  return item.type === "login" ? item.username : "";
}


// ---------------------------------------------------------------------------
// Syncing with a server
//
// Everything below is optional: a vault that is never connected behaves
// exactly as it did before. What crosses the wire is ciphertext plus the
// fields already bound into each item's authentication tag.

/** How long a burst of changes is allowed to settle before it is pushed. */
const PUSH_DEBOUNCE_MS = 2_000;

export async function syncStatus(): Promise<SyncSummary> {
  const state = await readState();
  if (!state) return { connected: false };
  return {
    connected: true,
    server: state.server,
    ...(state.lastSyncedAt === undefined ? {} : { lastSyncedAt: state.lastSyncedAt }),
    ...(state.lastError === undefined ? {} : { lastError: state.lastError }),
  };
}

async function connectedClient(): Promise<{ client: SyncClient; state: SyncState }> {
  const state = await readState();
  if (!state) throw new Error("This device is not connected to a server.");
  const vaultKey = await requireUnlocked();
  return { client: new SyncClient(state.server, openCredential(state, vaultKey)), state };
}

/**
 * Registers this vault with a server, as its first device there.
 *
 * The master password is checked locally first, by unwrapping the vault key
 * with it. Without that check a typo would be registered as *the* auth key,
 * and the mistake would not be recoverable without a fresh registration
 * token from the server's admin (or a fresh personal server).
 *
 * Needs a valid account-creation token: registration is always invite-only,
 * on a personal server (one is minted and logged at boot) and an
 * organisation's alike (an admin issues one). This upload is otherwise
 * unchanged — the local vault as it already stands, becoming account and
 * device zero on the server.
 */
export async function connectServer(
  server: string,
  token: string,
  deviceName: string,
  masterPassword: string,
): Promise<void> {
  if (await isLocalOnly()) {
    throw new Error("This vault is set to never sync. Turn that off in Settings first.");
  }
  if (await readState()) throw new Error("This device is already connected.");
  const vault = await getVault();
  if (!vault) throw new Error("No vault on this device yet.");

  const base = assertUsableServer(server).toString();
  const params = {
    memory_kib: vault.memoryKib,
    iterations: vault.iterations,
    parallelism: vault.parallelism,
  };

  const authKey = withMasterKey(masterPassword, vault.saltB64, params, (masterKey) => {
    // Throws on a wrong password, before anything reaches the network.
    unwrapVaultKey(vault.wrappedVaultKey, masterKey).free();
    return deriveAuthKey(masterKey);
  });

  const credential = await new SyncClient(base).register({
    token,
    authKey,
    vault: {
      saltB64: vault.saltB64,
      memoryKib: vault.memoryKib,
      iterations: vault.iterations,
      parallelism: vault.parallelism,
      wrappedVaultKey: vault.wrappedVaultKey,
    },
    deviceName,
  });

  const vaultKey = await requireUnlocked();
  await writeState({ server: base, cursor: "0", credential: sealCredential(credential, vaultKey) });
  await syncNow();
}

/**
 * Joins a server that already holds a vault, using a token from a device
 * that is already trusted.
 *
 * This is the flow that needs `enrollment-params`: the auth key is derived
 * from the master password *and* the vault's salt and costs, and those live
 * behind a credential this device does not have yet.
 */
export async function enrollWithServer(
  server: string,
  token: string,
  deviceName: string,
  masterPassword: string,
): Promise<void> {
  if (await isLocalOnly()) {
    throw new Error("This vault is set to never sync. Turn that off in Settings first.");
  }
  if (await readState()) throw new Error("This device is already connected.");

  const base = assertUsableServer(server).toString();
  const anonymous = new SyncClient(base);
  const remote = await anonymous.enrollmentParams(token);

  const existing = await getVault();
  if (existing && existing.saltB64 !== remote.saltB64) {
    // Two vaults created independently, each with its own key. Merging them
    // would need both master passwords, and guessing which to keep would
    // destroy the other. Say so rather than choose.
    throw new Error(
      "This device already holds a different vault. Remove it before joining this server.",
    );
  }

  const params = {
    memory_kib: remote.memoryKib,
    iterations: remote.iterations,
    parallelism: remote.parallelism,
  };
  const authKey = withMasterKey(masterPassword, remote.saltB64, params, deriveAuthKey);

  const credential = await anonymous.enroll({ token, authKey, deviceName });
  const client = new SyncClient(base, credential);
  const bootstrap = await client.vault();

  // The password is verified here, by the same unwrap an ordinary unlock
  // does — a wrong one fails indistinguishably from a tampered record.
  const vaultKey = withMasterKey(masterPassword, bootstrap.saltB64, params, (masterKey) =>
    unwrapVaultKey(bootstrap.wrappedVaultKey, masterKey),
  );

  await putVault({
    id: "vault",
    format: VAULT_FORMAT,
    saltB64: bootstrap.saltB64,
    memoryKib: bootstrap.memoryKib,
    iterations: bootstrap.iterations,
    parallelism: bootstrap.parallelism,
    wrappedVaultKey: bootstrap.wrappedVaultKey,
  });

  await stashVaultKey(vaultKey);
  warmVaultKey = vaultKey;

  await writeState({ server: base, cursor: "0", credential: sealCredential(credential, vaultKey) });
  await syncNow();
}

/** The floors the server enforces on a write, checked again on the way back. */
const KDF_FLOOR = { memoryKib: 19 * 1024, iterations: 2, parallelism: 1 };

/**
 * JSON with object keys in a fixed order.
 *
 * The wrapped key goes to the server as JSON and comes back out of a `jsonb`
 * column, which does not preserve field order. Without this, an unchanged
 * record would compare as different on every sync.
 */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, held: unknown) =>
    held !== null && typeof held === "object" && !Array.isArray(held)
      ? Object.fromEntries(
          Object.entries(held as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : held,
  );
}

/**
 * Takes on the vault record the server holds, when it differs from this one.
 *
 * This is how a master password change reaches the other devices. The vault
 * key itself never changes, so a device that adopts the new record carries on
 * syncing exactly as before — it simply needs the new password the next time
 * it unlocks.
 *
 * The record cannot be verified here: telling a genuine one from a
 * substituted one means unwrapping it, and that needs a password nobody has
 * typed. So a compromised server can hand over a record this device cannot
 * open, which costs that device access to its own copy — a denial of service
 * by a server that could equally refuse to answer at all. It learns nothing
 * either way. What *is* checked is that the record is well formed and its
 * costs have not been lowered — a weakened Argon2 is the one substitution
 * that would still open, and it would open cheaply.
 */
async function adoptServerVault(client: SyncClient): Promise<void> {
  const local = await getVault();
  if (!local) return;

  const remote = await client.vault();
  if (
    remote.saltB64 === local.saltB64 &&
    remote.memoryKib === local.memoryKib &&
    remote.iterations === local.iterations &&
    remote.parallelism === local.parallelism &&
    canonical(remote.wrappedVaultKey) === canonical(local.wrappedVaultKey)
  ) {
    return;
  }

  // Shape and floors together: this record is about to replace the only thing
  // on this device that can open the vault, so a malformed answer must be
  // refused rather than stored. The floors are the ones the server enforces on
  // the way in, checked again on the way out.
  if (
    typeof remote.saltB64 !== "string" ||
    remote.saltB64 === "" ||
    remote.wrappedVaultKey === undefined ||
    remote.wrappedVaultKey === null ||
    !Number.isInteger(remote.memoryKib) ||
    !Number.isInteger(remote.iterations) ||
    !Number.isInteger(remote.parallelism) ||
    remote.memoryKib < KDF_FLOOR.memoryKib ||
    remote.iterations < KDF_FLOOR.iterations ||
    remote.parallelism < KDF_FLOOR.parallelism
  ) {
    throw new Error("The server offered a vault record this device will not accept.");
  }

  await putVault({
    id: "vault",
    format: VAULT_FORMAT,
    saltB64: remote.saltB64,
    memoryKib: remote.memoryKib,
    iterations: remote.iterations,
    parallelism: remote.parallelism,
    wrappedVaultKey: remote.wrappedVaultKey,
  });
}

/**
 * Runs a full reconcile now.
 *
 * A failure is recorded, never thrown away and never rolled back: the local
 * write already happened, and the right answer to an unreachable server is to
 * say when the last successful sync was, not to lose an edit.
 */
export async function syncNow(): Promise<SyncOutcome> {
  const { client, state } = await connectedClient();
  const vaultKey = await requireUnlocked();

  try {
    // Before anything else: a master password change made on another device
    // arrives as a new vault record, and adopting it is what makes that
    // change take effect here.
    await adoptServerVault(client);

    const outcome = await reconcile(client, vaultKey, state.cursor);
    const settled = await readState();
    if (settled) {
      // `lastError` is dropped rather than set to undefined: a success has to
      // clear the previous failure, or the popup keeps reporting a stale one.
      const { lastError: _cleared, ...rest } = settled;
      await writeState({ ...rest, cursor: outcome.cursor, lastSyncedAt: Date.now() });
    }
    return outcome;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed.";
    const settled = await readState();
    if (settled) await writeState({ ...settled, lastError: message });
    throw error;
  }
}

let pushTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Asks for a sync shortly after a change, coalescing a burst into one push.
 *
 * Deliberately best-effort. The background page can be suspended before the
 * timer fires, in which case the item simply stays dirty and goes up on the
 * next sync — which is why "dirty" is a stored fact and not a queue held in
 * memory.
 */
export function scheduleSync(): void {
  if (pushTimer !== undefined) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = undefined;
    void syncIfAllowed().catch(() => {
      // Already recorded on the sync state; the popup reports it.
    });
  }, PUSH_DEBOUNCE_MS);
}

/** Forgets the server. Leaves the vault, and the server's copy, untouched. */
export async function disconnectServer(): Promise<void> {
  await clearState();
}

export async function remoteDevices(): Promise<RemoteDevice[]> {
  const { client } = await connectedClient();
  return await client.devices();
}

export async function newEnrollmentToken(): Promise<{ token: string; expiresAt: string }> {
  const { client } = await connectedClient();
  return await client.enrollmentToken();
}

export async function revokeRemoteDevice(deviceId: string): Promise<void> {
  const { client } = await connectedClient();
  await client.revoke(deviceId);
}
