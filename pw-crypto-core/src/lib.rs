//! Vaultiq crypto core.
//!
//! Every byte the server ever sees is produced here, and every byte the user
//! ever reads is decrypted here. Nothing in this crate performs I/O, opens a
//! socket, or reports telemetry — a compromised server learns nothing because
//! there is nothing on the wire to learn from.
//!
//! # Key hierarchy
//!
//! ```text
//! Master Password ──Argon2id──▶ MasterKey
//!                                  ├──HKDF──▶ AuthKey (server login only)
//!                                  └──HKDF──▶ StretchedEncryptionKey
//!                                                  │ wraps
//!                                                  ▼
//!                                             VaultKey ──XChaCha20-Poly1305──▶ items
//! ```
//!
//! See PROJECT.md for the design and CLAUDE.md for the rules this code is
//! held to.
//!
//! # Status
//!
//! Phase 1 is complete: derivation, vault key wrapping and item encryption
//! are implemented and pinned by known-answer vectors computed with OpenSSL
//! and libsodium. The WASM bindings in `wasm` are phase 2.

#![forbid(unsafe_code)]
#![warn(missing_docs)]
// Panicking in a crypto path is both a denial of service and a timing signal.
// Library code returns `CryptoError`; tests may still panic freely.
#![cfg_attr(
    not(test),
    deny(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::todo,
        clippy::unimplemented,
        clippy::indexing_slicing,
        clippy::arithmetic_side_effects,
    )
)]

pub mod error;
pub mod kdf;
pub mod keys;
pub mod password;
mod secret;
pub mod vault_item;

#[cfg(all(test, not(target_arch = "wasm32")))]
mod test_util;

#[cfg(feature = "wasm")]
pub mod wasm;

pub use error::{CryptoError, Result};
pub use kdf::{Argon2Params, MasterKey, Salt};
pub use keys::{
    AuthKey, StretchedEncryptionKey, VaultKey, WrappedVaultKey, derive_auth_key,
    derive_stretched_encryption_key, unwrap_vault_key, wrap_vault_key,
};
pub use password::{PasswordOptions, generate_password};
pub use vault_item::{EncryptedItem, ItemHeader, decrypt_item, encrypt_item};
