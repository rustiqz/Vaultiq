//! Per-item encryption.
//!
//! Items are encrypted individually rather than as one vault-wide blob, so a
//! single edit syncs as a single record (PROJECT.md, "Data model").
//!
//! This module is deliberately schema-agnostic: callers hand it serialized
//! JSON and get serialized JSON back. Logins, notes and cards all travel the
//! same path, so a new item type needs no change here.
//!
use crate::error::{CryptoError, Result};
use crate::keys::{NONCE_LEN, VaultKey};
use chacha20poly1305::aead::{Aead, Payload};
use chacha20poly1305::{KeyInit as _, XChaCha20Poly1305, XNonce};
use rand::TryRng as _;
use rand::rngs::SysRng;
use serde::{Deserialize, Serialize};

/// Format version for [`EncryptedItem`]. Bump on any layout change.
pub const ENCRYPTED_ITEM_VERSION: u8 = 1;

/// One encrypted vault item, in the form it is stored and synced.
///
/// Everything outside `ciphertext` is metadata the server is allowed to see.
/// That list is kept as short as it is on purpose: folder names, tags and
/// favourites live *inside* the ciphertext, because item counts and folder
/// labels leak plenty on their own.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EncryptedItem {
    /// Stable identifier, assigned by the client that created the item.
    pub id: String,
    /// Item type discriminator for the plaintext schema inside — `"login"`
    /// for v1.
    pub item_type: String,
    /// Layout version, for forward migration.
    pub format: u8,
    /// Encrypted item content plus its Poly1305 tag.
    pub ciphertext: Vec<u8>,
    /// The XChaCha20 nonce this item was encrypted under.
    pub nonce: [u8; NONCE_LEN],
    /// Monotonic revision counter, incremented on every update. Sync uses it
    /// for optimistic concurrency.
    pub version: u64,
    /// Last modification time, Unix milliseconds.
    pub updated_at: i64,
    /// Tombstone. Items are never hard-deleted — the flag has to survive long
    /// enough to propagate the deletion to every client.
    pub deleted: bool,
}

/// The plaintext metadata describing an item, supplied when encrypting it.
///
/// These fields end up bound into the ciphertext's authentication tag, so a
/// server that reshuffles them — moving a ciphertext onto a different `id`,
/// relabelling a login as a note, rolling `version` back — produces a record
/// that fails to decrypt rather than one that decrypts as something else.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ItemHeader<'a> {
    /// Stable identifier for the item.
    pub id: &'a str,
    /// Item type discriminator — `"login"` for v1.
    pub item_type: &'a str,
    /// Revision counter for this update.
    pub version: u64,
    /// Modification time, Unix milliseconds.
    pub updated_at: i64,
    /// Whether this update is a tombstone.
    pub deleted: bool,
}

/// Domain string bound into every encrypted item as associated data.
const ITEM_AAD_DOMAIN: &[u8] = b"vaultiq:encrypted-item";

/// Builds the associated data for an item.
///
/// Every variable-length field is length-prefixed. Without that, an id of
/// `"ab"` beside a type of `"c"` and an id of `"a"` beside a type of `"bc"`
/// would serialize identically, and the binding those fields are supposed to
/// provide would not hold at the boundary between them.
///
/// `updated_at` is deliberately *not* bound: it is a display hint, clients
/// legitimately normalize it for clock skew, and rollback is already
/// prevented by `version`, which is bound.
fn item_aad(format: u8, header: &ItemHeader<'_>) -> Result<Vec<u8>> {
    let id_len = u32::try_from(header.id.len())
        .map_err(|_| CryptoError::InvalidInput("item id is too long".to_owned()))?;
    let type_len = u32::try_from(header.item_type.len())
        .map_err(|_| CryptoError::InvalidInput("item type is too long".to_owned()))?;

    let mut aad = Vec::new();
    aad.extend_from_slice(ITEM_AAD_DOMAIN);
    aad.push(format);
    aad.push(u8::from(header.deleted));
    aad.extend_from_slice(&header.version.to_le_bytes());
    aad.extend_from_slice(&id_len.to_le_bytes());
    aad.extend_from_slice(header.id.as_bytes());
    aad.extend_from_slice(&type_len.to_le_bytes());
    aad.extend_from_slice(header.item_type.as_bytes());
    Ok(aad)
}

/// Encrypts one item's content under the vault key.
///
/// `plaintext_json` is already-serialized item content; this function does not
/// know or care what shape it has, which is what lets new item types arrive
/// without touching this module.
///
/// The nonce is drawn from the OS CSPRNG inside this function — there is no
/// parameter for it, so a caller cannot reuse one.
///
/// # Errors
///
/// [`CryptoError::KeyDerivationFailed`] if the OS CSPRNG is unavailable,
/// [`CryptoError::InvalidInput`] if the header is unrepresentable or the AEAD
/// cannot encrypt.
pub fn encrypt_item(
    plaintext_json: &str,
    header: &ItemHeader<'_>,
    vault_key: &VaultKey,
) -> Result<EncryptedItem> {
    let cipher = XChaCha20Poly1305::new_from_slice(vault_key.as_bytes()).map_err(|_| {
        CryptoError::KeyDerivationFailed("vault key has the wrong length".to_owned())
    })?;

    let mut nonce_bytes = [0u8; NONCE_LEN];
    SysRng.try_fill_bytes(&mut nonce_bytes).map_err(|_| {
        CryptoError::KeyDerivationFailed("OS random number generator unavailable".to_owned())
    })?;

    let aad = item_aad(ENCRYPTED_ITEM_VERSION, header)?;
    let ciphertext = cipher
        .encrypt(
            &XNonce::from(nonce_bytes),
            Payload {
                msg: plaintext_json.as_bytes(),
                aad: &aad,
            },
        )
        .map_err(|_| CryptoError::InvalidInput("item content could not be encrypted".to_owned()))?;

    Ok(EncryptedItem {
        id: header.id.to_owned(),
        item_type: header.item_type.to_owned(),
        format: ENCRYPTED_ITEM_VERSION,
        ciphertext,
        nonce: nonce_bytes,
        version: header.version,
        updated_at: header.updated_at,
        deleted: header.deleted,
    })
}

/// Decrypts an item back into the JSON string it was built from.
///
/// The returned `String` holds plaintext secrets and is the caller's to
/// scrub. It reuses the decryption buffer rather than copying it, so this is
/// the only copy in memory — but nothing here can zeroize it on the caller's
/// behalf.
///
/// # Errors
///
/// [`CryptoError::InvalidInput`] if the record carries an unknown `format` —
/// a forward-compatibility case, and `format` is public plaintext.
///
/// [`CryptoError::DecryptionFailed`] for everything else: wrong vault key,
/// tampered ciphertext, tampered nonce, or a header field that no longer
/// matches the one bound at encryption time. Indistinguishable on purpose.
pub fn decrypt_item(item: &EncryptedItem, vault_key: &VaultKey) -> Result<String> {
    if item.format != ENCRYPTED_ITEM_VERSION {
        return Err(CryptoError::InvalidInput(format!(
            "unsupported encrypted item format {}",
            item.format
        )));
    }

    let cipher = XChaCha20Poly1305::new_from_slice(vault_key.as_bytes())
        .map_err(|_| CryptoError::DecryptionFailed)?;

    let aad = item_aad(
        item.format,
        &ItemHeader {
            id: &item.id,
            item_type: &item.item_type,
            version: item.version,
            updated_at: item.updated_at,
            deleted: item.deleted,
        },
    )
    .map_err(|_| CryptoError::DecryptionFailed)?;

    let plaintext = cipher
        .decrypt(
            &XNonce::from(item.nonce),
            Payload {
                msg: &item.ciphertext,
                aad: &aad,
            },
        )
        .map_err(|_| CryptoError::DecryptionFailed)?;

    // Only reachable if something authenticated under the right key was not
    // UTF-8, which this module cannot produce. It still must not report a
    // different error than any other failure.
    String::from_utf8(plaintext).map_err(|_| CryptoError::DecryptionFailed)
}

// Host-only: these exercise the algorithms, which are target-independent.
// The browser-side surface is covered by tests/wasm.rs.
#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use crate::test_util::hex;

    /// Test-only content. Obviously fake, and marked so.
    const TEST_JSON: &str =
        r#"{"username":"ada@example.test","password":"hunter2","url":"https://example.test"}"#;
    const TEST_ID: &str = "01J000000000000000000000";

    fn test_vault_key() -> VaultKey {
        VaultKey::from_bytes(core::array::from_fn(|i| 0x40 + i as u8))
    }

    fn test_header() -> ItemHeader<'static> {
        ItemHeader {
            id: TEST_ID,
            item_type: "login",
            version: 1,
            updated_at: 1_756_000_000_000,
            deleted: false,
        }
    }

    fn sample() -> EncryptedItem {
        EncryptedItem {
            id: TEST_ID.to_owned(),
            item_type: "login".to_owned(),
            format: ENCRYPTED_ITEM_VERSION,
            ciphertext: vec![0xAA; 48],
            nonce: [0xBB; NONCE_LEN],
            version: 1,
            updated_at: 1_756_000_000_000,
            deleted: false,
        }
    }

    #[test]
    fn encrypted_item_round_trips_through_json() {
        let item = sample();
        let json = serde_json::to_string(&item).unwrap();
        assert_eq!(serde_json::from_str::<EncryptedItem>(&json).unwrap(), item);
    }

    #[test]
    fn serialized_item_carries_a_format_version() {
        assert!(
            serde_json::to_string(&sample())
                .unwrap()
                .contains("\"format\":1")
        );
    }

    // --- Known-answer vector ---

    /// An item encrypted by libsodium, not by this crate.
    ///
    /// Same construction as the wrapped-vault-key vector in `keys`:
    /// `crypto_aead_xchacha20poly1305_ietf_encrypt` over `TEST_JSON`, under
    /// the 0x40..0x5f vault key, with `item_aad(1, test_header())` as
    /// associated data. Running it through `decrypt_item` checks our decrypt
    /// path — and the exact AAD byte layout — against an implementation we
    /// did not write.
    fn libsodium_encrypted_item() -> EncryptedItem {
        EncryptedItem {
            ciphertext: hex::<97>(
                "cdf7f11278c4c105fb466aa4a78bdbbd2692c3104e1228c2480e51c847b9bb24\
                 83e30e5996ca16fde74b9708d3fdd8b0f88b65af5d991419da30e5df0e53a5eb\
                 43a1a00ff9653a87e7cc5bfe63de73e20afb2ec1764858a94de64d67afce04aa\
                 c5",
            )
            .to_vec(),
            nonce: hex::<NONCE_LEN>("18191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f"),
            ..sample()
        }
    }

    #[test]
    fn decrypt_matches_libsodium_known_answer_vector() {
        let plaintext = decrypt_item(&libsodium_encrypted_item(), &test_vault_key())
            .expect("libsodium ciphertext must decrypt");
        assert_eq!(plaintext, TEST_JSON);
    }

    // --- Round trips ---

    #[test]
    fn encrypt_decrypt_round_trips() {
        let key = test_vault_key();
        let item = encrypt_item(TEST_JSON, &test_header(), &key).unwrap();
        assert_eq!(decrypt_item(&item, &key).unwrap(), TEST_JSON);
    }

    #[test]
    fn header_is_carried_onto_the_record() {
        let header = test_header();
        let item = encrypt_item(TEST_JSON, &header, &test_vault_key()).unwrap();
        assert_eq!(item.id, header.id);
        assert_eq!(item.item_type, header.item_type);
        assert_eq!(item.version, header.version);
        assert_eq!(item.updated_at, header.updated_at);
        assert_eq!(item.deleted, header.deleted);
        assert_eq!(item.format, ENCRYPTED_ITEM_VERSION);
    }

    #[test]
    fn tombstones_encrypt_and_decrypt() {
        let key = test_vault_key();
        let header = ItemHeader {
            version: 2,
            deleted: true,
            ..test_header()
        };
        let item = encrypt_item("{}", &header, &key).unwrap();
        assert!(item.deleted);
        assert_eq!(decrypt_item(&item, &key).unwrap(), "{}");
    }

    #[test]
    fn encryption_never_reuses_a_nonce() {
        let key = test_vault_key();
        let first = encrypt_item(TEST_JSON, &test_header(), &key).unwrap();
        let second = encrypt_item(TEST_JSON, &test_header(), &key).unwrap();
        assert_ne!(first.nonce, second.nonce);
        assert_ne!(first.ciphertext, second.ciphertext);
    }

    #[test]
    fn ciphertext_does_not_leak_the_plaintext() {
        let item = encrypt_item(TEST_JSON, &test_header(), &test_vault_key()).unwrap();
        assert!(
            !item
                .ciphertext
                .windows(TEST_JSON.len())
                .any(|w| w == TEST_JSON.as_bytes()),
            "plaintext must not survive into the ciphertext"
        );
        assert!(!item.ciphertext.windows(7).any(|w| w == b"hunter2"));
    }

    // --- Tamper resistance ---
    //
    // Every case below must fail, and must fail identically.

    fn assert_decrypt_fails(item: &EncryptedItem, key: &VaultKey) {
        match decrypt_item(item, key) {
            Err(CryptoError::DecryptionFailed) => {}
            Err(other) => panic!("expected DecryptionFailed, got {other:?}"),
            Ok(_) => panic!("expected decryption to fail"),
        }
    }

    fn encrypted() -> EncryptedItem {
        encrypt_item(TEST_JSON, &test_header(), &test_vault_key()).unwrap()
    }

    #[test]
    fn decrypt_fails_with_the_wrong_vault_key() {
        assert_decrypt_fails(&encrypted(), &VaultKey::from_bytes([0x99; 32]));
    }

    #[test]
    fn decrypt_fails_on_tampered_ciphertext() {
        let mut item = encrypted();
        item.ciphertext[0] ^= 0x01;
        assert_decrypt_fails(&item, &test_vault_key());
    }

    #[test]
    fn decrypt_fails_on_tampered_tag() {
        let mut item = encrypted();
        let last = item.ciphertext.len() - 1;
        item.ciphertext[last] ^= 0x01;
        assert_decrypt_fails(&item, &test_vault_key());
    }

    #[test]
    fn decrypt_fails_on_tampered_nonce() {
        let mut item = encrypted();
        item.nonce[0] ^= 0x01;
        assert_decrypt_fails(&item, &test_vault_key());
    }

    #[test]
    fn decrypt_fails_on_truncated_ciphertext() {
        let mut item = encrypted();
        item.ciphertext.truncate(item.ciphertext.len() - 1);
        assert_decrypt_fails(&item, &test_vault_key());
    }

    // --- Header binding ---
    //
    // A malicious server holds every one of these fields in the clear. Each
    // test moves one of them and confirms the record stops decrypting.

    #[test]
    fn decrypt_fails_when_the_id_is_changed() {
        let mut item = encrypted();
        item.id = "01J000000000000000000001".to_owned();
        assert_decrypt_fails(&item, &test_vault_key());
    }

    #[test]
    fn decrypt_fails_when_the_item_type_is_changed() {
        let mut item = encrypted();
        item.item_type = "note".to_owned();
        assert_decrypt_fails(&item, &test_vault_key());
    }

    #[test]
    fn decrypt_fails_when_the_version_is_rolled_back() {
        let mut item = encrypted();
        item.version = 0;
        assert_decrypt_fails(&item, &test_vault_key());
    }

    #[test]
    fn decrypt_fails_when_the_tombstone_flag_is_flipped() {
        // Stops a server from resurrecting a deleted item, or from deleting a
        // live one, by flipping a boolean it can see.
        let mut item = encrypted();
        item.deleted = true;
        assert_decrypt_fails(&item, &test_vault_key());
    }

    #[test]
    fn ciphertexts_cannot_be_swapped_between_items() {
        let key = test_vault_key();
        let other = encrypt_item(
            TEST_JSON,
            &ItemHeader {
                id: "01J000000000000000000009",
                ..test_header()
            },
            &key,
        )
        .unwrap();

        let mut forged = encrypted();
        forged.ciphertext = other.ciphertext;
        forged.nonce = other.nonce;
        assert_decrypt_fails(&forged, &key);
    }

    #[test]
    fn aad_field_boundaries_are_unambiguous() {
        // Length prefixes exist so that shifting a byte across the id/type
        // boundary is not a no-op. Without them these two headers would
        // produce identical associated data.
        let key = test_vault_key();
        let item = encrypt_item(
            TEST_JSON,
            &ItemHeader {
                id: "ab",
                item_type: "c",
                ..test_header()
            },
            &key,
        )
        .unwrap();

        let mut shifted = item.clone();
        shifted.id = "a".to_owned();
        shifted.item_type = "bc".to_owned();
        assert_decrypt_fails(&shifted, &key);
    }

    #[test]
    fn every_failure_returns_the_same_error() {
        let key = test_vault_key();
        let good = encrypted();

        let mut bad_ciphertext = good.clone();
        bad_ciphertext.ciphertext[0] ^= 0x01;
        let mut bad_nonce = good.clone();
        bad_nonce.nonce[0] ^= 0x01;
        let mut bad_id = good.clone();
        bad_id.id = "01J000000000000000000002".to_owned();
        let mut truncated = good.clone();
        truncated.ciphertext.truncate(1);

        let messages: Vec<String> = [
            decrypt_item(&bad_ciphertext, &key),
            decrypt_item(&bad_nonce, &key),
            decrypt_item(&bad_id, &key),
            decrypt_item(&truncated, &key),
            decrypt_item(&good, &VaultKey::from_bytes([0x99; 32])),
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
    fn unknown_format_is_reported_as_unsupported() {
        let mut item = encrypted();
        item.format = 2;
        assert!(matches!(
            decrypt_item(&item, &test_vault_key()),
            Err(CryptoError::InvalidInput(_))
        ));
    }

    // --- Property-based round trip ---

    proptest::proptest! {
        #[test]
        fn round_trips_over_arbitrary_plaintext(plaintext in ".{0,4096}") {
            let key = test_vault_key();
            let item = encrypt_item(&plaintext, &test_header(), &key).unwrap();
            proptest::prop_assert_eq!(decrypt_item(&item, &key).unwrap(), plaintext);
        }

        #[test]
        fn round_trips_over_arbitrary_headers(
            id in ".{0,64}",
            item_type in ".{0,32}",
            version: u64,
            updated_at: i64,
            deleted: bool,
        ) {
            let key = test_vault_key();
            let header = ItemHeader {
                id: &id, item_type: &item_type, version, updated_at, deleted,
            };
            let item = encrypt_item(TEST_JSON, &header, &key).unwrap();
            proptest::prop_assert_eq!(decrypt_item(&item, &key).unwrap(), TEST_JSON);
        }

        #[test]
        fn tampering_with_any_byte_is_detected(index in 0usize..97) {
            let key = test_vault_key();
            let mut item = encrypted();
            item.ciphertext[index] ^= 0x01;
            proptest::prop_assert!(matches!(
                decrypt_item(&item, &key),
                Err(CryptoError::DecryptionFailed)
            ));
        }
    }
}
