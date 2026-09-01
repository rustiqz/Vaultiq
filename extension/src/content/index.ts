// The content script. Runs inside every page, which is the least trustworthy
// context in the extension, so it is deliberately dull:
//
//   * It holds no key and no password. It asks the background for a list of
//     names, and asks again for one password only after a real click.
//   * It never names its own site. The background reads the sender tab's URL,
//     so a compromised page cannot ask for credentials belonging to another.
//   * It fills only on a genuine user gesture. Filling on page load would let
//     a page read the password straight back out of the input.

import { readSubmission, submittedFields } from "./capture.js";
import { fieldsFor, fillField, type LoginFields } from "./detect.js";
import { closeDropdown, isInsideDropdown, showDropdown } from "./dropdown.js";
import { showPrompt } from "./prompt.js";
import type { Request, Response } from "../lib/messages.js";

async function ask(request: Request): Promise<Response> {
  return (await browser.runtime.sendMessage(request)) as Response;
}

/** The fields the picker is currently attached to. */
let active: LoginFields | undefined;

async function fill(id: string, fields: LoginFields): Promise<void> {
  // The password crosses into the page only here, only for the item just
  // clicked, and goes straight into the field.
  const response = await ask({ kind: "credentialForFill", id });
  if (!response.ok || response.kind !== "credentialForFill") return;

  if (fields.username && response.username) fillField(fields.username, response.username);
  fillField(fields.password, response.password);
  fields.password.focus();
}

async function offer(target: HTMLInputElement): Promise<void> {
  const fields = fieldsFor(target);
  if (!fields) return;

  // No URL is sent. The background reads it from the sender tab.
  const response = await ask({ kind: "itemsForSite" });
  if (!response.ok || response.kind !== "itemsForSite" || response.items.length === 0) return;

  active = fields;
  showDropdown(
    target,
    response.items.map((item) => ({
      id: item.id,
      label: item.name?.trim() || item.username || "(untitled)",
      detail: item.name?.trim() ? item.username : (item.url ?? ""),
    })),
    (id) => {
      if (active) void fill(id, active);
    },
  );
}

/** Offers to save what was just typed into a login form. */
async function offerToSave(target: EventTarget | null): Promise<void> {
  const fields = submittedFields(target, document);
  if (!fields) return;

  const submitted = readSubmission(fields);
  if (!submitted) return;

  // The background decides: it declines silently when locked, when the site
  // is unknown, or when this exact login is already stored.
  const decision = await ask({ kind: "shouldOfferToSave", ...submitted });
  if (!decision.ok || decision.kind !== "shouldOfferToSave" || !decision.offer) return;

  showPrompt(
    document,
    {
      title: decision.existingId ? "Update this login?" : "Save this login?",
      detail: `${submitted.username || "(no username)"} · ${decision.site}`,
      confirm: decision.existingId ? "Update" : "Save",
    },
    (save) => {
      if (save) void ask({ kind: "saveSubmitted", ...submitted });
    },
  );
}

// Submission is noticed in the capture phase, before the page's own handler
// can stop propagation or tear the form down.
document.addEventListener(
  "submit",
  (event) => {
    if (!event.isTrusted) return;
    void offerToSave(event.target);
  },
  true,
);

// Opening the picker is a user gesture, always. There is no path here that
// runs on load.
document.addEventListener(
  "focusin",
  (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!["password", "text", "email"].includes(target.type.toLowerCase())) return;
    if (!event.isTrusted) return;
    void offer(target);
  },
  true,
);

document.addEventListener(
  "click",
  (event) => {
    if (!isInsideDropdown(event.target)) closeDropdown();
  },
  true,
);

document.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Escape") closeDropdown();
  },
  true,
);
