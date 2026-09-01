// Browser wiring for the background context, and nothing else.
//
// Every operation lives in `vault.ts`, which knows nothing about messaging or
// alarms. Keeping the two apart is what lets the vault's behaviour be tested
// without a browser — and it keeps the rule visible: the popup sends a
// request, this file dispatches it, and no key ever crosses back.

import {
  AUTO_LOCK_ALARM,
  addItem,
  assertSessionStorage,
  create,
  extendAutoLock,
  listItems,
  loadCrypto,
  activeTabUrl,
  checkStrength,
  credentialForFill,
  saveSubmitted,
  shouldOfferToSave,
  auditLog,
  device,
  itemsForUrl,
  recordUse,
  renameDevice,
  newPassword,
  lock,
  purgeItem,
  restoreItem,
  status,
  trashItem,
  unlock,
  updateItem,
} from "./vault.js";
import type { Request, Response } from "../lib/messages.js";

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_LOCK_ALARM) void lock();
});

/**
 * The URL to treat as "the current site" for a request.
 *
 * For a content script it is the tab the message came from, as the browser
 * reports it — never anything the page supplied. For the popup, which has no
 * sender tab, it is the active tab. Either way the page does not get to name
 * its own site.
 */
async function requestOrigin(sender: browser.runtime.MessageSender): Promise<string | undefined> {
  return sender.tab?.url ?? (await activeTabUrl());
}

async function handle(
  request: Request,
  sender: browser.runtime.MessageSender,
): Promise<Response> {
  await loadCrypto();

  switch (request.kind) {
    case "status":
      return { ok: true, kind: "status", status: await status() };
    case "create":
      await create(request.masterPassword);
      await extendAutoLock();
      return { ok: true, kind: "create" };
    case "unlock":
      await unlock(request.masterPassword);
      await extendAutoLock();
      return { ok: true, kind: "unlock" };
    case "lock":
      await lock();
      return { ok: true, kind: "lock" };
    case "addItem": {
      const id = await addItem(request.content);
      await extendAutoLock();
      return { ok: true, kind: "addItem", id };
    }
    case "updateItem":
      await updateItem(request.id, request.content);
      await extendAutoLock();
      return { ok: true, kind: "updateItem" };
    case "trashItem":
      await trashItem(request.id);
      await extendAutoLock();
      return { ok: true, kind: "trashItem" };
    case "restoreItem":
      await restoreItem(request.id);
      await extendAutoLock();
      return { ok: true, kind: "restoreItem" };
    case "purgeItem":
      await purgeItem(request.id);
      await extendAutoLock();
      return { ok: true, kind: "purgeItem" };
    case "generatePassword":
      return { ok: true, kind: "generatePassword", password: newPassword(request.options) };
    case "checkStrength":
      return { ok: true, kind: "checkStrength", strength: checkStrength(request.password) };
    case "itemsForSite": {
      const { site, items } = await itemsForUrl(await requestOrigin(sender));
      await extendAutoLock();
      return { ok: true, kind: "itemsForSite", site, items };
    }
    case "credentialForFill": {
      const credential = await credentialForFill(request.id, await requestOrigin(sender));
      await extendAutoLock();
      return { ok: true, kind: "credentialForFill", ...credential };
    }
    case "shouldOfferToSave": {
      const decision = await shouldOfferToSave(request, await requestOrigin(sender));
      return decision.offer
        ? { ok: true, kind: "shouldOfferToSave", ...decision }
        : { ok: true, kind: "shouldOfferToSave", offer: false };
    }
    case "saveSubmitted": {
      await saveSubmitted(request, await requestOrigin(sender));
      await extendAutoLock();
      return { ok: true, kind: "saveSubmitted" };
    }
    case "recordUse":
      await recordUse(request.id, request.event ?? "copied");
      await extendAutoLock();
      return { ok: true, kind: "recordUse" };
    case "device":
      return { ok: true, kind: "device", device: await device() };
    case "renameDevice":
      await renameDevice(request.name);
      return { ok: true, kind: "renameDevice" };
    case "auditLog": {
      const log = await auditLog();
      await extendAutoLock();
      return { ok: true, kind: "auditLog", ...log };
    }
    case "listItems": {
      const items = await listItems();
      await extendAutoLock();
      return { ok: true, kind: "listItems", items };
    }
  }
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  assertSessionStorage();
  handle(message as Request, sender)
    .then(sendResponse)
    .catch((error: unknown) => {
      // The message is whatever the crypto core chose to say, which for any
      // decryption failure is one opaque string. Nothing is added here.
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "failed" });
    });
  return true; // keeps the channel open for the async reply
});
