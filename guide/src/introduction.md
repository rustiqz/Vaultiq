<a class="vq-home" href="/">← vaultiq.rustiq.in</a>

# Vaultiq

Vaultiq is a zero-knowledge password manager for Firefox, Chrome and Android.
Everything is encrypted on your device before it goes anywhere. If you choose
to sync, the server you run stores ciphertext and cannot read it. Item names,
URLs, usernames, notes and counts are encrypted, not just the passwords.

There is no hosted service. You either keep the vault on one device, or you run
the small sync server yourself.

> **There is no account recovery.** Your master password is stored nowhere and
> cannot be reset by anyone, including whoever runs your server. If you lose it,
> the vault is gone. This is deliberate and it is the cost of the design.

> **Vaultiq has not been independently audited.** The cryptography uses vetted
> RustCrypto primitives and is pinned by known-answer tests, but no third party
> has reviewed the code. Read [What Vaultiq protects, and what it does
> not](security.md) before trusting it with anything.

## What you can do

- Store five kinds of item: logins, cards, identities, authenticator (TOTP)
  codes and secure notes.
- Autofill and save logins in the browser extension, and fill logins in
  Android apps and browsers through Android's autofill service.
- Sync between devices through your own server, with invite-only registration
  and per-device revocation, or use a vault that never contacts a server.
- Unlock quickly with a PIN in the extension or a fingerprint on Android.
- Import from Chrome, Firefox, Bitwarden, LastPass and 1Password CSV, Bitwarden
  JSON and Proton Pass JSON, and export an encrypted backup.

## Platforms

| Platform | Status |
|---|---|
| Firefox | Supported |
| Chrome | Supported (same build as Firefox) |
| Android | Supported, arm64 |
| iOS | Not available |

There are no store listings yet. Both apps are built from source; see the
install pages.

## Where to go next

1. [Choose how to use Vaultiq](getting-started.md): with a server or without one.
2. Install the [extension](install/extension.md) and/or the
   [Android app](install/android.md).
3. If you chose a server, [deploy it](server/deploy.md).

Vaultiq is free software under the
[GNU Affero General Public License v3.0](https://github.com/rustiqz/Vaultiq/blob/main/LICENSE).
Source, issues and releases are on
[GitHub](https://github.com/rustiqz/Vaultiq).
