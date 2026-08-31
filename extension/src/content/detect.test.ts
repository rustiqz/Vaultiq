/**
 * @vitest-environment jsdom
 */

// Field detection against real markup. The cases that matter are the ones a
// login page actually throws at you: a hidden honeypot, two forms on a page,
// and a framework-backed input that ignores a plain value assignment.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fieldsFor, fillField, loginForms } from "./detect.js";

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
