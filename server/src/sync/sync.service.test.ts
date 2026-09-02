// Against a real Postgres: the cursor, the row lock and the sequence are all
// database behaviour, and none of them can be tested against a fake.

import { afterAll, beforeEach, describe, expect, it } from "vitest";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

const VAULT = {
  saltB64: "c2FsdA==",
  memoryKib: 65536,
  iterations: 3,
  parallelism: 4,
  wrappedVaultKey: { version: 1 },
};

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

  beforeEach(async () => {
    ({ pool } = await import("../db/pool.js"));
    const { migrate } = await import("../db/migrate.js");
    const { AuthService } = await import("../auth/auth.service.js");
    const { SyncService } = await import("./sync.service.js");

    await migrate();
    await pool.query("delete from users");

    const auth = new AuthService();
    const { deviceId, credential } = await auth.register({
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
  });
});
