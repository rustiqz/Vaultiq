/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";
import { brandMark, initialOf, keyGlyph } from "./skin.js";

describe("initialOf", () => {
  it("is the first letter, capitalised", () => {
    expect(initialOf("work account")).toBe("W");
    expect(initialOf("  example")).toBe("E");
    expect(initialOf("émile")).toBe("É");
  });

  it("keeps a whole character, not half a surrogate pair", () => {
    expect(initialOf("😀 fun")).toBe("😀");
  });

  it("has a placeholder for a label with nothing in it", () => {
    expect(initialOf("")).toBe("•");
    expect(initialOf("   ")).toBe("•");
  });
});

describe("the drawn glyphs", () => {
  it("builds the mark from elements, with nothing that runs", () => {
    const mark = brandMark(document);

    expect(mark.namespaceURI).toBe("http://www.w3.org/2000/svg");
    // The ring, three spokes and the hub.
    expect(mark.children).toHaveLength(5);
    expect(mark.querySelector("script")).toBeNull();
    expect(mark.getAttribute("aria-hidden")).toBe("true");
  });

  it("draws the key", () => {
    expect(keyGlyph(document).children.length).toBeGreaterThan(0);
  });
});
