/**
 * @vitest-environment jsdom
 */

// The picker renders inside a page the extension does not control, so these
// test the defences rather than the appearance.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { belongsToDropdown, closeDropdown, isInsideDropdown, showDropdown } from "./dropdown.js";

const ENTRIES = [
  { id: "a", label: "Personal", detail: "me@example.test" },
  { id: "b", label: "Work", detail: "me@work.test" },
];

function anchor(): HTMLInputElement {
  document.body.innerHTML = `<input type="password" id="p">`;
  return document.querySelector<HTMLInputElement>("#p")!;
}

/**
 * Reads what was drawn into the closed shadow root.
 *
 * Page script cannot do this, and the tests should not weaken that — so the
 * root is opened only for the duration of the call, by wrapping `attachShadow`,
 * and put back afterwards.
 */
function drawn(show: () => void): ShadowRoot {
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "attachShadow");
  if (!descriptor) throw new Error("no attachShadow to wrap");
  const original = descriptor.value as (this: Element, init: ShadowRootInit) => ShadowRoot;
  let root: ShadowRoot | undefined;
  Object.defineProperty(Element.prototype, "attachShadow", {
    ...descriptor,
    value(this: Element, init: ShadowRootInit): ShadowRoot {
      root = original.call(this, { ...init, mode: "open" });
      return root;
    },
  });
  try {
    show();
  } finally {
    Object.defineProperty(Element.prototype, "attachShadow", descriptor);
  }
  if (!root) throw new Error("nothing was drawn");
  return root;
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

  it("does not render a stored password", () => {
    // Entries for saved logins carry a label and a username. Their password
    // is fetched only after a click and never passes through here.
    //
    // A *generated* suggestion is different: it has not been stored yet, and
    // showing it is the point — the user may want to note it down.
    showDropdown(anchor(), ENTRIES, vi.fn());
    expect(host()!.outerHTML).not.toContain("s3cret-stored-value");
  });

  it("sets the suggestion apart from saved logins", () => {
    showDropdown(
      anchor(),
      [{ id: "s", label: "Use a suggested password", detail: "Xk4!qz", emphasis: true }, ...ENTRIES],
      vi.fn(),
    );
    // Not decoration: a row that fills a *new* password should not look
    // identical to one that fills a saved one.
    expect(host()).not.toBeNull();
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

  // The bug this replaced: the browser scrolls a focused field into view, and
  // the picker closed itself the instant it opened.
  it("survives the window scrolling", () => {
    showDropdown(anchor(), ENTRIES, vi.fn());

    const scroll = new Event("scroll");
    Object.defineProperty(scroll, "target", { value: document });
    document.dispatchEvent(scroll);

    // Positioned in page coordinates, so a window scroll carries it along
    // with the field. Closing would be wrong as well as unhelpful.
    expect(host()).not.toBeNull();
  });

  it("closes when a container scrolls out from under it", () => {
    document.body.innerHTML = `<div id="scroller"><input type="password" id="p"></div>`;
    showDropdown(document.querySelector<HTMLInputElement>("#p")!, ENTRIES, vi.fn());

    const scroller = document.querySelector("#scroller")!;
    scroller.dispatchEvent(new Event("scroll", { bubbles: false }));

    // An inner scroll does move the field without moving the picker.
    expect(host()).toBeNull();
  });

  it("stays open when the field that opened it is clicked", () => {
    // Clicking that field is what opened the picker. Treating the click as
    // "elsewhere" closed it again the same instant.
    const field = anchor();
    showDropdown(field, ENTRIES, vi.fn());
    expect(belongsToDropdown(field)).toBe(true);
  });

  it("closes when something else is clicked", () => {
    showDropdown(anchor(), ENTRIES, vi.fn());
    expect(belongsToDropdown(document.body)).toBe(false);
    expect(belongsToDropdown(null)).toBe(false);
  });

  it("forgets its anchor once closed", () => {
    const field = anchor();
    showDropdown(field, ENTRIES, vi.fn());
    closeDropdown();
    expect(belongsToDropdown(field)).toBe(false);
  });
});

describe("what it draws", () => {
  it("names the product, so it can be told from a lookalike", () => {
    const root = drawn(() => showDropdown(anchor(), ENTRIES, vi.fn()));

    expect(root.querySelector(".head")?.textContent).toContain("Vaultiq");
    expect(root.querySelector(".head svg")).not.toBeNull();
  });

  it("gives each login a letter and a Fill action", () => {
    const root = drawn(() => showDropdown(anchor(), ENTRIES, vi.fn()));

    const rows = [...root.querySelectorAll("li")];
    expect(rows.map((row) => row.querySelector(".avatar")?.textContent)).toEqual(["P", "W"]);
    expect(rows.map((row) => row.querySelector(".fill")?.textContent)).toEqual(["Fill", "Fill"]);
    expect(rows[0]?.querySelector(".label")?.textContent).toBe("Personal");
    expect(rows[0]?.querySelector(".detail")?.textContent).toBe("me@example.test");
  });

  it("counts saved logins, not the suggested password", () => {
    const root = drawn(() =>
      showDropdown(
        anchor(),
        [{ id: "s", label: "Use a suggested password", detail: "Xk4!qz", emphasis: true }, ...ENTRIES],
        vi.fn(),
      ),
    );

    expect(root.querySelector(".count")?.textContent).toBe("2 saved");
    const suggestion = root.querySelector("li.emphasis");
    expect(suggestion?.querySelector(".fill")?.textContent).toBe("Use");
    expect(suggestion?.querySelector(".avatar svg")).not.toBeNull();
  });

  it("shows no count when only a suggestion is on offer", () => {
    const root = drawn(() =>
      showDropdown(anchor(), [{ id: "s", label: "Use a suggested password", detail: "Xk4!qz", emphasis: true }], vi.fn()),
    );

    expect(root.querySelector(".count")).toBeNull();
  });

  it("renders text as text, never as markup", () => {
    const root = drawn(() =>
      showDropdown(anchor(), [{ id: "x", label: "<img src=x onerror=alert(1)>", detail: "<b>hi</b>" }], vi.fn()),
    );

    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector(".detail b")).toBeNull();
    expect(root.querySelector(".label")?.textContent).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("where it sits", () => {
  function viewport(width: number): void {
    Object.defineProperty(document.documentElement, "clientWidth", { value: width, configurable: true });
  }

  it("is at least 280px wide, whatever the field is", () => {
    viewport(1000);
    showDropdown(anchor(), ENTRIES, vi.fn());

    expect(host()?.style.getPropertyValue("width")).toBe("280px");
  });

  it("stays inside the viewport for a field near the right edge", () => {
    viewport(400);
    const field = anchor();
    field.getBoundingClientRect = () => ({ left: 380, right: 400, top: 0, bottom: 20, width: 20, height: 20, x: 380, y: 0 }) as DOMRect;

    showDropdown(field, ENTRIES, vi.fn());

    // 400 - 280 - 8: its right edge ends 8px inside the viewport.
    expect(host()?.style.getPropertyValue("left")).toBe("112px");
  });

  it("never starts left of the edge margin", () => {
    viewport(1000);
    const field = anchor();
    field.getBoundingClientRect = () => ({ left: -50, right: 0, top: 0, bottom: 20, width: 50, height: 20, x: -50, y: 0 }) as DOMRect;

    showDropdown(field, ENTRIES, vi.fn());

    expect(host()?.style.getPropertyValue("left")).toBe("8px");
  });

  it("pins a light colour scheme so the OS theme cannot restyle it", () => {
    showDropdown(anchor(), ENTRIES, vi.fn());

    expect(host()?.style.getPropertyValue("color-scheme")).toBe("light");
  });
});
