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
//! Scaffold. Types, parameters, salts and vault key generation are
//! implemented; derivation, wrapping and item encryption are marked with
//! `TODO(phase1)` in their modules.

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
mod secret;
pub mod vault_item;

#[cfg(feature = "wasm")]
pub mod wasm;

pub use error::{CryptoError, Result};
pub use kdf::{Argon2Params, MasterKey, Salt};
pub use keys::{AuthKey, StretchedEncryptionKey, VaultKey, WrappedVaultKey};
pub use vault_item::EncryptedItem;
