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
