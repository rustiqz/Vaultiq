package com.vaultiq.mobile

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Fingerprint unlock, gating a *cached master password* rather than
 * anything derived by pw-crypto-core: a fingerprint cannot re-derive a
 * vault key from Argon2id, so this is intentionally a separate, simpler
 * problem from that module -- storing the plaintext master password under
 * a hardware-backed key that only decrypts after biometric auth, the way
 * most password managers do this (docs/STATUS.md). JS owns *when* to call
 * [enable]/[disable]/[unlock] and where the resulting ciphertext lives
 * (`storage.ts`, alongside the vault record) -- this module only ever
 * touches the Keystore and the plaintext password for the moment it takes
 * to encrypt or decrypt it.
 *
 * The Keystore key requires authentication for every single use
 * (`setUserAuthenticationRequired`, no validity window) and is invalidated
 * the moment the device's enrolled biometrics change
 * (`setInvalidatedByBiometricEnrollment`) -- a new fingerprint added to the
 * device should not silently gain access to an old cached password.
 */
class BiometricModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "Biometric"

    private fun keyStore(): KeyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }

    private fun currentActivity(): FragmentActivity? = reactContext.currentActivity as? FragmentActivity

    /** Whether this device can actually do biometric auth right now. */
    @ReactMethod
    fun isAvailable(promise: Promise) {
        val manager = BiometricManager.from(reactContext)
        promise.resolve(manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS)
    }

    private fun freshSecretKey(): SecretKey {
        val store = keyStore()
        if (store.containsAlias(KEY_ALIAS)) store.deleteEntry(KEY_ALIAS)

        val builder =
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setUserAuthenticationRequired(true)
                .setInvalidatedByBiometricEnrollment(true)

        val spec =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                builder.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG).build()
            } else {
                @Suppress("DEPRECATION")
                builder.setUserAuthenticationValidityDurationSeconds(-1).build()
            }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER)
        generator.init(spec)
        return generator.generateKey()
    }

    private fun secretKey(): SecretKey? {
        val store = keyStore()
        if (!store.containsAlias(KEY_ALIAS)) return null
        return store.getKey(KEY_ALIAS, null) as? SecretKey
    }

    /**
     * Turns fingerprint unlock on: generates a fresh Keystore key (replacing
     * any previous one, so turning this off and on again can't be used to
     * dodge invalidation) and, behind one biometric prompt, encrypts
     * [password] under it. Resolves the ciphertext and IV, base64 encoded,
     * for JS to persist -- this module keeps nothing itself.
     */
    @ReactMethod
    fun enable(password: String, promise: Promise) {
        val activity = currentActivity()
        if (activity == null) {
            promise.reject("biometric_error", "no active screen to prompt from")
            return
        }

        val cipher: Cipher
        try {
            val key = freshSecretKey()
            cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, key)
        } catch (error: Exception) {
            promise.reject("biometric_error", error.message ?: "could not prepare the key", error)
            return
        }

        prompt(activity, "Confirm your fingerprint", cipher, promise) { authenticatedCipher ->
            val ciphertext = authenticatedCipher.doFinal(password.toByteArray(Charsets.UTF_8))
            Arguments.createMap().apply {
                putString("ciphertextB64", Base64.encodeToString(ciphertext, Base64.NO_WRAP))
                putString("ivB64", Base64.encodeToString(authenticatedCipher.iv, Base64.NO_WRAP))
            }
        }
    }

    /**
     * Recovers the cached master password behind one biometric prompt. A
     * device whose enrolled biometrics changed since [enable] surfaces as
     * `biometric_key_invalidated` specifically, so JS can fall back to
     * turning fingerprint unlock back off (and asking for the password
     * normally) rather than showing a raw crypto error.
     */
    @ReactMethod
    fun unlock(ciphertextB64: String, ivB64: String, promise: Promise) {
        val activity = currentActivity()
        if (activity == null) {
            promise.reject("biometric_error", "no active screen to prompt from")
            return
        }

        val cipher: Cipher
        try {
            val key = secretKey()
            if (key == null) {
                promise.reject("biometric_error", "fingerprint unlock was never turned on")
                return
            }
            cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, Base64.decode(ivB64, Base64.NO_WRAP)))
        } catch (error: KeyPermanentlyInvalidatedException) {
            promise.reject("biometric_key_invalidated", "biometric enrollment changed", error)
            return
        } catch (error: Exception) {
            promise.reject("biometric_error", error.message ?: "could not prepare the key", error)
            return
        }

        prompt(activity, "Unlock Vaultiq", cipher, promise) { authenticatedCipher ->
            val plaintext = authenticatedCipher.doFinal(Base64.decode(ciphertextB64, Base64.NO_WRAP))
            String(plaintext, Charsets.UTF_8)
        }
    }

    /** Deletes the Keystore key. JS separately forgets the stored ciphertext. */
    @ReactMethod
    fun disable(promise: Promise) {
        try {
            val store = keyStore()
            if (store.containsAlias(KEY_ALIAS)) store.deleteEntry(KEY_ALIAS)
            promise.resolve(null)
        } catch (error: Exception) {
            promise.reject("biometric_error", error.message ?: "could not remove the key", error)
        }
    }

    /**
     * Shows one [BiometricPrompt] over [cipher]. [onSuccess] runs the actual
     * encrypt/decrypt and returns whatever the caller's promise should
     * resolve with; every path here -- success, a crypto failure inside
     * [onSuccess], cancellation, or a prompt error -- settles that promise
     * exactly once. `onAuthenticationFailed` (one wrong finger) is the one
     * callback that must NOT settle it: the prompt itself stays open and
     * lets the user retry.
     *
     * The whole body runs on [activity]'s UI thread ([runOnUiThreadThenCall],
     * shared with every caller of this method) -- `@ReactMethod` calls land
     * on React Native's own native-modules thread, and `BiometricPrompt`
     * (via its internal `FragmentManager` transaction) throws
     * `IllegalStateException: Must be called from main thread of fragment
     * host` if constructed or asked to authenticate from anywhere else. That
     * was the actual cause of a first-tap failure that a second, identical
     * tap would then "fix" -- found only by attaching a debugger, since the
     * exception was silently swallowed into a rejected promise. It was
     * previously misdiagnosed as the hosting activity not yet being
     * `RESUMED` (`authenticateWhenResumed`'s wait-for-resume logic below is
     * still correct and worth keeping -- a prompt genuinely can't show
     * before then -- it just wasn't the actual bug).
     */
    private fun prompt(activity: FragmentActivity, title: String, cipher: Cipher, promise: Promise, onSuccess: (Cipher) -> Any) {
        runOnUiThreadThenCall(activity) {
            val executor = ContextCompat.getMainExecutor(reactContext)
            val callback =
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                        val authenticatedCipher = result.cryptoObject?.cipher
                        if (authenticatedCipher == null) {
                            promise.reject("biometric_error", "no cipher came back from the prompt")
                            return
                        }
                        try {
                            promise.resolve(onSuccess(authenticatedCipher))
                        } catch (error: Exception) {
                            promise.reject("biometric_error", error.message ?: "cryptographic operation failed", error)
                        }
                    }

                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                        // Covers both the user backing out and a genuine prompt-level
                        // error (lockout, hardware unavailable mid-prompt, etc.) -- JS
                        // treats this one code as "no password recovered," same as a
                        // cancellation, and falls back to asking for it normally.
                        promise.reject("biometric_cancelled", errString.toString())
                    }

                    override fun onAuthenticationFailed() {
                        // One wrong finger. The prompt stays open on its own; nothing
                        // to settle yet.
                    }
                }

            val biometricPrompt = BiometricPrompt(activity, executor, callback)
            val info =
                BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .setNegativeButtonText("Use password instead")
                    .build()
            authenticateWhenResumed(activity, biometricPrompt, info, BiometricPrompt.CryptoObject(cipher), promise)
        }
    }

    /**
     * `BiometricPrompt.authenticate()` throws if the hosting activity hasn't
     * actually reached RESUMED yet -- on the lock screen, the very first tap
     * of "Use fingerprint" right after the screen appears can lose this
     * race, rejecting with no prompt ever shown at all. A fixed delay before
     * calling this was tried first and wasn't reliable (device-dependent);
     * waiting for the real lifecycle event is deterministic instead of a
     * guess. Callable only from the UI thread -- see [runOnUiThreadThenCall].
     */
    private fun authenticateWhenResumed(
        activity: FragmentActivity,
        biometricPrompt: BiometricPrompt,
        info: BiometricPrompt.PromptInfo,
        cryptoObject: BiometricPrompt.CryptoObject,
        promise: Promise,
    ) {
        fun authenticate() {
            try {
                biometricPrompt.authenticate(info, cryptoObject)
            } catch (error: Exception) {
                promise.reject("biometric_error", error.message ?: "could not show the fingerprint prompt", error)
            }
        }

        if (activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
            authenticate()
            return
        }

        activity.lifecycle.addObserver(
            object : DefaultLifecycleObserver {
                override fun onResume(owner: LifecycleOwner) {
                    owner.lifecycle.removeObserver(this)
                    authenticate()
                }
            },
        )
    }

    private companion object {
        const val KEYSTORE_PROVIDER = "AndroidKeyStore"
        const val KEY_ALIAS = "vaultiq_biometric_master_password"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val GCM_TAG_BITS = 128
    }
}
