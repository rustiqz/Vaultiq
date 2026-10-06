<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="site/assets/logo/lockup-h-archivo-reversed.svg">
    <img src="site/assets/logo/lockup-h-archivo.svg" alt="Vaultiq" width="320">
  </picture>
</p>

<p align="center">
  A zero-knowledge, self-hosted password manager for Firefox, Chrome and Android.
</p>

<p align="center">
  <a href="https://github.com/rustiqz/Vaultiq/actions/workflows/ci.yml"><img src="https://github.com/rustiqz/Vaultiq/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/rustiqz/Vaultiq/releases/latest"><img src="https://img.shields.io/github/v/release/rustiqz/Vaultiq" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License: AGPL-3.0"></a>
</p>

---

Vaultiq encrypts everything on your device before it goes anywhere. The server
you run stores ciphertext and cannot read it. Item names, URLs, usernames,
notes and counts are all encrypted, not just the passwords.

> [!WARNING]
> **There is no account recovery.** Your master password is stored nowhere and
> cannot be reset by anyone, including whoever runs your server. Lose it and
> the vault is gone. This is deliberate, and it is the cost of the design.

> [!NOTE]
> Vaultiq has **not been independently audited.** The cryptography uses
> vetted RustCrypto primitives and is pinned by known-answer tests, but no
> third party has reviewed the code. Read [SECURITY.md](SECURITY.md) for what
> it does and does not defend against before trusting it with anything.

## Features

- **Five item types:** logins, cards, identities, authenticator (TOTP) codes
  and secure notes.
- **Autofill and save prompts** in the browser extension, and a real Android
  autofill service for logins.
- **Self-hosted sync** between devices through your own server, with
  invite-only registration and per-device revocation.
- **Local-only mode:** a vault that never contacts a server at all.
- **Quick unlock** by PIN in the extension and by fingerprint on Android.
- **Encrypted backup and restore**, plus import from Chrome, Firefox,
  Bitwarden, LastPass and 1Password CSV, Bitwarden JSON and Proton Pass JSON.
- **One Rust crypto core** shared by every client: WebAssembly in the
  extension, native FFI on Android.

## Platforms

| Platform | Status |
|---|---|
| Firefox | Supported |
| Chrome | Supported (same build as Firefox) |
| Android | Supported, arm64 |
| iOS | Not available |

## How it works

Your master password is stretched with Argon2id into a master key. Two
independent keys are derived from it with HKDF: an auth key, which is the only
thing that leaves your device, and an encryption key, which wraps a random
vault key. Items are encrypted under the vault key with XChaCha20-Poly1305,
with the item's id and version bound in as authenticated data so a ciphertext
cannot be swapped for another.

The server never sees the master password, the master key or the vault key.
The full key hierarchy, and what an attacker gets in each scenario, is in
[SECURITY.md](SECURITY.md). The design rationale is in
[PROJECT.md](PROJECT.md).

## Getting started

The user guide is at [vaultiq.rustiq.in/docs](https://vaultiq.rustiq.in/docs/)
(source in [`guide/`](guide/)).

Short versions below. The full build, test and deployment guide, including the
manual autofill test page and server test setup, is in
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

### Browser extension

Requires Rust (with the `wasm32-unknown-unknown` target), `wasm-pack`, Node 24
and pnpm.

```bash
cd extension
pnpm install
pnpm run build        # output in extension/dist
pnpm run dev          # Firefox, with live reload
pnpm run dev:chrome   # Chrome, with live reload
```

On first run, choose **Create your vault** and pick whether to use it without
a server.

### Sync server

Requires Docker. The compose file runs Postgres, the server and Caddy, which
obtains its own certificate. Only Caddy is published.

```bash
cp .env.example .env          # set POSTGRES_PASSWORD and VAULTIQ_DOMAIN
docker compose up -d
docker compose logs server    # the first-run registration token is logged here
```

Registration is invite-only. Manage invitations, users, devices and the audit
log with the admin CLI:

```bash
docker compose exec server node dist/admin/cli.js
```

### Android

Requires the Android SDK and NDK, and Rust with the `aarch64-linux-android`
target.

```bash
cd mobile
pnpm install
pnpm run crypto       # cross-compile the core and generate Kotlin bindings
pnpm run android
```

### Crypto core

```bash
cargo test
cargo build --features wasm
```

## Repository layout

| Path | What it is |
|---|---|
| `pw-crypto-core/` | Rust crypto core: key derivation, key wrapping, item encryption, wasm and FFI bindings |
| `extension/` | Manifest V3 browser extension for Firefox and Chrome |
| `mobile/` | React Native Android app |
| `server/` | NestJS and PostgreSQL sync server, plus the admin CLI |
| `site/` | Static landing page |
| `guide/` | mdBook user guide, published under `/docs/` |

## Known limitations

- No sharing, passkeys, breach checking or account recovery. These are
  deliberately out of scope, not forgotten.
- The Android app has been built and tested on a physical device, but several
  newer features (autofill service, biometric unlock, QR scanning, backup
  restore) are compile-verified only. See [docs/STATUS.md](docs/STATUS.md) for the
  per-feature record.
- A local-only vault has no offsite copy. Export a backup, or losing the
  device loses the vault.
- iOS is not available.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first,
because this is a security product and some changes need discussion before
code.

## Security

Please report vulnerabilities privately. See [SECURITY.md](SECURITY.md) for
how.

## Support the project

Vaultiq is free software built by one person. There is no paid support, and
issues are handled on a best-effort basis. If it is useful to you, you can
sponsor development through
[GitHub Sponsors](https://github.com/sponsors/rustiqz) or
[Buy Me a Coffee](https://buymeacoffee.com/rakshithg1l).

## License

Vaultiq is licensed under the
[GNU Affero General Public License v3.0](LICENSE). If you run a modified
version as a network service, you must offer its source to the users of that
service.

Bundled fonts are under the SIL Open Font License; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
