package com.vaultiq.mobile

import android.app.PendingIntent
import android.app.assist.AssistStructure
import android.content.Intent
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveInfo
import android.service.autofill.SaveRequest
import android.text.InputType
import android.view.View
import android.view.autofill.AutofillId
import android.widget.RemoteViews

/**
 * Login-only autofill (fill + save), v1 -- CLAUDE.md §0. Deliberately does
 * not decrypt or match anything itself: the vault is very likely locked
 * when some other app triggers this (backgrounding already tends to kill
 * this app's process, wiping the held vault key -- see CryptoCoreModule.kt),
 * and there is no native item cache to search even when it isn't (items
 * only ever exist decrypted transiently in JS after `vault.pullItems()`
 * runs inside a mounted screen). Building one just for this would be its
 * own separate, larger project.
 *
 * So [onFillRequest] only ever inspects the *form*, never the vault: if it
 * looks like a login, it replies with one generic, always-the-same
 * authenticated placeholder ("Fill with Vaultiq") gated behind
 * [AutofillActivity], which runs the app's own already-correct
 * unlock -> pullItems -> decrypt pipeline verbatim and hands the picked
 * value back. This is standard behavior for a locked password manager
 * (Bitwarden/1Password's own services work the same way) -- there is no
 * personalized suggestion to offer before that pipeline runs. [onSaveRequest]
 * follows the identical shape in the other direction.
 */
class VaultiqAutofillService : AutofillService() {

    private class Field(val id: AutofillId, val value: String?)

    private class LoginFields {
        var username: Field? = null
        var password: Field? = null
        var email: Field? = null
        var lastFreeText: Field? = null
        var domain: String? = null
    }

    override fun onFillRequest(request: FillRequest, cancellationSignal: CancellationSignal, callback: FillCallback) {
        val structure = request.fillContexts.lastOrNull()?.structure
        if (structure == null) {
            callback.onSuccess(null)
            return
        }

        val fields = collectLoginFields(structure)
        // No explicit USERNAME hint anywhere -- the common shape for a form
        // that never set autocomplete attributes is "whatever free-text
        // field came right before the password field".
        if (fields.username == null && fields.password != null) fields.username = fields.lastFreeText

        val autofillIds = listOfNotNull(fields.username?.id, fields.password?.id, fields.email?.id)
        if (autofillIds.isEmpty()) {
            callback.onSuccess(null)
            return
        }

        val intent =
            Intent(this, AutofillActivity::class.java).apply {
                putExtra(AutofillActivity.EXTRA_MODE, AutofillActivity.MODE_FILL)
                putExtra(AutofillActivity.EXTRA_DOMAIN, fields.domain ?: "")
                fields.username?.id?.let { putExtra(AutofillActivity.EXTRA_USERNAME_FIELD, it) }
                fields.password?.id?.let { putExtra(AutofillActivity.EXTRA_PASSWORD_FIELD, it) }
                fields.email?.id?.let { putExtra(AutofillActivity.EXTRA_EMAIL_FIELD, it) }
            }
        val pendingIntent =
            PendingIntent.getActivity(
                this,
                nextRequestCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

        val presentation = RemoteViews(packageName, R.layout.autofill_suggestion)
        val response =
            FillResponse.Builder()
                .setAuthentication(autofillIds.toTypedArray(), pendingIntent.intentSender, presentation)
                .apply {
                    val saveIds = listOfNotNull(fields.username?.id, fields.password?.id)
                    if (saveIds.isNotEmpty()) {
                        setSaveInfo(SaveInfo.Builder(SaveInfo.SAVE_DATA_TYPE_USERNAME or SaveInfo.SAVE_DATA_TYPE_PASSWORD, saveIds.toTypedArray()).build())
                    }
                }
                .build()

        callback.onSuccess(response)
    }

    /**
     * Fires once a form declared via [SaveInfo] above is submitted. Has no
     * UI of its own -- Android already showed its own "Save to Vaultiq?"
     * prompt before calling this -- so it launches [AutofillActivity] in
     * save mode with the typed values and holds [callback] open
     * (companion [pendingSaveCallback]) until that screen's own confirm/
     * discard flow finishes it. `SaveCallback` isn't JS-representable, so
     * this handoff stays entirely on the Kotlin side, the same
     * pending-callback shape `mobile/src/lib/qrScanResult.ts` uses for an
     * equivalent Activity-boundary handoff in JS.
     */
    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        val structure = request.fillContexts.lastOrNull()?.structure
        if (structure == null) {
            callback.onFailure("nothing to save")
            return
        }

        val fields = collectLoginFields(structure)
        if (fields.username == null && fields.password == null) {
            callback.onFailure("nothing recognizable to save")
            return
        }

        pendingSaveCallback = callback
        val intent =
            Intent(this, AutofillActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                putExtra(AutofillActivity.EXTRA_MODE, AutofillActivity.MODE_SAVE)
                putExtra(AutofillActivity.EXTRA_DOMAIN, fields.domain ?: "")
                putExtra(AutofillActivity.EXTRA_USERNAME, fields.username?.value ?: "")
                putExtra(AutofillActivity.EXTRA_PASSWORD, fields.password?.value ?: "")
            }
        startActivity(intent)
    }

    private fun collectLoginFields(structure: AssistStructure): LoginFields {
        val fields = LoginFields()
        for (i in 0 until structure.windowNodeCount) {
            walk(structure.getWindowNodeAt(i).rootViewNode, fields)
        }
        return fields
    }

    private fun walk(node: AssistStructure.ViewNode, fields: LoginFields) {
        if (fields.domain == null) node.webDomain?.let { fields.domain = it }

        val id = node.autofillId
        if (id != null) {
            val value = node.autofillValue?.let { if (it.isText) it.textValue?.toString() else null }
            val hints = node.autofillHints
            when {
                hints != null && hints.contains(View.AUTOFILL_HINT_PASSWORD) -> {
                    if (fields.password == null) fields.password = Field(id, value)
                }
                hints != null && hints.contains(View.AUTOFILL_HINT_EMAIL_ADDRESS) -> {
                    if (fields.email == null) fields.email = Field(id, value)
                }
                hints != null && hints.contains(View.AUTOFILL_HINT_USERNAME) -> {
                    if (fields.username == null) fields.username = Field(id, value)
                }
                isPasswordInputType(node.inputType) -> {
                    if (fields.password == null) fields.password = Field(id, value)
                }
                isFreeTextInputType(node.inputType) -> {
                    fields.lastFreeText = Field(id, value)
                }
            }
        }

        for (i in 0 until node.childCount) walk(node.getChildAt(i), fields)
    }

    /**
     * No explicit hint on this node -- inferred from [InputType] instead.
     * Covers the minority of forms (mostly older sites, some non-Chrome
     * apps) that never set an autocomplete/autofill hint at all; Chrome
     * itself reliably turns HTML autocomplete attributes into real hints,
     * so most modern web forms never reach this fallback.
     */
    private fun isPasswordInputType(inputType: Int): Boolean {
        val variation = inputType and InputType.TYPE_MASK_VARIATION
        return when (inputType and InputType.TYPE_MASK_CLASS) {
            InputType.TYPE_CLASS_TEXT ->
                variation == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
                    variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD ||
                    variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
            InputType.TYPE_CLASS_NUMBER -> variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD
            else -> false
        }
    }

    private fun isFreeTextInputType(inputType: Int): Boolean =
        (inputType and InputType.TYPE_MASK_CLASS) == InputType.TYPE_CLASS_TEXT && !isPasswordInputType(inputType)

    companion object {
        // Android requires the PendingIntent request code to be stable-ish
        // per distinct request, or a queued fill request can clobber an
        // in-flight one's. Not persisted -- this only needs to be unique
        // within this process's lifetime.
        private var requestCode = 0
        private fun nextRequestCode(): Int = ++requestCode

        /** Held between [onSaveRequest] and whichever save flow finishes it. */
        var pendingSaveCallback: SaveCallback? = null
    }
}
