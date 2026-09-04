//! Generates the Kotlin/Swift bindings from the `ffi` module's scaffolding.
//!
//! Not part of the library — built only behind the `uniffi-bindgen` feature
//! (see Cargo.toml) so an ordinary `--features ffi` build never needs uniffi's
//! CLI dependencies. Run via:
//!
//! ```text
//! cargo run --features uniffi-bindgen --bin uniffi-bindgen -- generate \
//!     --library <path-to-.so-or-.dylib> --language kotlin --out-dir <out>
//! ```

fn main() {
    uniffi::uniffi_bindgen_main();
}
