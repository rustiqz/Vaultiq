//! Passphrase generation.
//!
//! A passphrase is a handful of words drawn uniformly from the EFF long list
//! (7,776 words, about 12.92 bits each), which is far easier to read, type and
//! remember than a random string of the same strength. Six words is about 77
//! bits.
//!
//! Every word is drawn from the OS CSPRNG with the same rejection sampling the
//! password generator uses, so each is uniform over the whole list. Nothing
//! here is a new primitive: it is [`password::uniform_index`] called once per
//! word.
//!
//! The list and where it came from are described in `wordlist/README.md`.

use crate::error::{CryptoError, Result};
use crate::password::uniform_index;
use serde::{Deserialize, Serialize};
use zeroize::Zeroize as _;

/// The EFF long list, as published: a five-dice code, a tab, then the word.
const WORDLIST: &str = include_str!("wordlist/eff_large_wordlist.txt");

/// How many words the list has. Checked at run time as well as in tests,
/// because every entropy figure depends on it.
pub const WORD_COUNT: usize = 7_776;

/// Fewest words this will produce. Below three, the strength is not a
/// passphrase's to claim.
pub const MIN_WORDS: usize = 3;

/// Most words this will produce.
pub const MAX_WORDS: usize = 20;

/// Longest separator, in characters.
pub const MAX_SEPARATOR_CHARS: usize = 4;

/// What the passphrase may look like.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PassphraseOptions {
    /// Number of words.
    pub words: usize,
    /// Put between words. Up to four printable characters, or empty.
    pub separator: String,
    /// Capitalise the first letter of every word. Adds no strength.
    pub capitalize: bool,
    /// Append one random digit to one random word.
    pub include_number: bool,
}

impl Default for PassphraseOptions {
    /// Six words with hyphens: about 77 bits, which is what the EFF suggests
    /// for something that protects a lot.
    fn default() -> Self {
        Self {
            words: 6,
            separator: "-".to_owned(),
            capitalize: false,
            include_number: false,
        }
    }
}

impl PassphraseOptions {
    fn validate(&self) -> Result<()> {
        if self.words < MIN_WORDS || self.words > MAX_WORDS {
            return Err(CryptoError::InvalidInput(format!(
                "words must be between {MIN_WORDS} and {MAX_WORDS}, got {}",
                self.words
            )));
        }
        if self.separator.chars().count() > MAX_SEPARATOR_CHARS {
            return Err(CryptoError::InvalidInput(format!(
                "separator can be at most {MAX_SEPARATOR_CHARS} characters"
            )));
        }
        // Printable ASCII and the space. No control characters, no newline,
        // nothing that would be mangled on the way into a form field.
        if !self
            .separator
            .chars()
            .all(|c| c == ' ' || c.is_ascii_graphic())
        {
            return Err(CryptoError::InvalidInput(
                "separator must be printable ASCII".to_owned(),
            ));
        }
        Ok(())
    }
}

/// The words of the list, without their dice codes.
fn words() -> Result<Vec<&'static str>> {
    let list: Vec<&'static str> = WORDLIST
        .lines()
        .filter_map(|line| line.split('\t').nth(1))
        .collect();
    if list.len() != WORD_COUNT {
        // A build problem, never a caller's: the list is compiled in.
        return Err(CryptoError::InvalidInput(
            "the word list is not the expected size".to_owned(),
        ));
    }
    Ok(list)
}

fn capitalised(word: &str) -> String {
    let mut chars = word.chars();
    let mut out = String::with_capacity(word.len());
    if let Some(first) = chars.next() {
        out.push(first.to_ascii_uppercase());
    }
    out.push_str(chars.as_str());
    out
}

/// Generates a passphrase.
///
/// The result is a secret and the caller's to discard; the intermediate words
/// are scrubbed, but the returned `String` cannot be.
///
/// # Errors
///
/// [`CryptoError::InvalidInput`] if the options are out of range,
/// [`CryptoError::KeyDerivationFailed`] if the CSPRNG is unavailable.
pub fn generate_passphrase(options: &PassphraseOptions) -> Result<String> {
    options.validate()?;
    let list = words()?;

    let mut chosen: Vec<String> = Vec::with_capacity(options.words);
    for _ in 0..options.words {
        let index = uniform_index(list.len())?;
        let word = list
            .get(index)
            .ok_or_else(|| CryptoError::InvalidInput("index out of range".to_owned()))?;
        chosen.push(if options.capitalize {
            capitalised(word)
        } else {
            (*word).to_owned()
        });
    }

    if options.include_number {
        let at = uniform_index(chosen.len())?;
        let digit = u32::try_from(uniform_index(10)?)
            .ok()
            .and_then(|digit| char::from_digit(digit, 10))
            .ok_or_else(|| CryptoError::InvalidInput("digit out of range".to_owned()))?;
        if let Some(word) = chosen.get_mut(at) {
            word.push(digit);
        }
    }

    let phrase = chosen.join(&options.separator);
    for word in &mut chosen {
        word.zeroize();
    }
    Ok(phrase)
}

/// How many bits of entropy a passphrase made with these options has.
///
/// Counts only what is chosen at random: each word is one of
/// [`WORD_COUNT`], and the optional number adds a choice of which word and
/// which digit. Capitalisation and the separator are fixed by the options, so
/// they add nothing, and the figure is rounded down. It is a statement about
/// the generator, not an estimate from the text.
///
/// # Errors
///
/// [`CryptoError::InvalidInput`] if the options are out of range.
pub fn passphrase_bits(options: &PassphraseOptions) -> Result<u32> {
    options.validate()?;
    let words = f64::from(
        u32::try_from(options.words)
            .map_err(|_| CryptoError::InvalidInput("words is too large".to_owned()))?,
    );
    let per_word = f64::from(
        u32::try_from(WORD_COUNT)
            .map_err(|_| CryptoError::InvalidInput("word count is too large".to_owned()))?,
    )
    .log2();

    let mut bits = per_word * words;
    if options.include_number {
        // Which word gets the digit, and which digit.
        bits += (10.0 * words).log2();
    }
    Ok(bits.floor().max(0.0) as u32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest as _, Sha256};

    fn options(words: usize) -> PassphraseOptions {
        PassphraseOptions {
            words,
            ..PassphraseOptions::default()
        }
    }

    // --- The list ---

    #[test]
    fn the_word_list_is_exactly_the_one_published() {
        // Every strength claim depends on these 7,776 words and no others, so
        // a change to the file is a failing test rather than a quiet one.
        let digest = Sha256::digest(WORDLIST.as_bytes());
        let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
        assert_eq!(
            hex,
            "addd35536511597a02fa0a9ff1e5284677b8883b83e986e43f15a3db996b903e"
        );
    }

    #[test]
    fn the_word_list_has_the_expected_shape() {
        let list = words().unwrap();
        assert_eq!(list.len(), WORD_COUNT);
        let unique: std::collections::HashSet<_> = list.iter().collect();
        assert_eq!(unique.len(), WORD_COUNT, "a word appears twice");
        assert!(
            list.iter()
                .all(|word| word.bytes().all(|b| b.is_ascii_lowercase() || b == b'-')),
            "a word has a character other than a-z or a hyphen"
        );
    }

    // --- Generation ---

    #[test]
    fn makes_the_requested_number_of_words() {
        for count in [MIN_WORDS, 4, 6, 12, MAX_WORDS] {
            let phrase = generate_passphrase(&PassphraseOptions {
                separator: " ".to_owned(),
                ..options(count)
            })
            .unwrap();
            assert_eq!(phrase.split(' ').count(), count, "in {phrase}");
        }
    }

    #[test]
    fn every_word_comes_from_the_list() {
        let list: std::collections::HashSet<&str> = words().unwrap().into_iter().collect();
        for _ in 0..50 {
            let phrase = generate_passphrase(&PassphraseOptions {
                separator: " ".to_owned(),
                ..options(8)
            })
            .unwrap();
            for word in phrase.split(' ') {
                assert!(list.contains(word), "{word} is not in the list");
            }
        }
    }

    #[test]
    fn uses_the_separator_asked_for() {
        for separator in ["-", ".", "_", "", "::", " "] {
            let phrase = generate_passphrase(&PassphraseOptions {
                separator: separator.to_owned(),
                ..options(5)
            })
            .unwrap();
            if !separator.is_empty() && separator != "-" {
                assert!(phrase.contains(separator), "{phrase} lacks {separator:?}");
            }
        }
        // An empty separator runs the words together.
        let joined = generate_passphrase(&PassphraseOptions {
            separator: String::new(),
            ..options(4)
        })
        .unwrap();
        assert!(!joined.contains(' '));
    }

    #[test]
    fn capitalises_every_word_when_asked() {
        let phrase = generate_passphrase(&PassphraseOptions {
            capitalize: true,
            separator: " ".to_owned(),
            ..options(10)
        })
        .unwrap();
        for word in phrase.split(' ') {
            let first = word.chars().next().unwrap();
            assert!(first.is_ascii_uppercase(), "{word} is not capitalised");
        }
    }

    #[test]
    fn adds_exactly_one_digit_when_asked_and_none_otherwise() {
        for _ in 0..50 {
            let with = generate_passphrase(&PassphraseOptions {
                include_number: true,
                ..options(6)
            })
            .unwrap();
            assert_eq!(with.chars().filter(char::is_ascii_digit).count(), 1);

            let without = generate_passphrase(&options(6)).unwrap();
            assert_eq!(without.chars().filter(char::is_ascii_digit).count(), 0);
        }
    }

    #[test]
    fn the_digit_lands_at_the_end_of_a_word() {
        for _ in 0..50 {
            let phrase = generate_passphrase(&PassphraseOptions {
                include_number: true,
                separator: " ".to_owned(),
                ..options(6)
            })
            .unwrap();
            let word = phrase
                .split(' ')
                .find(|word| word.chars().any(|c| c.is_ascii_digit()))
                .unwrap();
            assert!(word.chars().last().unwrap().is_ascii_digit(), "{word}");
        }
    }

    #[test]
    fn two_passphrases_differ() {
        let a = generate_passphrase(&options(6)).unwrap();
        let b = generate_passphrase(&options(6)).unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn the_whole_list_is_reachable() {
        // A smoke test, not a proof of uniformity: it would catch a sampler
        // stuck in part of its range. The uniformity itself rests on the
        // rejection limit pinned in `password`.
        let mut seen = std::collections::HashSet::new();
        for _ in 0..400 {
            let phrase = generate_passphrase(&PassphraseOptions {
                separator: " ".to_owned(),
                ..options(MAX_WORDS)
            })
            .unwrap();
            seen.extend(phrase.split(' ').map(str::to_owned));
        }
        // 8,000 draws from 7,776 words should reach about 63% of them.
        assert!(seen.len() > 4_000, "only {} distinct words", seen.len());
    }

    // --- Strength ---

    #[test]
    fn counts_the_bits_the_generator_chooses() {
        // 6 words * log2(7776) = 77.5; 5 = 64.6; 3 = 38.8.
        assert_eq!(passphrase_bits(&options(6)).unwrap(), 77);
        assert_eq!(passphrase_bits(&options(5)).unwrap(), 64);
        assert_eq!(passphrase_bits(&options(3)).unwrap(), 38);
    }

    #[test]
    fn a_number_adds_which_word_and_which_digit() {
        // 77.5 + log2(10 * 6) = 77.5 + 5.9 = 83.4
        let with = PassphraseOptions {
            include_number: true,
            ..options(6)
        };
        assert_eq!(passphrase_bits(&with).unwrap(), 83);
    }

    #[test]
    fn capitalising_and_the_separator_add_nothing() {
        let dressed = PassphraseOptions {
            capitalize: true,
            separator: "::".to_owned(),
            ..options(6)
        };
        assert_eq!(
            passphrase_bits(&dressed).unwrap(),
            passphrase_bits(&options(6)).unwrap()
        );
    }

    // --- Refusals ---

    #[test]
    fn refuses_too_few_or_too_many_words() {
        for count in [0, 1, MIN_WORDS - 1, MAX_WORDS + 1, 1_000] {
            assert!(matches!(
                generate_passphrase(&options(count)),
                Err(CryptoError::InvalidInput(_))
            ));
            assert!(matches!(
                passphrase_bits(&options(count)),
                Err(CryptoError::InvalidInput(_))
            ));
        }
    }

    #[test]
    fn refuses_a_separator_that_is_too_long_or_not_printable() {
        for separator in ["-----", "\n", "a\tb", "é", "\u{7}"] {
            assert!(
                matches!(
                    generate_passphrase(&PassphraseOptions {
                        separator: separator.to_owned(),
                        ..options(5)
                    }),
                    Err(CryptoError::InvalidInput(_))
                ),
                "{separator:?} was accepted"
            );
        }
    }
}
