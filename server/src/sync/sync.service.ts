// Moving opaque blobs in and out.
//
// The server never decrypts anything, so "conflict" here means only that two
// writers disagree about which version is newest. It cannot merge, and does
// not try: it reports the disagreement and hands back what it holds, leaving
// the client — the only party that can read either side — to decide.

import { Injectable } from "@nestjs/common";
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

        await client.query(
          `insert into items
             (vault_id, item_id, item_type, version, updated_at, deleted, format,
              ciphertext, nonce, seq)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, nextval('item_seq'))
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
             seq = nextval('item_seq')`,
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
          ],
        );
        accepted.push(item.id);
      }

      const { rows: head } = await client.query<{ seq: string | null }>(
        "select max(seq)::text as seq from items where vault_id = $1",
        [caller.vaultId],
      );

      await client.query("commit");
      return { accepted, conflicts, cursor: head[0]?.seq ?? "0" };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
