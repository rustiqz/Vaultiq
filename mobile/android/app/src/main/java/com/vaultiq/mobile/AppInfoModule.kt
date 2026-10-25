package com.vaultiq.mobile

import androidx.core.content.pm.PackageInfoCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * What is actually installed, as the OS reports it -- the APK's own
 * `versionName`/`versionCode`, which the release job writes into
 * `build.gradle` (scripts/component-versions.sh). Read from the package
 * manager rather than bundled into the JS, so it is the installed binary
 * answering and not the JS bundle: the two could differ in a dev build that
 * loads a bundle from Metro. Nothing secret, and no vault state involved.
 */
class AppInfoModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "AppInfo"

    @ReactMethod
    fun version(promise: Promise) {
        try {
            val info = reactContext.packageManager.getPackageInfo(reactContext.packageName, 0)
            val result = Arguments.createMap()
            result.putString("versionName", info.versionName ?: "unknown")
            result.putDouble("versionCode", PackageInfoCompat.getLongVersionCode(info).toDouble())
            promise.resolve(result)
        } catch (error: Exception) {
            promise.reject("app_info_error", "could not read the app version")
        }
    }
}
