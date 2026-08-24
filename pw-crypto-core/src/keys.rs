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
//! Status: derivation is implemented. Wrapping is not yet — see the TODO at
//! the bottom of this module.

use crate::error::{CryptoError, Result};
use crate::kdf::MasterKey;
use crate::secret::define_secret_key;
use hkdf::Hkdf;
use rand::TryRng as _;
use rand::rngs::SysRng;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use zeroize::Zeroize as _;

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

/// HKDF-Expand over a key that is already uniformly random.
///
/// Expand-only, no extract step: the master key is Argon2id output, so it is
/// already a valid pseudorandom key. Running HKDF-Extract over it again would
/// add a hash invocation and no entropy.
///
/// `info` is what separates the derived keys from one another — see
/// [`INFO_AUTH_KEY`].
fn expand(prk: &[u8; KEY_LEN], info: &[u8]) -> Result<[u8; KEY_LEN]> {
    let hkdf = Hkdf::<Sha256>::from_prk(prk).map_err(|_| {
        CryptoError::KeyDerivationFailed("pseudorandom key is too short for HKDF".to_owned())
    })?;

    let mut output = [0u8; KEY_LEN];
    hkdf.expand(info, &mut output).map_err(|_| {
        CryptoError::KeyDerivationFailed("HKDF output length is invalid".to_owned())
    })?;
    Ok(output)
}

/// Derives the auth key, which is sent to the server to prove knowledge of
/// the master password.
///
/// This key decrypts nothing. A server that stores it, or an attacker who
/// takes that server, gains no ability to read vault data — and no shortcut
/// to the stretched encryption key, because the two come from the same PRK
/// under different `info` strings rather than from splitting one output.
///
/// # Errors
///
/// [`CryptoError::KeyDerivationFailed`] if HKDF rejects the input lengths.
pub fn derive_auth_key(master_key: &MasterKey) -> Result<AuthKey> {
    let mut bytes = expand(master_key.as_bytes(), INFO_AUTH_KEY)?;
    let key = AuthKey::from_bytes(bytes);
    bytes.zeroize();
    Ok(key)
}

/// Derives the stretched encryption key, which wraps and unwraps the
/// [`VaultKey`].
///
/// See [`derive_auth_key`] for why knowing one of these two keys gives no
/// advantage in computing the other.
///
/// # Errors
///
/// [`CryptoError::KeyDerivationFailed`] if HKDF rejects the input lengths.
pub fn derive_stretched_encryption_key(master_key: &MasterKey) -> Result<StretchedEncryptionKey> {
    let mut bytes = expand(master_key.as_bytes(), INFO_STRETCHED_KEY)?;
    let key = StretchedEncryptionKey::from_bytes(bytes);
    bytes.zeroize();
    Ok(key)
}

// TODO(phase1): `wrap_vault_key` / `unwrap_vault_key` using
// XChaCha20-Poly1305 under the stretched key, fresh CSPRNG nonce generated
// internally, `version` bound in as associated data. Unwrap maps every
// failure to `DecryptionFailed`. Tests: round trip, wrong stretched key
// fails, flipped ciphertext byte fails, flipped nonce byte fails.

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kdf::{Argon2Params, Salt};
    use crate::test_util::hex;

    /// Test-only password. Never use a real one, even locally (CLAUDE.md §2.6).
    const TEST_PASSWORD: &str = "correct horse battery staple";

    /// The master key pinned by `kdf`'s known-answer vector, re-derived here
    /// so this module's vectors chain off the same root.
    fn test_master_key() -> MasterKey {
        let salt = Salt::from_bytes(&hex::<16>("000102030405060708090a0b0c0d0e0f")).unwrap();
        MasterKey::derive(TEST_PASSWORD, &salt, &Argon2Params::default()).unwrap()
    }

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

    // --- Known-answer vectors ---
    //
    // Expected values were computed by OpenSSL 3.6.3's HKDF in EXPAND_ONLY
    // mode, not by this crate:
    //
    //   openssl kdf -keylen 32 -binary HKDF \
    //     -kdfopt mode:EXPAND_ONLY -kdfopt digest:SHA256 \
    //     -kdfopt hexkey:<master key> -kdfopt hexinfo:<info string>
    //
    // where <master key> is the vector pinned in `kdf::tests`. If either of
    // these fails, the key hierarchy changed and every existing vault is
    // undecryptable — a migration, not a test to update.

    #[test]
    fn expand_matches_rfc_5869_test_case_1() {
        // RFC 5869 §A.1, expand step only. HKDF-Expand output is a prefix, so
        // the first 32 bytes of the RFC's 42-byte OKM are what a 32-byte
        // expansion produces. Pins hkdf + sha2 against the standard itself.
        let prk =
            hex::<KEY_LEN>("077709362c2e32df0ddc3f0dc47bba6390b6c73bb50f9c3122ec844ad7c2b3e5");
        let okm = expand(&prk, &hex::<10>("f0f1f2f3f4f5f6f7f8f9")).unwrap();
        assert_eq!(
            okm,
            hex::<KEY_LEN>("3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf")
        );
    }

    #[test]
    fn auth_key_matches_known_answer_vector() {
        let expected =
            hex::<KEY_LEN>("2c61d1e5ae206584683a45d08a43163f1c49d22727b278ae5660c2250db62c7f");
        let auth_key = derive_auth_key(&test_master_key()).unwrap();
        assert_eq!(auth_key.as_bytes(), &expected);
    }

    #[test]
    fn stretched_key_matches_known_answer_vector() {
        let expected =
            hex::<KEY_LEN>("79798da70c99885e953400fad77bbefb2702b828dc08af4738f56a3ee2e94fd6");
        let stretched = derive_stretched_encryption_key(&test_master_key()).unwrap();
        assert_eq!(stretched.as_bytes(), &expected);
    }

    // --- Derivation behaviour ---

    #[test]
    fn derivation_is_deterministic() {
        let master_key = test_master_key();
        let auth_a = derive_auth_key(&master_key).unwrap();
        let auth_b = derive_auth_key(&master_key).unwrap();
        let stretched_a = derive_stretched_encryption_key(&master_key).unwrap();
        let stretched_b = derive_stretched_encryption_key(&master_key).unwrap();
        assert!(auth_a.ct_eq(&auth_b));
        assert!(stretched_a.ct_eq(&stretched_b));
    }

    #[test]
    fn auth_and_stretched_keys_differ() {
        // The whole point of the two `info` strings: the key that goes to the
        // server must share nothing with the key that unwraps the vault.
        let master_key = test_master_key();
        let auth = derive_auth_key(&master_key).unwrap();
        let stretched = derive_stretched_encryption_key(&master_key).unwrap();
        assert_ne!(auth.as_bytes(), stretched.as_bytes());
    }

    #[test]
    fn different_master_keys_give_different_derived_keys() {
        let a = MasterKey::from_bytes([0x11; KEY_LEN]);
        let b = MasterKey::from_bytes([0x22; KEY_LEN]);
        assert!(
            !derive_auth_key(&a)
                .unwrap()
                .ct_eq(&derive_auth_key(&b).unwrap())
        );
        assert!(
            !derive_stretched_encryption_key(&a)
                .unwrap()
                .ct_eq(&derive_stretched_encryption_key(&b).unwrap())
        );
    }

    #[test]
    fn derived_keys_are_not_the_master_key() {
        // Guards against an expand step that silently degenerates into a copy.
        let master_key = MasterKey::from_bytes([0x11; KEY_LEN]);
        let auth = derive_auth_key(&master_key).unwrap();
        let stretched = derive_stretched_encryption_key(&master_key).unwrap();
        assert_ne!(auth.as_bytes(), master_key.as_bytes());
        assert_ne!(stretched.as_bytes(), master_key.as_bytes());
    }

    #[test]
    fn changing_one_info_byte_changes_the_key() {
        let prk = [0x42; KEY_LEN];
        let a = expand(&prk, b"vaultiq:v1:auth-key").unwrap();
        let b = expand(&prk, b"vaultiq:v1:auth-keY").unwrap();
        assert_ne!(a, b);
    }
}
