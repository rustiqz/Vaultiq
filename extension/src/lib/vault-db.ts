// IndexedDB: the vault at rest.
//
// Everything here is ciphertext plus the metadata needed to address it. The
// KDF parameters and salt are stored beside the vault rather than hardcoded,
// so Argon2 costs can be raised later without making existing vaults
// unreadable (CLAUDE.md §4.10).

const DB_NAME = "vaultiq";
// Bumped for the usage store. onupgradeneeded creates only what is missing,
// so an existing vault keeps its items untouched.
const DB_VERSION = 2;
const STORE_VAULT = "vault";
const STORE_ITEMS = "items";
const STORE_USAGE = "usage";

/** The single record describing this vault. Contains no key material. */
export interface VaultRecord {
  id: "vault";
  /** Format version, so this record can be migrated later (§4.9). */
  format: number;
  saltB64: string;
  memoryKib: number;
  iterations: number;
  parallelism: number;
  /** The vault key, encrypted under the key derived from the password. */
  wrappedVaultKey: unknown;
}

/** An encrypted item, exactly as `pw-crypto-core` produced it. */
export interface StoredItem {
  id: string;
  item_type: string;
  format: number;
  ciphertext: number[];
  nonce: number[];
  version: number;
  updated_at: number;
  deleted: boolean;

  /**
   * The version the server last confirmed it holds. Local bookkeeping only:
   * it is never sent, and it sits outside the fields bound into the
   * authentication tag, so it cannot affect whether this item decrypts.
   *
   * Absent means "not known to be on the server", which is deliberately the
   * value a freshly written item has. The bias matters — a spurious push is
   * deduplicated by the server, a skipped one loses data silently.
   */
  synced_version?: number;

  /**
   * Set on a copy kept because two devices edited the same item at the same
   * version. Holds the id of the item this one lost to.
   */
  conflict_of?: string;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_VAULT)) {
        db.createObjectStore(STORE_VAULT, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_ITEMS)) {
        db.createObjectStore(STORE_ITEMS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_USAGE)) {
        db.createObjectStore(STORE_USAGE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb open failed"));
  });
}

function run<T>(store: string, mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = work(tx.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("indexeddb request failed"));
        tx.oncomplete = () => db.close();
      }),
  );
}

export async function getVault(): Promise<VaultRecord | undefined> {
  return await run<VaultRecord | undefined>(
    STORE_VAULT,
    "readonly",
    // IndexedDB is untyped at the API level; this is the one place the shape
    // is asserted, so a change to VaultRecord surfaces here.
    (s) => s.get("vault") as IDBRequest<VaultRecord | undefined>,
  );
}

export async function putVault(record: VaultRecord): Promise<void> {
  await run(STORE_VAULT, "readwrite", (s) => s.put(record));
}

export async function putItem(item: StoredItem): Promise<void> {
  await run(STORE_ITEMS, "readwrite", (s) => s.put(item));
}

export async function getItem(id: string): Promise<StoredItem | undefined> {
  return await run<StoredItem | undefined>(
    STORE_ITEMS,
    "readonly",
    (s) => s.get(id) as IDBRequest<StoredItem | undefined>,
  );
}

/**
 * One device's record of what it has done, encrypted.
 *
 * Deliberately one record *per device* rather than one shared blob. Every
 * autofill rewrites it, so a shared blob would collide the moment two devices
 * were used near each other — and since each device only ever writes its own,
 * a conflict is impossible by construction.
 *
 * It is also what makes the audit trail answer "which device", rather than
 * only "when".
 *
 * Stored the same way an item is, so it carries the same authentication: its
 * id and version are bound into the tag like everything else.
 */
export interface UsageRecord {
  /** `usage:<deviceId>` */
  id: string;
  deviceId: string;
  item: StoredItem;
}

export async function getUsage(deviceId: string): Promise<UsageRecord | undefined> {
  return await run<UsageRecord | undefined>(
    STORE_USAGE,
    "readonly",
    (s) => s.get(`usage:${deviceId}`) as IDBRequest<UsageRecord | undefined>,
  );
}

/** Every device's record, for merging into one view. */
export async function allUsage(): Promise<UsageRecord[]> {
  return await run<UsageRecord[]>(
    STORE_USAGE,
    "readonly",
    (s) => s.getAll() as IDBRequest<UsageRecord[]>,
  );
}

export async function putUsage(record: UsageRecord): Promise<void> {
  await run(STORE_USAGE, "readwrite", (s) => s.put(record));
}

/**
 * Every record, tombstones included.
 *
 * Nothing is filtered here: a tombstone is a real record that has to survive
 * so a deletion can propagate to other devices, and the caller decides what
 * to show. Records are never removed from this store.
 */
export async function allItems(): Promise<StoredItem[]> {
  return await run<StoredItem[]>(
    STORE_ITEMS,
    "readonly",
    (s) => s.getAll() as IDBRequest<StoredItem[]>,
  );
}
