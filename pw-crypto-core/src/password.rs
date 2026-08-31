//! Password generation.
//!
//! Lives here rather than in a client because it needs the same CSPRNG and
//! the same no-panic discipline as everything else in this crate — and
//! because the mobile and desktop clients will want it too.

use crate::error::{CryptoError, Result};
use rand::TryRng as _;
use rand::rngs::SysRng;
use serde::{Deserialize, Serialize};

const LOWERCASE: &[u8] = b"abcdefghijklmnopqrstuvwxyz";
const UPPERCASE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS: &[u8] = b"0123456789";

/// Deliberately excludes quotes, backslash and backtick: they are the
/// characters most often mangled by a site's own input handling, and dropping
/// them costs about half a bit per character.
const SYMBOLS: &[u8] = b"!@#$%^&*()-_=+[]{}<>?,.:;";

/// Shortest password this will produce. Below this, length is the problem
/// regardless of which character classes are enabled.
pub const MIN_LENGTH: usize = 8;

/// Longest password this will produce.
pub const MAX_LENGTH: usize = 256;

/// How many times to redraw when a password misses an enabled class.
///
/// Enforcing coverage by overwriting positions would skew the distribution,
/// so a password that misses a class is discarded and redrawn. At the minimum
/// length this practically never fires; the bound exists so the function
/// cannot hang.
const MAX_ATTEMPTS: usize = 1_000;

/// What the generated password may contain.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PasswordOptions {
    /// Number of characters.
    pub length: usize,
    /// Include `a`–`z`.
    pub lowercase: bool,
    /// Include `A`–`Z`.
    pub uppercase: bool,
    /// Include `0`–`9`.
    pub digits: bool,
    /// Include punctuation.
    pub symbols: bool,
}

impl Default for PasswordOptions {
    /// 20 characters drawn from every class.
    ///
    /// 20 is well past the point where length stops being the weak link, and
    /// a generated password is never typed from memory, so there is no reason
    /// to be frugal with it.
    fn default() -> Self {
        Self {
            length: 20,
            lowercase: true,
            uppercase: true,
            digits: true,
            symbols: true,
        }
    }
}

impl PasswordOptions {
    /// The character classes this enables, in a stable order.
    fn classes(&self) -> Vec<&'static [u8]> {
        let mut classes = Vec::new();
        if self.lowercase {
            classes.push(LOWERCASE);
        }
        if self.uppercase {
            classes.push(UPPERCASE);
        }
        if self.digits {
            classes.push(DIGITS);
        }
        if self.symbols {
            classes.push(SYMBOLS);
        }
        classes
    }

    fn validate(&self) -> Result<Vec<&'static [u8]>> {
        if self.length < MIN_LENGTH || self.length > MAX_LENGTH {
            return Err(CryptoError::InvalidInput(format!(
                "length must be between {MIN_LENGTH} and {MAX_LENGTH}, got {}",
                self.length
            )));
        }

        let classes = self.classes();
        if classes.is_empty() {
            return Err(CryptoError::InvalidInput(
                "at least one character class must be enabled".to_owned(),
            ));
        }

        // Guaranteeing one character per class is impossible otherwise. MIN_LENGTH
        // already exceeds the number of classes, so this cannot currently fire —
        // it is here so adding a class later fails loudly rather than silently
        // dropping the guarantee.
        if self.length < classes.len() {
            return Err(CryptoError::InvalidInput(
                "length is shorter than the number of enabled classes".to_owned(),
            ));
        }

        Ok(classes)
    }
}

/// The largest multiple of `bound` that fits in a `u32`.
///
/// Values at or above this are rejected when sampling, because the leftover
/// tail is shorter than `bound` and would make the characters it covers more
/// likely than the rest. Taking `random % bound` without this is the standard
/// way to introduce modulo bias.
fn rejection_limit(bound: u32) -> Result<u32> {
    let remainder = u32::MAX
        .checked_rem(bound)
        .ok_or_else(|| CryptoError::InvalidInput("empty character set".to_owned()))?;
    u32::MAX
        .checked_sub(remainder)
        .ok_or_else(|| CryptoError::InvalidInput("character set is too large".to_owned()))
}

/// Draws a uniformly distributed index below `bound`.
fn uniform_index(bound: usize) -> Result<usize> {
    let bound = u32::try_from(bound)
        .map_err(|_| CryptoError::InvalidInput("character set is too large".to_owned()))?;
    if bound == 0 {
        return Err(CryptoError::InvalidInput("empty character set".to_owned()));
    }

    let limit = rejection_limit(bound)?;

    loop {
        let mut bytes = [0u8; 4];
        SysRng.try_fill_bytes(&mut bytes).map_err(|_| {
            CryptoError::KeyDerivationFailed("OS random number generator unavailable".to_owned())
        })?;

        let value = u32::from_le_bytes(bytes);
        if value < limit {
            let index = value
                .checked_rem(bound)
                .ok_or_else(|| CryptoError::InvalidInput("empty character set".to_owned()))?;
            return usize::try_from(index)
                .map_err(|_| CryptoError::InvalidInput("index does not fit".to_owned()));
        }
        // Landed in the tail; draw again rather than fold it back in.
    }
}

/// Generates a password.
///
/// Every character is drawn from the OS CSPRNG with rejection sampling, so
/// the distribution is uniform over the enabled classes. The result is
/// guaranteed to contain at least one character from each enabled class.
///
/// The returned `String` is a secret and the caller's to discard; nothing
/// here can scrub it afterwards.
///
/// # Errors
///
/// [`CryptoError::InvalidInput`] if the options are unsatisfiable,
/// [`CryptoError::KeyDerivationFailed`] if the CSPRNG is unavailable.
pub fn generate_password(options: &PasswordOptions) -> Result<String> {
    let classes = options.validate()?;
    let charset: Vec<u8> = classes
        .iter()
        .flat_map(|class| class.iter().copied())
        .collect();

    for _ in 0..MAX_ATTEMPTS {
        let mut password = String::with_capacity(options.length);

        for _ in 0..options.length {
            let index = uniform_index(charset.len())?;
            let byte = charset
                .get(index)
                .ok_or_else(|| CryptoError::InvalidInput("index out of range".to_owned()))?;
            password.push(char::from(*byte));
        }

        if classes
            .iter()
            .all(|class| password.bytes().any(|byte| class.contains(&byte)))
        {
            return Ok(password);
        }
        // Missing a class. Discard and redraw: patching a character into
        // place would bias the position it landed in.
    }

    Err(CryptoError::KeyDerivationFailed(
        "could not satisfy the character class requirements".to_owned(),
    ))
}

// Host-only: these exercise the algorithm, which is target-independent.
#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;

    fn only(class: &'static [u8]) -> PasswordOptions {
        PasswordOptions {
            length: 16,
            lowercase: core::ptr::eq(class, LOWERCASE),
            uppercase: core::ptr::eq(class, UPPERCASE),
            digits: core::ptr::eq(class, DIGITS),
            symbols: core::ptr::eq(class, SYMBOLS),
        }
    }

    // --- The property that is easy to get wrong ---

    #[test]
    fn rejection_limit_is_an_exact_multiple_of_the_bound() {
        // This is what keeps the sampling uniform. If the limit were not a
        // multiple of the bound, the characters covered by the leftover tail
        // would be drawn more often than the rest — the classic modulo bias,
        // which no realistic distribution test would reliably catch.
        for bound in [2u32, 10, 25, 26, 62, 87, 255, 256] {
            let limit = rejection_limit(bound).unwrap();
            assert_eq!(limit % bound, 0, "limit for {bound} is not a multiple");
            // And it discards as little as possible.
            assert!(
                u32::MAX - limit < bound,
                "limit for {bound} rejects too much"
            );
        }
    }

    #[test]
    fn indices_stay_below_the_bound() {
        for _ in 0..2_000 {
            assert!(uniform_index(26).unwrap() < 26);
            assert!(uniform_index(1).unwrap() < 1);
        }
    }

    // --- Generation ---

    #[test]
    fn respects_the_requested_length() {
        for length in [MIN_LENGTH, 20, 64, MAX_LENGTH] {
            let options = PasswordOptions {
                length,
                ..PasswordOptions::default()
            };
            assert_eq!(generate_password(&options).unwrap().chars().count(), length);
        }
    }

    #[test]
    fn uses_only_the_enabled_classes() {
        for class in [LOWERCASE, UPPERCASE, DIGITS, SYMBOLS] {
            let password = generate_password(&only(class)).unwrap();
            assert!(
                password.bytes().all(|byte| class.contains(&byte)),
                "password {password} strayed outside its class"
            );
        }
    }

    #[test]
    fn includes_at_least_one_of_every_enabled_class() {
        let options = PasswordOptions::default();
        for _ in 0..200 {
            let password = generate_password(&options).unwrap();
            for class in options.classes() {
                assert!(
                    password.bytes().any(|byte| class.contains(&byte)),
                    "password {password} is missing a class"
                );
            }
        }
    }

    #[test]
    fn two_passwords_differ() {
        let options = PasswordOptions::default();
        let a = generate_password(&options).unwrap();
        let b = generate_password(&options).unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn every_character_of_a_class_is_reachable() {
        // A smoke test, not a proof of uniformity: it would catch a charset
        // that was built wrong or a sampler stuck in part of its range. The
        // uniformity itself is pinned by the rejection-limit test above.
        let options = PasswordOptions {
            length: MAX_LENGTH,
            ..only(DIGITS)
        };
        let mut seen = [false; 10];
        for _ in 0..40 {
            for byte in generate_password(&options).unwrap().bytes() {
                if let Some(slot) = seen.get_mut(usize::from(byte.wrapping_sub(b'0'))) {
                    *slot = true;
                }
            }
        }
        assert!(seen.iter().all(|hit| *hit), "some digits never appeared");
    }

    // --- Refusals ---

    #[test]
    fn rejects_a_length_outside_the_bounds() {
        for length in [0, MIN_LENGTH - 1, MAX_LENGTH + 1] {
            let options = PasswordOptions {
                length,
                ..PasswordOptions::default()
            };
            assert!(matches!(
                generate_password(&options),
                Err(CryptoError::InvalidInput(_))
            ));
        }
    }

    #[test]
    fn rejects_having_no_classes_at_all() {
        let options = PasswordOptions {
            length: 20,
            lowercase: false,
            uppercase: false,
            digits: false,
            symbols: false,
        };
        assert!(matches!(
            generate_password(&options),
            Err(CryptoError::InvalidInput(_))
        ));
    }

    #[test]
    fn default_options_are_usable() {
        let options = PasswordOptions::default();
        assert!(options.validate().is_ok());
        assert_eq!(options.classes().len(), 4);
    }
}
