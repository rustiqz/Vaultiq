// Hashing the two secrets the server is allowed to hold.
//
// Neither is a password. The auth key is HKDF output and a device credential
// is drawn straight from the CSPRNG, so both are 256 bits of uniform entropy
// and a fast hash would technically be enough.
//
// Argon2id is used anyway. It costs a few milliseconds on a login, and it
// covers the case where that entropy assumption turns out wrong — a client
// bug that shortened a key, or a future change to the derivation. Cheap
// insurance against the failure that would otherwise be silent.

import { hash, verify } from "@node-rs/argon2";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Deliberately lighter than the vault's own KDF.
 *
 * The vault's parameters defend a human-chosen password against an offline
 * search. These defend a 256-bit random value, where the search is not the
 * threat — so the cost is set to be unnoticeable on every request instead.
 */
const PARAMS = { memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 } as const;

export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

export async function hashSecret(secret: string): Promise<string> {
  return await hash(secret, PARAMS);
}

/**
 * Whether a secret matches its stored hash.
 *
 * Returns false rather than throwing on a malformed hash: a corrupt row
 * should deny access, not crash the request handling every other user.
 */
export async function secretMatches(secret: string, stored: string): Promise<boolean> {
  try {
    return await verify(stored, secret);
  } catch {
    return false;
  }
}

/**
 * Compares two values without leaking where they diverge.
 *
 * For tokens looked up by their own hash, where there is no Argon2 verify to
 * hide the comparison.
 */
export function equalSecrets(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch, which would itself be a
  // signal, so the lengths are compared first and the result folded in.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * A fast fingerprint for tokens, not the Argon2id hash above.
 *
 * A token is already 256 bits of uniform entropy, drawn straight from the
 * CSPRNG, and it's looked up by this fingerprint rather than verified
 * against a chosen value -- so unlike an auth key or device credential,
 * there's no offline search this needs to be slow against, only a database
 * dump this needs to not hand back a working token from.
 */
export function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
