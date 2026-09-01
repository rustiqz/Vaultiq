// Noticing that someone just logged in.
//
// Pure DOM logic, no extension APIs, so it is testable and reviewable on its
// own. It decides *what was typed*; whether that is worth saving is the
// background's call, and whether it gets saved is the user's.

import { loginForms, type LoginFields } from "./detect.js";

export interface Submission {
  username: string;
  password: string;
}

/** What was in a login form, if it holds anything worth offering to save. */
export function readSubmission(fields: LoginFields): Submission | undefined {
  const password = fields.password.value;
  if (!password) return undefined;

  return { username: fields.username?.value ?? "", password };
}

/**
 * The login form a submit event came from.
 *
 * Falls back to the only login form on the page when the event did not come
 * from a form element — plenty of sign-in pages submit through a button
 * handler and an XHR rather than a real form submission.
 */
export function submittedFields(target: EventTarget | null, root: Document): LoginFields | undefined {
  if (target instanceof HTMLFormElement) {
    const withinForm = loginForms(target);
    if (withinForm.length > 0) return withinForm[0];
  }

  const forms = loginForms(root);
  return forms.length === 1 ? forms[0] : undefined;
}
