/**
 * @vitest-environment jsdom
 */

// A password on the clipboard is readable by every application on the
// machine, so the timer is the feature, not a nicety.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIPBOARD_SECONDS, copyForAWhile } from "./clipboard.js";

let board = "";
// Held onto rather than reached back through `navigator.clipboard`, which
// would be passing a method around unbound.
let readText = vi.fn(() => Promise.resolve(board));

beforeEach(() => {
  vi.useFakeTimers();
  board = "";
  readText = vi.fn(() => Promise.resolve(board));

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn((text: string) => {
        board = text;
        return Promise.resolve();
      }),
      readText,
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("copying a secret", () => {
  it("puts it on the clipboard", async () => {
    await copyForAWhile("s3cret");
    expect(board).toBe("s3cret");
  });

  it("takes it back after the window", async () => {
    await copyForAWhile("s3cret");

    await vi.advanceTimersByTimeAsync(CLIPBOARD_SECONDS * 1000 - 100);
    expect(board).toBe("s3cret");

    await vi.advanceTimersByTimeAsync(200);
    expect(board).toBe("");
  });

  it("leaves alone whatever was copied since", async () => {
    await copyForAWhile("s3cret");
    board = "something the user copied";

    await vi.advanceTimersByTimeAsync(CLIPBOARD_SECONDS * 1000 + 100);

    // Wiping this would be its own small betrayal.
    expect(board).toBe("something the user copied");
  });

  it("restarts the clock on a second copy", async () => {
    await copyForAWhile("first");
    await vi.advanceTimersByTimeAsync(CLIPBOARD_SECONDS * 1000 - 500);

    await copyForAWhile("second");
    await vi.advanceTimersByTimeAsync(1_000);

    // The first timer must not clear the second copy early.
    expect(board).toBe("second");

    await vi.advanceTimersByTimeAsync(CLIPBOARD_SECONDS * 1000);
    expect(board).toBe("");
  });

  it("leaves the clipboard alone when it cannot be read", async () => {
    await copyForAWhile("s3cret");
    readText.mockRejectedValueOnce(new Error("denied"));

    await vi.advanceTimersByTimeAsync(CLIPBOARD_SECONDS * 1000 + 100);

    // Clearing blind would wipe something the user copied since.
    expect(board).toBe("s3cret");
  });
});
