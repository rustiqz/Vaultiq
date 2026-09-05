// The invariants CI cannot otherwise see.
//
// These are not crypto tests — the crate covers that. They cover the vault's
// bookkeeping, where a regression is silent: drop the version increment and
// everything still compiles, still builds, still appears to work, and the
// rollback protection that the AAD binding exists to provide is quietly gone.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CardContent,
  DecryptedCard,
  DecryptedItem,
  IdentityContent,
  LoginContent,
  NoteContent,
  TotpContent,
} from "../lib/messages.js";
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

const CONTENT = {
  type: "login",
  username: "ada@example.test",
  password: "hunter2",
  url: "https://x.test",
  notes: "",
} satisfies LoginContent;

/**
 * The same content as it is actually stored: everything but the type.
 *
 * The discriminator lives in the record header, where it is bound into the
 * authentication tag. Writing it into the ciphertext as well would be two
 * places for one fact to disagree, and only one of them tamper-evident.
 */
const { type: _type, ...STORED } = CONTENT;

/**
 * Narrows a listed item to a login.
 *
 * Most of these tests are about logins specifically, and the union is what
 * stops `item.password` from silently being undefined on something that never
 * had one — so the narrowing is stated rather than asserted away.
 */
function asLogin(item: DecryptedItem | undefined): LoginContent & DecryptedItem {
  if (!item) throw new Error("no item");
  if (item.type !== "login") throw new Error(`expected a login, got ${item.type}`);
  return item;
}

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
    // toMatchObject, not toEqual: the content also carries createdAt and
    // lastModifiedAt, which trashing must leave alone.
    expect(storedContent(id)).toMatchObject(STORED);
  });

  it("restores as a live item with the content intact", async () => {
    const id = await withOneItem();
    await vault.trashItem(id);
    await vault.restoreItem(id);

    expect(lastHeader().deleted).toBe(false);
    expect(storedContent(id)).toMatchObject(STORED);
  });

  it("still lists trashed items, flagged", async () => {
    const id = await withOneItem();
    await vault.trashItem(id);

    const items = await vault.listItems();
    expect(items).toHaveLength(1);
    expect(items[0]?.deleted).toBe(true);
    expect(asLogin(items[0]).password).toBe(CONTENT.password);
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
    expect(asLogin(items[0]).username).toBe(CONTENT.username);
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
    expect(items.map((item) => item.name ?? asLogin(item).username)).toEqual([
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

describe("handing a password to a page", () => {
  async function vaultWithTwoSites(): Promise<{ example: string; other: string }> {
    await vault.create("correct horse battery staple");
    const example = await vault.addItem({
      ...CONTENT,
      name: "Example",
      url: "https://example.com",
    });
    const other = await vault.addItem({
      ...CONTENT,
      name: "Other",
      username: "other@other.test",
      password: "other-secret",
      url: "https://other.test",
    });
    return { example, other };
  }

  it("hands over the credential for an item on this site", async () => {
    const { example } = await vaultWithTwoSites();
    const credential = await vault.credentialForFill(example, "https://login.example.com");
    expect(credential.username).toBe(CONTENT.username);
    expect(credential.password).toBe(CONTENT.password);
  });

  // The control this whole path turns on.
  it("refuses an item belonging to another site", async () => {
    const { other } = await vaultWithTwoSites();
    await expect(
      vault.credentialForFill(other, "https://example.com"),
    ).rejects.toThrow(/no such item/i);
  });

  it("refuses on a lookalike domain", async () => {
    const { example } = await vaultWithTwoSites();
    await expect(
      vault.credentialForFill(example, "https://example.com.attacker.test"),
    ).rejects.toThrow(/no such item/i);
  });

  it("refuses when there is no site at all", async () => {
    const { example } = await vaultWithTwoSites();
    await expect(vault.credentialForFill(example, undefined)).rejects.toThrow(/no such item/i);
  });

  it("refuses an item that has been trashed", async () => {
    const { example } = await vaultWithTwoSites();
    await vault.trashItem(example);
    await expect(
      vault.credentialForFill(example, "https://example.com"),
    ).rejects.toThrow(/no such item/i);
  });

  it("refuses while locked", async () => {
    const { example } = await vaultWithTwoSites();
    await vault.lock();
    await expect(
      vault.credentialForFill(example, "https://example.com"),
    ).rejects.toThrow(/locked/i);
  });

  it("refuses an id that does not exist", async () => {
    await vaultWithTwoSites();
    await expect(
      vault.credentialForFill("made-up", "https://example.com"),
    ).rejects.toThrow(/no such item/i);
  });
});

describe("offering to save a submitted login", () => {
  const SUBMITTED = { username: "ada@example.test", password: "typed-password" };
  const SITE = "https://example.com/login";

  async function unlockedVault(): Promise<void> {
    await vault.create("correct horse battery staple");
  }

  it("offers when the login is new", async () => {
    await unlockedVault();
    const decision = await vault.shouldOfferToSave(SUBMITTED, SITE);
    expect(decision).toEqual({ offer: true, site: "example.com", existingId: null });
  });

  it("stays quiet when the identical login is already stored", async () => {
    await unlockedVault();
    await vault.addItem({ type: "login", ...SUBMITTED, url: SITE, notes: "" });

    // Signing in every day must not ask every day.
    expect(await vault.shouldOfferToSave(SUBMITTED, SITE)).toEqual({ offer: false });
  });

  it("offers to update when the password changed", async () => {
    await unlockedVault();
    const id = await vault.addItem({ type: "login", ...SUBMITTED, password: "old", url: SITE, notes: "" });

    const decision = await vault.shouldOfferToSave(SUBMITTED, SITE);
    expect(decision).toEqual({ offer: true, site: "example.com", existingId: id });
  });

  it("treats a different username on the same site as a new login", async () => {
    await unlockedVault();
    await vault.addItem({
      type: "login",
      ...SUBMITTED,
      username: "other@example.test",
      url: SITE,
      notes: "",
    });

    const decision = await vault.shouldOfferToSave(SUBMITTED, SITE);
    expect(decision).toMatchObject({ offer: true, existingId: null });
  });

  it("stays quiet while locked", async () => {
    await unlockedVault();
    await vault.lock();

    // A banner the user cannot act on is worse than none, and the page did
    // nothing wrong — so this declines rather than throwing.
    expect(await vault.shouldOfferToSave(SUBMITTED, SITE)).toEqual({ offer: false });
  });

  it("stays quiet where there is no site", async () => {
    await unlockedVault();
    expect(await vault.shouldOfferToSave(SUBMITTED, undefined)).toEqual({ offer: false });
    expect(await vault.shouldOfferToSave(SUBMITTED, "about:blank")).toEqual({ offer: false });
  });

  it("stays quiet when no password was typed", async () => {
    await unlockedVault();
    expect(await vault.shouldOfferToSave({ ...SUBMITTED, password: "" }, SITE)).toEqual({
      offer: false,
    });
  });
});

describe("saving a submitted login", () => {
  const SUBMITTED = { username: "ada@example.test", password: "typed-password" };
  const SITE = "https://example.com/login";

  it("stores it against the site from the tab, not the page", async () => {
    await vault.create("correct horse battery staple");
    await vault.saveSubmitted(SUBMITTED, SITE);

    const items = await vault.listItems();
    expect(items).toHaveLength(1);
    expect(asLogin(items[0]).username).toBe(SUBMITTED.username);
    expect(asLogin(items[0]).url).toBe(SITE);
  });

  it("updates the existing login rather than adding a duplicate", async () => {
    await vault.create("correct horse battery staple");
    const id = await vault.addItem({ type: "login", ...SUBMITTED, password: "old", url: SITE, notes: "" });

    await vault.saveSubmitted(SUBMITTED, SITE);

    const items = await vault.listItems();
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(id);
    expect(asLogin(items[0]).password).toBe(SUBMITTED.password);
  });

  it("refuses when there is nothing worth saving", async () => {
    await vault.create("correct horse battery staple");
    await expect(vault.saveSubmitted(SUBMITTED, undefined)).rejects.toThrow(/nothing to save/i);
    await expect(
      vault.saveSubmitted({ ...SUBMITTED, password: "" }, SITE),
    ).rejects.toThrow(/nothing to save/i);
  });

  it("refuses while locked", async () => {
    await vault.create("correct horse battery staple");
    await vault.lock();
    await expect(vault.saveSubmitted(SUBMITTED, SITE)).rejects.toThrow(/nothing to save/i);
  });
});

describe("audit timestamps", () => {
  it("stamps when a login was created and last changed", async () => {
    await vault.create("correct horse battery staple");
    const id = await vault.addItem(CONTENT);

    const [item] = await vault.listItems();
    expect(item?.createdAt).toBeGreaterThan(0);
    expect(item?.lastModifiedAt).toBe(item?.createdAt);
    void id;
  });

  it("keeps createdAt across an edit and moves lastModifiedAt", async () => {
    await vault.create("correct horse battery staple");
    const id = await vault.addItem(CONTENT);
    const created = (await vault.listItems())[0]?.createdAt;

    vi.setSystemTime(new Date(Date.now() + 60_000));
    await vault.updateItem(id, { ...CONTENT, password: "changed" });

    const [item] = await vault.listItems();
    expect(item?.createdAt).toBe(created);
    expect(item?.lastModifiedAt).toBeGreaterThan(created ?? 0);
    vi.useRealTimers();
  });

  it("leaves them absent on a login saved before they existed", async () => {
    // They live inside the encrypted content, so older records simply lack
    // them. Nothing is migrated and nothing may break on their absence.
    await vault.create("correct horse battery staple");
    const id = await vault.addItem(CONTENT);

    const stored = db.items.get(id);
    const content = JSON.parse(stored!.plaintext) as Record<string, unknown>;
    delete content.createdAt;
    delete content.lastModifiedAt;
    db.items.set(id, { ...stored!, plaintext: JSON.stringify(content) });

    const [item] = await vault.listItems();
    expect(item?.createdAt).toBeUndefined();
    expect(asLogin(item).username).toBe(CONTENT.username);
  });
});

describe("usage", () => {
  it("starts at nothing", async () => {
    await vault.create("correct horse battery staple");
    await vault.addItem(CONTENT);

    const [item] = await vault.listItems();
    expect(item?.usage.useCount).toBe(0);
  });

  it("counts an autofill and marks it as one", async () => {
    await vault.create("correct horse battery staple");
    const id = await vault.addItem({ ...CONTENT, url: "https://example.com" });

    await vault.credentialForFill(id, "https://example.com");

    const [item] = await vault.listItems();
    expect(item?.usage.useCount).toBe(1);
    expect(item?.usage.lastAutofilledAt).toBeGreaterThan(0);
    expect(item?.usage.lastUsedAt).toBe(item?.usage.lastAutofilledAt);
  });

  it("counts a use from the popup without calling it an autofill", async () => {
    await vault.create("correct horse battery staple");
    const id = await vault.addItem(CONTENT);

    await vault.recordUse(id, "copied");

    const [item] = await vault.listItems();
    expect(item?.usage.useCount).toBe(1);
    expect(item?.usage.lastUsedAt).toBeGreaterThan(0);
    expect(item?.usage.lastAutofilledAt).toBeUndefined();
  });

  it("accumulates", async () => {
    await vault.create("correct horse battery staple");
    const id = await vault.addItem(CONTENT);

    await vault.recordUse(id, "copied");
    await vault.recordUse(id, "copied");
    await vault.recordUse(id, "copied");

    expect((await vault.listItems())[0]?.usage.useCount).toBe(3);
  });

  // The reason usage is not stored inside the item.
  it("does not bump the item version", async () => {
    await vault.create("correct horse battery staple");
    const id = await vault.addItem(CONTENT);
    const before = db.items.get(id)?.version;

    await vault.recordUse(id, "copied");

    // version drives sync's optimistic concurrency. If a fill moved it, two
    // devices using one login would collide over nothing that changed.
    expect(db.items.get(id)?.version).toBe(before);
  });

  it("survives a usage blob that will not decrypt", async () => {
    await vault.create("correct horse battery staple");
    await vault.addItem(CONTENT);
    const anyItem = db.items.values().next().value!;
    const { id: deviceId } = await vault.device();
    db.usage.set(`usage:${deviceId}`, {
      id: `usage:${deviceId}`,
      deviceId,
      item: { ...anyItem, plaintext: "not json" } as typeof anyItem,
    });

    // Statistics are not the vault. Losing them must not stop it opening.
    const items = await vault.listItems();
    expect(items).toHaveLength(1);
    expect(items[0]?.usage.useCount).toBe(0);
  });
});

describe("reused passwords", () => {
  it("counts nothing when every password is different", async () => {
    await vault.create("correct horse battery staple");
    await vault.addItem({ ...CONTENT, password: "one" });
    await vault.addItem({ ...CONTENT, password: "two" });

    expect((await vault.listItems()).map((item) => asLogin(item).reusedBy)).toEqual([0, 0]);
  });

  it("counts the others sharing a password", async () => {
    await vault.create("correct horse battery staple");
    await vault.addItem({ ...CONTENT, name: "a", password: "shared" });
    await vault.addItem({ ...CONTENT, name: "b", password: "shared" });
    await vault.addItem({ ...CONTENT, name: "c", password: "shared" });

    // Each sees the other two.
    expect((await vault.listItems()).map((item) => asLogin(item).reusedBy)).toEqual([2, 2, 2]);
  });

  it("ignores a password sitting in the trash", async () => {
    await vault.create("correct horse battery staple");
    await vault.addItem({ ...CONTENT, name: "live", password: "shared" });
    const trashed = await vault.addItem({ ...CONTENT, name: "gone", password: "shared" });
    await vault.trashItem(trashed);

    // A password you have deleted is not one you are relying on.
    const live = (await vault.listItems()).find((item) => !item.deleted);
    expect(asLogin(live).reusedBy).toBe(0);
  });

  it("flags reuse even when the password is strong", async () => {
    await vault.create("correct horse battery staple");
    await vault.addItem({ ...CONTENT, name: "a", password: "a-very-long-strong-one" });
    await vault.addItem({ ...CONTENT, name: "b", password: "a-very-long-strong-one" });

    const items = await vault.listItems();
    // Strength scoring cannot see this, which is the whole point.
    expect(asLogin(items[0]).strength.level).toBe("excellent");
    expect(asLogin(items[0]).reusedBy).toBe(1);
  });
});

describe("audit trail", () => {
  it("names the device that did something", async () => {
    await vault.create("correct horse battery staple");
    const id = await vault.addItem(CONTENT);
    await vault.recordUse(id, "copied");

    const me = await vault.device();
    const [item] = await vault.listItems();
    expect(item?.usage.devices).toHaveLength(1);
    expect(item?.usage.devices[0]?.deviceId).toBe(me.id);
    expect(item?.usage.devices[0]?.count).toBe(1);
  });

  it("counts each kind of use separately", async () => {
    await vault.create("correct horse battery staple");
    const id = await vault.addItem({ ...CONTENT, url: "https://example.com" });

    await vault.recordUse(id, "copied");
    await vault.recordUse(id, "copied");
    await vault.recordUse(id, "revealed");
    await vault.credentialForFill(id, "https://example.com");

    const [item] = await vault.listItems();
    expect(item?.usage.counts).toMatchObject({ copied: 2, revealed: 1, autofilled: 1 });
    expect(item?.usage.useCount).toBe(4);
    expect(item?.usage.lastAutofilledAt).toBeGreaterThan(0);
  });

  it("keeps a history, newest first", async () => {
    await vault.create("correct horse battery staple");
    const id = await vault.addItem(CONTENT);
    await vault.recordUse(id, "copied");
    await vault.recordUse(id, "revealed");

    const { events, devices } = await vault.auditLog();
    expect(events[0]?.kind).toBe("revealed");
    expect(events[1]?.kind).toBe("copied");
    expect(devices).toHaveLength(1);
  });

  it("bounds the history rather than growing without limit", async () => {
    await vault.create("correct horse battery staple");
    const id = await vault.addItem(CONTENT);
    for (let i = 0; i < 260; i += 1) await vault.recordUse(id, "copied");

    // An unbounded log is a growing liability as much as a growing file.
    const { events } = await vault.auditLog();
    expect(events).toHaveLength(200);

    // The counter is not bounded, only the event list.
    expect((await vault.listItems())[0]?.usage.counts.copied).toBe(260);
  });

  it("carries a renamed device into the trail", async () => {
    await vault.create("correct horse battery staple");
    const id = await vault.addItem(CONTENT);
    await vault.recordUse(id, "copied");
    await vault.renameDevice("Work laptop");

    const [item] = await vault.listItems();
    expect(item?.usage.devices[0]?.deviceName).toBe("Work laptop");
  });

  it("still lists items when one device's record is unreadable", async () => {
    await vault.create("correct horse battery staple");
    const id = await vault.addItem(CONTENT);
    await vault.recordUse(id, "copied");

    const me = await vault.device();
    const record = db.usage.get(`usage:${me.id}`)!;
    db.usage.set(record.id, {
      ...record,
      item: { ...record.item, plaintext: "not json" } as typeof record.item,
    });

    // Statistics are not the vault.
    const items = await vault.listItems();
    expect(items).toHaveLength(1);
    expect(items[0]?.usage.useCount).toBe(0);
  });
});

describe("quick unlock", () => {
  it("reports locked when no PIN is armed", async () => {
    await vault.create("correct horse battery staple");
    await vault.lock();
    expect(await vault.status()).toBe("locked");
  });

  it("reports quick when a PIN is armed", async () => {
    await vault.create("correct horse battery staple");
    await vault.setPin("1234");
    await vault.lock(false);

    // Locked, but reopenable without the master password.
    expect(await vault.status()).toBe("quick");
  });

  it("reopens with the PIN", async () => {
    await vault.create("correct horse battery staple");
    await vault.addItem(CONTENT);
    await vault.setPin("1234");
    await vault.lock(false);

    await vault.unlockWithPin("1234");
    expect(await vault.status()).toBe("unlocked");
    expect(await vault.listItems()).toHaveLength(1);
  });

  it("forgets the PIN when the user locks deliberately", async () => {
    await vault.create("correct horse battery staple");
    await vault.setPin("1234");

    // "Lock" in the popup means lock, not "ask me for a PIN".
    await vault.lock(true);
    expect(await vault.status()).toBe("locked");
  });

  it("keeps the PIN across an idle lock", async () => {
    await vault.create("correct horse battery staple");
    await vault.setPin("1234");

    // Being asked for a PIN after twenty idle minutes is the point of it.
    await vault.lock(false);
    expect(await vault.status()).toBe("quick");
  });

  it("refuses to arm a PIN while locked", async () => {
    await vault.create("correct horse battery staple");
    await vault.lock();
    await expect(vault.setPin("1234")).rejects.toThrow(/locked/i);
  });
});

describe("auto-lock timing", () => {
  it("defaults to fifteen minutes", async () => {
    expect(await vault.autoLockMinutes()).toBe(15);
  });

  it("remembers a different timeout", async () => {
    await vault.setAutoLockMinutes(60);
    expect(await vault.autoLockMinutes()).toBe(60);
  });

  it("treats zero as never locking", async () => {
    await vault.setAutoLockMinutes(0);
    expect(await vault.autoLockMinutes()).toBe(0);

    // No alarm is scheduled, so nothing will lock it.
    vi.mocked(browser.alarms.create).mockClear();
    await vault.extendAutoLock();
    expect(browser.alarms.create).not.toHaveBeenCalled();
  });

  it("refuses a negative timeout rather than storing one", async () => {
    await vault.setAutoLockMinutes(-5);
    expect(await vault.autoLockMinutes()).toBe(0);
  });
});

describe("strength", () => {
  it("rides along on every listed item", async () => {
    await withOneItem();
    const items = await vault.listItems();
    expect(asLogin(items[0]).strength.level).toBe("weak");
    expect(asLogin(items[0]).strength.bits).toBe(CONTENT.password.length * 6);
  });

  it("is scored from the item's own password, not something else", async () => {
    const id = await withOneItem();
    await vault.updateItem(id, { ...CONTENT, password: "a-much-longer-password" });

    const items = await vault.listItems();
    expect(asLogin(items[0]).strength.level).toBe("excellent");
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

describe("changing the master password", () => {
  const NEXT = "a completely different long phrase";

  it("re-wraps the vault key rather than re-encrypting anything", async () => {
    const id = await withOneItem();
    const written = encryptedHeaders.length;

    await vault.changeMasterPassword("correct horse battery staple", NEXT);

    // The whole reason the vault key is indirected: a rotation touches one
    // record, not every item. If this ever starts failing, a password change
    // has quietly become an O(vault) rewrite — and a resync of everything.
    expect(encryptedHeaders.length).toBe(written);
    expect(storedContent(id)).toMatchObject({ username: CONTENT.username });
  });

  it("derives the new wrapping key from a fresh salt", async () => {
    await vault.create("correct horse battery staple");
    cryptoFake.generateSalt.mockReturnValueOnce("rotated-salt");

    await vault.changeMasterPassword("correct horse battery staple", NEXT);

    expect(db.vault?.saltB64).toBe("rotated-salt");
    // Reusing the old salt would leave the two wrappings related for no
    // reason; the new password must be stretched under a salt of its own.
    expect(cryptoFake.deriveMasterKey).toHaveBeenLastCalledWith(
      NEXT,
      "rotated-salt",
      65536,
      3,
      4,
    );
  });

  it("adopts today's Argon2 costs", async () => {
    await vault.create("correct horse battery staple");
    // A vault created years ago should not stay on the costs of that year.
    cryptoFake.recommendedParams.mockReturnValueOnce({
      memory_kib: 131072,
      iterations: 4,
      parallelism: 4,
    });

    await vault.changeMasterPassword("correct horse battery staple", NEXT);

    expect(db.vault).toMatchObject({ memoryKib: 131072, iterations: 4, parallelism: 4 });
  });

  it("leaves the record untouched when the current password is wrong", async () => {
    await vault.create("correct horse battery staple");
    const before = db.vault;
    cryptoFake.unwrapVaultKey.mockImplementation(() => {
      throw new Error("decryption failed");
    });

    await expect(vault.changeMasterPassword("wrong", NEXT)).rejects.toThrow(/decryption failed/);

    // A half-done rotation would be a vault nobody can open.
    expect(db.vault).toBe(before);
  });

  it("refuses an empty new password", async () => {
    await vault.create("correct horse battery staple");
    await expect(
      vault.changeMasterPassword("correct horse battery staple", ""),
    ).rejects.toThrow(/new master password/i);
  });

  it("frees the keys it derived", async () => {
    await vault.create("correct horse battery staple");
    freed.length = 0;

    await vault.changeMasterPassword("correct horse battery staple", NEXT);

    // Two master keys — the old one to open with, the new one to wrap with —
    // and the vault key handle this opened for itself. None is garbage
    // collected; an unfreed handle leaves key material in wasm memory.
    expect(freed.filter((name) => name === "master")).toHaveLength(2);
    expect(freed).toContain("vault");
  });
});

describe("item types", () => {
  const NOTE = {
    type: "note",
    name: "Recovery codes",
    notes: "1111-2222\n3333-4444",
  } satisfies NoteContent;

  it("carries the type in the header, never in the ciphertext", async () => {
    await vault.create("correct horse battery staple");
    const id = await vault.addItem(NOTE);

    // The header field is bound into the authentication tag; the content is
    // not. Keeping the type in only the authenticated half is what stops a
    // server relabelling a secure note as a login.
    expect(lastHeader().item_type).toBe("note");
    expect(storedContent(id)).not.toHaveProperty("type");
  });

  it("round-trips a secure note", async () => {
    await vault.create("correct horse battery staple");
    await vault.addItem(NOTE);

    const [item] = await vault.listItems();
    expect(item).toMatchObject({ type: "note", name: NOTE.name, notes: NOTE.notes });
  });

  it("refuses to change what an item is", async () => {
    await vault.create("correct horse battery staple");
    const id = await vault.addItem(NOTE);

    // The type is in the tag of every version this item has ever had. A
    // rewrite under a different one would leave header and content disagreeing
    // about what the record is.
    await expect(vault.updateItem(id, CONTENT)).rejects.toThrow(/cannot change its type/i);
  });

  it("never offers a note to a page", async () => {
    await vault.create("correct horse battery staple");
    await vault.addItem({ ...NOTE, notes: "https://example.com is in here" });
    await vault.addItem({ ...CONTENT, url: "https://example.com" });

    // Only logins belong to a site. A note that merely mentions one is not a
    // credential for it.
    const { items } = await vault.itemsForUrl("https://example.com");
    expect(items).toHaveLength(1);
    expect(items.every((item) => item.type === "login")).toBe(true);
  });

  it("does not count notes towards password reuse", async () => {
    await vault.create("correct horse battery staple");
    await vault.addItem({ ...CONTENT, name: "a", password: "shared" });
    await vault.addItem({ ...CONTENT, name: "b", password: "shared" });
    await vault.addItem({ ...NOTE, notes: "shared" });

    const logins = (await vault.listItems()).filter((item) => item.type === "login");
    expect(logins.map((item) => asLogin(item).reusedBy)).toEqual([1, 1]);
  });

  it("keeps an item type it does not understand", async () => {
    await vault.create("correct horse battery staple");
    // As a newer client would have written it, arriving here over sync.
    db.items.set("from-the-future", {
      id: "from-the-future",
      // Deferred by PROJECT.md, so it stays unknown to this build for as long
      // as this test is worth having.
      item_type: "passkey",
      format: 1,
      ciphertext: [],
      nonce: [],
      version: 1,
      updated_at: Date.now(),
      deleted: false,
      plaintext: JSON.stringify({ name: "Front door" }),
    });

    // Nothing sensible to render, so it is not listed — but the record stays
    // in the store and keeps syncing. Dropping it would delete another
    // device's data.
    expect(await vault.listItems()).toHaveLength(0);
    expect(db.items.has("from-the-future")).toBe(true);
  });
});

describe("cards", () => {
  const CARD = {
    type: "card",
    name: "Everyday",
    cardholder: "A LOVELACE",
    // The scheme's own published test number — documentation, not a card.
    number: "4242 4242 4242 4242",
    expiryMonth: "04",
    expiryYear: "2030",
    securityCode: "737",
    notes: "",
  } satisfies CardContent;

  function asCard(item: DecryptedItem | undefined): DecryptedCard {
    if (!item) throw new Error("no item");
    if (item.type !== "card") throw new Error(`expected a card, got ${item.type}`);
    return item;
  }

  it("normalizes the number once, on the way in", async () => {
    await vault.create("correct horse battery staple");
    const id = await vault.addItem(CARD);

    // Stored as digits so the last four, and later a fill into a checkout
    // form, work from one representation rather than re-deriving it.
    expect(storedContent(id)).toMatchObject({ number: "4242424242424242" });
  });

  it("derives the scheme and the last four rather than storing them", async () => {
    await vault.create("correct horse battery staple");
    const id = await vault.addItem(CARD);

    const card = asCard((await vault.listItems())[0]);
    expect(card.brand).toBe("Visa");
    expect(card.last4).toBe("4242");
    // A stored brand would be a copy that could disagree with the number it
    // describes, and a migration the day the scheme list changes.
    expect(storedContent(id)).not.toHaveProperty("brand");
    expect(storedContent(id)).not.toHaveProperty("last4");
  });

  it("keeps a card it cannot name", async () => {
    await vault.create("correct horse battery staple");
    await vault.addItem({ ...CARD, number: "9999888877776666" });

    // A gift card, a store card, a scheme newer than the list. Storing it is
    // not conditional on recognising it.
    const card = asCard((await vault.listItems())[0]);
    expect(card.brand).toBeNull();
    expect(card.last4).toBe("6666");
  });

  it("carries the PIN only when there is one", async () => {
    await vault.create("correct horse battery staple");
    const bare = await vault.addItem(CARD);
    const withPin = await vault.addItem({ ...CARD, name: "Other", pin: "4021" });

    expect(storedContent(bare)).not.toHaveProperty("pin");
    expect(storedContent(withPin)).toMatchObject({ pin: "4021" });
  });

  it("never offers a card to a page", async () => {
    await vault.create("correct horse battery staple");
    await vault.addItem(CARD);
    await vault.addItem({ ...CONTENT, url: "https://example.com" });

    // Autofill for cards is its own decision, made per form. Until then a
    // card is not a credential for any site.
    const { items } = await vault.itemsForUrl("https://example.com");
    expect(items).toHaveLength(1);
    expect(items.every((item) => item.type === "login")).toBe(true);
  });

  it("does not count a security code towards password reuse", async () => {
    await vault.create("correct horse battery staple");
    await vault.addItem({ ...CONTENT, password: "737" });
    await vault.addItem(CARD);

    // Only logins have a password to share with another login.
    expect(asLogin((await vault.listItems()).find((item) => item.type === "login")).reusedBy).toBe(
      0,
    );
  });
});

describe("identities", () => {
  // Entirely invented, like every other fixture here (CLAUDE.md §2.6).
  const IDENTITY = {
    type: "identity",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.test",
    phone: "+44 20 7946 0000",
    street: "12 Analytical Way",
    city: "London",
    state: "Greater London",
    postalCode: "N1 9AA",
    country: "United Kingdom",
    notes: "",
  } satisfies IdentityContent;

  it("round-trips every field it was given", async () => {
    await vault.create("correct horse battery staple");
    await vault.addItem(IDENTITY);

    expect((await vault.listItems())[0]).toMatchObject(IDENTITY);
  });

  it("omits the optional fields rather than storing them empty", async () => {
    await vault.create("correct horse battery staple");
    const id = await vault.addItem(IDENTITY);

    for (const field of ["street2", "company", "dateOfBirth", "nationalId"]) {
      expect(storedContent(id)).not.toHaveProperty(field);
    }
  });

  it("keeps a national ID when there is one", async () => {
    await vault.create("correct horse battery staple");
    await vault.addItem({ ...IDENTITY, nationalId: "X1234567" });

    const [item] = await vault.listItems();
    expect(item).toMatchObject({ type: "identity", nationalId: "X1234567" });
  });

  it("never offers an identity to a page", async () => {
    await vault.create("correct horse battery staple");
    await vault.addItem(IDENTITY);
    await vault.addItem({ ...CONTENT, url: "https://example.com" });

    const { items } = await vault.itemsForUrl("https://example.com");
    expect(items).toHaveLength(1);
    expect(items.every((item) => item.type === "login")).toBe(true);
  });

  it("sorts among everything else by what it is called", async () => {
    await vault.create("correct horse battery staple");
    await vault.addItem({ ...CONTENT, name: "Zebra" });
    await vault.addItem({ ...IDENTITY, name: "Ada at home" });

    // One list, whatever the types: an item is found by its name, not by
    // first choosing a category.
    expect((await vault.listItems()).map((item) => item.name)).toEqual(["Ada at home", "Zebra"]);
  });
});

describe("authenticator accounts", () => {
  // RFC 6238's own published seed in base32 (CLAUDE.md §2.6).
  const TOTP = {
    type: "totp",
    issuer: "Example",
    account: "ada@example.test",
    secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    notes: "",
  } satisfies TotpContent;

  it("stores the shape of the codes, not just the secret", async () => {
    await vault.create("correct horse battery staple");
    const id = await vault.addItem({ ...TOTP, algorithm: "SHA256", digits: 8, period: 60 });

    // A record carrying only a secret is one whose codes change the day a
    // default does.
    expect(storedContent(id)).toMatchObject({
      algorithm: "SHA256",
      digits: 8,
      period: 60,
    });
  });

  it("computes the code where the item is decrypted", async () => {
    await vault.create("correct horse battery staple");
    await vault.addItem({ ...TOTP, digits: 8 });

    const [item] = await vault.listItems();
    // Derived, never stored: it is only true for the next few seconds.
    expect(item).toMatchObject({ type: "totp", code: "11111111" });
    expect(storedContent((await vault.listItems())[0]?.id ?? "")).not.toHaveProperty("code");
  });

  it("answers for one account without decrypting the vault", async () => {
    await vault.create("correct horse battery staple");
    const id = await vault.addItem(TOTP);
    await vault.addItem(CONTENT);

    cryptoFake.decryptItem.mockClear();
    const facts = await vault.totpCodeFor(id);

    expect(facts.code).toBe("111111");
    // One item read, not the whole list: this runs once a second while the
    // popup is open.
    expect(cryptoFake.decryptItem).toHaveBeenCalledTimes(1);
  });

  it("refuses to compute a code for something that is not one", async () => {
    await vault.create("correct horse battery staple");
    const id = await vault.addItem(CONTENT);
    await expect(vault.totpCodeFor(id)).rejects.toThrow(/no such authenticator/i);
  });

  it("says nothing is showing rather than emptying the list", async () => {
    await vault.create("correct horse battery staple");
    await vault.addItem({ ...TOTP, secret: "bad-secret" });
    await vault.addItem(CONTENT);

    // One mistyped secret must not take the rest of the vault with it.
    const items = await vault.listItems();
    expect(items).toHaveLength(2);
    expect(items.find((item) => item.type === "totp")).toMatchObject({ code: "" });
  });

  it("falls back to the RFC defaults for a record that lacks them", async () => {
    await vault.create("correct horse battery staple");
    db.items.set("older", {
      id: "older",
      item_type: "totp",
      format: 1,
      ciphertext: [],
      nonce: [],
      version: 1,
      updated_at: Date.now(),
      deleted: false,
      plaintext: JSON.stringify({ issuer: "Old", account: "a", secret: "GEZDGNBVGY3TQOJQ" }),
    });

    expect((await vault.listItems())[0]).toMatchObject({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    });
  });

  it("never offers an authenticator account to a page", async () => {
    await vault.create("correct horse battery staple");
    await vault.addItem(TOTP);
    await vault.addItem({ ...CONTENT, url: "https://example.com" });

    const { items } = await vault.itemsForUrl("https://example.com");
    expect(items).toHaveLength(1);
    expect(items.every((item) => item.type === "login")).toBe(true);
  });
});

describe("what the autofill picker is told", () => {
  const CARD = {
    type: "card",
    name: "Everyday",
    cardholder: "A LOVELACE",
    number: "4242424242424242",
    expiryMonth: "04",
    expiryYear: "2030",
    securityCode: "737",
    notes: "",
  } satisfies CardContent;

  const IDENTITY = {
    type: "identity",
    name: "Home",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.test",
    phone: "+44 20 7946 0000",
    street: "12 Analytical Way",
    city: "London",
    state: "Greater London",
    postalCode: "N1 9AA",
    country: "United Kingdom",
    notes: "",
  } satisfies IdentityContent;

  async function stocked(): Promise<void> {
    await vault.create("correct horse battery staple");
    await vault.addItem({ ...CONTENT, url: "https://example.com" });
    await vault.addItem({ ...CONTENT, name: "Elsewhere", url: "https://other.test" });
    await vault.addItem(CARD);
    await vault.addItem(IDENTITY);
    await vault.addItem({ type: "note", name: "Recovery codes", notes: "1111-2222" });
  }

  it("sends names, never values", async () => {
    await stocked();

    const { suggestions } = await vault.fillSuggestions(
      ["login", "card", "identity"],
      "https://example.com",
    );

    // The content script runs inside the page. It is handed enough to draw a
    // list and nothing that would be worth stealing from it. Check only the
    // label/detail text a page would see — the item's own random id isn't a
    // secret, but as an arbitrary string it can coincidentally contain a
    // short numeric value like a CVV.
    const payload = JSON.stringify(
      suggestions.map(({ label, detail }) => ({ label, detail })),
    );
    expect(payload).not.toContain(CONTENT.password);
    expect(payload).not.toContain(CARD.number);
    expect(payload).not.toContain(CARD.securityCode);
    expect(suggestions.every((entry) => Object.keys(entry).length === 4)).toBe(true);
  });

  it("offers a login only to its own site", async () => {
    await stocked();

    const here = await vault.fillSuggestions(["login"], "https://example.com");
    expect(here.suggestions.map((entry) => entry.label)).toEqual([CONTENT.username]);
  });

  it("offers a card anywhere, because a card belongs to no site", async () => {
    await stocked();

    const anywhere = await vault.fillSuggestions(["card"], "https://somewhere-else.test");
    expect(anywhere.suggestions.map((entry) => entry.label)).toEqual(["Everyday"]);
  });

  it("never offers a note", async () => {
    await stocked();

    // There is no field on any page that a secure note is the answer to.
    const asked = await vault.fillSuggestions(
      ["login", "card", "identity", "note", "totp"],
      "https://example.com",
    );
    expect(asked.suggestions.some((entry) => entry.type === "note")).toBe(false);
  });

  it("offers nothing at all while locked", async () => {
    await stocked();
    await vault.lock();

    // A decline, not an error: the page did nothing wrong.
    expect(await vault.fillSuggestions(["card"], "https://example.com")).toEqual({
      site: null,
      suggestions: [],
    });
  });
});

describe("filling a card or an identity", () => {
  const CARD = {
    type: "card",
    cardholder: "A LOVELACE",
    number: "4242424242424242",
    expiryMonth: "04",
    expiryYear: "2030",
    securityCode: "737",
    notes: "",
  } satisfies CardContent;

  it("names each value the way a form names it", async () => {
    await vault.create("correct horse battery staple");
    const id = await vault.addItem(CARD);

    expect(await vault.fillValues(id, "https://shop.test")).toEqual({
      "cc-name": "A LOVELACE",
      "cc-number": "4242424242424242",
      "cc-exp-month": "04",
      "cc-exp-year": "2030",
      "cc-csc": "737",
    });
  });

  it("leaves out what the item does not have", async () => {
    await vault.create("correct horse battery staple");
    const id = await vault.addItem({
      type: "identity",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.test",
      phone: "",
      street: "12 Analytical Way",
      city: "London",
      state: "",
      postalCode: "N1 9AA",
      country: "United Kingdom",
      notes: "",
    });

    // A blank field must not blank the page's box.
    const values = await vault.fillValues(id, "https://shop.test");
    expect(values).not.toHaveProperty("tel");
    expect(values).not.toHaveProperty("address-level1");
    expect(values["address-line1"]).toBe("12 Analytical Way");
  });

  it("still refuses a login belonging to another site", async () => {
    await vault.create("correct horse battery staple");
    const id = await vault.addItem({ ...CONTENT, url: "https://example.com" });

    // The site scoping a password has always had is not loosened by having
    // grown a second way to fill.
    await expect(vault.fillValues(id, "https://phishing.test")).rejects.toThrow(/no such item/i);
    await expect(vault.fillValues(id, "https://example.com")).resolves.toMatchObject({
      password: CONTENT.password,
    });
  });

  it("counts the fill", async () => {
    await vault.create("correct horse battery staple");
    const id = await vault.addItem(CARD);

    await vault.fillValues(id, "https://shop.test");

    const [item] = await vault.listItems();
    expect(item?.usage.counts.autofilled).toBe(1);
  });

  it("refuses an item there is nothing to fill from", async () => {
    await vault.create("correct horse battery staple");
    const id = await vault.addItem({ type: "note", name: "Recovery codes", notes: "1111" });

    await expect(vault.fillValues(id, "https://shop.test")).rejects.toThrow(/nothing on this page/i);
  });
});
