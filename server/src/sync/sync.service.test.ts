// Against a real Postgres: the cursor, the row lock and the sequence are all
// database behaviour, and none of them can be tested against a fake.

import { PayloadTooLargeException } from "@nestjs/common";
import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

const VAULT = {
  saltB64: "c2FsdA==",
  memoryKib: 65536,
  iterations: 3,
  parallelism: 4,
  wrappedVaultKey: { version: 1 },
};

/** A second real vault, inserted directly since `register` allows only one. */
async function createVault(
  pool: Pool,
): Promise<{ userId: string; vaultId: string; deviceId: string }> {
  const { rows: userRows } = await pool.query<{ id: string }>(
    "insert into users (auth_key_hash) values ('unused') returning id",
  );
  const { rows: vaultRows } = await pool.query<{ id: string }>(
    `insert into vaults
       (user_id, salt_b64, kdf_memory_kib, kdf_iterations, kdf_parallelism, wrapped_vault_key)
     values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [
      userRows[0]!.id,
      VAULT.saltB64,
      VAULT.memoryKib,
      VAULT.iterations,
      VAULT.parallelism,
      JSON.stringify(VAULT.wrappedVaultKey),
    ],
  );
  return { userId: userRows[0]!.id, vaultId: vaultRows[0]!.id, deviceId: "unused-device" };
}

/**
 * Inserted directly rather than through `push`, so a quota test doesn't also
 * have to pay for thousands of round trips. The seq values aren't meaningful
 * sync history, only bodies to count.
 */
async function seedItems(pool: Pool, vaultId: string, count: number): Promise<void> {
  await pool.query(
    `insert into items
       (vault_id, item_id, item_type, version, updated_at, deleted, format, ciphertext, nonce, seq)
     select $1, 'seed-' || gs::text, 'login', 1, 0, false, 1, '\\x00'::bytea, '\\x00'::bytea, gs
       from generate_series(1, $2) as gs`,
    [vaultId, count],
  );
}

function item(id: string, version: number, secret = "ciphertext"): {
  id: string;
  itemType: string;
  version: number;
  updatedAt: number;
  deleted: boolean;
  format: number;
  ciphertext: string;
  nonce: string;
} {
  return {
    id,
    itemType: "login",
    version,
    updatedAt: Date.now(),
    deleted: false,
    format: 1,
    ciphertext: Buffer.from(secret).toString("base64"),
    nonce: Buffer.from("nonce-value-here").toString("base64"),
  };
}

describeDb("sync", () => {
  let pool: typeof import("../db/pool.js").pool;
  let sync: import("./sync.service.js").SyncService;
  let caller: import("../auth/auth.service.js").Caller;
  let MAX_ITEMS_PER_VAULT: number;

  beforeEach(async () => {
    ({ pool } = await import("../db/pool.js"));
    const { migrate } = await import("../db/migrate.js");
    const { AuthService } = await import("../auth/auth.service.js");
    const { SyncService, MAX_ITEMS_PER_VAULT: max } = await import("./sync.service.js");
    MAX_ITEMS_PER_VAULT = max;

    await migrate();
    await pool.query("delete from users");

    const auth = new AuthService();
    const { token } = await auth.mintAccountToken({ grantsRole: "admin", minutes: 15 });
    const { deviceId, credential } = await auth.register({
      token,
      authKey: "auth-key",
      vault: VAULT,
      deviceName: "First",
    });
    caller = (await auth.identify(deviceId, credential))!;
    sync = new SyncService();
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("pulling", () => {
    it("returns nothing from an empty vault", async () => {
      const result = await sync.pull(caller, "0");
      expect(result.items).toHaveLength(0);
      expect(result.more).toBe(false);
    });

    it("returns everything after the cursor, and not before", async () => {
      await sync.push(caller, [item("a", 1)]);
      const first = await sync.pull(caller, "0");
      expect(first.items.map((i) => i.id)).toEqual(["a"]);

      await sync.push(caller, [item("b", 1)]);
      const second = await sync.pull(caller, first.cursor);
      expect(second.items.map((i) => i.id)).toEqual(["b"]);
    });

    it("picks up a row edited after the client passed it", async () => {
      await sync.push(caller, [item("a", 1)]);
      const seen = await sync.pull(caller, "0");

      await sync.push(caller, [item("a", 2, "changed")]);

      // The sequence advances on update, not only on insert. Without that a
      // client that had already read past this row would never see the edit.
      const after = await sync.pull(caller, seen.cursor);
      expect(after.items.map((i) => i.id)).toEqual(["a"]);
      expect(after.items[0]?.version).toBe(2);
    });

    it("resumes exactly where a partial page stopped", async () => {
      await sync.push(caller, Array.from({ length: 5 }, (_, n) => item(`i${String(n)}`, 1)));

      const all = await sync.pull(caller, "0");
      expect(all.items).toHaveLength(5);

      // The cursor is the last row actually returned, so nothing is skipped.
      const nothingLeft = await sync.pull(caller, all.cursor);
      expect(nothingLeft.items).toHaveLength(0);
    });

    it("round-trips the ciphertext unchanged", async () => {
      const bytes = Buffer.from([0, 1, 255, 128, 0, 7]);
      await sync.push(caller, [{ ...item("a", 1), ciphertext: bytes.toString("base64") }]);

      const { items } = await sync.pull(caller, "0");
      expect(Buffer.from(items[0]!.ciphertext, "base64")).toEqual(bytes);
    });
  });

  describe("pushing", () => {
    it("accepts a newer version", async () => {
      await sync.push(caller, [item("a", 1)]);
      const result = await sync.push(caller, [item("a", 2, "newer")]);

      expect(result.accepted).toEqual(["a"]);
      expect(result.conflicts).toHaveLength(0);
    });

    it("refuses an older version and hands back what it holds", async () => {
      await sync.push(caller, [item("a", 5, "current")]);
      const result = await sync.push(caller, [item("a", 3, "stale")]);

      expect(result.accepted).toHaveLength(0);
      expect(result.conflicts).toHaveLength(1);
      // The client is the only party that can read either side, so the server
      // hands its copy back rather than choosing.
      expect(result.conflicts[0]?.version).toBe(5);
      expect(Buffer.from(result.conflicts[0]!.ciphertext, "base64").toString()).toBe("current");
    });

    it("treats a repeated identical push as done, not as a conflict", async () => {
      const once = item("a", 1);
      await sync.push(caller, [once]);

      // A dropped response should not turn into a false disagreement.
      const again = await sync.push(caller, [once]);
      expect(again.accepted).toEqual(["a"]);
      expect(again.conflicts).toHaveLength(0);
    });

    it("calls the same version with different contents a conflict", async () => {
      await sync.push(caller, [item("a", 1, "mine")]);
      const result = await sync.push(caller, [item("a", 1, "theirs")]);

      // Two devices both wrote version 1. Neither is obviously right.
      expect(result.accepted).toHaveLength(0);
      expect(result.conflicts).toHaveLength(1);
    });

    it("keeps a tombstone rather than removing the row", async () => {
      await sync.push(caller, [item("a", 1)]);
      await sync.push(caller, [{ ...item("a", 2), deleted: true }]);

      const { items } = await sync.pull(caller, "0");
      // A deletion has to reach the other devices, so the record survives.
      expect(items).toHaveLength(1);
      expect(items[0]?.deleted).toBe(true);
    });

    it("applies a batch where some conflict and some do not", async () => {
      await sync.push(caller, [item("a", 5)]);

      const result = await sync.push(caller, [item("a", 2, "stale"), item("b", 1)]);
      expect(result.accepted).toEqual(["b"]);
      expect(result.conflicts.map((c) => c.id)).toEqual(["a"]);
    });
  });

  describe("what the server can see", () => {
    it("has nowhere to put a name, a username or a URL", async () => {
      // A schema assertion rather than a cryptographic one: the guarantee is
      // that the server holds only the fields already bound into each item's
      // tag, and the way that erodes is a plaintext column being added later.
      const { rows } = await pool.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_name = 'items' order by column_name`,
      );

      expect(rows.map((r) => r.column_name)).toEqual([
        "ciphertext",
        "deleted",
        "format",
        "item_id",
        "item_type",
        "nonce",
        "seq",
        "updated_at",
        "vault_id",
        "version",
      ]);
    });

    it("stores the ciphertext as bytes and nothing else about it", async () => {
      await sync.push(caller, [item("a", 1, "would-be-plaintext")]);

      // Everything the row holds, as text. The ciphertext column is the only
      // place the payload appears.
      const { rows } = await pool.query<Record<string, unknown>>(
        "select * from items where vault_id = $1",
        [caller.vaultId],
      );

      const row = rows[0]!;
      const elsewhere = Object.entries(row)
        .filter(([column]) => column !== "ciphertext")
        .map(([, value]) => String(value))
        .join(" ");

      expect(elsewhere).not.toContain("would-be-plaintext");
    });
  });

  describe("separating vaults", () => {
    it("never returns another vault's items", async () => {
      await sync.push(caller, [item("a", 1)]);

      const elsewhere = { ...caller, vaultId: "00000000-0000-4000-8000-000000000000" };
      const { items } = await sync.pull(elsewhere, "0");
      expect(items).toHaveLength(0);
    });

    it("gives each vault its own sequence, not a shared one", async () => {
      const other = await createVault(pool);

      // Advance the other vault's sequence well past this one's, the way a
      // busier tenant would. With a shared item_seq, this one's next cursor
      // would inherit that gap and report how much the other vault wrote.
      await sync.push(other, Array.from({ length: 20 }, (_, n) => item(`o${String(n)}`, 1)));

      const result = await sync.push(caller, [item("a", 1)]);
      expect(result.cursor).toBe("1");
    });
  });

  describe("per-vault quota", () => {
    it("refuses a new item once the vault is at its limit", async () => {
      await seedItems(pool, caller.vaultId, MAX_ITEMS_PER_VAULT);

      await expect(sync.push(caller, [item("one-too-many", 1)])).rejects.toThrow(
        PayloadTooLargeException,
      );
    });

    it("accepts a new item exactly at the boundary", async () => {
      await seedItems(pool, caller.vaultId, MAX_ITEMS_PER_VAULT - 1);

      const result = await sync.push(caller, [item("last-one", 1)]);
      expect(result.accepted).toEqual(["last-one"]);
    });

    it("does not count updating an existing item against the quota", async () => {
      await sync.push(caller, [item("a", 1)]);
      await seedItems(pool, caller.vaultId, MAX_ITEMS_PER_VAULT - 1);

      const result = await sync.push(caller, [item("a", 2, "still fits")]);
      expect(result.accepted).toEqual(["a"]);
    });
  });
});
