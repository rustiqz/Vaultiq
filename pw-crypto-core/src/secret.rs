//! Internal helper for declaring fixed-size secret key types.
//!
//! Every secret in this crate goes through this macro so that the three
//! properties that matter are decided in exactly one place rather than
//! re-derived per type (CLAUDE.md §2.3):
//!
//! 1. the bytes are zeroized on drop,
//! 2. `Debug` is redacted, so a secret can never reach a log via `{:?}`,
//! 3. there is no `Serialize`, `Display` or `Clone`, so a secret cannot be
//!    persisted, printed or silently duplicated.
//!
//! Byte access is `pub(crate)`: key material is usable inside the crate and
//! unreachable from the public API, WASM bindings included.

/// Declares a zeroizing, redacted, non-serializable secret key newtype.
macro_rules! define_secret_key {
    ($(#[$meta:meta])* $name:ident, $len:expr) => {
        $(#[$meta])*
        #[derive(::zeroize::Zeroize, ::zeroize::ZeroizeOnDrop)]
        pub struct $name([u8; $len]);

        // Scaffold: these are exercised by the module tests and consumed by the
        // `TODO(phase1)` derivation and wrapping code. Drop the allow once that
        // code lands.
        #[allow(dead_code)]
        impl $name {
            /// Length of this key in bytes.
            pub const LEN: usize = $len;

            /// Wraps raw key material. Callers own the invariant that the
            /// bytes came from a CSPRNG or a KDF, not from user input.
            pub(crate) fn from_bytes(bytes: [u8; $len]) -> Self {
                Self(bytes)
            }

            /// Borrows the raw key material. Crate-internal by design.
            pub(crate) fn as_bytes(&self) -> &[u8; $len] {
                &self.0
            }

            /// Constant-time equality. Never compare secrets with `==`.
            pub(crate) fn ct_eq(&self, other: &Self) -> bool {
                use ::subtle::ConstantTimeEq as _;
                self.0.ct_eq(&other.0).into()
            }
        }

        // Hand-written and redacted: `#[derive(Debug)]` on a key type would
        // print the key.
        impl ::core::fmt::Debug for $name {
            fn fmt(&self, f: &mut ::core::fmt::Formatter<'_>) -> ::core::fmt::Result {
                f.write_str(concat!(stringify!($name), "([REDACTED])"))
            }
        }
    };
}

pub(crate) use define_secret_key;
