// Finding the login fields on a page.
//
// Pure DOM reading, no extension APIs, so it is testable without a browser
// and reviewable on its own. Nothing here decides *whether* to fill — that is
// always the user clicking something.

/** The fields Vaultiq knows how to fill. */
export interface LoginFields {
  username: HTMLInputElement | undefined;
  password: HTMLInputElement;
}

function isVisible(element: HTMLElement): boolean {
  // A hidden field is usually a honeypot or a leftover; filling one is at
  // best useless and at worst hands a value to something the user cannot see.
  if (element.hidden) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  return element.getClientRects().length > 0;
}

function isFillable(input: HTMLInputElement): boolean {
  return !input.disabled && !input.readOnly && isVisible(input);
}

/**
 * The username field that goes with a password field.
 *
 * Taken as the last fillable text-like input before the password in document
 * order. That beats matching on names and placeholders, which differ by site
 * and language; the field immediately above the password is the convention
 * every login form follows.
 */
function usernameFor(password: HTMLInputElement, root: ParentNode): HTMLInputElement | undefined {
  const candidates = [...root.querySelectorAll("input")].filter(
    (input) =>
      ["text", "email", "tel", ""].includes(input.type.toLowerCase()) && isFillable(input),
  );

  let best: HTMLInputElement | undefined;
  for (const candidate of candidates) {
    const position = candidate.compareDocumentPosition(password);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) best = candidate;
  }
  return best;
}

/** The login fields containing or nearest to `target`, if there are any. */
export function fieldsFor(target: Element): LoginFields | undefined {
  const scope = target.closest("form") ?? target.ownerDocument;

  const password = [...scope.querySelectorAll("input")].find(
    (input) => input.type.toLowerCase() === "password" && isFillable(input),
  );
  if (!password) return undefined;

  return { username: usernameFor(password, scope), password };
}

/**
 * The password fields a new password should be written into.
 *
 * Every password field in scope *except* one marked `current-password`. A
 * change-password form has three — current, new, confirm — and overwriting
 * the current one would replace what the site is about to check against.
 */
export function newPasswordFields(scope: ParentNode): HTMLInputElement[] {
  return [...scope.querySelectorAll("input")].filter(
    (input) =>
      input.type.toLowerCase() === "password" &&
      isFillable(input) &&
      input.autocomplete.toLowerCase() !== "current-password",
  );
}

/**
 * Whether this form is asking the user to *choose* a password rather than
 * recall one.
 *
 * Either the field says so with `autocomplete="new-password"`, or there is
 * more than one password field — which is a sign-up or change form, since a
 * sign-in page has exactly one.
 */
export function isNewPasswordForm(target: HTMLInputElement, scope: ParentNode): boolean {
  if (target.autocomplete.toLowerCase() === "new-password") return true;

  const passwords = [...scope.querySelectorAll("input")].filter(
    (input) => input.type.toLowerCase() === "password" && isFillable(input),
  );
  return passwords.length > 1;
}

/** Every distinct login form on the page. */
export function loginForms(root: ParentNode): LoginFields[] {
  const passwords = [...root.querySelectorAll("input")].filter(
    (input) => input.type.toLowerCase() === "password" && isFillable(input),
  );

  return passwords.map((password) => ({
    username: usernameFor(password, password.closest("form") ?? root),
    password,
  }));
}

/**
 * Sets a field's value the way a person typing would.
 *
 * Assigning `.value` alone is invisible to React, Vue and anything else
 * tracking input through events, so a framework-backed form would submit an
 * empty string. The native setter plus an `input` event is what those
 * libraries actually listen for.
 */
export function fillField(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    input.ownerDocument.defaultView?.HTMLInputElement.prototype ?? HTMLInputElement.prototype,
    "value",
  );

  // Applied with an explicit receiver rather than assigned: `input.value = x`
  // goes through whatever setter a framework has installed on the element,
  // and this has to reach the native one underneath it.
  //
  // The lint below guards against losing `this`. Here the receiver is
  // supplied explicitly, which is the entire point of taking the setter off
  // the prototype in the first place.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  if (descriptor?.set) Reflect.apply(descriptor.set, input, [value]);
  else input.value = value;

  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * The fields a saved item can be filled into, named by their HTML
 * autocomplete token.
 *
 * The token vocabulary is the spec's, not ours, for the same reason the
 * identity schema borrows it: the browser, the site and the vault then all
 * agree what a field is without a translation table in the middle.
 */
export type FillToken =
  | "cc-name"
  | "cc-number"
  | "cc-exp-month"
  | "cc-exp-year"
  | "cc-csc"
  | "given-name"
  | "family-name"
  | "organization"
  | "email"
  | "tel"
  | "street-address"
  | "address-line1"
  | "address-line2"
  | "address-level1"
  | "address-level2"
  | "postal-code"
  | "country-name"
  | "bday"
  | "one-time-code";

const TOKENS: FillToken[] = [
  "cc-name",
  "cc-number",
  "cc-exp-month",
  "cc-exp-year",
  "cc-csc",
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
  "one-time-code",
];

/**
 * Names a field when the page did not.
 *
 * Second best, always. `autocomplete` is a declaration by the site and is
 * checked first; these patterns are guesses from the words developers reach
 * for, and they are deliberately narrow. A wrong guess here types a card
 * number into the wrong box, so anything ambiguous — "code", "number",
 * "name" on their own — is left unmatched rather than filled.
 */
const GUESSES: { token: FillToken; pattern: RegExp }[] = [
  { token: "cc-number", pattern: /card.?number|cardnum|ccnum|creditcard/ },
  { token: "cc-csc", pattern: /\bcvv\b|\bcvc\b|\bcsc\b|security.?code|card.?code/ },
  { token: "cc-exp-month", pattern: /exp.*month|month.*exp|\bexpmonth\b/ },
  { token: "cc-exp-year", pattern: /exp.*year|year.*exp|\bexpyear\b/ },
  { token: "cc-name", pattern: /card.?holder|name.?on.?card|cc.?name/ },
  { token: "one-time-code", pattern: /one.?time.?code|\botp\b|2fa.?code|auth.?code|totp/ },
  { token: "postal-code", pattern: /post.?code|postal.?code|\bzip\b|zipcode|pincode/ },
  { token: "address-line1", pattern: /address.?line.?1|addr1|street.?address/ },
  { token: "address-line2", pattern: /address.?line.?2|addr2/ },
  { token: "address-level2", pattern: /\bcity\b|town|locality/ },
  { token: "address-level1", pattern: /\bstate\b|province|region|county/ },
  { token: "country-name", pattern: /\bcountry\b/ },
  { token: "given-name", pattern: /first.?name|given.?name|forename/ },
  { token: "family-name", pattern: /last.?name|family.?name|surname/ },
  { token: "organization", pattern: /company|organi[sz]ation|business.?name/ },
];

/**
 * What one input is for, or nothing.
 *
 * The `autocomplete` attribute may carry section and billing/shipping
 * prefixes — `section-blue billing cc-number` is valid — so the field name is
 * the last word, which is where the spec puts it.
 */
export function tokenFor(input: HTMLInputElement): FillToken | undefined {
  const declared = input.autocomplete.toLowerCase().trim().split(/\s+/).at(-1);
  const named = TOKENS.find((token) => token === declared);
  if (named) return named;

  // `autocomplete="off"` is a request not to fill, and it is honoured for
  // these fields: unlike a password manager filling a login, there is no
  // long-standing convention of overriding it for an address or a card.
  if (declared === "off") return undefined;

  const described = [input.name, input.id, input.placeholder, input.getAttribute("aria-label")]
    .filter((value): value is string => typeof value === "string" && value !== "")
    .join(" ")
    .toLowerCase();
  if (!described) return undefined;

  return GUESSES.find((guess) => guess.pattern.test(described))?.token;
}

/**
 * Every fillable field in scope, by what it is for.
 *
 * A token can appear more than once — a page may show billing and shipping
 * side by side — and all of them are returned. Choosing which to fill is the
 * caller's decision, made from a click, not this function's.
 */
export function tokenFields(scope: ParentNode): Map<FillToken, HTMLInputElement[]> {
  const found = new Map<FillToken, HTMLInputElement[]>();

  for (const input of scope.querySelectorAll("input")) {
    if (!isFillable(input)) continue;
    // A password field is never one of these, whatever it claims: filling a
    // card number into something the browser will not display is how a
    // number ends up somewhere nobody can check.
    if (input.type.toLowerCase() === "password") continue;

    const token = tokenFor(input);
    if (!token) continue;

    const existing = found.get(token);
    if (existing) existing.push(input);
    else found.set(token, [input]);
  }

  return found;
}

/** The tokens a form is asking for, from any field inside its scope. */
export function fillScopeFor(target: Element): {
  scope: ParentNode;
  fields: Map<FillToken, HTMLInputElement[]>;
} {
  const scope = target.closest("form") ?? target.ownerDocument;
  return { scope, fields: tokenFields(scope) };
}

/**
 * The section an input belongs to, from the words before its field name.
 *
 * `autocomplete="billing cc-number"` is in the billing section;
 * `shipping address-line1` is in shipping. A page that shows both at once
 * puts them in one form, so without this a single pick would fill an address
 * into somewhere the user was not looking.
 *
 * Empty is a real answer, and the common one: most fields declare no section,
 * and neither do any matched by name.
 */
export function sectionOf(input: HTMLInputElement): string {
  const parts = input.autocomplete.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, -1).join(" ");
}
