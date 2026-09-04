#!/usr/bin/env bash
set -euo pipefail

# Cross-compiles pw-crypto-core for Android and regenerates the Kotlin
# bindings uniffi derives from it. Neither output is committed -- see
# .gitignore -- so this has to run before the app builds, the same role
# wasm-pack plays for the browser extension (see extension/package.json).

cd "$(dirname "$0")/.."

CRATE=../pw-crypto-core
ABI=arm64-v8a
JNI_OUT=android/app/src/main/jniLibs
KOTLIN_OUT=android/app/src/main/java

export ANDROID_NDK_HOME="${ANDROID_NDK_HOME:-/opt/android-ndk}"

cargo ndk -t "$ABI" -o "$JNI_OUT" build \
  --manifest-path "$CRATE/Cargo.toml" --features ffi --release

cargo run --manifest-path "$CRATE/Cargo.toml" --features uniffi-bindgen --bin uniffi-bindgen -- \
  generate \
  --library "$JNI_OUT/$ABI/libpw_crypto_core.so" \
  --language kotlin \
  --out-dir "$KOTLIN_OUT"
