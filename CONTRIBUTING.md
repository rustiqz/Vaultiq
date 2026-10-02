# Contributing to Vaultiq

Thanks for considering a contribution. Vaultiq is a zero-knowledge password
manager, so a mistake here can expose someone's entire credential set. That
shapes the process: it is deliberately slower and more cautious than most
projects.

By contributing you agree that your work is licensed under the
[AGPL-3.0](LICENSE), the same as the rest of the project.

## Before you start

**Open an issue first** for anything beyond a small fix. Agree on the approach
before writing code, so neither of us wastes time.

**Security vulnerabilities do not go in issues or pull requests.** Follow
[SECURITY.md](SECURITY.md).

### What is in scope

Bug fixes, tests, documentation, accessibility, performance, and improvements
to existing features are welcome.

### What is deliberately out of scope

These are decided, not forgotten. Pull requests for them will be closed, even
as partial work or as "just the types for later":

- Sharing between users
- Account recovery or key escrow
- Passkeys
- Breach checking

### What needs discussion before any code

- Any change to an algorithm, key-derivation input, HKDF `info` string, AAD
  layout or serialized format. These make existing vaults undecryptable and
  count as breaking changes.
- Any change to the key hierarchy or crypto choices (Argon2id,
  XChaCha20-Poly1305, the vault-key indirection).
- Any new dependency.

## Development setup

| Tool | Version |
|---|---|
| Rust | 1.98.0 (via `rustup`) |
| Node | 24 |
| pnpm | 11 |
| `wasm-pack` | for the extension build |
| Docker | for running the server locally |

Rust targets: `wasm32-unknown-unknown` for the extension, and
`aarch64-linux-android` (plus the Android SDK and NDK) for mobile.

[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) has the full build and test guide
for each component. Enable the repository's git hooks once after cloning:

```bash
git config core.hooksPath .githooks
```

The extension, server and mobile app each have their own pnpm workspace and
lockfile. Run `pnpm install` inside the component you are changing.

## Checks that must pass

Run what applies to the component you changed. CI runs the same checks.

**Crypto core** (repository root):

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo build --features wasm
```

**Extension and server** (inside `extension/` or `server/`):

```bash
pnpm typecheck
pnpm lint
pnpm test
```

The server tests need Postgres. **Mobile** (inside `mobile/`): `pnpm exec tsc`,
`pnpm exec eslint .`, `pnpm test`, and a debug build.

Do not report something as passing unless you ran it. If you could not
verify a change on a real device or browser, say so in the pull request.

## Rules for security-sensitive code

These apply to everything, and to the crypto core most strictly.

- **Never write a primitive.** No hand-rolled KDF, cipher, MAC or padding.
  Use vetted crates through their documented high-level API.
- **No `unsafe`** in the core crate (`#![forbid(unsafe_code)]`).
- **No panics** in library code: no `unwrap`, `expect`, `panic!`, slice
  indexing or overflow-prone arithmetic outside tests. Every failure is a
  `CryptoError`.
- **Randomness only from `OsRng`.** Nonces are generated internally. Callers
  must never be able to supply one for encryption.
- **Constant-time comparison** (`subtle`) for anything derived from a secret.
- **Zeroize secrets.** Secret types implement `ZeroizeOnDrop` and have a
  hand-written, redacted `Debug`. Never derive `Debug`, `Serialize` or
  `Clone` on a type holding key material.
- **Never log secrets:** no key material, no plaintext item content, no
  master password, and no "just the first few bytes".
- **Uniform errors.** Wrong password, wrong key, tampered or truncated input
  all return the same `DecryptionFailed`, with no extra detail across the
  WASM or FFI boundary.
- **No network calls** in the crypto core, ever.
- **Version every persisted format** from the first commit.
- Explain security-relevant reasoning in a code comment where a future reader
  would be tempted to simplify it away.

Tests for security properties are required, including known-answer vectors,
tamper-detection and the same-error-variant assertion. Test data must be fake
and obviously so, such as `"correct horse battery staple"` or counting byte
arrays. Never use a real password, even locally.

## Dependencies

- Every new dependency needs a stated reason in the pull request.
- Pin exact versions. No wildcards, no loose ranges.
- Prefer RustCrypto and other well-audited crates for anything
  security-relevant.
- Run `cargo audit` before adding or bumping, and read the changelog.
- Dependency bumps are their own pull request, never bundled with a feature.
- No dependency in the crypto core may perform I/O, networking or process
  spawning.

## Git workflow

Branch from `main`, and never commit to it directly. Name branches by type
and area, for example `fix/nonce-reuse`, `feat/extension-import` or
`chore/deps`.

### Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/),
imperative mood, subject at most 72 characters:

```
feat(kdf): derive MasterKey via Argon2id
fix(vault_item): reject reused nonce
test(keys): add wrap/unwrap round-trip
chore(deps): pin chacha20poly1305 0.10
```

The body explains *why*, not what the diff already shows. A security-relevant
commit states the threat it addresses.

**The subject decides the release version.** Releases are cut automatically
from commit subjects, so a mistyped type silently produces the wrong version.
CI rejects malformed subjects. A change to a key-derivation input, AAD layout
or serialized format is a breaking change and must be written `feat!:` or
`fix!:` (or carry a `BREAKING CHANGE:` footer).

Keep commits atomic: one logical change each. Do not edit component version
numbers by hand, and do not use `--no-verify`.

## Pull requests

Before opening one, confirm:

- [ ] The checks above pass for every component touched
- [ ] Tests cover the change, including failure cases
- [ ] No secrets, `.env` files, vault exports, database dumps or personal
      vault data are included. Review `git diff --staged`.
- [ ] `SECURITY.md` is updated if the change alters what is defended against
- [ ] Anything unverified (device, browser) is stated plainly

If you commit a secret by accident, treat it as compromised. Rotate it first,
then tell the maintainer. Amending the commit is not a fix.

## Support

Vaultiq is maintained by one person, with no support commitment. Issues and
pull requests are reviewed on a best-effort basis, so expect delays.
