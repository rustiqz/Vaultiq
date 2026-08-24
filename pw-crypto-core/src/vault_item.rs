//! Per-item encryption.
//!
//! Items are encrypted individually rather than as one vault-wide blob, so a
//! single edit syncs as a single record (PROJECT.md, "Data model").
//!
//! This module is deliberately schema-agnostic: callers hand it serialized
//! JSON and get serialized JSON back. Logins, notes and cards all travel the
//! same path, so a new item type needs no change here.
//!
//! Status: the record type is implemented. `encrypt_item` / `decrypt_item`
//! are not yet — see the TODOs at the bottom of this module.

use crate::keys::NONCE_LEN;
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

// TODO(phase1): `encrypt_item(plaintext_json: &str, item_id: &str, version: u64,
// key: &VaultKey) -> Result<EncryptedItem>`. Fresh CSPRNG nonce generated
// internally — the caller must have no way to supply one (CLAUDE.md §4.5).
// Bind `id`, `version` and `format` in as associated data so a swapped
// ciphertext fails authentication instead of decrypting under the wrong
// identity.
//
// TODO(phase1): `decrypt_item(&EncryptedItem, &VaultKey) -> Result<String>`,
// reconstructing the same associated data and mapping every failure to
// `DecryptionFailed`.
//
// Tests: round trip; wrong VaultKey fails; each of a flipped ciphertext byte,
// flipped nonce byte and altered `id`/`version` fails; every one of those
// returns the *same* error variant; proptest round trip over arbitrary
// plaintext including empty and large inputs.

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> EncryptedItem {
        EncryptedItem {
            id: "01J000000000000000000000".to_owned(),
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
        let restored: EncryptedItem = serde_json::from_str(&json).unwrap();
        assert_eq!(item, restored);
    }

    #[test]
    fn serialized_item_carries_a_format_version() {
        let json = serde_json::to_string(&sample()).unwrap();
        assert!(json.contains("\"format\":1"));
    }
}
