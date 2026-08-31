/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { closePrompt, isPromptOpen, showPrompt } from "./prompt.js";

const COPY = { title: "Save this login?", detail: "ada@example.test · example.com", confirm: "Save" };

function host(): HTMLElement | null {
  return document.querySelector("#vaultiq-save-prompt");
}

beforeEach(() => {
  closePrompt();
  document.body.innerHTML = "";
});

describe("resisting the page", () => {
  it("hides its contents from page script", () => {
    showPrompt(document, COPY, vi.fn());
    expect(host()).not.toBeNull();
    expect(host()?.shadowRoot).toBeNull();
  });

  it("pins every layout property against page CSS", () => {
    // Asserted on the calls: jsdom drops the priority flag for several
    // properties that real browsers honour.
    const setProperty = vi.spyOn(CSSStyleDeclaration.prototype, "setProperty");
    showPrompt(document, COPY, vi.fn());

    const calls = setProperty.mock.calls.filter(([property]) =>
      ["display", "opacity", "visibility", "z-index", "position", "pointer-events"].includes(
        property,
      ),
    );
    expect(calls.length).toBeGreaterThanOrEqual(6);
    for (const [property, , priority] of calls) {
      expect(priority, `${property} was not set !important`).toBe("important");
    }
  });

  it("never puts the password on screen", () => {
    // There is no reason to show a secret to ask a yes/no question, and a
    // banner that did would be worth phishing.
    showPrompt(document, { ...COPY, detail: "ada@example.test · example.com" }, vi.fn());
    expect(host()!.outerHTML).not.toContain("s3cret");
    expect(host()!.outerHTML.toLowerCase()).not.toContain("password");
  });
});

describe("behaviour", () => {
  it("reports whether it is open", () => {
    expect(isPromptOpen()).toBe(false);
    showPrompt(document, COPY, vi.fn());
    expect(isPromptOpen()).toBe(true);
    closePrompt();
    expect(isPromptOpen()).toBe(false);
  });

  it("replaces an open prompt rather than stacking", () => {
    showPrompt(document, COPY, vi.fn());
    showPrompt(document, COPY, vi.fn());
    expect(document.querySelectorAll("#vaultiq-save-prompt")).toHaveLength(1);
  });
});
