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
//! Rotating the master password re-wraps the vault key under a new stretched
//! key; the vault key itself never changes, so not one item is re-encrypted.

use crate::error::{CryptoError, Result};
use crate::kdf::MasterKey;
use crate::secret::define_secret_key;
use chacha20poly1305::aead::{Aead, Payload};
use chacha20poly1305::{KeyInit as _, XChaCha20Poly1305, XNonce};
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

/// Domain string bound into every wrapped vault key as associated data.
const WRAP_AAD_DOMAIN: &[u8] = b"vaultiq:wrapped-vault-key";

/// Builds the associated data for a wrap at `version`.
///
/// Binding the domain and the version means a ciphertext cannot be lifted
/// into a different context, and a downgrade of the version field fails
/// authentication rather than being quietly honoured.
fn wrap_aad(version: u8) -> Vec<u8> {
    // Built by extend/push rather than a sized allocation: the crate denies
    // bare arithmetic in library code, and a capacity hint for 26 bytes is
    // not worth an exception.
    let mut aad = Vec::new();
    aad.extend_from_slice(WRAP_AAD_DOMAIN);
    aad.push(version);
    aad
}

/// Encrypts a [`VaultKey`] under a [`StretchedEncryptionKey`].
///
/// The nonce is drawn from the OS CSPRNG inside this function. There is no
/// parameter for it, deliberately: a caller who could supply a nonce could
/// reuse one, and nonce reuse under a single XChaCha20 key is catastrophic
/// (CLAUDE.md §4.5).
///
/// # Errors
///
/// [`CryptoError::KeyDerivationFailed`] if the OS CSPRNG is unavailable,
/// [`CryptoError::InvalidInput`] if the AEAD cannot encrypt.
pub fn wrap_vault_key(
    vault_key: &VaultKey,
    stretched_key: &StretchedEncryptionKey,
) -> Result<WrappedVaultKey> {
    let cipher = XChaCha20Poly1305::new_from_slice(stretched_key.as_bytes()).map_err(|_| {
        CryptoError::KeyDerivationFailed("stretched encryption key has the wrong length".to_owned())
    })?;

    let mut nonce_bytes = [0u8; NONCE_LEN];
    SysRng.try_fill_bytes(&mut nonce_bytes).map_err(|_| {
        CryptoError::KeyDerivationFailed("OS random number generator unavailable".to_owned())
    })?;

    let aad = wrap_aad(WRAPPED_VAULT_KEY_VERSION);
    let ciphertext = cipher
        .encrypt(
            &XNonce::from(nonce_bytes),
            Payload {
                msg: vault_key.as_bytes(),
                aad: &aad,
            },
        )
        .map_err(|_| CryptoError::InvalidInput("vault key could not be encrypted".to_owned()))?;

    Ok(WrappedVaultKey {
        version: WRAPPED_VAULT_KEY_VERSION,
        ciphertext,
        nonce: nonce_bytes,
    })
}

/// Decrypts a [`WrappedVaultKey`] back into a usable [`VaultKey`].
///
/// # Errors
///
/// [`CryptoError::InvalidInput`] if the record carries a version this build
/// does not know how to read — a forward-compatibility case, not a failed
/// decryption, and it reveals only the plaintext version field the caller
/// already holds.
///
/// [`CryptoError::DecryptionFailed`] for everything else: wrong stretched
/// key, tampered ciphertext, tampered nonce, altered associated data,
/// truncated input. These are one indistinguishable outcome on purpose —
/// telling them apart is what a decryption oracle is built from
/// (CLAUDE.md §2.4).
pub fn unwrap_vault_key(
    wrapped: &WrappedVaultKey,
    stretched_key: &StretchedEncryptionKey,
) -> Result<VaultKey> {
    if wrapped.version != WRAPPED_VAULT_KEY_VERSION {
        return Err(CryptoError::InvalidInput(format!(
            "unsupported wrapped vault key version {}",
            wrapped.version
        )));
    }

    let cipher = XChaCha20Poly1305::new_from_slice(stretched_key.as_bytes())
        .map_err(|_| CryptoError::DecryptionFailed)?;

    let aad = wrap_aad(wrapped.version);
    let mut plaintext = cipher
        .decrypt(
            &XNonce::from(wrapped.nonce),
            Payload {
                msg: &wrapped.ciphertext,
                aad: &aad,
            },
        )
        .map_err(|_| CryptoError::DecryptionFailed)?;

    // Unreachable in practice — the AEAD already authenticated the length —
    // but it must not be an unchecked conversion, and it must not report a
    // different error if it ever fires.
    let mut bytes: [u8; KEY_LEN] = plaintext
        .as_slice()
        .try_into()
        .map_err(|_| CryptoError::DecryptionFailed)?;
    plaintext.zeroize();

    let key = VaultKey::from_bytes(bytes);
    bytes.zeroize();
    Ok(key)
}

// Host-only: these exercise the algorithms, which are target-independent.
// The browser-side surface is covered by tests/wasm.rs.
#[cfg(all(test, not(target_arch = "wasm32")))]
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

    // --- Wrapping ---

    fn test_stretched_key() -> StretchedEncryptionKey {
        derive_stretched_encryption_key(&test_master_key()).unwrap()
    }

    /// A wrapped vault key produced by libsodium, not by this crate.
    ///
    /// OpenSSL has no XChaCha20-Poly1305, so libsodium's
    /// `crypto_aead_xchacha20poly1305_ietf_encrypt` is the independent
    /// implementation here — same IETF construction, different codebase.
    /// The stretched key is the vector pinned above; the plaintext is
    /// 0x40..0x5f; the associated data is `wrap_aad(1)`.
    ///
    /// This runs through `unwrap_vault_key`, so it checks our decrypt path
    /// against a ciphertext we did not produce.
    fn libsodium_wrapped_vault_key() -> WrappedVaultKey {
        WrappedVaultKey {
            version: WRAPPED_VAULT_KEY_VERSION,
            ciphertext: hex::<48>(
                "ae68d6789299ef2f2dd97a828c988687859ef3353af688a21304813dd37c4026\
                 3128338ce5e6f936d509fe8a1712fbc6",
            )
            .to_vec(),
            nonce: hex::<NONCE_LEN>("000102030405060708090a0b0c0d0e0f1011121314151617"),
        }
    }

    #[test]
    fn unwrap_matches_libsodium_known_answer_vector() {
        let expected: [u8; KEY_LEN] = core::array::from_fn(|i| 0x40 + i as u8);
        let vault_key = unwrap_vault_key(&libsodium_wrapped_vault_key(), &test_stretched_key())
            .expect("libsodium ciphertext must unwrap");
        assert_eq!(vault_key.as_bytes(), &expected);
    }

    #[test]
    fn wrap_unwrap_round_trips() {
        let stretched = test_stretched_key();
        let vault_key = VaultKey::generate().unwrap();
        let wrapped = wrap_vault_key(&vault_key, &stretched).unwrap();
        let unwrapped = unwrap_vault_key(&wrapped, &stretched).unwrap();
        assert!(vault_key.ct_eq(&unwrapped));
    }

    #[test]
    fn wrapping_never_reuses_a_nonce() {
        let stretched = test_stretched_key();
        let vault_key = VaultKey::generate().unwrap();
        let first = wrap_vault_key(&vault_key, &stretched).unwrap();
        let second = wrap_vault_key(&vault_key, &stretched).unwrap();
        assert_ne!(first.nonce, second.nonce, "each wrap needs a fresh nonce");
        assert_ne!(
            first.ciphertext, second.ciphertext,
            "a fresh nonce must change the ciphertext"
        );
    }

    #[test]
    fn wrapped_key_does_not_contain_the_plaintext_key() {
        let stretched = test_stretched_key();
        let vault_key = VaultKey::generate().unwrap();
        let wrapped = wrap_vault_key(&vault_key, &stretched).unwrap();
        assert!(
            !wrapped
                .ciphertext
                .windows(KEY_LEN)
                .any(|w| w == vault_key.as_bytes()),
            "the vault key must not appear verbatim in its own ciphertext"
        );
    }

    #[test]
    fn wrapped_key_round_trips_through_json() {
        let wrapped = libsodium_wrapped_vault_key();
        let json = serde_json::to_string(&wrapped).unwrap();
        assert_eq!(
            serde_json::from_str::<WrappedVaultKey>(&json).unwrap(),
            wrapped
        );
    }

    // --- Tamper resistance ---
    //
    // Every case below must fail, and must fail *identically*. Anything that
    // distinguishes them hands an attacker a decryption oracle.

    fn assert_unwrap_fails(wrapped: &WrappedVaultKey, stretched: &StretchedEncryptionKey) {
        match unwrap_vault_key(wrapped, stretched) {
            Err(CryptoError::DecryptionFailed) => {}
            Err(other) => panic!("expected DecryptionFailed, got {other:?}"),
            Ok(_) => panic!("expected decryption to fail"),
        }
    }

    #[test]
    fn unwrap_fails_with_the_wrong_stretched_key() {
        let wrapped =
            wrap_vault_key(&VaultKey::generate().unwrap(), &test_stretched_key()).unwrap();
        let wrong = StretchedEncryptionKey::from_bytes([0x99; KEY_LEN]);
        assert_unwrap_fails(&wrapped, &wrong);
    }

    #[test]
    fn unwrap_fails_on_tampered_ciphertext() {
        let stretched = test_stretched_key();
        let mut wrapped = wrap_vault_key(&VaultKey::generate().unwrap(), &stretched).unwrap();
        wrapped.ciphertext[0] ^= 0x01;
        assert_unwrap_fails(&wrapped, &stretched);
    }

    #[test]
    fn unwrap_fails_on_tampered_tag() {
        let stretched = test_stretched_key();
        let mut wrapped = wrap_vault_key(&VaultKey::generate().unwrap(), &stretched).unwrap();
        let last = wrapped.ciphertext.len() - 1;
        wrapped.ciphertext[last] ^= 0x01;
        assert_unwrap_fails(&wrapped, &stretched);
    }

    #[test]
    fn unwrap_fails_on_tampered_nonce() {
        let stretched = test_stretched_key();
        let mut wrapped = wrap_vault_key(&VaultKey::generate().unwrap(), &stretched).unwrap();
        wrapped.nonce[0] ^= 0x01;
        assert_unwrap_fails(&wrapped, &stretched);
    }

    #[test]
    fn unwrap_fails_on_truncated_ciphertext() {
        let stretched = test_stretched_key();
        let mut wrapped = wrap_vault_key(&VaultKey::generate().unwrap(), &stretched).unwrap();
        wrapped.ciphertext.truncate(wrapped.ciphertext.len() - 1);
        assert_unwrap_fails(&wrapped, &stretched);
    }

    #[test]
    fn unwrap_fails_on_empty_ciphertext() {
        let stretched = test_stretched_key();
        let mut wrapped = wrap_vault_key(&VaultKey::generate().unwrap(), &stretched).unwrap();
        wrapped.ciphertext.clear();
        assert_unwrap_fails(&wrapped, &stretched);
    }

    #[test]
    fn every_tampering_returns_the_same_error() {
        // The security property stated in `CryptoError::DecryptionFailed`,
        // asserted rather than assumed: all four failures are one outcome,
        // down to the rendered message.
        let stretched = test_stretched_key();
        let good = wrap_vault_key(&VaultKey::generate().unwrap(), &stretched).unwrap();

        let mut bad_ciphertext = good.clone();
        bad_ciphertext.ciphertext[0] ^= 0x01;
        let mut bad_nonce = good.clone();
        bad_nonce.nonce[0] ^= 0x01;
        let mut truncated = good.clone();
        truncated.ciphertext.truncate(1);

        let messages: Vec<String> = [
            unwrap_vault_key(&bad_ciphertext, &stretched),
            unwrap_vault_key(&bad_nonce, &stretched),
            unwrap_vault_key(&truncated, &stretched),
            unwrap_vault_key(&good, &StretchedEncryptionKey::from_bytes([0x99; KEY_LEN])),
        ]
        .into_iter()
        .map(|result| result.unwrap_err().to_string())
        .collect();

        assert!(
            messages.windows(2).all(|w| w[0] == w[1]),
            "failure modes must be indistinguishable, got {messages:?}"
        );
        assert_eq!(messages[0], "decryption failed");
    }

    #[test]
    fn associated_data_is_bound_into_the_wrap() {
        // Re-encrypting the same key and nonce with empty AAD must produce a
        // blob our unwrap rejects — proof the AAD is really in the tag and
        // not merely computed and discarded.
        let stretched = test_stretched_key();
        let vault_key = VaultKey::generate().unwrap();
        let wrapped = wrap_vault_key(&vault_key, &stretched).unwrap();

        let cipher = XChaCha20Poly1305::new_from_slice(stretched.as_bytes()).unwrap();
        let without_aad = cipher
            .encrypt(
                &XNonce::from(wrapped.nonce),
                Payload {
                    msg: vault_key.as_bytes(),
                    aad: b"",
                },
            )
            .unwrap();
        assert_ne!(without_aad, wrapped.ciphertext);

        assert_unwrap_fails(
            &WrappedVaultKey {
                ciphertext: without_aad,
                ..wrapped
            },
            &stretched,
        );
    }

    #[test]
    fn unknown_version_is_reported_as_unsupported() {
        // A forward-compatibility case, not a tampering case: the version is
        // public plaintext, so saying so reveals nothing the caller lacks.
        let stretched = test_stretched_key();
        let mut wrapped = wrap_vault_key(&VaultKey::generate().unwrap(), &stretched).unwrap();
        wrapped.version = 2;
        assert!(matches!(
            unwrap_vault_key(&wrapped, &stretched),
            Err(CryptoError::InvalidInput(_))
        ));
    }
}
