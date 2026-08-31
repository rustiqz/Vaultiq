/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readSubmission, submittedFields } from "./capture.js";
import { fieldsFor } from "./detect.js";

function render(html: string): void {
  document.body.innerHTML = html;
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

describe("reading what was submitted", () => {
  it("takes the username and password that were typed", () => {
    render(`<form><input type="text" id="u"><input type="password" id="p"></form>`);
    document.querySelector<HTMLInputElement>("#u")!.value = "ada@example.test";
    document.querySelector<HTMLInputElement>("#p")!.value = "s3cret";

    const fields = fieldsFor(document.querySelector("#p")!)!;
    expect(readSubmission(fields)).toEqual({ username: "ada@example.test", password: "s3cret" });
  });

  it("offers nothing when no password was typed", () => {
    // A search form, or a login page the user abandoned.
    render(`<form><input type="text" id="u"><input type="password" id="p"></form>`);
    document.querySelector<HTMLInputElement>("#u")!.value = "ada@example.test";

    expect(readSubmission(fieldsFor(document.querySelector("#p")!)!)).toBeUndefined();
  });

  it("still offers a password with no username beside it", () => {
    render(`<form><input type="password" id="p"></form>`);
    document.querySelector<HTMLInputElement>("#p")!.value = "s3cret";

    expect(readSubmission(fieldsFor(document.querySelector("#p")!)!)).toEqual({
      username: "",
      password: "s3cret",
    });
  });
});

describe("finding the form that was submitted", () => {
  it("uses the form the event came from", () => {
    render(`
      <form id="signin"><input type="text"><input type="password" id="pa"></form>
      <form id="signup"><input type="text"><input type="password" id="pb"></form>`);

    const form = document.querySelector<HTMLFormElement>("#signin")!;
    expect(submittedFields(form, document)?.password.id).toBe("pa");
  });

  it("falls back to the only login form when the event was not a form", () => {
    // Plenty of sign-in pages submit through a button handler and an XHR.
    render(`<div><input type="text"><input type="password" id="p"></div>`);
    expect(submittedFields(null, document)?.password.id).toBe("p");
  });

  it("refuses to guess between two forms", () => {
    render(`
      <div><input type="password" id="pa"></div>
      <div><input type="password" id="pb"></div>`);

    // Saving the wrong form's password would be worse than not asking.
    expect(submittedFields(null, document)).toBeUndefined();
  });

  it("finds nothing on a page with no password field", () => {
    render(`<form><input type="text"></form>`);
    expect(submittedFields(null, document)).toBeUndefined();
  });
});
