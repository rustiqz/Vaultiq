// A login typed while the vault is locked is held, not dropped — and held
// narrowly. These cover both halves: that it survives to be saved, and that it
// does not outlive the user's decision, a timeout, or the wrong tab.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionStore } from "../test/setup.js";
import { cryptoFake, dbFake, resetFakes } from "../test/fakes.js";

vi.mock("../lib/crypto.js", () => cryptoFake);
vi.mock("../lib/vault-db.js", () => dbFake);

const vault = await import("./vault.js");
const held = await import("./pendingSave.js");

// Test-only values.
const PASSWORD = "correct horse battery staple";
const URL = "https://login.example.test/signin";
const TYPED = { username: "ada@example.test", password: "typed-password-1" };

beforeEach(resetFakes);
afterEach(() => vi.useRealTimers());

async function lockedVault(): Promise<void> {
  await vault.create(PASSWORD);
  await vault.lock();
}

describe("holding a login while locked", () => {
  it("holds it and says the vault must be unlocked first", async () => {
    await lockedVault();

    const answer = await held.offerOrHoldSave(TYPED, URL, 7);

    expect(answer).toMatchObject({ offer: true, locked: true, site: "example.test", existingId: null });
    expect(await held.pendingSaveExists()).toBe(true);
  });

  it("never puts the password in an answer or in what the popup is told", async () => {
    await lockedVault();
    const answer = await held.offerOrHoldSave(TYPED, URL, 7);
    const info = await held.pendingSaveInfo();

    expect(JSON.stringify(answer)).not.toContain(TYPED.password);
    expect(JSON.stringify(info)).not.toContain(TYPED.password);
    expect(info).toEqual({ site: "example.test", username: TYPED.username, locked: true, update: false });
  });

  it("holds nothing when there is no vault, no password or no site", async () => {
    expect(await held.offerOrHoldSave(TYPED, URL, 7)).toMatchObject({ offer: false });

    await lockedVault();
    expect(await held.offerOrHoldSave({ ...TYPED, password: "" }, URL, 7)).toMatchObject({ offer: false });
    expect(await held.offerOrHoldSave(TYPED, undefined, 7)).toMatchObject({ offer: false });
    expect(await held.pendingSaveExists()).toBe(false);
  });

  it("keeps one capture: a newer one replaces the older", async () => {
    await lockedVault();
    await held.offerOrHoldSave(TYPED, URL, 7);
    await held.offerOrHoldSave({ username: "grace@example.test", password: "typed-password-2" }, URL, 7);

    expect((await held.pendingSaveInfo())?.username).toBe("grace@example.test");
  });

  it("holds it while unlocked too, so a redirect cannot lose the prompt", async () => {
    await vault.create(PASSWORD);

    const answer = await held.offerOrHoldSave(TYPED, URL, 7);

    expect(answer).toMatchObject({ offer: true, existingId: null, site: "example.test" });
    expect(answer).not.toHaveProperty("locked");
    expect(JSON.stringify(answer)).not.toContain(TYPED.password);
    expect(await held.pendingSaveInfo(7)).toEqual({
      site: "example.test",
      username: TYPED.username,
      locked: false,
      update: false,
    });
  });

  it("holds nothing unlocked when the vault already has this exact login", async () => {
    await vault.create(PASSWORD);
    await vault.addItem({
      type: "login",
      name: "Example",
      username: TYPED.username,
      password: TYPED.password,
      url: URL,
      notes: "",
    });

    expect(await held.offerOrHoldSave(TYPED, URL, 7)).toMatchObject({ offer: false });
    expect(await held.pendingSaveExists()).toBe(false);
  });

  it("saves from the next page after a redirect, then wipes", async () => {
    await vault.create(PASSWORD);
    await held.offerOrHoldSave(TYPED, URL, 7);

    // The form's page is gone; the page it redirected to asks, in the same tab.
    expect(await held.pendingSaveInfo(7)).not.toBeNull();
    expect(await held.resolvePendingSave({ save: true })).toEqual({ saved: true });

    expect(await held.pendingSaveExists()).toBe(false);
    expect((await vault.itemsForUrl(URL)).items.map((item) => item.username)).toEqual([TYPED.username]);
  });
});

describe("how long it is held", () => {
  it("is gone after two minutes, and the password is gone from storage", async () => {
    vi.useFakeTimers();
    await lockedVault();
    await held.offerOrHoldSave(TYPED, URL, 7);

    vi.advanceTimersByTime(held.PENDING_SAVE_TTL_MS - 1);
    expect(await held.pendingSaveExists()).toBe(true);

    vi.advanceTimersByTime(2);
    expect(await held.pendingSaveInfo()).toBeNull();
    expect(JSON.stringify([...sessionStore.entries()])).not.toContain(TYPED.password);
  });

  it("schedules an alarm so it is wiped even if nobody asks again", async () => {
    await lockedVault();
    await held.offerOrHoldSave(TYPED, URL, 7);

    expect(browser.alarms.create).toHaveBeenCalledWith(held.PENDING_SAVE_ALARM, { delayInMinutes: 2 });
  });
});

describe("who is told about it", () => {
  it("shows a page only if it is in the tab the login came from", async () => {
    await lockedVault();
    await held.offerOrHoldSave(TYPED, URL, 7);

    expect(await held.pendingSaveInfo(7)).not.toBeNull();
    expect(await held.pendingSaveInfo(8)).toBeNull();
    // The popup has no tab and sees it.
    expect(await held.pendingSaveInfo()).not.toBeNull();
  });
});

describe("deciding", () => {
  it("dismissing wipes it, even while still locked", async () => {
    await lockedVault();
    await held.offerOrHoldSave(TYPED, URL, 7);

    expect(await held.resolvePendingSave({ save: false })).toEqual({ saved: false });

    expect(await held.pendingSaveExists()).toBe(false);
    expect(JSON.stringify([...sessionStore.entries()])).not.toContain(TYPED.password);
  });

  it("asking to save while locked is not a decision: it refuses and keeps the capture", async () => {
    await lockedVault();
    await held.offerOrHoldSave(TYPED, URL, 7);

    await expect(held.resolvePendingSave({ save: true })).rejects.toThrow(/unlock/i);

    expect(await held.pendingSaveExists()).toBe(true);
  });

  it("saves after unlock under the site the form was on, then wipes", async () => {
    await lockedVault();
    await held.offerOrHoldSave(TYPED, URL, 7);
    await vault.unlock(PASSWORD);

    expect(await held.resolvePendingSave({ save: true, name: "Work" })).toEqual({ saved: true });

    const items = await vault.listItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "login", name: "Work", username: TYPED.username, url: URL });
    expect(await held.pendingSaveExists()).toBe(false);
  });

  it("updates the existing login when the same username has a new password", async () => {
    await vault.create(PASSWORD);
    await vault.addItem({ type: "login", username: TYPED.username, password: "old-password", url: URL, notes: "" });
    await vault.lock();
    await held.offerOrHoldSave(TYPED, URL, 7);
    await vault.unlock(PASSWORD);

    expect(await held.pendingSaveInfo()).toMatchObject({ locked: false, update: true });
    await held.resolvePendingSave({ save: true });

    const items = await vault.listItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ password: TYPED.password });
  });

  it("saves nothing, and still wipes, when the vault already holds this exact login", async () => {
    await vault.create(PASSWORD);
    await vault.addItem({ type: "login", ...TYPED, url: URL, notes: "" });
    await vault.lock();
    await held.offerOrHoldSave(TYPED, URL, 7);
    await vault.unlock(PASSWORD);

    expect(await held.resolvePendingSave({ save: true })).toEqual({ saved: false });

    expect(await vault.listItems()).toHaveLength(1);
    expect(await held.pendingSaveExists()).toBe(false);
  });

  it("wipes even when saving fails", async () => {
    await lockedVault();
    await held.offerOrHoldSave(TYPED, URL, 7);
    await vault.unlock(PASSWORD);
    cryptoFake.encryptItem.mockImplementationOnce(() => {
      throw new Error("boom");
    });

    await expect(held.resolvePendingSave({ save: true })).rejects.toThrow("boom");

    expect(await held.pendingSaveExists()).toBe(false);
  });

  it("does nothing when nothing is waiting", async () => {
    await vault.create(PASSWORD);
    expect(await held.resolvePendingSave({ save: true })).toEqual({ saved: false });
  });
});
