// The invariants CI cannot otherwise see.
//
// These are not crypto tests — the crate covers that. They cover the vault's
// bookkeeping, where a regression is silent: drop the version increment and
// everything still compiles, still builds, still appears to work, and the
// rollback protection that the AAD binding exists to provide is quietly gone.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeTab } from "../test/setup.js";
import {
  cryptoFake,
  db,
  dbFake,
  encryptedHeaders,
  freed,
  resetFakes,
  storedContent,
} from "../test/fakes.js";

vi.mock("../lib/crypto.js", () => cryptoFake);
vi.mock("../lib/vault-db.js", () => dbFake);

const vault = await import("./vault.js");

const CONTENT = { username: "ada@example.test", password: "hunter2", url: "https://x.test", notes: "" };

/** Puts the vault in an unlocked state with one item already saved. */
async function withOneItem(): Promise<string> {
  await vault.create("correct horse battery staple");
  return await vault.addItem(CONTENT);
}

function lastHeader() {
  const header = encryptedHeaders.at(-1);
  if (!header) throw new Error("nothing was encrypted");
  return header;
}

beforeEach(resetFakes);

describe("version", () => {
  it("starts at 1 for a new item", async () => {
    await withOneItem();
    expect(lastHeader().version).toBe(1);
  });

  // The one that matters. Without the increment a new ciphertext is
  // interchangeable with the old one, and a server could roll you back to a
  // previous password undetected.
  it("increments on every mutation", async () => {
    const id = await withOneItem();

    await vault.updateItem(id, { ...CONTENT, password: "second" });
    expect(lastHeader().version).toBe(2);

    await vault.trashItem(id);
    expect(lastHeader().version).toBe(3);

    await vault.restoreItem(id);
    expect(lastHeader().version).toBe(4);

    await vault.purgeItem(id);
    expect(lastHeader().version).toBe(5);
  });

  it("never reuses a version for one item", async () => {
    const id = await withOneItem();
    await vault.updateItem(id, CONTENT);
    await vault.updateItem(id, CONTENT);

    const versions = encryptedHeaders.map((h) => h.version);
    expect(new Set(versions).size).toBe(versions.length);
  });
});

describe("the header bound into the tag", () => {
  it("carries the item's own id and type on every rewrite", async () => {
    const id = await withOneItem();
    await vault.updateItem(id, CONTENT);
    await vault.trashItem(id);

    for (const header of encryptedHeaders) {
      expect(header.id).toBe(id);
      expect(header.item_type).toBe("login");
    }
  });
});

describe("trash", () => {
  it("keeps the content, so a deletion can be undone", async () => {
    const id = await withOneItem();
    await vault.trashItem(id);

    expect(lastHeader().deleted).toBe(true);
    expect(storedContent(id)).toEqual(CONTENT);
  });

  it("restores as a live item with the content intact", async () => {
    const id = await withOneItem();
    await vault.trashItem(id);
    await vault.restoreItem(id);

    expect(lastHeader().deleted).toBe(false);
    expect(storedContent(id)).toEqual(CONTENT);
  });

  it("still lists trashed items, flagged", async () => {
    const id = await withOneItem();
    await vault.trashItem(id);

    const items = await vault.listItems();
    expect(items).toHaveLength(1);
    expect(items[0]?.deleted).toBe(true);
    expect(items[0]?.password).toBe(CONTENT.password);
  });
});

describe("purge", () => {
  it("erases the content but keeps the record", async () => {
    const id = await withOneItem();
    await vault.purgeItem(id);

    // The record survives so the deletion can propagate to other devices.
    expect(db.items.has(id)).toBe(true);
    expect(lastHeader().deleted).toBe(true);

    const content = storedContent(id);
    expect(content).toEqual({ purged: true });
    expect(JSON.stringify(content)).not.toContain(CONTENT.password);
  });

  it("hides the marker inside the encrypted payload, not beside it", async () => {
    const id = await withOneItem();
    await vault.purgeItem(id);

    // A server sees only the header. If "purged" appeared there it would
    // learn which items were deleted and when.
    expect(Object.keys(lastHeader())).not.toContain("purged");
  });

  it("is not shown to the user", async () => {
    const id = await withOneItem();
    await vault.purgeItem(id);
    expect(await vault.listItems()).toHaveLength(0);
  });
});

describe("locking", () => {
  it("refuses every item operation while locked", async () => {
    const id = await withOneItem();
    await vault.lock();

    await expect(vault.addItem(CONTENT)).rejects.toThrow(/locked/i);
    await expect(vault.updateItem(id, CONTENT)).rejects.toThrow(/locked/i);
    await expect(vault.trashItem(id)).rejects.toThrow(/locked/i);
    await expect(vault.restoreItem(id)).rejects.toThrow(/locked/i);
    await expect(vault.purgeItem(id)).rejects.toThrow(/locked/i);
    await expect(vault.listItems()).rejects.toThrow(/locked/i);
  });

  it("clears session storage and frees the key", async () => {
    await withOneItem();
    await vault.lock();

    expect(cryptoFake.clearStashedVaultKey).toHaveBeenCalled();
    expect(freed).toContain("vault");
  });

  it("reports locked once the key is gone", async () => {
    await withOneItem();
    await vault.lock();
    expect(await vault.status()).toBe("locked");
  });

  it("reports empty before a vault exists", async () => {
    expect(await vault.status()).toBe("empty");
  });
});

describe("names", () => {
  it("round-trips a name", async () => {
    await vault.create("correct horse battery staple");
    await vault.addItem({ ...CONTENT, name: "Work email" });

    const items = await vault.listItems();
    expect(items[0]?.name).toBe("Work email");
  });

  it("lists an item saved before the field existed", async () => {
    // The field lives inside the encrypted content, so older records simply
    // lack it. Nothing is migrated, and nothing may break on their absence.
    await vault.create("correct horse battery staple");
    const id = await vault.addItem(CONTENT);

    const items = await vault.listItems();
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(id);
    expect(items[0]?.name).toBeUndefined();
    expect(items[0]?.username).toBe(CONTENT.username);
  });

  it("keeps several logins for one site apart", async () => {
    await vault.create("correct horse battery staple");
    await vault.addItem({ ...CONTENT, name: "Personal", username: "me@example.test" });
    await vault.addItem({ ...CONTENT, name: "Work", username: "me@work.test" });

    const items = await vault.listItems();
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.name)).toEqual(["Personal", "Work"]);
    expect(new Set(items.map((item) => item.id)).size).toBe(2);
  });

  it("orders by what the list actually shows", async () => {
    // Storage order is by random UUID, so without sorting the list would
    // reshuffle itself between openings.
    await vault.create("correct horse battery staple");
    await vault.addItem({ ...CONTENT, name: "zeta" });
    await vault.addItem({ ...CONTENT, name: "Alpha" });
    // Omitted, not set to undefined: with exactOptionalPropertyTypes those
    // are different types, and "absent" is what an older record looks like.
    await vault.addItem({ ...CONTENT, username: "mid@example.test" });

    const items = await vault.listItems();
    expect(items.map((item) => item.name ?? item.username)).toEqual([
      "Alpha",
      "mid@example.test",
      "zeta",
    ]);
  });
});

describe("items for the current site", () => {
  async function withSites(): Promise<void> {
    await vault.create("correct horse battery staple");
    await vault.addItem({ ...CONTENT, name: "Example", url: "https://www.example.com/login" });
    await vault.addItem({ ...CONTENT, name: "Other", url: "https://other.test" });
    await vault.addItem({ ...CONTENT, name: "No site", url: "" });
  }

  it("offers logins from the same registrable domain", async () => {
    await withSites();
    activeTab.url = "https://account.example.com/settings";

    const { site, items } = await vault.itemsForUrl(await vault.activeTabUrl());
    expect(site).toBe("example.com");
    expect(items.map((item) => item.name)).toEqual(["Example"]);
  });

  it("offers nothing on an unrelated site", async () => {
    await withSites();
    activeTab.url = "https://unrelated.test";
    expect((await vault.itemsForUrl(await vault.activeTabUrl())).items).toHaveLength(0);
  });

  it("refuses a lookalike domain", async () => {
    await withSites();
    // The failure this whole module exists to prevent.
    const { items } = await vault.itemsForUrl("https://example.com.attacker.test/login");
    expect(items).toHaveLength(0);
  });

  it("offers nothing when there is no tab to read", async () => {
    await withSites();
    activeTab.url = undefined;

    const { site, items } = await vault.itemsForUrl(await vault.activeTabUrl());
    expect(site).toBeNull();
    expect(items).toHaveLength(0);
  });

  it("does not offer a trashed login", async () => {
    await vault.create("correct horse battery staple");
    const id = await vault.addItem({ ...CONTENT, url: "https://example.com" });
    await vault.trashItem(id);

    // Deleting a login should stop it turning up on the site it was for.
    expect((await vault.itemsForUrl("https://example.com")).items).toHaveLength(0);
  });

  it("refuses while locked, like every other item operation", async () => {
    await withSites();
    await vault.lock();
    await expect(vault.itemsForUrl("https://example.com")).rejects.toThrow(/locked/i);
  });
});

describe("strength", () => {
  it("rides along on every listed item", async () => {
    await withOneItem();
    const items = await vault.listItems();
    expect(items[0]?.strength.level).toBe("weak");
    expect(items[0]?.strength.bits).toBe(CONTENT.password.length * 6);
  });

  it("is scored from the item's own password, not something else", async () => {
    const id = await withOneItem();
    await vault.updateItem(id, { ...CONTENT, password: "a-much-longer-password" });

    const items = await vault.listItems();
    expect(items[0]?.strength.level).toBe("excellent");
  });

  it("works while locked", () => {
    // A signup form is a reason to want a score and no reason to unlock.
    expect(vault.checkStrength("short").level).toBe("weak");
  });
});

describe("password generation", () => {
  it("works while locked", async () => {
    // Filling a signup form is a reason to want a password and no reason to
    // have unlocked the vault first.
    expect(await vault.status()).toBe("empty");
    expect(vault.newPassword()).toBe("Generated-Password-1!");
  });

  it("falls back to the recommended options when none are given", () => {
    vault.newPassword();
    expect(cryptoFake.recommendedPasswordOptions).toHaveBeenCalled();
  });

  it("passes explicit options straight through", () => {
    const options = {
      length: 32,
      lowercase: true,
      uppercase: false,
      digits: true,
      symbols: false,
    };
    vault.newPassword(options);
    expect(cryptoFake.generatePassword).toHaveBeenLastCalledWith(options);
    expect(cryptoFake.recommendedPasswordOptions).not.toHaveBeenCalled();
  });
});

describe("mutating an item that does not exist", () => {
  it("is refused rather than silently creating one", async () => {
    await vault.create("correct horse battery staple");
    await expect(vault.updateItem("nope", CONTENT)).rejects.toThrow(/no such item/i);
    expect(db.items.size).toBe(0);
  });
});
