// Moving opaque blobs in and out.
//
// The server never decrypts anything, so "conflict" here means only that two
// writers disagree about which version is newest. It cannot merge, and does
// not try: it reports the disagreement and hands back what it holds, leaving
// the client — the only party that can read either side — to decide.

import { Injectable, PayloadTooLargeException } from "@nestjs/common";
import { pool } from "../db/pool.js";
import type { Caller } from "../auth/auth.service.js";

export interface SyncItem {
  id: string;
  itemType: string;
  version: number;
  updatedAt: number;
  deleted: boolean;
  format: number;
  ciphertext: string;
  nonce: string;
}

export interface PullResult {
  items: SyncItem[];
  cursor: string;
  /** Whether another page is waiting behind this one. */
  more: boolean;
}

export interface PushResult {
  accepted: string[];
  /** What the server holds for items it would not overwrite. */
  conflicts: SyncItem[];
  cursor: string;
}

/** One page. Large enough that a first sync is a handful of round trips. */
const PAGE = 250;

// Self-limiting with one tenant, since the one person filling the disk is
// the one person it costs. With several, one vault could fill it for
// everyone. An item count is a coarser proxy for storage than total
// ciphertext bytes, but it's the cheap check to make first, and raising it
// later is a one-line change, not a migration.
export const MAX_ITEMS_PER_VAULT = 10_000;

interface ItemRow {
  item_id: string;
  item_type: string;
  version: string;
  updated_at: string;
  deleted: boolean;
  format: number;
  ciphertext: Buffer;
  nonce: Buffer;
  seq: string;
}

function toItem(row: ItemRow): SyncItem {
  return {
    id: row.item_id,
    itemType: row.item_type,
    // bigint arrives as a string from pg, because it does not fit a double
    // in general. These values do, so the conversion is safe here.
    version: Number(row.version),
    updatedAt: Number(row.updated_at),
    deleted: row.deleted,
    format: row.format,
    ciphertext: row.ciphertext.toString("base64"),
    nonce: row.nonce.toString("base64"),
  };
}

@Injectable()
export class SyncService {
  /**
   * Everything written after `since`.
   *
   * Ordered by the sequence rather than by time: clocks skew, and two writes
   * in one millisecond are ambiguous. The sequence advances on every write,
   * including an update, so a row edited after a client passed it is picked
   * up on the next pull.
   */
  async pull(caller: Caller, since: string): Promise<PullResult> {
    const { rows } = await pool.query<ItemRow>(
      `select item_id, item_type, version, updated_at, deleted, format, ciphertext, nonce, seq
         from items
        where vault_id = $1 and seq > $2
        order by seq
        limit $3`,
      [caller.vaultId, since, PAGE + 1],
    );

    const more = rows.length > PAGE;
    const page = more ? rows.slice(0, PAGE) : rows;

    return {
      items: page.map(toItem),
      // The last row actually returned, so a partial page resumes exactly
      // where it stopped rather than skipping the remainder.
      cursor: page.at(-1)?.seq ?? since,
      more,
    };
  }

  /**
   * Stores what the client has, where the client is not behind.
   *
   * An item is written when its version is newer than the stored one. Equal
   * versions are accepted only when the ciphertext is byte-identical, which
   * makes a retried push idempotent rather than a conflict — a dropped
   * response should not turn into a false disagreement.
   *
   * Anything else is a conflict, and the stored row comes back with it.
   */
  async push(caller: Caller, items: SyncItem[]): Promise<PushResult> {
    const accepted: string[] = [];
    const conflicts: SyncItem[] = [];

    const client = await pool.connect();
    try {
      await client.query("begin");

      // Locked for the whole push, not just read: this is what makes the
      // sequence per-vault rather than global without a second table. Two
      // concurrent pushes to the *same* vault now serialise here instead of
      // racing on a shared sequence; two pushes to different vaults never
      // contend, since each locks only its own row.
      const { rows: vaultRows } = await client.query<{ next_seq: string }>(
        "select next_seq from vaults where id = $1 for update",
        [caller.vaultId],
      );
      let nextSeq = BigInt(vaultRows[0]!.next_seq);

      // Only a genuinely new item_id grows the vault; an update to one
      // already stored does not, so it's what's checked against the quota
      // rather than the size of this push.
      const { rows: existingRows } = await client.query<{ item_id: string }>(
        "select item_id from items where vault_id = $1 and item_id = any($2::text[])",
        [caller.vaultId, items.map((item) => item.id)],
      );
      const existingIds = new Set(existingRows.map((row) => row.item_id));
      const newItemCount = items.filter((item) => !existingIds.has(item.id)).length;

      if (newItemCount > 0) {
        const { rows: countRows } = await client.query<{ count: string }>(
          "select count(*)::text as count from items where vault_id = $1",
          [caller.vaultId],
        );
        const currentCount = Number(countRows[0]!.count);
        if (currentCount + newItemCount > MAX_ITEMS_PER_VAULT) {
          throw new PayloadTooLargeException(
            `Vault is at its ${MAX_ITEMS_PER_VAULT}-item limit.`,
          );
        }
      }

      for (const item of items) {
        const ciphertext = Buffer.from(item.ciphertext, "base64");
        const nonce = Buffer.from(item.nonce, "base64");

        // Locked so two devices pushing the same item cannot both read the
        // old version and both decide they are newer.
        const { rows } = await client.query<ItemRow>(
          `select item_id, item_type, version, updated_at, deleted, format,
                  ciphertext, nonce, seq
             from items
            where vault_id = $1 and item_id = $2
            for update`,
          [caller.vaultId, item.id],
        );

        const stored = rows[0];
        if (stored) {
          const storedVersion = Number(stored.version);

          if (storedVersion > item.version) {
            conflicts.push(toItem(stored));
            continue;
          }

          if (storedVersion === item.version) {
            if (stored.ciphertext.equals(ciphertext)) {
              accepted.push(item.id);
            } else {
              conflicts.push(toItem(stored));
            }
            continue;
          }
        }

        const seq = nextSeq;
        nextSeq += 1n;

        await client.query(
          `insert into items
             (vault_id, item_id, item_type, version, updated_at, deleted, format,
              ciphertext, nonce, seq)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           on conflict (vault_id, item_id) do update set
             item_type = excluded.item_type,
             version = excluded.version,
             updated_at = excluded.updated_at,
             deleted = excluded.deleted,
             format = excluded.format,
             ciphertext = excluded.ciphertext,
             nonce = excluded.nonce,
             -- Advanced on update too, or a client that had already read past
             -- this row would never see the change.
             seq = excluded.seq`,
          [
            caller.vaultId,
            item.id,
            item.itemType,
            item.version,
            item.updatedAt,
            item.deleted,
            item.format,
            ciphertext,
            nonce,
            seq,
          ],
        );
        accepted.push(item.id);
      }

      await client.query("update vaults set next_seq = $1 where id = $2", [
        nextSeq,
        caller.vaultId,
      ]);

      await client.query("commit");
      // next_seq is always one past the highest seq this vault has ever
      // handed out, so it doubles as the cursor without a second query.
      return { accepted, conflicts, cursor: (nextSeq - 1n).toString() };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
