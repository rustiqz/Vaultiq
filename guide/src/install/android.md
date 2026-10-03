# Install the Android app

The Android app is built from source and installed as a debug APK. It targets
arm64 devices. There is no store listing yet.

## Build it

You need Rust with the `aarch64-linux-android` target, the Android SDK and NDK,
Node 24 and pnpm.

```bash
git clone https://github.com/rustiqz/Vaultiq.git
cd Vaultiq/mobile
pnpm install
pnpm run crypto                 # cross-compile the core, generate Kotlin bindings
cd android && ./gradlew assembleDebug
```

The APK is in `app/build/outputs/apk/debug/`. Install it with `adb install` or
copy it to the phone.

## First run

Choose one of the options on the first screen:

- **Create a vault** on a server you run (needs an invitation token).
- **Join** an existing vault by scanning a QR code from the extension's
  **Add a device**, or by pasting a token.
- **Use without a server** for a local-only vault.
- **Restore** from an exported backup. A restored vault is always local-only.

## Turn on Android autofill

Vaultiq fills logins in other apps through Android's autofill service. Switch it
on in system settings: **Settings → Passwords & accounts → Autofill service**
(the wording varies by device), then choose Vaultiq. See
[Autofill and saving logins](using/autofill.md).

## Fingerprint unlock

After you unlock with the master password once, enable fingerprint unlock in
**Settings**. See [Unlocking and locking](using/unlock.md) for how it works and
what invalidates it.
