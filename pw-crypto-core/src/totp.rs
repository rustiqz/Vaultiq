//! Time-based one-time passwords, RFC 6238.
//!
//! This lives in the crypto core rather than in each client for the same
//! reason password scoring does: a code that differed between two devices
//! would be worse than no code at all, and there is no room for two
//! interpretations of a spec that produces six digits.
//!
//! # There is no clock here
//!
//! The current time is a parameter, never read inside this module. The crypto
//! core makes no syscalls and has no ambient state (CLAUDE.md §2.5), a wasm
//! build has no clock to read without going back out to JavaScript anyway,
//! and a function of `(secret, time)` is a function that known-answer vectors
//! can pin.

use crate::error::{CryptoError, Result};
use data_encoding::BASE32_NOPAD;
use hmac::{Hmac, KeyInit as _, Mac as _};
use sha1::Sha1;
use sha2::{Sha256, Sha512};
use zeroize::{Zeroize as _, ZeroizeOnDrop};

/// Digits an authenticator may be asked for.
///
/// RFC 4226 §5.3 defines the truncation for six to eight; beyond eight the
/// modulus stops fitting the 31 bits the truncation produces, so more digits
/// would mean leading zeros that carry no entropy.
const MIN_DIGITS: u32 = 6;
const MAX_DIGITS: u32 = 8;

/// Which HMAC an issuer chose.
///
/// SHA-1 is the default and is what almost every QR code in the world
/// specifies. Its collision weakness does not carry into HMAC — the
/// construction does not rely on collision resistance — and this is the only
/// place in the crate it appears.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TotpAlgorithm {
    /// The RFC 6238 default, and what nearly every issuer uses.
    #[default]
    Sha1,
    /// Offered by some issuers; selected by `algorithm=SHA256` in a URI.
    Sha256,
    /// As above, `algorithm=SHA512`.
    Sha512,
}

impl TotpAlgorithm {
    /// Parses the `algorithm` parameter of an `otpauth://` URI.
    ///
    /// # Errors
    ///
    /// [`CryptoError::InvalidInput`] for a name this build does not know. The
    /// name came from the caller, so echoing it reveals nothing.
    pub fn parse(name: &str) -> Result<Self> {
        match name.to_ascii_uppercase().as_str() {
            "SHA1" => Ok(Self::Sha1),
            "SHA256" => Ok(Self::Sha256),
            "SHA512" => Ok(Self::Sha512),
            other => Err(CryptoError::InvalidInput(format!(
                "unsupported TOTP algorithm {other}"
            ))),
        }
    }
}

/// How an issuer's codes are shaped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TotpParams {
    /// Which HMAC the issuer chose.
    pub algorithm: TotpAlgorithm,
    /// How many digits the code has: six to eight.
    pub digits: u32,
    /// Seconds each code is valid for.
    pub period: u64,
}

impl Default for TotpParams {
    /// The RFC 6238 defaults, which is what an `otpauth://` URI means when it
    /// omits these.
    fn default() -> Self {
        Self {
            algorithm: TotpAlgorithm::Sha1,
            digits: 6,
            period: 30,
        }
    }
}

impl TotpParams {
    /// Rejects parameters no correct code could come out of.
    ///
    /// # Errors
    ///
    /// [`CryptoError::InvalidInput`] for a digit count outside 6–8 or a period
    /// of zero. Both describe the caller's own argument.
    fn validate(&self) -> Result<()> {
        if !(MIN_DIGITS..=MAX_DIGITS).contains(&self.digits) {
            return Err(CryptoError::InvalidInput(format!(
                "TOTP digits must be {MIN_DIGITS}-{MAX_DIGITS}, got {}",
                self.digits
            )));
        }
        if self.period == 0 {
            return Err(CryptoError::InvalidInput(
                "TOTP period must be at least one second".to_owned(),
            ));
        }
        Ok(())
    }
}

/// A shared secret, scrubbed when it is dropped.
///
/// Variable length by nature — RFC 4226 requires at least 128 bits and
/// recommends 160, and issuers hand out anything from 10 to 64 bytes — so
/// this is not one of the fixed-width key types in `secret.rs`.
#[derive(ZeroizeOnDrop)]
pub struct TotpSecret(Vec<u8>);

// Hand-written, as every secret type in this crate must be: a derived Debug
// would print the shared secret into whatever log touched it (CLAUDE.md §2.3).
impl core::fmt::Debug for TotpSecret {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("TotpSecret([REDACTED])")
    }
}

/// Shortest secret RFC 4226 §4 allows, in bytes.
const MIN_SECRET_LEN: usize = 16;

impl TotpSecret {
    /// Takes a secret that is already bytes.
    ///
    /// # Errors
    ///
    /// [`CryptoError::InvalidInput`] if it is shorter than RFC 4226 allows.
    /// The length of a value the caller just supplied is not a secret from
    /// the caller.
    pub fn from_bytes(bytes: Vec<u8>) -> Result<Self> {
        if bytes.len() < MIN_SECRET_LEN {
            return Err(CryptoError::InvalidInput(format!(
                "TOTP secret must be at least {MIN_SECRET_LEN} bytes"
            )));
        }
        Ok(Self(bytes))
    }

    /// Decodes the base32 an authenticator prints under its QR code.
    ///
    /// Spaces and lowercase are accepted because that is how the string
    /// arrives when it is read off a screen and typed in by hand, and padding
    /// is optional because issuers disagree about whether to include it.
    ///
    /// # Errors
    ///
    /// [`CryptoError::InvalidInput`] if it is not base32, or decodes to
    /// something too short. Both are properties of the caller's own input.
    pub fn parse(encoded: &str) -> Result<Self> {
        let mut cleaned: String = encoded
            .chars()
            .filter(|character| !character.is_whitespace() && *character != '=')
            .collect::<String>()
            .to_ascii_uppercase();

        let decoded = BASE32_NOPAD.decode(cleaned.as_bytes());
        // Scrubbed whether or not it decoded: it is the secret either way.
        cleaned.zeroize();

        let bytes = decoded
            .map_err(|_| CryptoError::InvalidInput("TOTP secret is not base32".to_owned()))?;
        Self::from_bytes(bytes)
    }
}

/// Which time step `unix_seconds` falls in.
fn counter(unix_seconds: u64, period: u64) -> u64 {
    // period is non-zero by validation, but division is written to be
    // total anyway: a panic in a crypto path is a DoS (CLAUDE.md §4.3).
    unix_seconds.checked_div(period).unwrap_or(0)
}

/// RFC 4226 §5.3 dynamic truncation: 31 bits, from an offset the tag chooses.
fn truncate(tag: &[u8]) -> Result<u32> {
    let last = tag
        .last()
        .ok_or_else(|| CryptoError::InvalidInput("empty HMAC output".to_owned()))?;
    let offset = usize::from(last & 0x0f);

    let window = tag
        .get(offset..offset.saturating_add(4))
        .ok_or_else(|| CryptoError::InvalidInput("HMAC output is too short".to_owned()))?;
    let bytes: [u8; 4] = window
        .try_into()
        .map_err(|_| CryptoError::InvalidInput("HMAC output is too short".to_owned()))?;

    // The top bit is masked off so the result is the same on every platform,
    // signed or not — the reason the RFC specifies it rather than leaving it
    // to the implementation.
    Ok(u32::from_be_bytes(bytes) & 0x7fff_ffff)
}

/// HMACs the counter under one algorithm.
///
/// Written once per algorithm rather than over a trait object: the three
/// output types differ in length, and a boxed digest would add an allocation
/// and a dependency on `digest`'s dyn support for no benefit.
fn mac(algorithm: TotpAlgorithm, secret: &[u8], counter: u64) -> Result<Vec<u8>> {
    let message = counter.to_be_bytes();
    let failed = || CryptoError::InvalidInput("TOTP secret is not a usable HMAC key".to_owned());

    Ok(match algorithm {
        TotpAlgorithm::Sha1 => {
            let mut hmac = Hmac::<Sha1>::new_from_slice(secret).map_err(|_| failed())?;
            hmac.update(&message);
            hmac.finalize().into_bytes().to_vec()
        }
        TotpAlgorithm::Sha256 => {
            let mut hmac = Hmac::<Sha256>::new_from_slice(secret).map_err(|_| failed())?;
            hmac.update(&message);
            hmac.finalize().into_bytes().to_vec()
        }
        TotpAlgorithm::Sha512 => {
            let mut hmac = Hmac::<Sha512>::new_from_slice(secret).map_err(|_| failed())?;
            hmac.update(&message);
            hmac.finalize().into_bytes().to_vec()
        }
    })
}

/// The code for one moment, zero-padded to the requested width.
///
/// Returned as a string because a leading zero is part of the code: `042191`
/// is not `42191`, and a caller that received a number would have to know to
/// pad it back.
///
/// # Errors
///
/// [`CryptoError::InvalidInput`] for parameters outside RFC 4226's range or a
/// secret the HMAC will not take. Nothing derived from the secret is
/// reported.
pub fn totp_code(secret: &TotpSecret, params: &TotpParams, unix_seconds: u64) -> Result<String> {
    params.validate()?;

    let mut tag = mac(
        params.algorithm,
        &secret.0,
        counter(unix_seconds, params.period),
    )?;
    let truncated = truncate(&tag);
    // The tag is derived from the secret; it does not linger either.
    tag.zeroize();

    let modulus = 10_u32
        .checked_pow(params.digits)
        .ok_or_else(|| CryptoError::InvalidInput("TOTP digit count overflows".to_owned()))?;

    // `checked_rem` rather than `%`: the modulus cannot be zero after
    // validation, but the crate denies bare arithmetic in library code
    // precisely so that reasoning does not have to be re-checked by a reader.
    let code = truncated?
        .checked_rem(modulus)
        .ok_or_else(|| CryptoError::InvalidInput("TOTP digit count overflows".to_owned()))?;
    Ok(format!(
        "{code:0width$}",
        width = usize::try_from(params.digits)
            .map_err(|_| CryptoError::InvalidInput("TOTP digit count overflows".to_owned()))?
    ))
}

/// How long the current code has left, in seconds.
///
/// A whole `period` when a step has just begun. Zero is never returned, since
/// a code with no time left is already the next one.
///
/// # Errors
///
/// [`CryptoError::InvalidInput`] for a period of zero.
pub fn seconds_remaining(params: &TotpParams, unix_seconds: u64) -> Result<u64> {
    params.validate()?;
    let elapsed = unix_seconds
        .checked_rem(params.period)
        .ok_or_else(|| CryptoError::InvalidInput("TOTP period must not be zero".to_owned()))?;
    Ok(params.period.saturating_sub(elapsed))
}

// Host-only: the algorithm is target-independent, and the browser-side
// surface is covered by tests/wasm.rs.
#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;

    /// RFC 6238 Appendix B's seed: the ASCII digits, repeated to length.
    ///
    /// Test data from the specification itself, which is the one place a
    /// fixed secret is not someone's (CLAUDE.md §2.6).
    fn rfc_secret(length: usize) -> TotpSecret {
        let pattern = b"1234567890";
        let bytes: Vec<u8> = pattern.iter().copied().cycle().take(length).collect();
        TotpSecret::from_bytes(bytes).unwrap()
    }

    fn eight_digits(algorithm: TotpAlgorithm) -> TotpParams {
        TotpParams {
            algorithm,
            digits: 8,
            period: 30,
        }
    }

    // --- Known-answer vectors, RFC 6238 Appendix B ---
    //
    // Not computed by this crate: these are the values printed in the
    // specification. If one of them fails, the implementation is wrong, not
    // the table.

    #[test]
    fn matches_rfc_6238_sha1_vectors() {
        let secret = rfc_secret(20);
        let params = eight_digits(TotpAlgorithm::Sha1);
        for (at, expected) in [
            (59_u64, "94287082"),
            (1_111_111_109, "07081804"),
            (1_111_111_111, "14050471"),
            (1_234_567_890, "89005924"),
            (2_000_000_000, "69279037"),
            (20_000_000_000, "65353130"),
        ] {
            assert_eq!(
                totp_code(&secret, &params, at).unwrap(),
                expected,
                "at {at}"
            );
        }
    }

    #[test]
    fn matches_rfc_6238_sha256_vectors() {
        let secret = rfc_secret(32);
        let params = eight_digits(TotpAlgorithm::Sha256);
        for (at, expected) in [
            (59_u64, "46119246"),
            (1_111_111_109, "68084774"),
            (1_111_111_111, "67062674"),
            (1_234_567_890, "91819424"),
            (2_000_000_000, "90698825"),
            (20_000_000_000, "77737706"),
        ] {
            assert_eq!(
                totp_code(&secret, &params, at).unwrap(),
                expected,
                "at {at}"
            );
        }
    }

    #[test]
    fn matches_rfc_6238_sha512_vectors() {
        let secret = rfc_secret(64);
        let params = eight_digits(TotpAlgorithm::Sha512);
        for (at, expected) in [
            (59_u64, "90693936"),
            (1_111_111_109, "25091201"),
            (1_111_111_111, "99943326"),
            (1_234_567_890, "93441116"),
            (2_000_000_000, "38618901"),
            (20_000_000_000, "47863826"),
        ] {
            assert_eq!(
                totp_code(&secret, &params, at).unwrap(),
                expected,
                "at {at}"
            );
        }
    }

    // --- Shape ---

    #[test]
    fn keeps_a_leading_zero() {
        // The reason a code is a string. RFC 6238's own 1111111109 vector
        // begins with a zero, and a caller handed 7081804 would have to know
        // to pad it back.
        let code = totp_code(
            &rfc_secret(20),
            &eight_digits(TotpAlgorithm::Sha1),
            1_111_111_109,
        )
        .unwrap();
        assert_eq!(code.len(), 8);
        assert!(code.starts_with('0'));
    }

    #[test]
    fn six_digits_is_the_default_shape() {
        let params = TotpParams::default();
        assert_eq!(params.digits, 6);
        assert_eq!(params.period, 30);
        assert_eq!(params.algorithm, TotpAlgorithm::Sha1);

        let code = totp_code(&rfc_secret(20), &params, 59).unwrap();
        assert_eq!(code.len(), 6);
        assert!(code.chars().all(|character| character.is_ascii_digit()));
    }

    #[test]
    fn the_code_holds_still_within_one_step_and_changes_across_it() {
        let secret = rfc_secret(20);
        let params = TotpParams::default();
        let inside = totp_code(&secret, &params, 60).unwrap();
        assert_eq!(totp_code(&secret, &params, 89).unwrap(), inside);
        assert_ne!(totp_code(&secret, &params, 90).unwrap(), inside);
    }

    #[test]
    fn time_left_counts_down_within_the_step() {
        let params = TotpParams::default();
        assert_eq!(seconds_remaining(&params, 60).unwrap(), 30);
        assert_eq!(seconds_remaining(&params, 75).unwrap(), 15);
        // Never zero: a code with no time left is already the next one.
        assert_eq!(seconds_remaining(&params, 89).unwrap(), 1);
    }

    // --- Parsing ---

    #[test]
    fn parses_the_base32_an_authenticator_prints() {
        // RFC 4648 base32 of the RFC 6238 seed.
        let secret = TotpSecret::parse("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ").unwrap();
        let params = eight_digits(TotpAlgorithm::Sha1);
        assert_eq!(totp_code(&secret, &params, 59).unwrap(), "94287082");
    }

    #[test]
    fn accepts_a_secret_as_it_is_read_off_a_screen() {
        // Lowercase, grouped in fours, padded — all of which happen.
        let typed = TotpSecret::parse("gezd gnbv gy3t qojq gezd gnbv gy3t qojq==").unwrap();
        let clean = TotpSecret::parse("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ").unwrap();
        let params = TotpParams::default();
        assert_eq!(
            totp_code(&typed, &params, 59).unwrap(),
            totp_code(&clean, &params, 59).unwrap()
        );
    }

    #[test]
    fn refuses_a_secret_that_is_not_base32() {
        assert!(matches!(
            TotpSecret::parse("not base32!"),
            Err(CryptoError::InvalidInput(_))
        ));
    }

    #[test]
    fn refuses_a_secret_too_short_to_be_one() {
        // RFC 4226 §4 requires 128 bits. A four-byte "secret" is a typo.
        assert!(matches!(
            TotpSecret::parse("GEZDGNBV"),
            Err(CryptoError::InvalidInput(_))
        ));
    }

    #[test]
    fn refuses_parameters_no_code_could_come_from() {
        let secret = rfc_secret(20);
        for digits in [0, 5, 9, 20] {
            let params = TotpParams {
                digits,
                ..TotpParams::default()
            };
            assert!(matches!(
                totp_code(&secret, &params, 59),
                Err(CryptoError::InvalidInput(_))
            ));
        }

        let stopped = TotpParams {
            period: 0,
            ..TotpParams::default()
        };
        assert!(matches!(
            totp_code(&secret, &stopped, 59),
            Err(CryptoError::InvalidInput(_))
        ));
        assert!(matches!(
            seconds_remaining(&stopped, 59),
            Err(CryptoError::InvalidInput(_))
        ));
    }

    #[test]
    fn algorithm_names_are_read_however_they_are_written() {
        assert_eq!(TotpAlgorithm::parse("SHA1").unwrap(), TotpAlgorithm::Sha1);
        assert_eq!(
            TotpAlgorithm::parse("sha256").unwrap(),
            TotpAlgorithm::Sha256
        );
        assert_eq!(
            TotpAlgorithm::parse("Sha512").unwrap(),
            TotpAlgorithm::Sha512
        );
        assert!(matches!(
            TotpAlgorithm::parse("MD5"),
            Err(CryptoError::InvalidInput(_))
        ));
    }

    #[test]
    fn secret_debug_output_is_redacted() {
        let secret = rfc_secret(20);
        assert_eq!(format!("{secret:?}"), "TotpSecret([REDACTED])");
    }
}
