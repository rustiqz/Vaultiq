/**
 * @vitest-environment jsdom
 */

// The picker renders inside a page the extension does not control, so these
// test the defences rather than the appearance.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeDropdown, isInsideDropdown, showDropdown } from "./dropdown.js";

const ENTRIES = [
  { id: "a", label: "Personal", detail: "me@example.test" },
  { id: "b", label: "Work", detail: "me@work.test" },
];

function anchor(): HTMLInputElement {
  document.body.innerHTML = `<input type="password" id="p">`;
  return document.querySelector<HTMLInputElement>("#p")!;
}

function host(): HTMLElement | null {
  return document.querySelector("#vaultiq-picker");
}

beforeEach(() => {
  closeDropdown();
  document.body.innerHTML = "";
});

describe("resisting the page", () => {
  it("hides its contents from page script", () => {
    showDropdown(anchor(), ENTRIES, vi.fn());

    // A closed root: `element.shadowRoot` is null, so page script cannot read
    // which logins were listed, nor reach a button to click it.
    expect(host()).not.toBeNull();
    expect(host()?.shadowRoot).toBeNull();
  });

  it("pins every layout property against page CSS", () => {
    // A page that could set display:none or opacity:0 on the host would leave
    // a clickable but invisible dropdown sitting over its own UI, so every
    // rule is written with !important.
    //
    // Asserted on the calls rather than the stored style: jsdom's CSS
    // implementation drops the priority flag for several properties
    // (position, z-index, visibility) that real browsers honour, so reading
    // it back would test the environment rather than this code.
    const setProperty = vi.spyOn(CSSStyleDeclaration.prototype, "setProperty");
    showDropdown(anchor(), ENTRIES, vi.fn());

    const hostCalls = setProperty.mock.calls.filter(([property]) =>
      ["display", "opacity", "visibility", "z-index", "position", "pointer-events"].includes(
        property,
      ),
    );
    expect(hostCalls.length).toBeGreaterThanOrEqual(6);
    for (const [property, , priority] of hostCalls) {
      expect(priority, `${property} was not set !important`).toBe("important");
    }

    expect(host()!.style.getPropertyValue("display")).toBe("block");
    expect(host()!.style.getPropertyValue("opacity")).toBe("1");
  });

  it("does not render any password", () => {
    // Entries carry a label and a username. The password is fetched only
    // after a click, and never passes through here.
    showDropdown(anchor(), ENTRIES, vi.fn());
    expect(host()!.outerHTML).not.toContain("password");
  });
});

describe("behaviour", () => {
  it("renders nothing when there is nothing to offer", () => {
    showDropdown(anchor(), [], vi.fn());
    expect(host()).toBeNull();
  });

  it("replaces an open picker rather than stacking", () => {
    const field = anchor();
    showDropdown(field, ENTRIES, vi.fn());
    showDropdown(field, ENTRIES, vi.fn());
    expect(document.querySelectorAll("#vaultiq-picker")).toHaveLength(1);
  });

  it("closes on demand", () => {
    showDropdown(anchor(), ENTRIES, vi.fn());
    closeDropdown();
    expect(host()).toBeNull();
  });

  it("recognises its own clicks and nothing else", () => {
    showDropdown(anchor(), ENTRIES, vi.fn());
    expect(isInsideDropdown(host())).toBe(true);
    expect(isInsideDropdown(document.body)).toBe(false);
    expect(isInsideDropdown(null)).toBe(false);
  });

  it("closes when the page scrolls, so it cannot drift off its field", () => {
    showDropdown(anchor(), ENTRIES, vi.fn());
    document.dispatchEvent(new Event("scroll"));
    expect(host()).toBeNull();
  });
});
