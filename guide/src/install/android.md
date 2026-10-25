# Install the Android app

Download `vaultiq-X.Y.Z.apk` from the
[latest release](https://github.com/rustiqz/Vaultiq/releases/latest). It is a
signed release build for arm64 devices. There is no store listing yet.

1. On your computer, check the file against `SHA256SUMS` from the same release:
   `sha256sum --ignore-missing -c SHA256SUMS`.
2. Copy it to the phone, or download it there directly.
3. Open it. Android asks to allow installs from that app (your browser or file
   manager); allow it for this install.
4. To upgrade, install the newer APK over the old one. Your vault and settings
   are kept. The app does not update itself.

## Build it from source

You need Rust with the `aarch64-linux-android` target, the Android SDK and NDK,
Node 24 and pnpm.

```bash
git clone https://github.com/rustiqz/Vaultiq.git
cd Vaultiq/mobile
pnpm install
pnpm run crypto                 # cross-compile the core, generate Kotlin bindings
cd android && ./gradlew assembleDebug
```

This produces a debug APK in `app/build/outputs/apk/debug/`, signed with a
debug key. It cannot be installed over a release APK, or the reverse; uninstall
one before the other.

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
