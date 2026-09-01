import { afterEach, describe, expect, it, vi } from "vitest";
import { ago } from "./format.js";

afterEach(() => {
  vi.useRealTimers();
});

function at(secondsAgo: number): number {
  return Date.now() - secondsAgo * 1000;
}

describe("relative time", () => {
  it("says never when there is nothing to say", () => {
    expect(ago(undefined)).toBe("never");
    expect(ago(0)).toBe("never");
  });

  it("collapses anything very recent", () => {
    expect(ago(at(2))).toBe("just now");
    expect(ago(at(40))).toBe("just now");
  });

  it("picks the largest unit that fits", () => {
    // The bug worth guarding: an implementation that always picks the first
    // unit reports "7200 seconds ago".
    expect(ago(at(120))).toMatch(/minute/);
    expect(ago(at(7_200))).toMatch(/hour/);
    expect(ago(at(172_800))).toMatch(/day/);
    expect(ago(at(7_776_000))).toMatch(/month/);
    expect(ago(at(63_072_000))).toMatch(/year/);
  });
});
