// What the merge does, and — more usefully — what it refuses to do.
//
// The failures worth catching here are all silent ones: a cursor that skips
// another device's writes, an item that stops being pushed because a local
// field said it was already up there, an edit discarded because two devices
// disagreed. None of them break a build.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { cryptoFake, db, dbFake, resetFakes, type FakeStoredItem } from "../test/fakes.js";

vi.mock("../lib/crypto.js", () => cryptoFake);
vi.mock("../lib/vault-db.js", () => dbFake);

const { reconcile } = await import("./engine.js");
const { toWire } = await import("./wire.js");

import type { StoredItem } from "../lib/vault-db.js";
import type { PullResult, PushResult, SyncClient } from "./client.js";

const vaultKey = { free: vi.fn() } as unknown as Parameters<typeof reconcile>[1];

function item(over: Partial<FakeStoredItem> = {}): FakeStoredItem {
  return {
    id: "item-1",
    item_type: "login",
    format: 1,
    ciphertext: [1, 2, 3],
    nonce: [9],
    version: 1,
    updated_at: 1_000,
    deleted: false,
    plaintext: JSON.stringify({ name: "Example", password: "hunter2" }),
    ...over,
  };
}

/** A client that answers from scripted pages and records what was pushed. */
function fakeClient(options: {
  pages?: PullResult[];
  push?: (items: unknown[]) => PushResult;
}) {
  const pages = options.pages ?? [{ items: [], cursor: "0", more: false }];
  const pulledFrom: string[] = [];
  const pushed: StoredItem[][] = [];
  let page = 0;

  const client = {
    pull: vi.fn((since: string) => {
      pulledFrom.push(since);
      return Promise.resolve(pages[Math.min(page++, pages.length - 1)]!);
    }),
    push: vi.fn((items: StoredItem[]) => {
      pushed.push(items);
      return Promise.resolve(
        options.push?.(items) ?? {
          accepted: items.map((each) => each.id),
          conflicts: [],
          cursor: "999",
        },
      );
    }),
  };
  return { client: client as unknown as SyncClient, pulledFrom, pushed };
}

beforeEach(resetFakes);

describe("pulling", () => {
  it("stores an item it has never seen", async () => {
    const { client } = fakeClient({
      pages: [{ items: [toWire(item())], cursor: "7", more: false }],
    });

    const outcome = await reconcile(client, vaultKey, "0");

    expect(outcome.pulled).toBe(1);
    expect(db.items.get("item-1")?.version).toBe(1);
  });

  it("takes the server's copy when it is newer", async () => {
    db.items.set("item-1", item({ version: 2, synced_version: 2 }));
    const { client } = fakeClient({
      pages: [{ items: [toWire(item({ version: 5 }))], cursor: "7", more: false }],
    });

    await reconcile(client, vaultKey, "0");

    expect(db.items.get("item-1")?.version).toBe(5);
  });

  it("keeps the local copy when it is ahead, and pushes it", async () => {
    db.items.set("item-1", item({ version: 9 }));
    const { client, pushed } = fakeClient({
      pages: [{ items: [toWire(item({ version: 4 }))], cursor: "7", more: false }],
    });

    await reconcile(client, vaultKey, "0");

    expect(db.items.get("item-1")?.version).toBe(9);
    expect(pushed[0]?.[0]?.version).toBe(9);
  });

  it("reads every page before it pushes anything", async () => {
    const { client, pulledFrom } = fakeClient({
      pages: [
        { items: [toWire(item({ id: "a" }))], cursor: "1", more: true },
        { items: [toWire(item({ id: "b" }))], cursor: "2", more: false },
      ],
    });

    const outcome = await reconcile(client, vaultKey, "0");

    expect(pulledFrom).toEqual(["0", "1"]);
    expect(outcome.pulled).toBe(2);
  });
});

describe("the cursor", () => {
  it("comes from the pull, never from the push", async () => {
    // The trap this test exists for: `push` reports the highest sequence in
    // the whole vault, including rows other devices wrote that this one has
    // not read. Adopting it would skip those writes permanently.
    db.items.set("item-1", item());
    const { client } = fakeClient({
      pages: [{ items: [], cursor: "42", more: false }],
      push: (items) => ({ accepted: items.map((i) => (i as StoredItem).id), conflicts: [], cursor: "9999" }),
    });

    const outcome = await reconcile(client, vaultKey, "0");

    expect(outcome.cursor).toBe("42");
  });
});

describe("deciding what to push", () => {
  it("pushes an item the server has never confirmed", async () => {
    db.items.set("item-1", item());
    const { client, pushed } = fakeClient({});

    await reconcile(client, vaultKey, "0");

    // No `synced_version` at all — the state every freshly written item is in.
    expect(pushed[0]?.map((each) => each.id)).toEqual(["item-1"]);
  });

  it("leaves an item alone once the server has confirmed its version", async () => {
    db.items.set("item-1", item({ version: 3, synced_version: 3 }));
    const { client } = fakeClient({});

    await reconcile(client, vaultKey, "0");

    expect((client as unknown as { push: ReturnType<typeof vi.fn> }).push).not.toHaveBeenCalled();
  });

  it("pushes again after a local edit", async () => {
    db.items.set("item-1", item({ version: 4, synced_version: 3 }));
    const { client, pushed } = fakeClient({});

    await reconcile(client, vaultKey, "0");

    expect(pushed[0]?.[0]?.version).toBe(4);
  });

  it("records the confirmed version, so the next sync does not resend it", async () => {
    db.items.set("item-1", item({ version: 4 }));
    const { client } = fakeClient({});

    await reconcile(client, vaultKey, "0");

    expect(db.items.get("item-1")?.synced_version).toBe(4);
  });

  it("splits a large vault into batches the server will accept", async () => {
    for (let n = 0; n < 201; n += 1) db.items.set(`i${String(n)}`, item({ id: `i${String(n)}` }));
    const { client, pushed } = fakeClient({});

    await reconcile(client, vaultKey, "0");

    expect(pushed.map((batch) => batch.length)).toEqual([200, 1]);
  });

  it("sends nothing a server could read as a name or a URL", async () => {
    db.items.set("item-1", item());
    const { client, pushed } = fakeClient({});

    await reconcile(client, vaultKey, "0");

    // The wire shape is the contract, and the plaintext the fake carries is
    // exactly the sort of thing that must not travel with it.
    expect(Object.keys(pushed[0]![0]!).sort()).toEqual([
      "ciphertext",
      "deleted",
      "format",
      "id",
      "itemType",
      "nonce",
      "updatedAt",
      "version",
    ]);
  });
});

describe("conflicts", () => {
  const mine = item({ version: 2, ciphertext: [1, 1, 1] });
  const theirs = item({ version: 2, ciphertext: [2, 2, 2] });

  it("is not a conflict when both sides hold the same bytes", async () => {
    db.items.set("item-1", item({ version: 2 }));
    const { client } = fakeClient({
      pages: [{ items: [toWire(item({ version: 2 }))], cursor: "7", more: false }],
    });

    const outcome = await reconcile(client, vaultKey, "0");

    // A retried push must not become a disagreement.
    expect(outcome.conflicts).toBe(0);
    expect(db.items.get("item-1")?.synced_version).toBe(2);
  });

  it("keeps the losing edit rather than discarding it", async () => {
    db.items.set("item-1", mine);
    const { client } = fakeClient({
      pages: [{ items: [toWire(theirs)], cursor: "7", more: false }],
    });

    const outcome = await reconcile(client, vaultKey, "0");

    expect(outcome.conflicts).toBe(1);
    // The server's row keeps the real id...
    expect(db.items.get("item-1")?.ciphertext).toEqual([2, 2, 2]);
    // ...and the local edit survives under a new one.
    const copies = [...db.items.values()].filter((each) => each.conflict_of === "item-1");
    expect(copies).toHaveLength(1);
  });

  it("names the copy so it is visible without opening it", async () => {
    db.items.set("item-1", mine);
    const { client } = fakeClient({
      pages: [{ items: [toWire(theirs)], cursor: "7", more: false }],
    });

    await reconcile(client, vaultKey, "0");

    const copy = [...db.items.values()].find((each) => each.conflict_of === "item-1");
    expect(JSON.parse(copy!.plaintext) as { name: string }).toMatchObject({
      name: "Example (conflicted copy)",
    });
  });

  it("sends the copy on, so the other device sees it too", async () => {
    db.items.set("item-1", mine);
    const { client, pushed } = fakeClient({
      pages: [{ items: [toWire(theirs)], cursor: "7", more: false }],
    });

    await reconcile(client, vaultKey, "0");

    const copy = [...db.items.values()].find((each) => each.conflict_of === "item-1");
    expect(pushed[0]?.map((each) => each.id)).toContain(copy!.id);
  });

  it("handles a conflict the server reports on push", async () => {
    db.items.set("item-1", mine);
    const { client } = fakeClient({
      push: () => ({ accepted: [], conflicts: [toWire(theirs)], cursor: "9" }),
    });

    const outcome = await reconcile(client, vaultKey, "0");

    expect(outcome.conflicts).toBe(1);
    expect(db.items.get("item-1")?.ciphertext).toEqual([2, 2, 2]);
  });
});

describe("usage records", () => {
  function usage(over: Partial<FakeStoredItem> = {}): FakeStoredItem {
    return item({ id: "usage:device-a", item_type: "usage", plaintext: "{}", ...over });
  }

  it("travels through the same endpoints as everything else", async () => {
    db.usage.set("usage:device-a", { id: "usage:device-a", deviceId: "device-a", item: usage() });
    const { client, pushed } = fakeClient({});

    await reconcile(client, vaultKey, "0");

    expect(pushed[0]?.map((each) => each.id)).toEqual(["usage:device-a"]);
  });

  it("lands back in the usage store, not among the items", async () => {
    const { client } = fakeClient({
      pages: [{ items: [toWire(usage())], cursor: "7", more: false }],
    });

    await reconcile(client, vaultKey, "0");

    expect(db.usage.get("usage:device-a")?.deviceId).toBe("device-a");
    expect(db.items.has("usage:device-a")).toBe(false);
  });

  it("never makes a conflicted copy of a use counter", async () => {
    db.usage.set(
      "usage:device-a",
      { id: "usage:device-a", deviceId: "device-a", item: usage({ version: 2, ciphertext: [1] }) },
    );
    const { client } = fakeClient({
      pages: [{ items: [toWire(usage({ version: 2, ciphertext: [2] }))], cursor: "7", more: false }],
    });

    const outcome = await reconcile(client, vaultKey, "0");

    expect(outcome.conflicts).toBe(0);
    expect(db.items.size).toBe(0);
  });
});

describe("deletions", () => {
  it("carries a tombstone in both directions", async () => {
    db.items.set("gone", item({ id: "gone", version: 3, deleted: true }));
    const { client, pushed } = fakeClient({
      pages: [{ items: [toWire(item({ id: "other", version: 2, deleted: true }))], cursor: "7", more: false }],
    });

    await reconcile(client, vaultKey, "0");

    expect(pushed[0]?.find((each) => each.id === "gone")?.deleted).toBe(true);
    expect(db.items.get("other")?.deleted).toBe(true);
  });
});
