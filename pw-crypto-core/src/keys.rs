//! The key hierarchy below the master key.
//!
//! ```text
//! MasterKey ──HKDF(INFO_AUTH_KEY)──────────▶ AuthKey
//!          └──HKDF(INFO_STRETCHED_KEY)─────▶ StretchedEncryptionKey
//!                                                  │ wraps
//!                                                  ▼
//!                                             VaultKey ──▶ items
//! ```
//!
//! Status: key types and `VaultKey::generate` are implemented. Derivation and
//! wrapping are not yet — see the TODOs at the bottom of this module.

use crate::error::{CryptoError, Result};
use crate::secret::define_secret_key;
use rand::TryRng as _;
use rand::rngs::SysRng;
use serde::{Deserialize, Serialize};

/// Length of every key below the master key, in bytes.
pub const KEY_LEN: usize = 32;

/// Nonce length for XChaCha20-Poly1305.
pub const NONCE_LEN: usize = 24;

/// Format version for [`WrappedVaultKey`]. Bump on any layout change.
pub const WRAPPED_VAULT_KEY_VERSION: u8 = 1;

/// HKDF `info` string for the auth key.
///
/// These two strings are the entire reason knowing one derived key gives no
/// advantage in computing the other. They are versioned, they live here and
/// nowhere else, and changing either one invalidates every existing vault —
/// treat an edit to these lines as a data migration (CLAUDE.md §4.8).
pub const INFO_AUTH_KEY: &[u8] = b"vaultiq:v1:auth-key";

/// HKDF `info` string for the stretched encryption key. See [`INFO_AUTH_KEY`].
pub const INFO_STRETCHED_KEY: &[u8] = b"vaultiq:v1:stretched-encryption-key";

define_secret_key! {
    /// Proves knowledge of the master password to the server.
    ///
    /// This is the only derived key that ever leaves the device, and it
    /// decrypts nothing: a server holding it — or an attacker who has taken
    /// that server — still cannot read a single vault item.
    AuthKey, KEY_LEN
}

define_secret_key! {
    /// Wraps and unwraps the [`VaultKey`]. Never touches item ciphertext
    /// directly, which is what makes master password rotation cheap.
    StretchedEncryptionKey, KEY_LEN
}

define_secret_key! {
    /// The key that actually encrypts vault items.
    ///
    /// Random, generated once per vault, never derived from the password —
    /// so changing the master password re-wraps this key rather than
    /// re-encrypting every item.
    VaultKey, KEY_LEN
}

impl VaultKey {
    /// Draws a fresh vault key from the OS CSPRNG.
    pub fn generate() -> Result<Self> {
        let mut bytes = [0u8; KEY_LEN];
        SysRng.try_fill_bytes(&mut bytes).map_err(|_| {
            CryptoError::KeyDerivationFailed("OS random number generator unavailable".to_owned())
        })?;
        Ok(Self::from_bytes(bytes))
    }
}

/// A [`VaultKey`] encrypted under a [`StretchedEncryptionKey`].
///
/// Safe to persist and to sync: this is the form the vault key takes at rest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WrappedVaultKey {
    /// Layout version, for forward migration.
    pub version: u8,
    /// The wrapped key plus its Poly1305 tag.
    pub ciphertext: Vec<u8>,
    /// The XChaCha20 nonce this key was wrapped under.
    pub nonce: [u8; NONCE_LEN],
}

// TODO(phase1): `derive_auth_key` and `derive_stretched_encryption_key` via
// `hkdf::Hkdf::<Sha256>::new(None, master_key.as_bytes())` with the two INFO
// constants above. Tests: both derive deterministically, the two outputs
// differ for the same master key, and a known-answer vector pins each.
//
// TODO(phase1): `wrap_vault_key` / `unwrap_vault_key` using
// XChaCha20-Poly1305 under the stretched key, fresh CSPRNG nonce generated
// internally, `version` bound in as associated data. Unwrap maps every
// failure to `DecryptionFailed`. Tests: round trip, wrong stretched key
// fails, flipped ciphertext byte fails, flipped nonce byte fails.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_vault_keys_differ() {
        let a = VaultKey::generate().unwrap();
        let b = VaultKey::generate().unwrap();
        assert!(!a.ct_eq(&b), "two CSPRNG vault keys must not collide");
    }

    #[test]
    fn vault_key_is_not_all_zeroes() {
        let key = VaultKey::generate().unwrap();
        assert_ne!(key.as_bytes(), &[0u8; KEY_LEN]);
    }

    #[test]
    fn secret_debug_output_is_redacted() {
        let auth = AuthKey::from_bytes([1u8; KEY_LEN]);
        let stretched = StretchedEncryptionKey::from_bytes([2u8; KEY_LEN]);
        let vault = VaultKey::from_bytes([3u8; KEY_LEN]);
        assert_eq!(format!("{auth:?}"), "AuthKey([REDACTED])");
        assert_eq!(
            format!("{stretched:?}"),
            "StretchedEncryptionKey([REDACTED])"
        );
        assert_eq!(format!("{vault:?}"), "VaultKey([REDACTED])");
    }

    #[test]
    fn derivation_info_strings_are_distinct() {
        assert_ne!(INFO_AUTH_KEY, INFO_STRETCHED_KEY);
    }
}
