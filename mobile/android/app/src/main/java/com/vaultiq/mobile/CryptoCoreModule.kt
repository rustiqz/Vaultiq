package com.vaultiq.mobile

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import uniffi.pw_crypto_core.estimateStrengthFfi
import uniffi.pw_crypto_core.generateSalt

/**
 * Smoke-test bridge into `pw-crypto-core`'s uniffi bindings -- proves the
 * Rust -> JNI -> Kotlin -> JS chain works end to end on a real device, the
 * same role the Firefox extension played for the wasm bindings in phase 2.
 *
 * A plain legacy native module rather than a generated TurboModule spec:
 * React Native's New Architecture interop layer still supports this style
 * without codegen, which is all a proving-ground module needs. The real
 * vault-unlock surface (deriving a [uniffi.pw_crypto_core.MasterKeyHandle],
 * holding it, wrapping/unwrapping the vault key) is not implemented here --
 * this module exists only to confirm the native bridge itself works.
 */
class CryptoCoreModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "CryptoCore"

    /** Draws a fresh per-vault salt via the real crypto core, base64 encoded. */
    @ReactMethod
    fun generateSalt(promise: com.facebook.react.bridge.Promise) {
        try {
            promise.resolve(generateSalt())
        } catch (error: Exception) {
            // The message is uniffi's own FfiException text, which never
            // carries key or plaintext material -- see ffi.rs's FfiError.
            promise.reject("crypto_core_error", error.message, error)
        }
    }

    /** Scores a password's shape. Never fails, so no promise rejection path. */
    @ReactMethod
    fun estimateStrength(password: String, promise: com.facebook.react.bridge.Promise) {
        val strength = estimateStrengthFfi(password)
        promise.resolve(
            com.facebook.react.bridge.Arguments.createMap().apply {
                putInt("bits", strength.bits.toInt())
                putString("level", strength.level.name)
            },
        )
    }
}
