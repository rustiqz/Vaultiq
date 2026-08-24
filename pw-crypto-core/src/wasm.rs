//! Thin `wasm_bindgen` wrappers for the browser extension (phase 2).
//!
//! This file is a marshalling layer and nothing else: JsValue and base64 in,
//! Rust types out, straight into `kdf` / `keys` / `vault_item`. No crypto
//! decision is made here, and no error detail crosses into JS — everything
//! that fails to decrypt returns the one opaque failure, exactly as it does
//! on the Rust side (CLAUDE.md §2.4, §4.13).
//!
//! Status: empty. Populated in phase 2, once the modules it wraps exist.

// TODO(phase2): `#[wasm_bindgen]` wrappers over derive / wrap / unwrap /
// encrypt_item / decrypt_item, taking and returning base64 strings.
//
// TODO(phase2): building for `wasm32-unknown-unknown` needs getrandom's
// browser backend enabled for `OsRng`; wire that up with the extension's
// build, not before.
