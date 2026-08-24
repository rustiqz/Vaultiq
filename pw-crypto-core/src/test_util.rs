//! Test-only helpers.
//!
//! Kept out of the public API: this module exists so known-answer vectors can
//! be written as the hex strings they are published in, rather than as
//! hand-transcribed byte arrays where a typo reads as a crypto bug.

/// Decodes a hex string into a fixed-size array.
///
/// Panics on malformed input — this is test-only code, and a bad literal in a
/// test vector should fail loudly and immediately.
pub(crate) fn hex<const N: usize>(s: &str) -> [u8; N] {
    assert_eq!(s.len(), N * 2, "hex literal must be {} chars", N * 2);
    let bytes = s.as_bytes();
    let mut out = [0u8; N];
    for (i, slot) in out.iter_mut().enumerate() {
        let pair = std::str::from_utf8(&bytes[i * 2..i * 2 + 2]).unwrap();
        *slot = u8::from_str_radix(pair, 16).expect("hex literal must be valid hex");
    }
    out
}
