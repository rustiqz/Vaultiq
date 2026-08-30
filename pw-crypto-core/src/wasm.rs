//! Thin `wasm_bindgen` wrappers for the browser extension.
//!
//! This is a marshalling layer and nothing else: base64 and `JsValue` in,
//! Rust types out, straight into `kdf` / `keys` / `vault_item`. No crypto
//! decision is made here (CLAUDE.md §4.13).
//!
//! # Keys never cross into JavaScript
//!
//! Every secret is returned as an opaque handle — [`MasterKeyHandle`],
//! [`VaultKeyHandle`] — which JS holds as a pointer into wasm linear memory.
//! Handing back base64 key material instead would put it in a garbage
//! collected JS string that nothing can scrub. The one exception is
//! [`derive_auth_key`], which returns base64 because that key is *meant* to
//! leave the device, and decrypts nothing.
//!
//! [`derive_stretched_encryption_key`](crate::derive_stretched_encryption_key)
//! is deliberately not exposed. JS never needs it on its own, and not
//! exporting it removes a way to misuse the hierarchy.
//!
//! # Freeing handles
//!
//! `wasm_bindgen` handles are **not** garbage collected. If JS drops a handle
//! without calling `.free()`, `Drop` never runs, so `ZeroizeOnDrop` never
//! scrubs the key and it stays in memory until the module is torn down.
//! Locking a vault means calling `.free()` on every handle — there is a
//! [`MasterKeyHandle::lock`] alias that reads better at a call site.

use crate::error::CryptoError;
use crate::kdf::{Argon2Params, MasterKey, SALT_LEN, Salt};
use crate::keys::{
    KEY_LEN, VaultKey, WrappedVaultKey, derive_auth_key as derive_auth,
    derive_stretched_encryption_key, unwrap_vault_key as unwrap_key, wrap_vault_key as wrap_key,
};
use crate::vault_item::{EncryptedItem, ItemHeader, decrypt_item as decrypt, encrypt_item};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as B64;
use serde::Deserialize;
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

/// Collapses every `CryptoError` into one opaque JavaScript error.
///
/// No branching on the variant, by design. Wrong password, wrong key,
/// tampered ciphertext, tampered nonce, altered header and truncated input
/// must be one indistinguishable outcome on this side of the boundary too —
/// telling them apart is what a decryption oracle is built from
/// (CLAUDE.md §2.4). Detailed diagnostics stay on the Rust side, reachable
/// only from a debug build, never from here.
fn opaque(_error: CryptoError) -> JsError {
    JsError::new("decryption failed")
}

/// Reports a malformed *argument*, which is a caller bug rather than a
/// cryptographic failure.
///
/// This is not a leak: it says only that a value the caller just supplied was
/// the wrong shape, which the caller already knows. It never reports anything
/// derived from a key or a plaintext.
fn bad_argument(what: &str) -> JsError {
    JsError::new(&format!("invalid argument: {what}"))
}

fn decode_b64(value: &str, what: &str) -> Result<Vec<u8>, JsError> {
    B64.decode(value).map_err(|_| bad_argument(what))
}

/// An opaque handle to a derived master key.
///
/// Call [`lock`](Self::lock) (or `free()`) when the vault locks; see the
/// module docs on why that is not automatic.
#[wasm_bindgen]
pub struct MasterKeyHandle(MasterKey);

// Hand-written and redacted, exactly as the key it wraps. A derived Debug
// here would print through the handle to the key material.
impl core::fmt::Debug for MasterKeyHandle {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("MasterKeyHandle([REDACTED])")
    }
}

#[wasm_bindgen]
impl MasterKeyHandle {
    /// Scrubs the key and releases the handle.
    ///
    /// An alias for `free()` that reads correctly at a call site. After this
    /// the handle is unusable.
    pub fn lock(self) {
        drop(self);
    }
}

/// An opaque handle to the vault key.
///
/// See [`MasterKeyHandle`] for the freeing rules — they are identical.
#[wasm_bindgen]
pub struct VaultKeyHandle(VaultKey);

// See MasterKeyHandle: redacted by hand, never derived.
impl core::fmt::Debug for VaultKeyHandle {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("VaultKeyHandle([REDACTED])")
    }
}

#[wasm_bindgen]
impl VaultKeyHandle {
    /// Scrubs the key and releases the handle.
    pub fn lock(self) {
        drop(self);
    }
}

/// The Argon2id cost parameters this build recommends.
///
/// Returned so a client does not hard-code them: the values a vault was
/// created with are stored alongside it, and these are only the defaults for
/// a *new* vault.
#[wasm_bindgen(js_name = defaultArgon2Params)]
pub fn default_argon2_params() -> Result<wasm_bindgen::JsValue, JsError> {
    serde_wasm_bindgen::to_value(&Argon2Params::default())
        .map_err(|_| JsError::new("could not serialize parameters"))
}

/// Draws a fresh per-vault salt, base64 encoded.
///
/// Not secret — it is stored in the clear beside the vault — but it must come
/// from a CSPRNG, which is why JS does not generate it.
#[wasm_bindgen(js_name = generateSalt)]
pub fn generate_salt() -> Result<String, JsError> {
    let salt = Salt::generate().map_err(opaque)?;
    Ok(B64.encode(salt.as_bytes()))
}

/// Derives the master key from the master password.
///
/// The returned handle keeps the key inside wasm memory; nothing about it
/// reaches JavaScript.
#[wasm_bindgen(js_name = deriveMasterKey)]
pub fn derive_master_key(
    password: &str,
    salt_b64: &str,
    memory_kib: u32,
    iterations: u32,
    parallelism: u32,
) -> Result<MasterKeyHandle, JsError> {
    let salt_bytes = decode_b64(salt_b64, "salt")?;
    if salt_bytes.len() != SALT_LEN {
        return Err(bad_argument("salt"));
    }
    let salt = Salt::from_bytes(&salt_bytes).map_err(opaque)?;

    let params = Argon2Params {
        memory_kib,
        iterations,
        parallelism,
    };

    MasterKey::derive(password, &salt, &params)
        .map(MasterKeyHandle)
        .map_err(opaque)
}

/// Derives the auth key, base64 encoded, for sending to the server.
///
/// This is the one derived key that legitimately leaves the device. It
/// decrypts nothing: a server holding it cannot read a single vault item.
#[wasm_bindgen(js_name = deriveAuthKey)]
pub fn derive_auth_key(master_key: &MasterKeyHandle) -> Result<String, JsError> {
    let auth_key = derive_auth(&master_key.0).map_err(opaque)?;
    Ok(B64.encode(auth_key.as_bytes()))
}

/// Generates a fresh vault key.
#[wasm_bindgen(js_name = generateVaultKey)]
pub fn generate_vault_key() -> Result<VaultKeyHandle, JsError> {
    VaultKey::generate().map(VaultKeyHandle).map_err(opaque)
}

/// Wraps the vault key for storage, under the key derived from the password.
///
/// The nonce is generated inside the crypto core. There is no parameter for
/// it here either — a caller who could supply one could reuse one.
#[wasm_bindgen(js_name = wrapVaultKey)]
pub fn wrap_vault_key(
    vault_key: &VaultKeyHandle,
    master_key: &MasterKeyHandle,
) -> Result<wasm_bindgen::JsValue, JsError> {
    let stretched = derive_stretched_encryption_key(&master_key.0).map_err(opaque)?;
    let wrapped = wrap_key(&vault_key.0, &stretched).map_err(opaque)?;
    serde_wasm_bindgen::to_value(&wrapped).map_err(|_| opaque(CryptoError::DecryptionFailed))
}

/// Unwraps a stored vault key.
#[wasm_bindgen(js_name = unwrapVaultKey)]
pub fn unwrap_vault_key(
    wrapped: wasm_bindgen::JsValue,
    master_key: &MasterKeyHandle,
) -> Result<VaultKeyHandle, JsError> {
    let wrapped: WrappedVaultKey =
        serde_wasm_bindgen::from_value(wrapped).map_err(|_| bad_argument("wrapped vault key"))?;
    let stretched = derive_stretched_encryption_key(&master_key.0).map_err(opaque)?;
    unwrap_key(&wrapped, &stretched)
        .map(VaultKeyHandle)
        .map_err(opaque)
}

/// The plaintext metadata for an item, as it arrives from JavaScript.
///
/// A mirror of [`ItemHeader`], which borrows its strings and so cannot be
/// deserialized directly.
#[derive(Deserialize)]
struct HeaderInput {
    id: String,
    item_type: String,
    version: u64,
    updated_at: i64,
    deleted: bool,
}

/// Encrypts one item's already-serialized JSON content.
///
/// The header fields are bound into the authentication tag, so a server that
/// moves this ciphertext onto a different `id`, relabels its type, rolls the
/// version back or flips the tombstone produces a record that fails to
/// decrypt rather than one that decrypts as something else.
#[wasm_bindgen(js_name = encryptItem)]
pub fn encrypt_item_js(
    plaintext_json: &str,
    header: wasm_bindgen::JsValue,
    vault_key: &VaultKeyHandle,
) -> Result<wasm_bindgen::JsValue, JsError> {
    let header: HeaderInput =
        serde_wasm_bindgen::from_value(header).map_err(|_| bad_argument("item header"))?;

    let item = encrypt_item(
        plaintext_json,
        &ItemHeader {
            id: &header.id,
            item_type: &header.item_type,
            version: header.version,
            updated_at: header.updated_at,
            deleted: header.deleted,
        },
        &vault_key.0,
    )
    .map_err(opaque)?;

    serde_wasm_bindgen::to_value(&item).map_err(|_| opaque(CryptoError::DecryptionFailed))
}

/// Decrypts an item back to the JSON string it was built from.
///
/// The returned string holds plaintext secrets and is the caller's to discard
/// promptly; JavaScript strings cannot be scrubbed.
#[wasm_bindgen(js_name = decryptItem)]
pub fn decrypt_item_js(
    item: wasm_bindgen::JsValue,
    vault_key: &VaultKeyHandle,
) -> Result<String, JsError> {
    let item: EncryptedItem =
        serde_wasm_bindgen::from_value(item).map_err(|_| bad_argument("encrypted item"))?;
    decrypt(&item, &vault_key.0).map_err(opaque)
}

/// Length of a key in bytes, exported so JS can validate without hard-coding.
#[wasm_bindgen(js_name = keyLength)]
pub fn key_length() -> usize {
    KEY_LEN
}
