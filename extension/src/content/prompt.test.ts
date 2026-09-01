/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { answerFrom, buildPromptCard, closePrompt, isPromptOpen, showPrompt } from "./prompt.js";

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

describe("what a click means", () => {
  it("trims what was typed", () => {
    expect(answerFrom(true, "  Work  ", " second account ")).toEqual({
      name: "Work",
      notes: "second account",
    });
  });

  it("saves with empty strings when nothing was typed", () => {
    expect(answerFrom(true, "", "")).toEqual({ name: "", notes: "" });
  });

  it("yields nothing at all when dismissed", () => {
    // "Not now" has to be distinguishable from "save without a name", or a
    // dismissal would quietly store the login anyway.
    expect(answerFrom(false, "typed anyway", "and notes")).toBeUndefined();
  });
});

describe("the name and notes fields", () => {
  it("are on the card, and scroll rather than clipping the buttons", () => {
    const card = buildPromptCard(document, COPY, vi.fn());
    document.body.append(card);

    expect(card.querySelector(".name")).not.toBeNull();
    expect(card.querySelector(".notes")).not.toBeNull();
    expect(card.querySelector(".fields")).not.toBeNull();
  });

  it("ignores a click the page synthesised", () => {
    // Nothing dispatched from script is trusted, so this is the real guard
    // rather than a stand-in — and it is why the decision above is tested as
    // a function instead of through the DOM.
    const decide = vi.fn();
    const card = buildPromptCard(document, COPY, decide);
    document.body.append(card);

    card.querySelector<HTMLButtonElement>(".save")!.click();
    card.querySelector<HTMLButtonElement>(".dismiss")!.click();

    expect(decide).not.toHaveBeenCalled();
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
