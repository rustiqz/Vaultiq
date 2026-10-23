// The PIN is only safe because the blob it protects never touches disk, so
// these test that property as much as the mechanics.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionStore } from "../test/setup.js";
import { cryptoFake, resetFakes } from "../test/fakes.js";

vi.mock("./crypto.js", () => cryptoFake);

const {
  MAX_ATTEMPTS,
  MIN_PIN,
  armQuickUnlock,
  disarmQuickUnlock,
  quickUnlock,
  quickUnlockReady,
  quickUnlockStatus,
} = await import("./quick-unlock.js");

const salt = (): string => "salt-b64";

function vaultKey(): never {
  return cryptoFake.generateVaultKey() as never;
}

beforeEach(resetFakes);

describe("arming", () => {
  it("refuses a PIN that is too short or not digits", async () => {
    for (const pin of ["", "1", "123", "abcd", "12a4"]) {
      await expect(armQuickUnlock(pin, vaultKey(), salt)).rejects.toThrow(
        new RegExp(`${String(MIN_PIN)} digits`),
      );
    }
    expect(await quickUnlockReady()).toBe(false);
  });

  it("accepts a long enough numeric PIN", async () => {
    await armQuickUnlock("1234", vaultKey(), salt);
    expect(await quickUnlockReady()).toBe(true);
  });

  it("keeps the wrapped key in session storage and nowhere else", async () => {
    // The entire safety argument: a four-digit PIN is about thirteen bits, so
    // a blob on disk would fall to an offline search. In memory there is
    // nothing to attack offline.
    await armQuickUnlock("1234", vaultKey(), salt);
    expect(sessionStore.has("quickUnlock")).toBe(true);
  });

  it("derives from its own salt, not the vault's", async () => {
    await armQuickUnlock("1234", vaultKey(), salt);
    // Reusing the vault's salt would tie a weak secret to a strong one's
    // derivation for no benefit.
    const lastCall = cryptoFake.deriveMasterKey.mock.calls.at(-1);
    expect(lastCall?.[1]).toBe("salt-b64");
  });
});

describe("unlocking", () => {
  it("refuses when nothing is armed", async () => {
    await expect(quickUnlock("1234")).rejects.toThrow(/not set up/i);
  });

  it("reopens the vault with the right PIN", async () => {
    await armQuickUnlock("1234", vaultKey(), salt);
    await expect(quickUnlock("1234")).resolves.toBeDefined();
  });

  it("gives up after too many wrong guesses", async () => {
    await armQuickUnlock("1234", vaultKey(), salt);
    cryptoFake.unwrapVaultKey.mockImplementation(() => {
      throw new Error("decryption failed");
    });

    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await expect(quickUnlock("9999")).rejects.toThrow();
    }

    // Torn down, so the master password is the only way back in — and the
    // counter cannot be reset by restarting, because a restart destroys the
    // blob along with it.
    expect(await quickUnlockReady()).toBe(false);
    await expect(quickUnlock("1234")).rejects.toThrow(/not set up/i);
  });

  it("forgets the count after a correct PIN", async () => {
    await armQuickUnlock("1234", vaultKey(), salt);

    cryptoFake.unwrapVaultKey.mockImplementationOnce(() => {
      throw new Error("decryption failed");
    });
    await expect(quickUnlock("9999")).rejects.toThrow();

    await expect(quickUnlock("1234")).resolves.toBeDefined();
    expect(sessionStore.get("quickUnlockAttempts")).toBe(0);
  });

  it("says no more than the crypto core does", async () => {
    await armQuickUnlock("1234", vaultKey(), salt);
    cryptoFake.unwrapVaultKey.mockImplementationOnce(() => {
      throw new Error("decryption failed");
    });

    // A wrong PIN must not be distinguishable from a tampered blob.
    await expect(quickUnlock("9999")).rejects.toThrow("decryption failed");
  });
});

describe("disarming", () => {
  it("clears the blob and the count", async () => {
    await armQuickUnlock("1234", vaultKey(), salt);
    await disarmQuickUnlock();

    expect(await quickUnlockReady()).toBe(false);
    expect(sessionStore.has("quickUnlockAttempts")).toBe(false);
  });
});

describe("status", () => {
  it("says no PIN is set before one is armed", async () => {
    expect(await quickUnlockStatus()).toEqual({ set: false, attemptsLeft: 0 });
  });

  it("says a PIN is set, with every try left", async () => {
    await armQuickUnlock("1234", vaultKey(), salt);

    expect(await quickUnlockStatus()).toEqual({ set: true, attemptsLeft: MAX_ATTEMPTS });
  });

  it("counts wrong tries down", async () => {
    await armQuickUnlock("1234", vaultKey(), salt);
    cryptoFake.unwrapVaultKey.mockImplementation(() => {
      throw new Error("decryption failed");
    });

    await expect(quickUnlock("0000")).rejects.toThrow();
    await expect(quickUnlock("0000")).rejects.toThrow();

    expect(await quickUnlockStatus()).toEqual({ set: true, attemptsLeft: MAX_ATTEMPTS - 2 });
  });

  it("says no PIN is set once the tries are spent", async () => {
    await armQuickUnlock("1234", vaultKey(), salt);
    cryptoFake.unwrapVaultKey.mockImplementation(() => {
      throw new Error("decryption failed");
    });
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) await expect(quickUnlock("0000")).rejects.toThrow();

    expect(await quickUnlockStatus()).toEqual({ set: false, attemptsLeft: 0 });
  });

  it("goes back to full tries after a right one", async () => {
    await armQuickUnlock("1234", vaultKey(), salt);
    cryptoFake.unwrapVaultKey.mockImplementationOnce(() => {
      throw new Error("decryption failed");
    });
    await expect(quickUnlock("0000")).rejects.toThrow();
    expect((await quickUnlockStatus()).attemptsLeft).toBe(MAX_ATTEMPTS - 1);

    await quickUnlock("1234");

    expect((await quickUnlockStatus()).attemptsLeft).toBe(MAX_ATTEMPTS);
  });

  it("says no PIN is set after it is removed", async () => {
    await armQuickUnlock("1234", vaultKey(), salt);
    await disarmQuickUnlock();

    expect(await quickUnlockStatus()).toEqual({ set: false, attemptsLeft: 0 });
  });

  it("never reports anything derived from the PIN", async () => {
    await armQuickUnlock("1234", vaultKey(), salt);

    expect(JSON.stringify(await quickUnlockStatus())).not.toContain("1234");
  });
});
