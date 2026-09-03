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
use crate::password::{PasswordOptions, estimate_strength, generate_password as generate};
use crate::totp::{TotpAlgorithm, TotpParams, TotpSecret, seconds_remaining, totp_code};
use crate::vault_item::{EncryptedItem, ItemHeader, decrypt_item as decrypt, encrypt_item};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as B64;
use serde::Deserialize;
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;
use zeroize::Zeroize as _;

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

    /// Exports the vault key so it can survive the extension's background
    /// context being suspended.
    ///
    /// # This is the one sanctioned way key material leaves wasm
    ///
    /// Everything else in this module exists to keep keys inside linear
    /// memory. This function deliberately breaks that, for one reason: both
    /// Manifest V3 background contexts — Chrome's service worker and
    /// Firefox's event page — are suspended when idle, and everything in
    /// their memory dies with them. Without this, unlocking would have to
    /// happen again, at full Argon2 cost, every time the browser reclaimed
    /// the background page.
    ///
    /// **The result may only be written to `storage.session`**, which is held
    /// in memory and never persisted to disk. Writing it to
    /// `storage.local`, IndexedDB, a cookie, or anywhere else on disk turns a
    /// memory-lifetime secret into a permanent one, and is a vault
    /// compromise. Nothing here can enforce that — it is a review rule.
    ///
    /// Pair with [`restore_from_session_storage`](Self::restore_from_session_storage).
    #[wasm_bindgen(js_name = exportForSessionStorage)]
    pub fn export_for_session_storage(&self) -> String {
        B64.encode(self.0.as_bytes())
    }

    /// Rebuilds a handle from [`export_for_session_storage`](Self::export_for_session_storage).
    ///
    /// Returns an argument error for anything that is not exactly a base64
    /// encoded key of the right length. That check is about the shape of a
    /// value the caller just supplied, so it reveals nothing.
    #[wasm_bindgen(js_name = restoreFromSessionStorage)]
    pub fn restore_from_session_storage(encoded: &str) -> Result<VaultKeyHandle, JsError> {
        let mut decoded = decode_b64(encoded, "session key")?;

        let mut bytes: [u8; KEY_LEN] = decoded
            .as_slice()
            .try_into()
            .map_err(|_| bad_argument("session key"))?;
        decoded.zeroize();

        let handle = VaultKeyHandle(VaultKey::from_bytes(bytes));
        bytes.zeroize();
        Ok(handle)
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

/// The generator settings this build recommends.
#[wasm_bindgen(js_name = defaultPasswordOptions)]
pub fn default_password_options() -> Result<wasm_bindgen::JsValue, JsError> {
    serde_wasm_bindgen::to_value(&PasswordOptions::default())
        .map_err(|_| JsError::new("could not serialize options"))
}

/// Generates a password.
///
/// Returned as a plain string because it is going into a form field. Unlike a
/// key, it is meant to be read — but it is still a secret, and JavaScript
/// strings cannot be scrubbed, so the caller should not hold it longer than
/// the user needs it on screen.
#[wasm_bindgen(js_name = generatePassword)]
pub fn generate_password_js(options: wasm_bindgen::JsValue) -> Result<String, JsError> {
    let options: PasswordOptions =
        serde_wasm_bindgen::from_value(options).map_err(|_| bad_argument("password options"))?;

    // Unsatisfiable settings are a caller bug and say nothing secret, so the
    // reason is reported rather than collapsed.
    generate(&options).map_err(|error| match error {
        CryptoError::InvalidInput(reason) => JsError::new(&format!("invalid options: {reason}")),
        other => opaque(other),
    })
}

/// Estimates how strong a password looks.
///
/// Never fails: an empty or unusual password simply scores low. Scoring
/// happens here rather than in JavaScript so every client agrees — the same
/// password rating differently on two devices would be worse than no rating.
#[wasm_bindgen(js_name = estimateStrength)]
pub fn estimate_strength_js(password: &str) -> Result<wasm_bindgen::JsValue, JsError> {
    serde_wasm_bindgen::to_value(&estimate_strength(password))
        .map_err(|_| JsError::new("could not serialize strength"))
}

/// Length of a key in bytes, exported so JS can validate without hard-coding.
#[wasm_bindgen(js_name = keyLength)]
pub fn key_length() -> usize {
    KEY_LEN
}

/// Reads the parameters a caller supplied for a one-time password.
///
/// The time arrives as an `f64` because that is what `Date.now()` is; a `u64`
/// would cross as a BigInt and make every call site convert. The saturating
/// cast cannot panic, and no clock this side of the year 285000 loses a
/// second to it.
fn totp_arguments(
    algorithm: &str,
    digits: u32,
    period: f64,
    unix_seconds: f64,
) -> Result<(TotpParams, u64), JsError> {
    let params = TotpParams {
        algorithm: TotpAlgorithm::parse(algorithm).map_err(|_| bad_argument("TOTP algorithm"))?,
        digits,
        period: period.max(0.0) as u64,
    };
    Ok((params, unix_seconds.max(0.0) as u64))
}

/// The one-time code for a moment in time.
///
/// The shared secret arrives as the base32 an issuer printed, and the moment
/// as seconds since the epoch — this layer has no clock of its own, and
/// neither does the module underneath it.
///
/// Returned as a string because a leading zero is part of a code.
#[wasm_bindgen(js_name = totpCode)]
pub fn totp_code_js(
    secret_b32: &str,
    algorithm: &str,
    digits: u32,
    period: f64,
    unix_seconds: f64,
) -> Result<String, JsError> {
    let (params, at) = totp_arguments(algorithm, digits, period, unix_seconds)?;
    // A malformed secret is reported as the argument problem it is. Nothing
    // derived from the secret crosses back — the failure says only that what
    // the caller just supplied was not base32 of a usable length.
    let secret = TotpSecret::parse(secret_b32).map_err(|_| bad_argument("TOTP secret"))?;
    totp_code(&secret, &params, at).map_err(|_| bad_argument("TOTP parameters"))
}

/// How many seconds the current code has left.
#[wasm_bindgen(js_name = totpSecondsRemaining)]
pub fn totp_seconds_remaining_js(period: f64, unix_seconds: f64) -> Result<f64, JsError> {
    let (params, at) = totp_arguments("SHA1", TotpParams::default().digits, period, unix_seconds)?;
    let left = seconds_remaining(&params, at).map_err(|_| bad_argument("TOTP period"))?;
    // Back out as an f64 for the same reason it came in as one.
    Ok(left as f64)
}
