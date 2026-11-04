// The content script. Runs inside every page, which is the least trustworthy
// context in the extension, so it is deliberately dull:
//
//   * It holds no key and no secret. It asks the background for a list of
//     names — no password, no card number, nothing worth stealing — and asks
//     again for one item's values only after a real click.
//   * It never names its own site. The background reads the sender tab's URL,
//     so a compromised page cannot ask for credentials belonging to another.
//   * It fills only on a genuine user gesture. Filling on page load would let
//     a page read the value straight back out of the input.
//
// That last rule carries more weight since cards and identities arrived. A
// login is offered only to the site it belongs to; a card has no site, so the
// click *is* the protection. Nothing here may ever fill one without it.

import { readSubmission, submittedFields } from "./capture.js";
import {
  fieldsFor,
  fillField,
  fillScopeFor,
  isNewPasswordForm,
  loginForms,
  newPasswordFields,
  sectionOf,
  tokenFor,
  type FillToken,
  type LoginFields,
} from "./detect.js";
import {
  belongsToDropdown,
  closeDropdown,
  dropdownAnchor,
  showDropdown,
  type DropdownEntry,
} from "./dropdown.js";
import {
  hideLauncher,
  isDismissed,
  isInsideLauncher,
  launcherAnchor,
  markDismissed,
  showLauncher,
} from "./launcher.js";
import { showPrompt } from "./prompt.js";
import type { ItemType, Request, Response } from "../lib/messages.js";

async function ask(request: Request): Promise<Response> {
  return (await browser.runtime.sendMessage(request)) as Response;
}

/**
 * The id used for the "use a suggested password" row.
 *
 * A NUL byte, so it can never collide with a real item id.
 */
const SUGGESTION_ID = "\u0000suggested-password";

/** The fields the picker is currently attached to. */
let active: LoginFields | undefined;

/** Which item each row in the current picker came from. */
let offered = new Map<string, ItemType>();

/**
 * The tokens an identity can answer.
 *
 * A card and a one-time code are recognised by their own prefixes; these are
 * the rest, listed rather than pattern-matched so that adding a field to the
 * identity schema does not silently start offering identities somewhere new.
 */
const IDENTITY_TOKENS = new Set<FillToken>([
  "given-name",
  "family-name",
  "organization",
  "email",
  "tel",
  "street-address",
  "address-line1",
  "address-line2",
  "address-level1",
  "address-level2",
  "postal-code",
  "country-name",
  "bday",
]);

/**
 * What the field under the cursor is asking for.
 *
 * Driven by the focused field, not by everything the page happens to
 * contain: a form with a card section further down should not offer cards
 * while the user is typing their email into it.
 *
 * Identities are offered only where there is no password field in scope. A
 * sign-in form with an email box is asking for a login, and putting a list of
 * addresses under it would be noise on the page people visit most.
 */
function wantsFor(target: HTMLInputElement, login: LoginFields | undefined): ItemType[] {
  const wants: ItemType[] = [];
  if (login && (target === login.password || target === login.username)) wants.push("login");

  const token = tokenFor(target);
  if (token?.startsWith("cc-")) wants.push("card");
  if (token === "one-time-code") wants.push("totp");
  if (token && !login && IDENTITY_TOKENS.has(token)) wants.push("identity");

  return wants;
}

/**
 * Writes one item's values into the fields that asked for them.
 *
 * Only fields in the focused field's own section, and only tokens the item
 * actually has: a card with no PIN leaves the PIN box alone rather than
 * blanking it.
 */
async function fillFrom(id: string, target: HTMLInputElement): Promise<void> {
  const { fields } = fillScopeFor(target);
  const section = sectionOf(target);

  // Values cross into the page only here, only for the item just clicked.
  const response = await ask({ kind: "fillValues", id });
  if (!response.ok || response.kind !== "fillValues") return;

  for (const [token, inputs] of fields) {
    const value = response.values[token];
    if (value === undefined) continue;
    for (const input of inputs) {
      if (sectionOf(input) === section) {
        fillField(input, value);
        // Filled fields are done with the picker; see `fill`.
        markDismissed(input);
      }
    }
  }
  markDismissed(target);
  target.focus();
}

/** The password offered in the current picker, if one was. */
let suggested: string | undefined;

async function fill(id: string, fields: LoginFields): Promise<boolean> {
  // The password crosses into the page only here, only for the item just
  // clicked, and goes straight into the field.
  const response = await ask({ kind: "credentialForFill", id });
  if (!response.ok || response.kind !== "credentialForFill") return false;

  if (fields.username && response.username) fillField(fields.username, response.username);
  fillField(fields.password, response.password);
  // Both fields are marked before the refocus below: focusing the password
  // field is a focus like any other and would otherwise open the picker on it.
  if (fields.username) markDismissed(fields.username);
  markDismissed(fields.password);
  fields.password.focus();
  return true;
}

/**
 * Fills from an explicit popup click.
 *
 * Opening a browser-action popup can move focus out of the page, so the
 * focused input is preferred but the first visible login form is the safe
 * fallback. The credential still comes through `credentialForFill`, whose
 * background-side site check rejects an id belonging to another origin.
 */
async function fillActiveLogin(id: string): Promise<boolean> {
  const focused = document.activeElement;
  const fields = focused instanceof HTMLInputElement
    ? fieldsFor(focused)
    : loginForms(document)[0];
  if (!fields) return false;
  return fill(id, fields);
}

browser.runtime.onMessage.addListener((message: unknown) => {
  if (
    typeof message !== "object" ||
    message === null ||
    !("kind" in message) ||
    message.kind !== "vaultiqFillActiveLogin" ||
    !("id" in message) ||
    typeof message.id !== "string"
  ) {
    return undefined;
  }

  return fillActiveLogin(message.id).then((filled) => ({ filled }));
});

/** Writes a suggested password into every field meant to receive it. */
function useSuggestion(target: HTMLInputElement, password: string): void {
  const scope = target.closest("form") ?? target.ownerDocument;
  for (const field of newPasswordFields(scope)) {
    fillField(field, password);
    markDismissed(field);
  }
  markDismissed(target);
  target.focus();
}

/** Bumped on every offer, so a slow answer for a field the user left is dropped. */
let latestOffer = 0;

/**
 * Looks up what could fill `target`, marks the field with the launcher, and
 * opens the picker.
 *
 * `how` is "asked" when the user pressed the launcher, "focus" when the field
 * was focused and "hover" when only the pointer is over it. The picker opens
 * on its own only for a focus, and only on a field it has not been closed on
 * yet; every other case gets the launcher alone.
 */
async function offer(
  target: HTMLInputElement,
  how: "asked" | "focus" | "hover" = "focus",
): Promise<void> {
  const fields = fieldsFor(target);
  const wants = wantsFor(target, fields);
  if (wants.length === 0) return;
  const mine = ++latestOffer;

  const scope = target.closest("form") ?? document;
  const choosing = Boolean(fields) && isNewPasswordForm(fields!.password, scope);

  // No URL is sent. The background reads it from the sender tab, and answers
  // with names only — no password, no card number, nothing worth stealing
  // from a page that has not been clicked in.
  const response = await ask({ kind: "fillSuggestions", wants });
  if (mine !== latestOffer) return;
  const stored =
    response.ok && response.kind === "fillSuggestions" ? response.suggestions : [];

  offered = new Map(stored.map((item) => [item.id, item.type]));
  const entries: DropdownEntry[] = stored.map((item) => ({
    id: item.id,
    label: item.label,
    detail: item.detail,
  }));

  suggested = undefined;
  if (choosing) {
    // Only offered where the user is being asked to choose a password. On a
    // sign-in form it would be noise at best and a mis-fill at worst.
    const generated = await ask({ kind: "generatePassword" });
    if (mine !== latestOffer) return;
    if (generated.ok && generated.kind === "generatePassword") {
      suggested = generated.password;
      entries.unshift({
        id: SUGGESTION_ID,
        label: "Use a suggested password",
        detail: generated.password,
        emphasis: true,
      });
    }
  }

  if (entries.length === 0) {
    hideLauncher();
    return;
  }

  active = fields;
  showLauncher(target, () => void offer(target, "asked"));
  if (how === "hover" || (how === "focus" && isDismissed(target))) return;

  showDropdown(target, entries, (id) => {
    // Picked: this field is done with the picker until the launcher is
    // pressed. Marked before the fill, whose `focus()` would otherwise reopen it.
    markDismissed(target);
    if (id === SUGGESTION_ID) {
      if (suggested) useSuggestion(target, suggested);
      return;
    }
    // A login goes through the site-scoped credential path it always has.
    // Everything else has no site to be scoped to, so it is filled by token
    // — and either way, only for the row the user just clicked.
    if (offered.get(id) === "login") {
      if (active) void fill(id, active);
      return;
    }
    void fillFrom(id, target);
  });
}

/** "Unlock to save", for a login the background is holding while the vault is locked. */
function showUnlockToSave(detail: string): void {
  showPrompt(
    document,
    { title: "Save this login?", detail, confirm: "Unlock to save", fields: false },
    (answer) => {
      // "Not now" is a decision: it wipes what the background was holding.
      void ask(answer ? { kind: "openUnlockWindow" } : { kind: "resolvePendingSave", save: false });
    },
  );
}

/**
 * A page that loads just after a sign-in form was submitted — the usual
 * redirect — asks whether a login is waiting from the tab it came from.
 *
 * The site shown is the one the form was on, not this page's: the background
 * remembers it, because by now this page may be somewhere else entirely.
 */
async function showPendingSave(): Promise<void> {
  if (window !== window.top) return;
  const response = await ask({ kind: "pendingSave" });
  if (!response.ok || response.kind !== "pendingSave" || !response.pending) return;

  const { pending } = response;
  const detail = `${pending.username || "(no username)"} · ${pending.site}`;
  if (pending.locked) {
    showUnlockToSave(detail);
    return;
  }

  showPrompt(
    document,
    {
      title: pending.update ? "Update this login?" : "Save this login?",
      detail,
      confirm: pending.update ? "Update" : "Save",
    },
    (answer) => {
      void ask({
        kind: "resolvePendingSave",
        save: answer !== undefined,
        ...(answer?.name ? { name: answer.name } : {}),
        ...(answer?.notes ? { notes: answer.notes } : {}),
      });
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

  // The vault is locked. The background is already holding what was typed, so
  // the page can be navigated away from; all this asks is for the vault to be
  // opened somewhere that survives that.
  if (decision.locked) {
    showUnlockToSave(`${submitted.username || "(no username)"} · ${decision.site}`);
    return;
  }

  showPrompt(
    document,
    {
      title: decision.existingId ? "Update this login?" : "Save this login?",
      detail: `${submitted.username || "(no username)"} · ${decision.site}`,
      confirm: decision.existingId ? "Update" : "Save",
    },
    (answer) => {
      // The background is holding this capture in case the page redirects away
      // before an answer; either answer ends that, so a dismissal is sent too.
      void ask({
        kind: "resolvePendingSave",
        save: answer !== undefined,
        ...(answer?.name ? { name: answer.name } : {}),
        ...(answer?.notes ? { notes: answer.notes } : {}),
      });
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

/** Field types that can hold something worth offering. */
function isFillable(target: EventTarget | null): target is HTMLInputElement {
  if (!(target instanceof HTMLInputElement)) return false;
  // `tel`, `number` and `date` are here for cards and addresses; a checkout
  // form's expiry and postcode boxes are routinely one of those.
  return ["password", "text", "email", "tel", "number", "date", "search", ""].includes(
    target.type.toLowerCase(),
  );
}

/** The picker is closed by the user: this field is left alone until the launcher is pressed. */
function dismissPicker(): void {
  const field = dropdownAnchor();
  if (field) markDismissed(field);
  closeDropdown();
}

// Opening the picker is a user gesture, always. There is no path here that
// runs on load.
document.addEventListener(
  "focusin",
  (event) => {
    if (!event.isTrusted) return;
    if (!isFillable(event.target)) {
      hideLauncher();
      return;
    }
    void offer(event.target, "focus");
  },
  true,
);

// Moving off a field takes its launcher with it, unless the move is onto the
// launcher itself (which does not take focus, but is checked anyway).
document.addEventListener(
  "focusout",
  (event) => {
    if (event.target !== launcherAnchor()) return;
    if (isInsideLauncher(event.relatedTarget)) return;
    hideLauncher();
  },
  true,
);

// The launcher also follows the pointer, so it can be found again on a field
// the picker was closed on without having to focus it first. Hover only ever
// draws the mark; it never opens the picker.
document.addEventListener(
  "mouseover",
  (event) => {
    if (!event.isTrusted || !isFillable(event.target)) return;
    if (event.target === launcherAnchor()) return;
    // A focused field keeps its own launcher.
    const focused = launcherAnchor() === document.activeElement;
    if (focused) return;
    void offer(event.target, "hover");
  },
  true,
);

document.addEventListener(
  "mouseout",
  (event) => {
    const anchor = launcherAnchor();
    if (!anchor || anchor === document.activeElement) return;
    // Leaving the field or the mark, for anywhere but the other of the two.
    if (event.target !== anchor && !isInsideLauncher(event.target)) return;
    if (event.relatedTarget === anchor || isInsideLauncher(event.relatedTarget)) return;
    hideLauncher();
  },
  true,
);

document.addEventListener(
  "click",
  (event) => {
    if (isInsideLauncher(event.target)) return;
    if (!belongsToDropdown(event.target)) dismissPicker();
  },
  true,
);

document.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Escape") dismissPicker();
  },
  true,
);

void showPendingSave().catch(() => {
  // The extension was reloaded or updated under this page; nothing to show.
});
