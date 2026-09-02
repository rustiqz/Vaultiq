// Reopening a locked vault without retyping the master password.
//
// The vault key is wrapped under a key derived from a short PIN, and the
// result is held in `storage.session` — in memory, never written to disk.
//
// That last part is the whole design. A four-digit PIN carries about thirteen
// bits, so a blob protected by one and sitting on disk would fall to an
// offline search in minutes. Held only in memory there is nothing to attack
// offline: a stolen disk yields nothing, and an attacker with live process
// memory already has the vault key itself.
//
// It follows that closing the browser ends it. That is not a limitation to
// work around — it is what keeps a short PIN honest. Surviving a restart
// would mean putting the blob on disk, and then the PIN would need something
// outside the attacker's reach to rate-limit it.

import type { VaultKeyHandle } from "./crypto.js";
import { deriveMasterKey, unwrapVaultKey, wrapVaultKey } from "./crypto.js";

const BLOB = "quickUnlock";
const ATTEMPTS = "quickUnlockAttempts";

/** Wrong PINs before the quick unlock is torn down for the session. */
export const MAX_ATTEMPTS = 5;

/** Shortest PIN accepted. Four is the floor people expect; six is better. */
export const MIN_PIN = 4;

interface StoredQuickUnlock {
  /** A salt of its own, so the PIN's derivation is unrelated to the vault's. */
  saltB64: string;
  memoryKib: number;
  iterations: number;
  parallelism: number;
  wrapped: unknown;
}

/**
 * Argon2 costs for the PIN.
 *
 * Lower than the vault's, deliberately: this runs on every unlock and guards
 * a secret that only exists in memory for the length of a browser session.
 * The work factor is not what protects a PIN here — the absence of anything
 * to attack offline is.
 */
const PIN_PARAMS = { memoryKib: 19 * 1024, iterations: 2, parallelism: 1 };

function assertUsablePin(pin: string): void {
  if (!/^\d+$/.test(pin) || pin.length < MIN_PIN) {
    throw new Error(`A PIN must be at least ${String(MIN_PIN)} digits.`);
  }
}

/** Whether a PIN can currently reopen the vault. */
export async function quickUnlockReady(): Promise<boolean> {
  const stored = await browser.storage.session.get(BLOB);
  return typeof stored[BLOB] === "object" && stored[BLOB] !== null;
}

/** Arms the PIN for this browser session, from an unlocked vault. */
export async function armQuickUnlock(
  pin: string,
  vaultKey: VaultKeyHandle,
  generateSalt: () => string,
): Promise<void> {
  assertUsablePin(pin);

  const saltB64 = generateSalt();
  const pinKey = deriveMasterKey(
    pin,
    saltB64,
    PIN_PARAMS.memoryKib,
    PIN_PARAMS.iterations,
    PIN_PARAMS.parallelism,
  );

  try {
    const record: StoredQuickUnlock = {
      saltB64,
      memoryKib: PIN_PARAMS.memoryKib,
      iterations: PIN_PARAMS.iterations,
      parallelism: PIN_PARAMS.parallelism,
      wrapped: wrapVaultKey(vaultKey, pinKey) as unknown,
    };
    await browser.storage.session.set({ [BLOB]: record, [ATTEMPTS]: 0 });
  } finally {
    pinKey.free();
  }
}

/** Forgets the PIN. Called on lock, and after too many wrong guesses. */
export async function disarmQuickUnlock(): Promise<void> {
  await browser.storage.session.remove([BLOB, ATTEMPTS]);
}

/**
 * Reopens the vault with a PIN.
 *
 * A wrong PIN is counted, and the whole arrangement is torn down once the
 * allowance is spent — leaving the master password as the only way back in.
 * The counter lives beside the blob in memory, so restarting the browser
 * destroys both rather than resetting the count.
 */
export async function quickUnlock(pin: string): Promise<VaultKeyHandle> {
  const stored = await browser.storage.session.get([BLOB, ATTEMPTS]);
  const record = stored[BLOB] as StoredQuickUnlock | undefined;
  if (!record) throw new Error("Quick unlock is not set up.");

  const used = typeof stored[ATTEMPTS] === "number" ? stored[ATTEMPTS] : 0;
  if (used >= MAX_ATTEMPTS) {
    await disarmQuickUnlock();
    throw new Error("Too many attempts. Unlock with your master password.");
  }

  const pinKey = deriveMasterKey(
    pin,
    record.saltB64,
    record.memoryKib,
    record.iterations,
    record.parallelism,
  );

  try {
    const vaultKey = unwrapVaultKey(record.wrapped, pinKey);
    await browser.storage.session.set({ [ATTEMPTS]: 0 });
    return vaultKey;
  } catch (error) {
    const now = used + 1;
    if (now >= MAX_ATTEMPTS) await disarmQuickUnlock();
    else await browser.storage.session.set({ [ATTEMPTS]: now });
    // The crypto core says only "decryption failed"; nothing is added here.
    throw error;
  } finally {
    pinKey.free();
  }
}
