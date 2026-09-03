// A typed wrapper over the wasm package.
//
// Nothing here makes a crypto decision — that all lives in `pw-crypto-core`.
// This file exists to load the module once, to keep the handle types honest,
// and to hold the one rule about session storage in a single place.

import init, {
  MasterKeyHandle,
  VaultKeyHandle,
  defaultArgon2Params,
  defaultPasswordOptions,
  estimateStrength,
  generatePassword,
  deriveAuthKey,
  deriveMasterKey,
  encryptItem,
  decryptItem,
  generateSalt,
  generateVaultKey,
  unwrapVaultKey,
  wrapVaultKey,
} from "../../vendor/pw-crypto-core/pw_crypto_core.js";

export type { MasterKeyHandle, VaultKeyHandle };
export {
  generatePassword,
  decryptItem,
  deriveAuthKey,
  deriveMasterKey,
  encryptItem,
  generateSalt,
  generateVaultKey,
  unwrapVaultKey,
  wrapVaultKey,
};

export interface Argon2Params {
  memory_kib: number;
  iterations: number;
  parallelism: number;
}

export interface PasswordOptions {
  length: number;
  lowercase: boolean;
  uppercase: boolean;
  digits: boolean;
  symbols: boolean;
}

export type StrengthLevel = "very-weak" | "weak" | "fair" | "strong" | "excellent";

export interface PasswordStrength {
  bits: number;
  level: StrengthLevel;
}

let ready: Promise<unknown> | undefined;

/**
 * Loads the wasm module, once.
 *
 * The `.wasm` is resolved through `runtime.getURL` because a background
 * context has no meaningful document base URL to resolve a relative path
 * against.
 */
export async function loadCrypto(): Promise<void> {
  ready ??= init({
    module_or_path: browser.runtime.getURL("pw_crypto_core_bg.wasm"),
  });
  await ready;
}

export function recommendedParams(): Argon2Params {
  return defaultArgon2Params() as Argon2Params;
}

export function recommendedPasswordOptions(): PasswordOptions {
  return defaultPasswordOptions() as PasswordOptions;
}

/**
 * Scores a password.
 *
 * Wrapped rather than re-exported: the binding hands back a JsValue, which is
 * `any` to TypeScript, and this is the one place that shape is asserted.
 */
export function scorePassword(password: string): PasswordStrength {
  return estimateStrength(password) as PasswordStrength;
}

/**
 * The only place a vault key is allowed to leave wasm.
 *
 * `storage.session` is held in memory and never written to disk, so the key
 * lives exactly as long as the browser session. Putting this value in
 * `storage.local`, IndexedDB or any other durable store would turn a
 * memory-lifetime secret into a permanent one — see the Rust doc comment on
 * `exportForSessionStorage`.
 */
const SESSION_KEY = "vaultKey";

export async function stashVaultKey(vaultKey: VaultKeyHandle): Promise<void> {
  await browser.storage.session.set({
    [SESSION_KEY]: vaultKey.exportForSessionStorage(),
  });
}

export async function takeStashedVaultKey(): Promise<VaultKeyHandle | undefined> {
  const stored = await browser.storage.session.get(SESSION_KEY);
  const encoded: unknown = stored[SESSION_KEY];
  if (typeof encoded !== "string") return undefined;
  return VaultKeyHandle.restoreFromSessionStorage(encoded);
}

export async function clearStashedVaultKey(): Promise<void> {
  await browser.storage.session.remove(SESSION_KEY);
}

/**
 * Fails loudly if `storage.session` is missing.
 *
 * Without it the key would have nowhere to live but disk, and the unlock
 * design silently becomes something we explicitly rejected.
 */
export function assertSessionStorage(): void {
  if (typeof browser.storage.session === "undefined") {
    throw new Error(
      "This browser has no storage.session. Vaultiq will not keep a vault key anywhere else.",
    );
  }
}
