// Browser wiring for the background context, and nothing else.
//
// Every operation lives in `vault.ts`, which knows nothing about messaging or
// alarms. Keeping the two apart is what lets the vault's behaviour be tested
// without a browser — and it keeps the rule visible: the popup sends a
// request, this file dispatches it, and no key ever crosses back.

import {
  AUTO_LOCK_ALARM,
  addItem,
  changeMasterPassword,
  assertSessionStorage,
  create,
  extendAutoLock,
  listItems,
  loadCrypto,
  activeTabUrl,
  checkStrength,
  credentialForFill,
  fillSuggestions,
  fillValues,
  saveSubmitted,
  shouldOfferToSave,
  auditLog,
  autoLockMinutes,
  device,
  forgetPin,
  isLocalOnly,
  itemsForUrl,
  recordUse,
  renameDevice,
  setAutoLockMinutes,
  setLocalOnly,
  setPin,
  unlockWithPin,
  newPassword,
  lock,
  purgeItem,
  restoreItem,
  status,
  trashItem,
  unlock,
  updateItem,
  connectServer,
  disconnectServer,
  enrollWithServer,
  exportBackup,
  newEnrollmentToken,
  remoteDevices,
  restoreBackup,
  revokeRemoteDevice,
  syncNow,
  syncStatus,
  totpCodeFor,
} from "./vault.js";
import type { Request, Response } from "../lib/messages.js";

browser.alarms.onAlarm.addListener((alarm) => {
  // Idle lock leaves the PIN armed: being asked for a PIN after twenty
  // minutes is the point of having one.
  if (alarm.name === AUTO_LOCK_ALARM) void lock(false);
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
    case "exportBackup":
      return { ok: true, kind: "exportBackup", backup: await exportBackup() };
    case "restoreBackup":
      await restoreBackup(request.backup, request.masterPassword);
      await extendAutoLock();
      return { ok: true, kind: "restoreBackup" };
    case "unlock":
      await unlock(request.masterPassword);
      await extendAutoLock();
      return { ok: true, kind: "unlock" };
    case "changeMasterPassword":
      await changeMasterPassword(request.currentPassword, request.newPassword);
      await extendAutoLock();
      return { ok: true, kind: "changeMasterPassword" };
    case "lock":
      await lock(request.forget ?? true);
      return { ok: true, kind: "lock" };
    case "setPin":
      await setPin(request.pin);
      await extendAutoLock();
      return { ok: true, kind: "setPin" };
    case "forgetPin":
      await forgetPin();
      return { ok: true, kind: "forgetPin" };
    case "unlockWithPin":
      await unlockWithPin(request.pin);
      await extendAutoLock();
      return { ok: true, kind: "unlockWithPin" };
    case "autoLock":
      return { ok: true, kind: "autoLock", minutes: await autoLockMinutes() };
    case "setAutoLock":
      await setAutoLockMinutes(request.minutes);
      return { ok: true, kind: "setAutoLock" };
    case "localOnly":
      return { ok: true, kind: "localOnly", value: await isLocalOnly() };
    case "setLocalOnly":
      await setLocalOnly(request.value);
      return { ok: true, kind: "setLocalOnly" };
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
    case "fillActiveLogin": {
      const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
      const active = tab ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0];
      if (active?.id === undefined) throw new Error("No active page to fill.");

      const result = (await browser.tabs.sendMessage(active.id, {
        kind: "vaultiqFillActiveLogin",
        id: request.id,
      })) as { filled?: boolean } | undefined;
      if (result?.filled !== true) throw new Error("Focus a login form on this page first.");

      await extendAutoLock();
      return { ok: true, kind: "fillActiveLogin" };
    }
    case "fillSuggestions": {
      const offered = await fillSuggestions(request.wants, await requestOrigin(sender));
      return { ok: true, kind: "fillSuggestions", ...offered };
    }
    case "fillValues": {
      const values = await fillValues(request.id, await requestOrigin(sender));
      await extendAutoLock();
      return { ok: true, kind: "fillValues", values };
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
    case "totpCode": {
      const facts = await totpCodeFor(request.id);
      await extendAutoLock();
      return { ok: true, kind: "totpCode", ...facts };
    }
    case "listItems": {
      const items = await listItems();
      await extendAutoLock();
      return { ok: true, kind: "listItems", items };
    }

    case "syncStatus":
      // Readable while locked: the popup has to be able to say when the last
      // sync was without opening the vault.
      return { ok: true, kind: "syncStatus", sync: await syncStatus() };
    case "connectServer":
      await connectServer(request.server, request.token, request.deviceName, request.masterPassword);
      await extendAutoLock();
      return { ok: true, kind: "connectServer" };
    case "enrollWithServer":
      await enrollWithServer(
        request.server,
        request.token,
        request.deviceName,
        request.masterPassword,
      );
      return { ok: true, kind: "enrollWithServer" };
    case "syncNow": {
      const outcome = await syncNow();
      await extendAutoLock();
      return { ok: true, kind: "syncNow", outcome };
    }
    case "disconnectServer":
      await disconnectServer();
      return { ok: true, kind: "disconnectServer" };
    case "remoteDevices": {
      const devices = await remoteDevices();
      await extendAutoLock();
      return { ok: true, kind: "remoteDevices", devices };
    }
    case "newEnrollmentToken": {
      const minted = await newEnrollmentToken();
      await extendAutoLock();
      return { ok: true, kind: "newEnrollmentToken", ...minted };
    }
    case "revokeRemoteDevice":
      await revokeRemoteDevice(request.deviceId);
      await extendAutoLock();
      return { ok: true, kind: "revokeRemoteDevice" };
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
