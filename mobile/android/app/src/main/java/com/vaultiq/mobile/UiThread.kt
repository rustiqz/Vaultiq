package com.vaultiq.mobile

import android.app.Activity

/**
 * Runs [block] on [activity]'s UI thread, synchronously if already there.
 *
 * React Native invokes every `@ReactMethod` on its own native-modules
 * thread, never the UI thread -- easy to miss, since most Android APIs
 * tolerate being called from any thread. Some don't: `BiometricPrompt`
 * (via its internal `FragmentManager` transaction) is one, throwing
 * `IllegalStateException: Must be called from main thread of fragment
 * host` when it isn't. That exact bug shipped in `BiometricModule.kt`,
 * silently swallowed into a rejected promise and misdiagnosed as an
 * activity-not-yet-resumed race, since a retry often incidentally
 * succeeded (see `BiometricModule.kt::prompt`'s comment for the full
 * story). Any native module doing Fragment/View work -- not just
 * biometrics -- needs this same dispatch; reach for it instead of calling
 * `activity.runOnUiThread` ad hoc, so the reason is documented once.
 */
fun runOnUiThreadThenCall(activity: Activity, block: () -> Unit) {
    activity.runOnUiThread(block)
}
