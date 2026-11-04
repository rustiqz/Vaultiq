/**
 * @vitest-environment jsdom
 */

// The mark is drawn inside a page the extension does not control, so these
// test the defences and the open/closed bookkeeping, not the appearance.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hideLauncher,
  isDismissed,
  isInsideLauncher,
  launcherAnchor,
  markDismissed,
  showLauncher,
} from "./launcher.js";

function field(): HTMLInputElement {
  document.body.innerHTML = `<input type="password" id="p">`;
  const input = document.querySelector<HTMLInputElement>("#p")!;
  // jsdom has no layout; give the field a believable box.
  input.getBoundingClientRect = () =>
    ({ left: 10, right: 310, top: 10, bottom: 42, width: 300, height: 32 }) as DOMRect;
  return input;
}

function host(): HTMLElement | null {
  return document.querySelector("#vaultiq-launcher");
}

beforeEach(() => {
  hideLauncher();
  document.body.innerHTML = "";
});

describe("the launcher", () => {
  it("is drawn on the field, in a closed root", () => {
    const input = field();
    showLauncher(input, vi.fn());
    expect(host()).not.toBeNull();
    expect(host()!.shadowRoot).toBeNull();
    expect(launcherAnchor()).toBe(input);
    expect(isInsideLauncher(host())).toBe(true);
  });

  it("pins every layout property against page CSS", () => {
    // Asserted on the calls: jsdom drops the priority flag for some
    // properties, so reading it back would test the environment.
    const setProperty = vi.spyOn(CSSStyleDeclaration.prototype, "setProperty");
    showLauncher(field(), vi.fn());

    const hostCalls = setProperty.mock.calls.filter(([property]) =>
      ["display", "opacity", "visibility", "z-index", "position", "pointer-events"].includes(
        property,
      ),
    );
    expect(hostCalls.length).toBeGreaterThanOrEqual(6);
    for (const [property, , priority] of hostCalls) {
      expect(priority, `${property} was not set !important`).toBe("important");
    }
    setProperty.mockRestore();
  });

  it("goes away on hide", () => {
    showLauncher(field(), vi.fn());
    hideLauncher();
    expect(host()).toBeNull();
    expect(launcherAnchor()).toBeUndefined();
  });

  it("is not drawn on a field too small to hold it", () => {
    const input = field();
    input.getBoundingClientRect = () =>
      ({ left: 0, right: 30, top: 0, bottom: 32, width: 30, height: 32 }) as DOMRect;
    showLauncher(input, vi.fn());
    expect(host()).toBeNull();
  });

  it("is not duplicated by a second show on the same field", () => {
    const input = field();
    showLauncher(input, vi.fn());
    showLauncher(input, vi.fn());
    expect(document.querySelectorAll("#vaultiq-launcher")).toHaveLength(1);
  });
});

describe("dismissal", () => {
  it("is remembered per field", () => {
    const a = field();
    const b = document.createElement("input");
    expect(isDismissed(a)).toBe(false);
    markDismissed(a);
    expect(isDismissed(a)).toBe(true);
    expect(isDismissed(b)).toBe(false);
  });
});
