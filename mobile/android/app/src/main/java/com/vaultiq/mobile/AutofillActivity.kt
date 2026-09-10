package com.vaultiq.mobile

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.service.autofill.Dataset
import android.service.autofill.FillResponse
import android.view.autofill.AutofillId
import android.view.autofill.AutofillManager
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

/**
 * Hosts the same registered `"Vaultiq"` RN component as [MainActivity] --
 * a second entry point into the *same* app rather than a separate one, so
 * the existing unlock -> `vault.pullItems()` -> decrypt pipeline
 * (`App.tsx`'s ordinary status state machine) runs completely unchanged;
 * only one extra prop (`autofillRequest`, via [getLaunchOptions]) tells JS
 * to render the fill/save screen instead of the normal tab shell once
 * unlocked. See `VaultiqAutofillService.kt` for how this gets launched.
 *
 * The framework's [AutofillId] objects never cross into JS -- they're read
 * straight off the launch intent here and kept as plain fields, used only
 * by [finishWithDataset]. JS only ever sees which item the user picked (a
 * plain username/password pair), never the opaque IDs the framework gave
 * this activity.
 */
class AutofillActivity : ReactActivity() {
    private var usernameFieldId: AutofillId? = null
    private var passwordFieldId: AutofillId? = null
    private var emailFieldId: AutofillId? = null
    private var saveMode = false

    override fun getMainComponentName(): String = "Vaultiq"

    override fun onCreate(savedInstanceState: Bundle?) {
        saveMode = intent.getStringExtra(EXTRA_MODE) == MODE_SAVE
        usernameFieldId = intent.getParcelableExtra(EXTRA_USERNAME_FIELD)
        passwordFieldId = intent.getParcelableExtra(EXTRA_PASSWORD_FIELD)
        emailFieldId = intent.getParcelableExtra(EXTRA_EMAIL_FIELD)
        super.onCreate(savedInstanceState)
    }

    override fun createReactActivityDelegate(): ReactActivityDelegate =
        object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {
            override fun getLaunchOptions(): Bundle {
                val request =
                    Bundle().apply {
                        putString("mode", if (saveMode) "save" else "fill")
                        putString("domain", intent.getStringExtra(EXTRA_DOMAIN) ?: "")
                        if (saveMode) {
                            putString("username", intent.getStringExtra(EXTRA_USERNAME) ?: "")
                            putString("password", intent.getStringExtra(EXTRA_PASSWORD) ?: "")
                        }
                    }
                return Bundle().apply { putBundle("autofillRequest", request) }
            }
        }

    /**
     * Builds the real Android response and finishes with it. [emailFieldId],
     * if present, gets the username value too -- a login-shaped form with an
     * email-hinted field instead of a username one is filled the same way a
     * saved login's username would go there.
     */
    fun finishWithDataset(username: String, password: String) {
        val presentation = RemoteViews(packageName, R.layout.autofill_suggestion)
        val builder = Dataset.Builder(presentation)
        var any = false
        usernameFieldId?.let {
            builder.setValue(it, AutofillValue.forText(username))
            any = true
        }
        passwordFieldId?.let {
            builder.setValue(it, AutofillValue.forText(password))
            any = true
        }
        emailFieldId?.let {
            builder.setValue(it, AutofillValue.forText(username))
            any = true
        }

        if (!any) {
            finishCancelled()
            return
        }

        // The original placeholder was authenticated at the whole-FillResponse
        // level (FillResponse.Builder.setAuthentication in
        // VaultiqAutofillService), so the framework expects a FillResponse
        // back here, not a bare Dataset -- the two authentication levels
        // have different result contracts.
        val response = FillResponse.Builder().addDataset(builder.build()).build()
        val result = Intent().putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, response)
        setResult(Activity.RESULT_OK, result)
        finish()
    }

    fun finishCancelled() {
        setResult(Activity.RESULT_CANCELED)
        finish()
    }

    /** Tells the service's held [android.service.autofill.SaveCallback] the outcome, then closes. */
    fun finishSaveHandled(success: Boolean) {
        val callback = VaultiqAutofillService.pendingSaveCallback
        VaultiqAutofillService.pendingSaveCallback = null
        if (success) callback?.onSuccess() else callback?.onFailure("could not save")
        finish()
    }

    override fun onDestroy() {
        // Safety net: if this finished any other way (back button, app
        // killed) while a save was pending, don't leave the framework's
        // callback dangling. A no-op if finishSaveHandled already ran.
        if (saveMode) {
            VaultiqAutofillService.pendingSaveCallback?.onFailure("cancelled")
            VaultiqAutofillService.pendingSaveCallback = null
        }
        super.onDestroy()
    }

    companion object {
        const val EXTRA_MODE = "com.vaultiq.mobile.autofill.MODE"
        const val MODE_FILL = "fill"
        const val MODE_SAVE = "save"
        const val EXTRA_DOMAIN = "com.vaultiq.mobile.autofill.DOMAIN"
        const val EXTRA_USERNAME_FIELD = "com.vaultiq.mobile.autofill.USERNAME_FIELD"
        const val EXTRA_PASSWORD_FIELD = "com.vaultiq.mobile.autofill.PASSWORD_FIELD"
        const val EXTRA_EMAIL_FIELD = "com.vaultiq.mobile.autofill.EMAIL_FIELD"
        const val EXTRA_USERNAME = "com.vaultiq.mobile.autofill.USERNAME"
        const val EXTRA_PASSWORD = "com.vaultiq.mobile.autofill.PASSWORD"
    }
}
