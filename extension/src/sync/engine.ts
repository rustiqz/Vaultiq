// Reconciling this device with the server.
//
// Pull to the head of the server's change sequence, then push whatever is
// still local-only. Nothing here decides *when* to run — that is the
// background's job — and nothing here touches the network directly, so the
// merge can be exercised against a fake client.

import { decryptItem, encryptItem, type VaultKeyHandle } from "../lib/crypto.js";
import {
  allItems,
  allUsage,
  getItem,
  getUsage,
  putItem,
  putUsage,
  type StoredItem,
} from "../lib/vault-db.js";
import type { SyncClient } from "./client.js";
import { fromWire, toWire } from "./wire.js";

const USAGE_TYPE = "usage";

/** The server refuses more than this in one request. */
const PUSH_BATCH = 200;

/** Appended to the name of a copy kept because two devices disagreed. */
const CONFLICT_SUFFIX = " (conflicted copy)";

export interface SyncOutcome {
  pulled: number;
  pushed: number;
  conflicts: number;
  cursor: string;
}

/** Every record this device holds, items and usage alike. */
async function localRecords(): Promise<StoredItem[]> {
  const usage = (await allUsage()).map((record) => record.item);
  return [...(await allItems()), ...usage];
}

function isDirty(item: StoredItem): boolean {
  // Absent counts as dirty. An unauthenticated local field must never be the
  // reason a write fails to reach the server.
  return item.synced_version !== item.version;
}

async function store(item: StoredItem, syncedVersion: number): Promise<void> {
  const row: StoredItem = { ...item, synced_version: syncedVersion };
  if (item.item_type === USAGE_TYPE) {
    // `usage:<deviceId>` — the id is the only place the device is recorded,
    // and it is bound into the tag, so it cannot have been switched.
    const deviceId = item.id.slice("usage:".length);
    await putUsage({ id: item.id, deviceId, item: row });
    return;
  }
  await putItem(row);
}

async function localCopy(id: string, itemType: string): Promise<StoredItem | undefined> {
  if (itemType === USAGE_TYPE) {
    return (await getUsage(id.slice("usage:".length)))?.item;
  }
  return await getItem(id);
}

/**
 * Keeps the losing side of a conflict rather than discarding it.
 *
 * A conflict is narrow — two devices both wrote version *n* of one item
 * between syncs — but picking a winner silently would throw away an edit the
 * user made and never mentioned it. Instead the server's row takes the real
 * id, and the local content is re-encrypted under a fresh one.
 *
 * It has to be a fresh encryption: the id is bound into the authentication
 * tag, so a copy cannot simply be relabelled.
 */
async function keepLosingCopy(local: StoredItem, vaultKey: VaultKeyHandle): Promise<void> {
  let plaintext: string;
  try {
    plaintext = decryptItem(local, vaultKey);
  } catch {
    // Nothing can be preserved from a record that will not decrypt, and
    // failing here would leave the whole sync stuck on one bad row.
    return;
  }

  const id = crypto.randomUUID();
  const copy = encryptItem(
    labelled(plaintext),
    { id, item_type: local.item_type, version: 1, updated_at: Date.now(), deleted: false },
    vaultKey,
  ) as StoredItem;

  // No `synced_version`, so the next push carries it to the other devices.
  await putItem({ ...copy, conflict_of: local.id });
}

/** Marks the copy in its name, so it is visible without any new UI. */
function labelled(plaintext: string): string {
  try {
    const content = JSON.parse(plaintext) as { name?: unknown };
    if (typeof content.name !== "string") return plaintext;
    return JSON.stringify({ ...content, name: content.name + CONFLICT_SUFFIX });
  } catch {
    return plaintext;
  }
}

/**
 * Applies one record the server sent.
 *
 * Returns whether it counted as a conflict, so the caller can report how many
 * copies were kept.
 */
async function applyIncoming(incoming: StoredItem, vaultKey: VaultKeyHandle): Promise<boolean> {
  const local = await localCopy(incoming.id, incoming.item_type);

  if (!local || incoming.version > local.version) {
    await store(incoming, incoming.version);
    return false;
  }

  if (incoming.version < local.version) {
    // Ours is ahead; the push carries it up. Nothing to record here — the
    // server has not confirmed our version, so the item stays dirty.
    return false;
  }

  const same =
    local.ciphertext.length === incoming.ciphertext.length &&
    local.ciphertext.every((byte, index) => byte === incoming.ciphertext[index]);

  if (same) {
    // Already agreed; note that the server holds it so it stops being pushed.
    await store(local, incoming.version);
    return false;
  }

  if (incoming.item_type === USAGE_TYPE) {
    // Each device writes only its own record, so this means a device id was
    // reused or a record was restored. It is a use counter — take theirs.
    await store(incoming, incoming.version);
    return false;
  }

  await keepLosingCopy(local, vaultKey);
  await store(incoming, incoming.version);
  return true;
}

/**
 * Pulls to the head of the sequence, then pushes what is still local-only.
 *
 * The order matters, and so does what is *not* taken from the push response.
 * `push` reports the highest sequence number in the whole vault, including
 * rows written by devices this one has not pulled yet; adopting it as the
 * read cursor would skip those permanently. The cursor therefore only ever
 * advances from a pull.
 *
 * The cost is that our own pushed rows come back on the next pull. They
 * arrive byte-identical at the same version and land as no-ops, which is far
 * cheaper than trying to detect whether another device wrote in between.
 */
export async function reconcile(
  client: SyncClient,
  vaultKey: VaultKeyHandle,
  from: string,
): Promise<SyncOutcome> {
  let cursor = from;
  let pulled = 0;
  let conflicts = 0;

  for (;;) {
    const page = await client.pull(cursor);
    for (const wire of page.items) {
      if (await applyIncoming(fromWire(wire), vaultKey)) conflicts += 1;
      pulled += 1;
    }
    cursor = page.cursor;
    if (!page.more) break;
  }

  const dirty = (await localRecords()).filter(isDirty);
  let pushed = 0;

  for (let at = 0; at < dirty.length; at += PUSH_BATCH) {
    const batch = dirty.slice(at, at + PUSH_BATCH);
    const result = await client.push(batch.map(toWire));

    const accepted = new Set(result.accepted);
    for (const item of batch) {
      if (accepted.has(item.id)) {
        await store(item, item.version);
        pushed += 1;
      }
    }

    for (const wire of result.conflicts) {
      if (await applyIncoming(fromWire(wire), vaultKey)) conflicts += 1;
    }
  }

  return { pulled, pushed, conflicts, cursor };
}
