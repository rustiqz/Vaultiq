/**
 * @vitest-environment jsdom
 */

// Field detection against real markup. The cases that matter are the ones a
// login page actually throws at you: a hidden honeypot, two forms on a page,
// and a framework-backed input that ignores a plain value assignment.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fieldsFor,
  fillField,
  loginForms,
  sectionOf,
  tokenFields,
  tokenFor,
} from "./detect.js";

function render(html: string): void {
  document.body.innerHTML = html;
  // jsdom reports no layout, so getClientRects is empty for everything and
  // every field would look invisible. Stub it to reflect the `hidden`
  // attribute and inline display, which is what the tests vary.
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (
    this: HTMLElement,
  ) {
    const invisible = this.hidden || this.style.display === "none";
    return (invisible ? [] : [{} as DOMRect]) as unknown as DOMRectList;
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("finding the fields", () => {
  it("pairs a password with the text field above it", () => {
    render(`<form>
      <input type="text" id="u">
      <input type="password" id="p">
    </form>`);

    const fields = fieldsFor(document.querySelector("#p")!);
    expect(fields?.username?.id).toBe("u");
    expect(fields?.password.id).toBe("p");
  });

  it("takes the nearest text field, not the first on the page", () => {
    render(`<form>
      <input type="text" id="search">
      <input type="email" id="email">
      <input type="password" id="p">
    </form>`);

    expect(fieldsFor(document.querySelector("#p")!)?.username?.id).toBe("email");
  });

  it("ignores a hidden honeypot", () => {
    render(`<form>
      <input type="text" id="trap" hidden>
      <input type="text" id="real">
      <input type="password" id="p">
    </form>`);

    expect(fieldsFor(document.querySelector("#p")!)?.username?.id).toBe("real");
  });

  it("ignores a disabled or readonly field", () => {
    render(`<form>
      <input type="text" id="frozen" readonly>
      <input type="text" id="off" disabled>
      <input type="text" id="real">
      <input type="password" id="p">
    </form>`);

    expect(fieldsFor(document.querySelector("#p")!)?.username?.id).toBe("real");
  });

  it("stays inside the form it was asked about", () => {
    render(`
      <form id="signin"><input type="text" id="a"><input type="password" id="pa"></form>
      <form id="signup"><input type="text" id="b"><input type="password" id="pb"></form>`);

    expect(fieldsFor(document.querySelector("#pa")!)?.username?.id).toBe("a");
    expect(fieldsFor(document.querySelector("#pb")!)?.username?.id).toBe("b");
  });

  it("copes with a password field that has no username beside it", () => {
    render(`<form><input type="password" id="p"></form>`);

    const fields = fieldsFor(document.querySelector("#p")!);
    expect(fields?.password.id).toBe("p");
    expect(fields?.username).toBeUndefined();
  });

  it("finds nothing where there is no password field", () => {
    render(`<form><input type="text" id="q"></form>`);
    expect(fieldsFor(document.querySelector("#q")!)).toBeUndefined();
  });

  it("ignores a password field that is not visible", () => {
    render(`<form><input type="password" id="p" style="display:none"></form>`);
    expect(fieldsFor(document.querySelector("#p")!)).toBeUndefined();
  });

  it("lists every login form on the page", () => {
    render(`
      <form><input type="text"><input type="password" id="pa"></form>
      <form><input type="text"><input type="password" id="pb"></form>`);

    expect(loginForms(document).map((f) => f.password.id)).toEqual(["pa", "pb"]);
  });
});

describe("recognising a form that asks you to choose a password", () => {
  it("takes autocomplete at its word", async () => {
    const { isNewPasswordForm } = await import("./detect.js");
    render(`<form><input type="password" id="p" autocomplete="new-password"></form>`);

    const password = document.querySelector<HTMLInputElement>("#p")!;
    expect(isNewPasswordForm(password, document)).toBe(true);
  });

  it("treats two password fields as a sign-up", async () => {
    const { isNewPasswordForm } = await import("./detect.js");
    render(`<form>
      <input type="password" id="p">
      <input type="password" id="repeat">
    </form>`);

    expect(isNewPasswordForm(document.querySelector("#p")!, document)).toBe(true);
  });

  it("does not mistake a sign-in form for one", async () => {
    const { isNewPasswordForm } = await import("./detect.js");
    render(`<form><input type="text"><input type="password" id="p"></form>`);

    // One password field and nothing saying otherwise: the user is recalling
    // a password, not choosing one. Suggesting here would be a mis-fill.
    expect(isNewPasswordForm(document.querySelector("#p")!, document)).toBe(false);
  });
});

describe("choosing which fields a new password goes into", () => {
  it("fills the password and its confirmation", async () => {
    const { newPasswordFields } = await import("./detect.js");
    render(`<form>
      <input type="password" id="p">
      <input type="password" id="repeat">
    </form>`);

    expect(newPasswordFields(document).map((f) => f.id)).toEqual(["p", "repeat"]);
  });

  it("leaves the current password alone on a change form", async () => {
    const { newPasswordFields } = await import("./detect.js");
    render(`<form>
      <input type="password" id="current" autocomplete="current-password">
      <input type="password" id="new" autocomplete="new-password">
      <input type="password" id="repeat" autocomplete="new-password">
    </form>`);

    // Overwriting the current one would replace what the site is about to
    // check against, and the change would be rejected.
    expect(newPasswordFields(document).map((f) => f.id)).toEqual(["new", "repeat"]);
  });

  it("skips a hidden field", async () => {
    const { newPasswordFields } = await import("./detect.js");
    render(`<form>
      <input type="password" id="p">
      <input type="password" id="trap" hidden>
    </form>`);

    expect(newPasswordFields(document).map((f) => f.id)).toEqual(["p"]);
  });
});

describe("filling a field", () => {
  it("sets the value and announces it", () => {
    render(`<input type="text" id="u">`);
    const input = document.querySelector<HTMLInputElement>("#u")!;

    const events: string[] = [];
    input.addEventListener("input", () => events.push("input"));
    input.addEventListener("change", () => events.push("change"));

    fillField(input, "ada@example.test");

    expect(input.value).toBe("ada@example.test");
    // Without these a React or Vue form submits an empty string: assigning
    // .value alone is invisible to anything tracking input through events.
    expect(events).toEqual(["input", "change"]);
  });

  it("bubbles, so a listener on the form hears it", () => {
    render(`<form id="f"><input type="text" id="u"></form>`);
    const heard = vi.fn();
    document.querySelector("#f")!.addEventListener("input", heard);

    fillField(document.querySelector<HTMLInputElement>("#u")!, "x");
    expect(heard).toHaveBeenCalled();
  });
});

describe("naming a field", () => {
  function input(html: string): HTMLInputElement {
    render(`<form>${html}</form>`);
    const field = document.querySelector("input");
    if (!field) throw new Error("no input");
    return field;
  }

  /** A form, rendered with the same visibility stub the rest of the file uses. */
  function form(html: string): HTMLFormElement {
    render(`<form>${html}</form>`);
    const rendered = document.querySelector("form");
    if (!rendered) throw new Error("no form");
    return rendered;
  }

  it("believes the page when it declares what a field is", () => {
    expect(tokenFor(input('<input autocomplete="cc-number">'))).toBe("cc-number");
    expect(tokenFor(input('<input autocomplete="postal-code">'))).toBe("postal-code");
  });

  it("reads through the section and billing prefixes", () => {
    // `section-blue billing cc-number` is valid, and the field name is the
    // last word — which is where the spec puts it.
    expect(tokenFor(input('<input autocomplete="section-blue billing cc-number">'))).toBe(
      "cc-number",
    );
    expect(tokenFor(input('<input autocomplete="shipping address-line1">'))).toBe("address-line1");
  });

  it("guesses from the words developers reach for", () => {
    expect(tokenFor(input('<input name="cardNumber">'))).toBe("cc-number");
    expect(tokenFor(input('<input id="cvv">'))).toBe("cc-csc");
    expect(tokenFor(input('<input placeholder="ZIP">'))).toBe("postal-code");
    expect(tokenFor(input('<input aria-label="First name">'))).toBe("given-name");
  });

  it("leaves anything ambiguous unmatched", () => {
    // A wrong guess types a card number into the wrong box. "code", "number"
    // and "name" alone are not enough to act on.
    expect(tokenFor(input('<input name="code">'))).toBeUndefined();
    expect(tokenFor(input('<input name="number">'))).toBeUndefined();
    expect(tokenFor(input('<input name="name">'))).toBeUndefined();
    expect(tokenFor(input("<input>"))).toBeUndefined();
  });

  it("honours autocomplete=off", () => {
    // Unlike a login, there is no long-standing convention of overriding it
    // for an address or a card.
    expect(tokenFor(input('<input autocomplete="off" name="cardNumber">'))).toBeUndefined();
  });

  it("never names a password field", () => {
    // Filling a card number into something the browser will not display is
    // how a number ends up where nobody can check it.
    expect(tokenFields(form('<input type="password" autocomplete="cc-number">')).size).toBe(0);
  });

  it("collects every field a form asks for", () => {
    const checkout = form(`
      <input autocomplete="cc-name">
      <input autocomplete="cc-number">
      <input autocomplete="cc-exp-month">
      <input autocomplete="cc-exp-year">
      <input autocomplete="cc-csc">
    `);

    expect([...tokenFields(checkout).keys()].sort()).toEqual([
      "cc-csc",
      "cc-exp-month",
      "cc-exp-year",
      "cc-name",
      "cc-number",
    ]);
  });

  it("keeps every field sharing a token", () => {
    // Billing and shipping side by side in one form. Which to fill is the
    // caller's decision, made from a click.
    const both = form(`
      <input autocomplete="billing postal-code">
      <input autocomplete="shipping postal-code">
    `);
    expect(tokenFields(both).get("postal-code")).toHaveLength(2);
  });

  it("reads the section a field belongs to", () => {
    expect(sectionOf(input('<input autocomplete="billing cc-number">'))).toBe("billing");
    expect(sectionOf(input('<input autocomplete="section-a shipping tel">'))).toBe("section-a shipping");
    // The common case: no section at all.
    expect(sectionOf(input('<input autocomplete="email">'))).toBe("");
    expect(sectionOf(input('<input name="whatever">'))).toBe("");
  });
});
