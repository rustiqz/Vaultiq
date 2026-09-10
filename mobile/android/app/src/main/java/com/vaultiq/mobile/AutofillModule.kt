package com.vaultiq.mobile

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.view.autofill.AutofillManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * JS-facing bridge for the fill/save screens `AutofillActivity` hosts --
 * mirrors `BiometricModule.kt`'s shape (a thin wrapper resolving one
 * activity-scoped action per call). Never touches the vault key or
 * `pw-crypto-core`; this only ever finishes whatever `AutofillActivity`
 * instance is currently on screen.
 */
class AutofillModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "Autofill"

    private fun currentAutofillActivity(): AutofillActivity? = reactContext.currentActivity as? AutofillActivity

    /** Whether the Autofill framework exists on this OS version at all. */
    @ReactMethod
    fun isSupported(promise: Promise) {
        promise.resolve(Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
    }

    /** Whether Vaultiq is the OS's currently-selected autofill service. */
    @ReactMethod
    fun isEnabled(promise: Promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            promise.resolve(false)
            return
        }
        val manager = reactContext.getSystemService(AutofillManager::class.java)
        promise.resolve(manager?.hasEnabledAutofillServices() == true)
    }

    /**
     * Opens the OS's own "set autofill service" flow -- there's no way for
     * an app to enable itself; this is the only path in.
     */
    @ReactMethod
    fun openAutofillSettings(promise: Promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            promise.reject("autofill_error", "not supported on this Android version")
            return
        }
        try {
            val intent =
                Intent(Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE, Uri.parse("package:${reactContext.packageName}")).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            reactContext.startActivity(intent)
            promise.resolve(null)
        } catch (error: Exception) {
            promise.reject("autofill_error", error.message ?: "could not open autofill settings", error)
        }
    }

    /** Completes a fill request with the chosen login's values. */
    @ReactMethod
    fun completeFill(username: String, password: String, promise: Promise) {
        val activity = currentAutofillActivity()
        if (activity == null) {
            promise.reject("autofill_error", "no autofill screen is open")
            return
        }
        activity.finishWithDataset(username, password)
        promise.resolve(null)
    }

    /** The user backed out of the fill picker without choosing anything. */
    @ReactMethod
    fun cancelFill(promise: Promise) {
        currentAutofillActivity()?.finishCancelled()
        promise.resolve(null)
    }

    /** Called after `vault.addItem` for the new login has actually succeeded. */
    @ReactMethod
    fun completeSave(promise: Promise) {
        val activity = currentAutofillActivity()
        if (activity == null) {
            promise.reject("autofill_error", "no autofill screen is open")
            return
        }
        activity.finishSaveHandled(true)
        promise.resolve(null)
    }

    /** The user chose not to save the detected login. */
    @ReactMethod
    fun discardSave(promise: Promise) {
        currentAutofillActivity()?.finishSaveHandled(false)
        promise.resolve(null)
    }
}
