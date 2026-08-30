//! Error type for the crypto core.

/// Errors surfaced by this crate.
///
/// # Why `DecryptionFailed` carries no detail
///
/// A wrong password, a wrong key, a tampered ciphertext and a truncated blob
/// all produce this one variant with this one message. Distinguishing them
/// would hand an attacker a decryption oracle: the difference between "bad
/// padding" and "bad MAC" is exactly the signal such attacks are built on.
///
/// This is a security property, not a style choice — it is asserted in the
/// test suite, and it must hold at every trust boundary (WASM returns, FFI,
/// API responses). See CLAUDE.md §2.4.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum CryptoError {
    /// Decryption or authentication failed. Deliberately says nothing more.
    #[error("decryption failed")]
    DecryptionFailed,

    /// Key derivation could not complete (bad parameters, CSPRNG failure).
    ///
    /// The message describes the *configuration* problem and must never
    /// include key material, password material or a salt.
    #[error("key derivation failed: {0}")]
    KeyDerivationFailed(String),

    /// Caller-supplied input was malformed — wrong length, out of range.
    ///
    /// Reports the shape of the input, never its contents.
    #[error("invalid input: {0}")]
    InvalidInput(String),

    /// A record could not be serialized or deserialized.
    #[error("serialization error: {0}")]
    Serialization(String),

    /// Base64 or other transport encoding could not be decoded.
    #[error("encoding error: {0}")]
    Encoding(String),
}

/// Convenience alias for results from this crate.
pub type Result<T> = core::result::Result<T, CryptoError>;

// Host-only: these exercise the algorithms, which are target-independent.
// The browser-side surface is covered by tests/wasm.rs.
#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use std::error::Error as _;

    #[test]
    fn decryption_failure_message_is_opaque() {
        let err = CryptoError::DecryptionFailed;
        assert_eq!(err.to_string(), "decryption failed");
        assert!(
            err.source().is_none(),
            "DecryptionFailed must not chain a source error that explains the cause"
        );
    }
}
