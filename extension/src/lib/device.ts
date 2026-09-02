// This browser's identity.
//
// Not a secret — it names which device did what in the audit trail, and it
// keys that device's own usage record. It lives in `storage.local` rather
// than `storage.session` because it has to survive the browser closing;
// losing it would orphan this device's history on every restart.
//
// The credential that proves this device may *talk to the server* is a
// separate thing entirely, and does not exist yet.

import type { DeviceIdentity } from "./messages.js";

const KEY = "device";

/** A readable default, so a device list is not a wall of identifiers. */
function describe(): string {
  const agent = navigator.userAgent;
  const browser = /Firefox/.test(agent) ? "Firefox" : /Chrome/.test(agent) ? "Chrome" : "Browser";

  const platform = /Linux/.test(agent)
    ? "Linux"
    : /Mac/.test(agent)
      ? "macOS"
      : /Windows/.test(agent)
        ? "Windows"
        : /Android/.test(agent)
          ? "Android"
          : "";

  return platform ? `${browser} on ${platform}` : browser;
}

/** This device, created on first use and stable thereafter. */
export async function thisDevice(): Promise<DeviceIdentity> {
  const stored = await browser.storage.local.get(KEY);
  const existing = stored[KEY] as DeviceIdentity | undefined;
  if (existing?.id) return existing;

  const device: DeviceIdentity = { id: crypto.randomUUID(), name: describe() };
  await browser.storage.local.set({ [KEY]: device });
  return device;
}

export async function renameDevice(name: string): Promise<DeviceIdentity> {
  const device = await thisDevice();
  const renamed: DeviceIdentity = { ...device, name: name.trim() || device.name };
  await browser.storage.local.set({ [KEY]: renamed });
  return renamed;
}
