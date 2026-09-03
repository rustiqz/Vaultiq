// Fakes for the two modules the vault sits on top of.
//
// The crypto is faked on purpose. Its correctness is covered by the crate's
// unit tests, its known-answer vectors — cross-computed with OpenSSL and
// libsodium — and its browser tests. What has no coverage is the
// *orchestration*: whether the vault passes the right header when it
// re-encrypts. Faking `encryptItem` as a spy is what makes that assertable.
//
// The stored record keeps its plaintext so a test can see what was written;
// nothing here is, or pretends to be, encryption.

import { vi } from "vitest";
import type { StoredItem, UsageRecord, VaultRecord } from "../lib/vault-db.js";

export interface FakeHeader {
  id: string;
  item_type: string;
  version: number;
  updated_at: number;
  deleted: boolean;
}

/** Every header the vault has encrypted under, in order. */
export const encryptedHeaders: FakeHeader[] = [];

/** Handles that were freed, so a test can prove keys are released. */
export const freed: string[] = [];

function handle(name: string) {
  return {
    free: vi.fn(() => void freed.push(name)),
    exportForSessionStorage: vi.fn(() => `session-${name}`),
  };
}

export const cryptoFake = {
  loadCrypto: vi.fn(() => Promise.resolve()),
  assertSessionStorage: vi.fn(),
  recommendedParams: vi.fn(() => ({ memory_kib: 65536, iterations: 3, parallelism: 4 })),
  recommendedPasswordOptions: vi.fn(() => ({
    length: 20,
    lowercase: true,
    uppercase: true,
    digits: true,
    symbols: true,
  })),
  generatePassword: vi.fn(() => "Generated-Password-1!"),
  // Scores by length alone, which is enough to tell the vault's plumbing
  // apart from the real estimator. The estimator itself is tested in Rust.
  scorePassword: vi.fn((password: string) => ({
    bits: password.length * 6,
    level: password.length >= 16 ? "excellent" : "weak",
  })),
  generateSalt: vi.fn(() => "salt-b64"),
  // Enough to tell the vault's plumbing apart from the real generator: the
  // algorithm itself is pinned against RFC 6238 in Rust.
  totpCode: vi.fn(
    (secret: string, _algorithm: string, digits: number, _period: number, _at: number) => {
      if (secret === "bad-secret") throw new Error("invalid argument: TOTP secret");
      return "1".repeat(digits);
    },
  ),
  totpSecondsRemaining: vi.fn((period: number, at: number) => period - (at % period)),
  generateVaultKey: vi.fn(() => handle("vault")),
  // Takes the real arguments so a test can assert what it was called with. A
  // zero-argument fake records empty tuples and verifies nothing.
  deriveMasterKey: vi.fn(
    (_password: string, _saltB64: string, _m: number, _t: number, _p: number) => handle("master"),
  ),
  deriveAuthKey: vi.fn(() => "auth-b64"),
  wrapVaultKey: vi.fn(() => ({ version: 1, ciphertext: [], nonce: [] })),
  unwrapVaultKey: vi.fn(() => handle("vault")),

  encryptItem: vi.fn((plaintext: string, header: FakeHeader) => {
    encryptedHeaders.push({ ...header });
    // The "ciphertext" is the plaintext, so a test can read what was stored.
    return { ...header, format: 1, ciphertext: [], nonce: [], plaintext };
  }),
  decryptItem: vi.fn((item: StoredItem & { plaintext?: string }) => item.plaintext ?? "{}"),

  stashVaultKey: vi.fn(() => Promise.resolve()),
  takeStashedVaultKey: vi.fn(() => Promise.resolve(undefined)),
  clearStashedVaultKey: vi.fn(() => Promise.resolve()),
};

/**
 * A stored record, plus the plaintext the fake "encrypted".
 *
 * Real records carry only ciphertext; this extra field is what lets a test
 * see what was actually written.
 */
export type FakeStoredItem = StoredItem & { plaintext: string };

/** An in-memory stand-in for IndexedDB. */
export const db = {
  vault: undefined as VaultRecord | undefined,
  items: new Map<string, FakeStoredItem>(),
  usage: new Map<string, UsageRecord>(),
};

/** The content a test believes is stored for an item. */
export function storedContent(id: string): Record<string, unknown> {
  const item = db.items.get(id);
  if (!item) throw new Error(`no stored item ${id}`);
  return JSON.parse(item.plaintext) as Record<string, unknown>;
}

export const dbFake = {
  getVault: vi.fn(() => Promise.resolve(db.vault)),
  putVault: vi.fn((record: VaultRecord) => {
    db.vault = record;
    return Promise.resolve();
  }),
  getItem: vi.fn((id: string) => Promise.resolve(db.items.get(id))),
  putItem: vi.fn((item: StoredItem) => {
    // Always a FakeStoredItem here: it came from the fake encryptItem above.
    db.items.set(item.id, item as FakeStoredItem);
    return Promise.resolve();
  }),
  allItems: vi.fn(() => Promise.resolve([...db.items.values()])),
  getUsage: vi.fn((deviceId: string) => Promise.resolve(db.usage.get(`usage:${deviceId}`))),
  allUsage: vi.fn(() => Promise.resolve([...db.usage.values()])),
  putUsage: vi.fn((record: UsageRecord) => {
    db.usage.set(record.id, record);
    return Promise.resolve();
  }),
};

export function resetFakes(): void {
  encryptedHeaders.length = 0;
  freed.length = 0;

  // Implementations, not just call history: a persistent mockImplementation
  // set by one test would otherwise leak into every test after it.
  cryptoFake.unwrapVaultKey.mockImplementation(() => handle("vault"));
  cryptoFake.decryptItem.mockImplementation(
    (item: StoredItem & { plaintext?: string }) => item.plaintext ?? "{}",
  );
  db.vault = undefined;
  db.items.clear();
  db.usage.clear();
  cryptoFake.takeStashedVaultKey.mockResolvedValue(undefined);
}
