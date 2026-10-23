// A login typed into a page while the vault is locked.
//
// Declining silently (what a locked vault used to do) loses it: a sign-in form
// usually redirects, so by the time the user has unlocked, the page, its URL
// and the form are gone. So the capture is held here, in the background, and
// the decision is made afterwards.
//
// What this holds is a plaintext password, which nothing else the extension
// keeps while locked is. That is limited as far as it can be:
//   - in session storage only — memory-backed, never written to disk, gone when
//     the browser closes;
//   - one capture at a time (a new one replaces the old);
//   - for two minutes at most, enforced on every read and by an alarm;
//   - wiped the moment the user decides, Save or Not now, whatever the time;
//   - never sent anywhere except into the vault's own encryption path — the
//     popup and the page banner are told the site and the username, nothing
//     else.
// The site is the one the browser reported at the moment of the submit, not
// wherever the tab has since been redirected to.

import type { PendingSaveInfo, Response } from "../lib/messages.js";
import { siteScope } from "../lib/site.js";
import { itemsForUrl, saveSubmitted, shouldOfferToSave, status } from "./vault.js";

export const PENDING_SAVE_ALARM = "vaultiq-pending-save";
export const PENDING_SAVE_TTL_MS = 2 * 60 * 1000;

const KEY = "pendingSave";

interface Held {
  username: string;
  password: string;
  /** The page's URL when the form was submitted, as the browser reported it. */
  url: string;
  site: string;
  /** The tab it came from; only that tab is shown the banner on its next page. */
  tabId: number | undefined;
  at: number;
}

async function read(): Promise<Held | undefined> {
  const stored = await browser.storage.session.get(KEY);
  const held = stored[KEY] as Held | undefined;
  if (!held) return undefined;
  if (Date.now() - held.at >= PENDING_SAVE_TTL_MS) {
    await clearPendingSave();
    return undefined;
  }
  return held;
}

export async function clearPendingSave(): Promise<void> {
  await browser.storage.session.remove(KEY);
  await browser.alarms.clear(PENDING_SAVE_ALARM);
}

export async function pendingSaveExists(): Promise<boolean> {
  return (await read()) !== undefined;
}

/**
 * Answers a submitted login: the ordinary decision while unlocked, and while
 * locked, holds it and says so.
 */
export async function offerOrHoldSave(
  submitted: { username: string; password: string },
  url: string | undefined,
  tabId: number | undefined,
): Promise<Extract<Response, { kind: "shouldOfferToSave" }>> {
  const state = await status();
  if (state === "unlocked") {
    const decision = await shouldOfferToSave(submitted, url);
    return decision.offer
      ? { ok: true, kind: "shouldOfferToSave", ...decision }
      : { ok: true, kind: "shouldOfferToSave", offer: false };
  }

  const site = url ? siteScope(url) : null;
  // No vault yet, or nothing to save, or no site to say it belongs to: there is
  // nothing to hold and nobody to ask.
  if (state === "empty" || !submitted.password || !url || !site) {
    return { ok: true, kind: "shouldOfferToSave", offer: false };
  }

  await browser.storage.session.set({
    [KEY]: { ...submitted, url, site, tabId, at: Date.now() } satisfies Held,
  });
  browser.alarms.create(PENDING_SAVE_ALARM, { delayInMinutes: PENDING_SAVE_TTL_MS / 60_000 });
  return { ok: true, kind: "shouldOfferToSave", offer: true, site, existingId: null, locked: true };
}

/**
 * What is waiting, for the popup or for a page banner.
 *
 * `tabId` is set for a request from a page: only the tab the capture came from
 * is shown it, so an unrelated tab loading never prompts. The popup passes
 * none.
 */
export async function pendingSaveInfo(tabId?: number): Promise<PendingSaveInfo | null> {
  const held = await read();
  if (!held) return null;
  if (tabId !== undefined && held.tabId !== tabId) return null;

  const locked = (await status()) !== "unlocked";
  let update = false;
  if (!locked) {
    const { items } = await itemsForUrl(held.url);
    update = items.some((item) => item.username === held.username);
  }
  return { site: held.site, username: held.username, locked, update };
}

/**
 * The user's decision. Either answer wipes the capture, at once.
 *
 * Saving needs the vault open: asking to save while still locked changes
 * nothing and keeps the capture, since that was not a decision. Everything
 * after that point — saved, already stored, or failed — wipes it, so a
 * password never outlives the choice that was made about it.
 */
export async function resolvePendingSave(answer: {
  save: boolean;
  name?: string;
  notes?: string;
}): Promise<{ saved: boolean }> {
  const held = await read();
  if (!held) return { saved: false };

  if (!answer.save) {
    await clearPendingSave();
    return { saved: false };
  }

  if ((await status()) !== "unlocked") throw new Error("Unlock the vault to save this login.");

  try {
    // The decision is made again here, against the vault as it is now: it may
    // already hold this exact login, or one to update.
    const decision = await shouldOfferToSave(held, held.url);
    if (!decision.offer) return { saved: false };
    await saveSubmitted(
      {
        username: held.username,
        password: held.password,
        ...(answer.name ? { name: answer.name } : {}),
        ...(answer.notes ? { notes: answer.notes } : {}),
      },
      held.url,
    );
    return { saved: true };
  } finally {
    await clearPendingSave();
  }
}
