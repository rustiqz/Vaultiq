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
  showDropdown,
  type DropdownEntry,
} from "./dropdown.js";
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
      if (sectionOf(input) === section) fillField(input, value);
    }
  }
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
  for (const field of newPasswordFields(scope)) fillField(field, password);
  target.focus();
}

async function offer(target: HTMLInputElement): Promise<void> {
  const fields = fieldsFor(target);
  const wants = wantsFor(target, fields);
  if (wants.length === 0) return;

  const scope = target.closest("form") ?? document;
  const choosing = Boolean(fields) && isNewPasswordForm(fields!.password, scope);

  // No URL is sent. The background reads it from the sender tab, and answers
  // with names only — no password, no card number, nothing worth stealing
  // from a page that has not been clicked in.
  const response = await ask({ kind: "fillSuggestions", wants });
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

  if (entries.length === 0) return;

  active = fields;
  showDropdown(target, entries, (id) => {
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
    (answer) => {
      if (!answer) return;
      void ask({
        kind: "saveSubmitted",
        ...submitted,
        ...(answer.name ? { name: answer.name } : {}),
        ...(answer.notes ? { notes: answer.notes } : {}),
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

// Opening the picker is a user gesture, always. There is no path here that
// runs on load.
document.addEventListener(
  "focusin",
  (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    // `tel`, `number` and `date` are here for cards and addresses; a checkout
    // form's expiry and postcode boxes are routinely one of those.
    if (
      !["password", "text", "email", "tel", "number", "date", "search", ""].includes(
        target.type.toLowerCase(),
      )
    ) {
      return;
    }
    if (!event.isTrusted) return;
    void offer(target);
  },
  true,
);

document.addEventListener(
  "click",
  (event) => {
    if (!belongsToDropdown(event.target)) closeDropdown();
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
