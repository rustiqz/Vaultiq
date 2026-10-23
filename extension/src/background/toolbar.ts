// What the toolbar button shows: a dot for lock state, and a count of the
// logins saved for the current site.
//
// The decision is a pure function of three facts so it can be tested without a
// browser; `refreshToolbar` is the thin part that reads those facts and calls
// the browser. Nothing here is secret: lock state is already visible to
// anyone looking at the popup, and the count is a number — never a name, a
// username or a site — drawn only while the vault is unlocked, since it takes
// the vault key to know it.

import type { VaultStatus } from "../lib/messages.js";
import { loginCountForUrl, status } from "./vault.js";

export type ToolbarIcon = "none" | "locked" | "unlocked";

export interface ToolbarView {
  icon: ToolbarIcon;
  title: string;
  /** Empty clears the badge. */
  badge: string;
}

/** Beyond this the badge cannot fit the digits anyway. */
const BADGE_CAP = 99;

export function toolbarView(state: VaultStatus, loginCount: number, saveWaiting: boolean): ToolbarView {
  if (state === "empty") return { icon: "none", title: "Vaultiq — no vault yet", badge: "" };

  if (state !== "unlocked") {
    return {
      icon: "locked",
      title: saveWaiting ? "Vaultiq — locked, a login is waiting to be saved" : "Vaultiq — locked",
      badge: saveWaiting ? "!" : "",
    };
  }

  const matches = loginCount === 1 ? "1 login for this site" : `${String(loginCount)} logins for this site`;
  const parts = ["Vaultiq — unlocked"];
  if (loginCount > 0) parts.push(matches);
  if (saveWaiting) parts.push("a login is waiting to be saved");
  return {
    icon: "unlocked",
    title: parts.join(", "),
    // A pending save outranks the count: it is the one thing that expires.
    badge: saveWaiting ? "!" : loginCount === 0 ? "" : loginCount > BADGE_CAP ? `${String(BADGE_CAP)}+` : String(loginCount),
  };
}

const SIZES = [16, 32, 48, 128] as const;

function iconPaths(icon: ToolbarIcon): Record<string, string> {
  return Object.fromEntries(SIZES.map((size) => [String(size), `icons/state-${icon}-${String(size)}.png`]));
}

let shownState: VaultStatus | undefined;

/**
 * Brings the button in line with the vault and the tab in front.
 *
 * Best effort and never throws: a toolbar that fails to update must not take a
 * vault operation down with it, and the next event repairs it.
 */
export async function refreshToolbar(saveWaiting = false): Promise<void> {
  try {
    const state = await status();
    const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    const count = state === "unlocked" ? await loginCountForUrl(tab?.url) : 0;
    const view = toolbarView(state, count, saveWaiting);

    await browser.action.setIcon({ path: iconPaths(view.icon) });
    await browser.action.setTitle({ title: view.title });

    // Badges are per tab so a count never follows you to another site. When the
    // vault stops being unlocked, every tab's old count has to go, not just the
    // one in front — otherwise a stale number reappears on the next switch.
    if (shownState === "unlocked" && state !== "unlocked") {
      for (const other of await browser.tabs.query({})) {
        if (other.id !== undefined) await browser.action.setBadgeText({ text: "", tabId: other.id });
      }
    }
    shownState = state;

    await browser.action.setBadgeText(tab?.id === undefined ? { text: view.badge } : { text: view.badge, tabId: tab.id });
    await browser.action.setBadgeBackgroundColor({ color: saveWaiting ? "#B7791F" : "#674636" });
    // Not in every browser version; the default text colour is readable anyway.
    await browser.action.setBadgeTextColor?.({ color: "#FFF8E8" });
  } catch {
    // See above.
  }
}
