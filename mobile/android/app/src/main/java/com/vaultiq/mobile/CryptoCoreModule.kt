package com.vaultiq.mobile

import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import uniffi.pw_crypto_core.EncryptedItemFfi
import uniffi.pw_crypto_core.FfiException
import uniffi.pw_crypto_core.ItemHeaderInput
import uniffi.pw_crypto_core.VaultKeyHandle
import uniffi.pw_crypto_core.WrappedVaultKeyFfi
import uniffi.pw_crypto_core.decryptItemFfi
import uniffi.pw_crypto_core.deriveAuthKey as deriveAuthKeyFfi
import uniffi.pw_crypto_core.deriveMasterKey
import uniffi.pw_crypto_core.encryptItemFfi
import uniffi.pw_crypto_core.estimateStrengthFfi
import uniffi.pw_crypto_core.generateSalt as generateSaltFfi
import uniffi.pw_crypto_core.totpCodeFfi
import uniffi.pw_crypto_core.totpSecondsRemainingFfi
import uniffi.pw_crypto_core.unwrapVaultKey
import uniffi.pw_crypto_core.wrapVaultKey

/**
 * Bridge into `pw-crypto-core`'s uniffi bindings.
 *
 * Holds at most one unwrapped [VaultKeyHandle] at a time -- the mobile
 * analogue of the extension's single `warmVaultKey` / `storage.session`
 * (CLAUDE.md §0). Nothing derived from a key ever crosses into JS: [unlock]
 * takes a password and resolves with nothing but success/failure, and every
 * later vault operation ([encryptItem]/[decryptItem]) operates on the held
 * handle rather than taking one as an argument from JS. [deriveAuthKey] is
 * the one exception, same as `wasm.rs::derive_auth_key` -- that key is
 * meant to leave the device.
 *
 * A plain legacy native module rather than a generated TurboModule spec:
 * React Native's New Architecture interop layer still supports this style
 * without codegen.
 */
class CryptoCoreModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    // Mutated only on the thread the RN bridge invokes @ReactMethod calls on
    // for a given module instance -- the same single-writer assumption the
    // legacy bridge already guarantees for its native modules.
    private var vaultKey: VaultKeyHandle? = null

    override fun getName() = "CryptoCore"

    private fun rejectFfi(promise: Promise, error: Throwable) {
        // The message this surfaces to JS is deliberately generic for
        // DecryptionFailed -- see ffi.rs::FfiError. InvalidArgument's reason
        // describes only the shape of a bad caller argument, never key or
        // plaintext material, so it is safe to pass through.
        val message = when (error) {
            is FfiException.DecryptionFailed -> "decryption failed"
            is FfiException.InvalidArgument -> error.reason
            else -> error.message ?: "unknown error"
        }
        promise.reject("crypto_core_error", message, error)
    }

    /** Draws a fresh per-vault salt via the real crypto core, base64 encoded. */
    @ReactMethod
    fun generateSalt(promise: Promise) {
        try {
            promise.resolve(generateSaltFfi())
        } catch (error: Exception) {
            rejectFfi(promise, error)
        }
    }

    /** Scores a password's shape. Never fails, so no promise rejection path. */
    @ReactMethod
    fun estimateStrength(password: String, promise: Promise) {
        val strength = estimateStrengthFfi(password)
        promise.resolve(
            Arguments.createMap().apply {
                putInt("bits", strength.bits.toInt())
                putString("level", strength.level.name)
            },
        )
    }

    /**
     * Derives the auth key for enrollment, base64 encoded. Frees the master
     * key immediately after -- it is never needed again for this call.
     */
    @ReactMethod
    fun deriveAuthKey(
        password: String,
        saltB64: String,
        memoryKib: Double,
        iterations: Double,
        parallelism: Double,
        promise: Promise,
    ) {
        try {
            val masterKey =
                deriveMasterKey(
                    password,
                    saltB64,
                    memoryKib.toInt().toUInt(),
                    iterations.toInt().toUInt(),
                    parallelism.toInt().toUInt(),
                )
            try {
                promise.resolve(deriveAuthKeyFfi(masterKey))
            } finally {
                masterKey.close()
            }
        } catch (error: Exception) {
            rejectFfi(promise, error)
        }
    }

    /**
     * Derives the master key and unwraps the vault key, holding the result
     * until [lock]. A wrong password surfaces as the same `DecryptionFailed`
     * a tampered record would -- this call is also the only password check
     * that happens (CLAUDE.md §2.4).
     */
    @ReactMethod
    fun unlock(
        password: String,
        saltB64: String,
        memoryKib: Double,
        iterations: Double,
        parallelism: Double,
        wrappedVaultKey: ReadableMap,
        promise: Promise,
    ) {
        try {
            val masterKey =
                deriveMasterKey(
                    password,
                    saltB64,
                    memoryKib.toInt().toUInt(),
                    iterations.toInt().toUInt(),
                    parallelism.toInt().toUInt(),
                )
            val wrapped =
                WrappedVaultKeyFfi(
                    version = wrappedVaultKey.getInt("version").toUByte(),
                    ciphertext = readByteArray(requireNotNull(wrappedVaultKey.getArray("ciphertext"))),
                    nonce = readByteArray(requireNotNull(wrappedVaultKey.getArray("nonce"))),
                )
            val unwrapped =
                try {
                    unwrapVaultKey(wrapped, masterKey)
                } finally {
                    masterKey.close()
                }
            vaultKey?.close()
            vaultKey = unwrapped
            promise.resolve(null)
        } catch (error: Exception) {
            rejectFfi(promise, error)
        }
    }

    /**
     * Verifies the current password by unwrapping the *persisted* vault key
     * under it (independent of whatever [unlock] already holds -- same
     * reasoning as extension/src/background/vault.ts's
     * `changeMasterPassword`, which re-derives from the stored record rather
     * than trusting session state), then wraps that key under a fresh salt
     * and the new password. Doesn't touch [vaultKey]; the caller pushes the
     * result to the server and local storage itself. Costs are carried over
     * unchanged rather than raised to "today's recommended" ones on
     * rotation -- a reasonable follow-up, not done here.
     */
    @ReactMethod
    fun rewrapVaultKey(
        currentPassword: String,
        currentSaltB64: String,
        currentMemoryKib: Double,
        currentIterations: Double,
        currentParallelism: Double,
        currentWrappedVaultKey: ReadableMap,
        newPassword: String,
        newSaltB64: String,
        newMemoryKib: Double,
        newIterations: Double,
        newParallelism: Double,
        promise: Promise,
    ) {
        try {
            val currentMasterKey =
                deriveMasterKey(
                    currentPassword,
                    currentSaltB64,
                    currentMemoryKib.toInt().toUInt(),
                    currentIterations.toInt().toUInt(),
                    currentParallelism.toInt().toUInt(),
                )
            val wrapped =
                WrappedVaultKeyFfi(
                    version = currentWrappedVaultKey.getInt("version").toUByte(),
                    ciphertext = readByteArray(requireNotNull(currentWrappedVaultKey.getArray("ciphertext"))),
                    nonce = readByteArray(requireNotNull(currentWrappedVaultKey.getArray("nonce"))),
                )
            val unwrapped =
                try {
                    unwrapVaultKey(wrapped, currentMasterKey)
                } finally {
                    currentMasterKey.close()
                }
            try {
                val newMasterKey =
                    deriveMasterKey(
                        newPassword,
                        newSaltB64,
                        newMemoryKib.toInt().toUInt(),
                        newIterations.toInt().toUInt(),
                        newParallelism.toInt().toUInt(),
                    )
                val rewrapped =
                    try {
                        wrapVaultKey(unwrapped, newMasterKey)
                    } finally {
                        newMasterKey.close()
                    }
                promise.resolve(writeWrappedVaultKey(rewrapped))
            } finally {
                unwrapped.close()
            }
        } catch (error: Exception) {
            rejectFfi(promise, error)
        }
    }

    /** Scrubs the held vault key and forgets it. */
    @ReactMethod
    fun lock(promise: Promise) {
        vaultKey?.close()
        vaultKey = null
        promise.resolve(null)
    }

    @ReactMethod
    fun isUnlocked(promise: Promise) {
        promise.resolve(vaultKey != null)
    }

    /**
     * The current TOTP code for an authenticator item, and how it's scored.
     * Stateless -- the secret is already-decrypted plaintext content the
     * caller holds, so this needs no vault key, same as ffi.rs's
     * totp_code_ffi/totp_seconds_remaining_ffi.
     */
    @ReactMethod
    fun totpCode(secretB32: String, algorithm: String, digits: Double, period: Double, unixSeconds: Double, promise: Promise) {
        try {
            promise.resolve(totpCodeFfi(secretB32, algorithm, digits.toInt().toUInt(), period, unixSeconds))
        } catch (error: Exception) {
            rejectFfi(promise, error)
        }
    }

    @ReactMethod
    fun totpSecondsRemaining(period: Double, unixSeconds: Double, promise: Promise) {
        try {
            promise.resolve(totpSecondsRemainingFfi(period, unixSeconds))
        } catch (error: Exception) {
            rejectFfi(promise, error)
        }
    }

    /**
     * Encrypts one item's already-serialized JSON content under the held
     * vault key. Ciphertext/nonce cross as base64 -- the server's `sync`
     * routes validate them as base64 strings (`@IsBase64()` in
     * server/src/sync/dto.ts), unlike the vault-bootstrap wire shape
     * ([unlock]'s `wrappedVaultKey`), which is an untyped, opaque field the
     * server never validates the shape of. Two different wire conventions
     * for two different endpoints, matched rather than unified.
     */
    @ReactMethod
    fun encryptItem(plaintextJson: String, header: ReadableMap, promise: Promise) {
        val key = vaultKey
        if (key == null) {
            promise.reject("crypto_core_error", "vault is locked")
            return
        }
        try {
            val encrypted =
                encryptItemFfi(
                    plaintextJson,
                    ItemHeaderInput(
                        id = requireNotNull(header.getString("id")),
                        itemType = requireNotNull(header.getString("itemType")),
                        version = header.getDouble("version").toULong(),
                        updatedAt = header.getDouble("updatedAt").toLong(),
                        deleted = header.getBoolean("deleted"),
                    ),
                    key,
                )
            promise.resolve(writeEncryptedItem(encrypted))
        } catch (error: Exception) {
            rejectFfi(promise, error)
        }
    }

    /** Decrypts an item back to the JSON string it was built from. */
    @ReactMethod
    fun decryptItem(item: ReadableMap, promise: Promise) {
        val key = vaultKey
        if (key == null) {
            promise.reject("crypto_core_error", "vault is locked")
            return
        }
        try {
            val encrypted =
                EncryptedItemFfi(
                    id = requireNotNull(item.getString("id")),
                    itemType = requireNotNull(item.getString("itemType")),
                    format = item.getInt("format").toUByte(),
                    ciphertext = readByteArrayB64(requireNotNull(item.getString("ciphertext"))),
                    nonce = readByteArrayB64(requireNotNull(item.getString("nonce"))),
                    version = item.getDouble("version").toULong(),
                    updatedAt = item.getDouble("updatedAt").toLong(),
                    deleted = item.getBoolean("deleted"),
                )
            promise.resolve(decryptItemFfi(encrypted, key))
        } catch (error: Exception) {
            rejectFfi(promise, error)
        }
    }

    // Used for wrappedVaultKey only -- see the encryptItem/decryptItem doc.
    private fun readByteArray(array: ReadableArray): ByteArray = ByteArray(array.size()) { i -> array.getInt(i).toByte() }

    private fun readByteArrayB64(value: String): ByteArray = Base64.decode(value, Base64.NO_WRAP)

    private fun writeByteArrayB64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)

    // Ints in the 0..255 range, matching the wire shape [unlock]'s
    // wrappedVaultKey argument already reads (wasm's default Vec<u8>
    // serialization) -- a rewrap must produce a record any device, mobile or
    // extension, can read back later.
    private fun writeIntArray(bytes: ByteArray): WritableArray =
        Arguments.createArray().apply { for (byte in bytes) pushInt(byte.toInt() and 0xFF) }

    private fun writeWrappedVaultKey(wrapped: WrappedVaultKeyFfi): WritableMap =
        Arguments.createMap().apply {
            putInt("version", wrapped.version.toInt())
            putArray("ciphertext", writeIntArray(wrapped.ciphertext))
            putArray("nonce", writeIntArray(wrapped.nonce))
        }

    private fun writeEncryptedItem(item: EncryptedItemFfi): WritableMap =
        Arguments.createMap().apply {
            putString("id", item.id)
            putString("itemType", item.itemType)
            putInt("format", item.format.toInt())
            putString("ciphertext", writeByteArrayB64(item.ciphertext))
            putString("nonce", writeByteArrayB64(item.nonce))
            putDouble("version", item.version.toDouble())
            putDouble("updatedAt", item.updatedAt.toDouble())
            putBoolean("deleted", item.deleted)
        }
}
