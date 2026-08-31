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

// --- Strength ---

/// How strong a password looks.
///
/// Bands are anchored to what this crate's own generator produces: its
/// 20-character default lands around 131 bits, so [`Excellent`] is reachable
/// essentially only by generating one — which is the advice worth giving.
///
/// [`Excellent`]: StrengthLevel::Excellent
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StrengthLevel {
    /// Around eight random characters or fewer. Replace it now.
    VeryWeak,
    /// Nine to eleven random characters. Days against a fast hash.
    Weak,
    /// Around twelve random characters.
    Fair,
    /// Around sixteen random characters.
    Strong,
    /// What the generator produces by default.
    Excellent,
}

/// An estimate of a password's strength.
///
/// # What this does not do
///
/// It scores *shape*, not predictability. There is no dictionary here, so
/// something like `MyCatWhiskers!77x` — seventeen characters across all four
/// classes, no repeated or consecutive run — reads as strong despite being
/// the kind of thing a rule-based wordlist attack is built for. Catching that
/// needs either a dictionary (which costs sixteen times this crate's entire
/// wasm bundle, measured) or a breach-corpus lookup, which would mean a
/// network call this crate must never make (CLAUDE.md §2.5).
///
/// The run penalty does catch the most obvious cases — `Password123456789!`
/// scores as weak, because the nine-digit sequence is charged for.
///
/// For a vault of generated passwords that boundary is unimportant. For old
/// human-chosen ones, treat a good score as "not obviously bad" rather than
/// "safe".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PasswordStrength {
    /// Estimated bits of entropy, assuming the password was chosen at random
    /// from the character classes it happens to use.
    pub bits: u32,
    /// The band `bits` falls in.
    pub level: StrengthLevel,
}

/// Shortest run that can count as a pattern at all.
///
/// Three is too low: in twenty characters drawn at random from this crate's
/// own alphabet, an accidental `abc` or `77` turns up about two times in a
/// hundred. Charging for that would penalise passwords for being random.
const MIN_RUN: usize = 4;

/// Counts the distinct character classes a password draws on, as a charset
/// size an attacker would have to search.
fn charset_size(password: &str) -> u32 {
    let mut size = 0u32;
    if password.bytes().any(|b| LOWERCASE.contains(&b)) {
        size = size.saturating_add(26);
    }
    if password.bytes().any(|b| UPPERCASE.contains(&b)) {
        size = size.saturating_add(26);
    }
    if password.bytes().any(|b| DIGITS.contains(&b)) {
        size = size.saturating_add(10);
    }
    if password.bytes().any(|b| SYMBOLS.contains(&b)) {
        size = size.saturating_add(u32::try_from(SYMBOLS.len()).unwrap_or(0));
    }
    // Anything outside the classes above still widens the search space, but
    // conservatively: count it as one extra character rather than guessing.
    if password.bytes().any(|b| {
        ![LOWERCASE, UPPERCASE, DIGITS, SYMBOLS]
            .iter()
            .any(|c| c.contains(&b))
    }) {
        size = size.saturating_add(1);
    }
    size
}

/// The length of the longest run of identical or consecutive bytes.
fn longest_run(password: &str) -> usize {
    let bytes = password.as_bytes();
    let mut longest = 1usize;
    let mut current = 1usize;

    for pair in bytes.windows(2) {
        let (Some(previous), Some(next)) = (pair.first(), pair.get(1)) else {
            continue;
        };
        let step = i16::from(*next).saturating_sub(i16::from(*previous));
        if step == 0 || step == 1 || step == -1 {
            current = current.saturating_add(1);
            longest = longest.max(current);
        } else {
            current = 1;
        }
    }

    if bytes.is_empty() { 0 } else { longest }
}

/// Estimates how strong a password is.
///
/// Never fails and never panics: an empty password scores zero.
#[must_use]
pub fn estimate_strength(password: &str) -> PasswordStrength {
    let length = password.chars().count();
    let charset = charset_size(password);

    // bits = length * log2(charset). Done in floating point and clamped,
    // because the result is an estimate shown to a person, not a value
    // anything depends on.
    let bits = if length == 0 || charset == 0 {
        0.0
    } else {
        let per_character = f64::from(charset).log2();
        per_character * (length as f64)
    };

    // A run of identical or consecutive characters is typed rather than
    // chosen — but only once it is long enough to be the password rather than
    // a coincidence inside it. Requiring the run to cover at least a third
    // means `aaaaaaaa` is charged for and a random string that happens to
    // contain `stu` is not. A nudge, not a model.
    let run = longest_run(password);
    let dominates = run.saturating_mul(3) >= length;
    let bits = if run >= MIN_RUN && dominates && length > 0 {
        let patterned = (run as f64) / (length as f64);
        bits * (1.0 - patterned.min(0.9))
    } else {
        bits
    };

    let bits = if bits.is_finite() && bits > 0.0 {
        bits.min(f64::from(u32::MAX)) as u32
    } else {
        0
    };

    let level = match bits {
        0..=49 => StrengthLevel::VeryWeak,
        50..=74 => StrengthLevel::Weak,
        75..=99 => StrengthLevel::Fair,
        100..=119 => StrengthLevel::Strong,
        _ => StrengthLevel::Excellent,
    };

    PasswordStrength { bits, level }
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

    // --- Strength ---

    fn level(password: &str) -> StrengthLevel {
        estimate_strength(password).level
    }

    #[test]
    fn a_chance_run_does_not_penalise_a_random_password() {
        // The reason MIN_RUN is not three. Both of these are otherwise strong
        // and contain a short accidental run.
        assert_eq!(level("xQ7!abcMz2#pLw9$Kd"), StrengthLevel::Strong);
        assert_eq!(level("xQ7!zz2Mz2#pLw9$Kd"), StrengthLevel::Strong);
    }

    #[test]
    fn what_the_generator_produces_is_excellent() {
        // The bands exist to make this true: the advice worth giving is
        // "let it generate one", so only that should reach the top band.
        // Enough iterations that a rare accidental run would surface: the
        // earlier three-character threshold failed roughly one run in three.
        let options = PasswordOptions::default();
        for _ in 0..500 {
            let password = generate_password(&options).unwrap();
            assert_eq!(
                level(&password),
                StrengthLevel::Excellent,
                "generated {password} did not reach the top band"
            );
        }
    }

    #[test]
    fn nine_random_characters_are_weak() {
        // ~59 bits. Days against a fast unsalted hash on real hardware, which
        // is what has to be assumed for a password held by someone else.
        assert_eq!(level("aB3!xQ7z."), StrengthLevel::Weak);
    }

    #[test]
    fn length_bands_line_up_with_the_generator() {
        let options = |length| PasswordOptions {
            length,
            ..PasswordOptions::default()
        };
        assert_eq!(
            level(&generate_password(&options(8)).unwrap()),
            StrengthLevel::Weak
        );
        assert_eq!(
            level(&generate_password(&options(12)).unwrap()),
            StrengthLevel::Fair
        );
        assert_eq!(
            level(&generate_password(&options(16)).unwrap()),
            StrengthLevel::Strong
        );
        assert_eq!(
            level(&generate_password(&options(20)).unwrap()),
            StrengthLevel::Excellent
        );
    }

    #[test]
    fn a_narrow_charset_needs_far_more_length() {
        // 26 characters per position instead of 87: eleven lowercase letters
        // is worth about as much as six from the full set.
        assert_eq!(level("abcdefghijk"), StrengthLevel::VeryWeak);
        // No run long enough to charge for, so this is scored purely on its
        // narrow alphabet: eleven lowercase letters is about 51 bits.
        assert_eq!(level("qwrtypsdfgh"), StrengthLevel::Weak);
    }

    #[test]
    fn runs_and_repeats_are_penalised() {
        // Composition alone would rate these on length and class alone.
        assert_eq!(level("aaaaaaaaaaaaaaaa"), StrengthLevel::VeryWeak);
        assert_eq!(level("1234567890123456"), StrengthLevel::VeryWeak);
        assert_eq!(level("abcdefghijklmnop"), StrengthLevel::VeryWeak);
    }

    #[test]
    fn an_empty_password_scores_nothing() {
        let strength = estimate_strength("");
        assert_eq!(strength.bits, 0);
        assert_eq!(strength.level, StrengthLevel::VeryWeak);
    }

    #[test]
    fn scoring_never_panics_on_odd_input() {
        for password in ["\u{0}", "🔐🔐🔐🔐", "  ", "\n\t", &"x".repeat(10_000)] {
            let _ = estimate_strength(password);
        }
    }

    #[test]
    fn a_wider_charset_scores_higher_at_equal_length() {
        let narrow = estimate_strength("abcdlkjhgfds").bits;
        let wide = estimate_strength("aB3!lkjHgf&s").bits;
        assert!(wide > narrow, "{wide} should beat {narrow}");
    }

    // --- The documented limitation, asserted so it stays deliberate ---

    #[test]
    fn an_obvious_sequence_is_still_caught() {
        // Composition alone would rate this at 116 bits on length and class.
        // The run penalty charges for the nine-digit sequence instead.
        assert_eq!(level("Password123456789!"), StrengthLevel::Weak);
    }

    #[test]
    fn a_predictable_password_without_runs_is_not_caught() {
        // The boundary of composition scoring, recorded here so it stays a
        // known trade rather than a surprise. Seventeen characters, all four
        // classes, no run to charge for — and exactly what a rule-based
        // wordlist attack is built for.
        assert_eq!(level("MyCatWhiskers!77x"), StrengthLevel::Strong);
    }
}
