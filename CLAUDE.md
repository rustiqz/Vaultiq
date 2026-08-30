# Vaultiq — Working Rules

Rules for implementing the design in [PROJECT.md](PROJECT.md). PROJECT.md is
*what* we build; this file is *how*. Where they conflict, PROJECT.md wins on
design, this file wins on process.

This is a zero-knowledge password manager. The cost of a mistake here is not
a bug report — it is someone's entire credential set. Slow and correct beats
fast and clever, every time.

---

## 0. Current state (keep this section accurate)

- **Phase: 1 — Rust crypto core.**
- PROJECT.md says `pw-crypto-core/` was already scaffolded. It was not — the
  crate was created from scratch, with dependency versions looked up fresh
  against crates.io rather than taken from the doc.
- **Phase 1 is complete.** `pw-crypto-core/` implements key derivation,
  vault key wrapping and item encryption, pinned by known-answer vectors
  cross-computed with OpenSSL and libsodium. `src/wasm.rs` is empty and
  belongs to phase 2.
- Cargo workspace at the repo root; one `Cargo.lock` for every crate.
- Git repository initialized; `main` is the trunk; `origin` is
  `git@github.com:rustiqz/Vaultiq.git`. CI and release automation live in
  `.github/workflows/` — see §8.
- Toolchain present: cargo/rustc 1.98.0, git 2.55.0. The `wasm32-unknown-unknown`
  target is required for the `wasm` feature (Arch: `rust-wasm`).

Update this section when it stops being true.

---

## 1. Scope discipline

1. **Build phases in order.** Phase 1 (crypto core) must build, test, and
   lint clean before any extension, server, or mobile code exists. No
   "while I'm here" scaffolding of later phases.
2. **The design is settled.** Do not re-litigate Argon2id, XChaCha20-Poly1305,
   the vault-key indirection, or the data model. If something is genuinely
   unworkable, stop and explain why *before* deviating — never silently
   substitute an approach.
3. **Deferred means deferred.** Sharing, recovery flows, passkeys, TOTP,
   non-login item types, import, breach checking — not now, not partially,
   not "just the types for later".
4. **No shortcuts justified by "it's only me".** Single-user today does not
   license plaintext metadata, skipped auth separation, or hardcoded paths.

---

## 2. Secrets: never leak, never commit, never log

This is the section that matters most.

### 2.1 Never commit
- No real passwords, master passwords, vault exports, or `.env` files.
- No private keys, certificates, API tokens, or server credentials.
- No database dumps, sync payloads, or captured HTTP bodies.
- No personal vault data of any kind, encrypted or not.

Every commit gets `git diff --staged` reviewed before it happens. Never
`git add -A` / `git add .` without reading what it staged.

### 2.2 If a secret does get committed
Treat it as **compromised, permanently**. Rotate the secret first, then clean
history. Amending the commit is not a fix — assume it was already read.

### 2.3 Never log
- No key material — master key, vault key, auth key, stretched key, wrapped
  key bytes.
- No plaintext item content, no master password, no password-derived value.
- No "just the first 8 bytes" of anything secret. Prefixes are secrets.

Secret types must have a **hand-written `Debug`** that prints a redacted
placeholder (e.g. `MasterKey([REDACTED])`). Never `#[derive(Debug)]` on a
type holding key material. Never `#[derive(Serialize)]` on one either —
serializing a key is a bug, and the compiler should be the one to catch it.

### 2.4 Never reveal through errors
Per PROJECT.md: wrong password, tampered ciphertext, wrong key, and truncated
input all return the **same** `DecryptionFailed`. No context, no source error
chained in, no distinct message. This holds especially at trust boundaries —
WASM return values, FFI, and (later) API responses.

Detailed diagnostics may exist behind a debug-only, client-side-only path.
They must never be reachable from the WASM/FFI surface.

### 2.5 Never send outward
- The crypto core makes **zero network calls**. Ever. No telemetry, no
  crash reporting, no update checks.
- Don't paste project files, vault data, or real passwords into external
  services, pastebins, or issue trackers.
- Ask before pushing anything to a remote, publishing a crate, or uploading
  build artifacts.

### 2.6 Test data is fake and obviously so
Fixtures use values like `"correct horse battery staple"` and all-zero or
counting byte arrays, with a comment marking them test-only. Never use a
real password as a test vector, even once, even locally.

---

## 3. Git rules

1. **Commit only when asked.** Don't auto-commit after edits.
2. **Never commit directly to `main`.** Branch as
   `phase1/kdf`, `phase1/keys`, `fix/nonce-reuse`, `chore/deps`.
3. **Atomic commits.** One logical change. A commit that touches `kdf.rs`
   and adds a README section is two commits.
4. **Conventional commit subjects**, imperative, ≤72 chars:
   `feat(kdf): derive MasterKey via Argon2id`,
   `fix(vault_item): reject reused nonce`,
   `test(keys): add wrap/unwrap round-trip`,
   `chore(deps): pin chacha20poly1305 0.10`.
   Body explains *why*, not what the diff already shows. Security-relevant
   commits state the threat they address.
5. **Never force-push a shared branch.** Never rewrite pushed history.
6. **Never `--no-verify`.** If a hook fails, fix the cause.
7. **Green before commit.** `fmt`, `clippy -D warnings`, and `test` all pass
   (see §6). A commit that doesn't build is not a commit.
8. **Commit `Cargo.lock`.** This is a security product; reproducible
   dependency resolution is part of the threat model.
9. **Never commit build output** — `target/`, `pkg/`, `node_modules/`,
   `dist/`, `*.wasm`. See `.gitignore`.
10. **Never tag by hand.** Tags and releases are produced by git-cliff from
    the commit subjects. See §8.
11. Dependency bumps are their own commits, never bundled into feature work.

---

## 4. Crypto implementation rules

1. **Never write a primitive.** No hand-rolled KDF, cipher, MAC, or padding.
   Vetted crates only, used through their documented high-level API.
2. **`#![forbid(unsafe_code)]`** in the core crate. When FFI later requires
   `unsafe`, it lives in a separate, minimal, documented module — never in
   `kdf`/`keys`/`vault_item`.
3. **No panics in library code.** No `unwrap`, `expect`, `panic!`, `todo!`,
   slice indexing, or integer-overflow-prone arithmetic outside `#[cfg(test)]`.
   Every failure is a `CryptoError`. A panic in a crypto path is a side
   channel and a DoS.
4. **Randomness only from `OsRng`.** Never `thread_rng` for key material,
   never a seeded RNG outside tests, never a counter or timestamp as a nonce.
5. **Fresh random nonce per encryption**, generated internally. Callers must
   not be able to supply a nonce for encryption. Nonce reuse under a single
   key is catastrophic for XChaCha20-Poly1305 — the API shape should make it
   impossible, not merely discouraged.
6. **Constant-time comparison** (`subtle`) for anything derived from a
   secret. Never `==` on key bytes, tags, or auth values.
7. **Zeroize everything secret.** `MasterKey`, `VaultKey`, `AuthKey`,
   `StretchedEncryptionKey`, decrypted plaintext buffers, and any
   intermediate derivation output implement `ZeroizeOnDrop`. Avoid `Clone`
   on secrets; each clone is another copy to scrub.
8. **Domain separation is explicit.** Auth key and stretched encryption key
   come from HKDF with distinct, versioned `info` strings — never from
   splitting or truncating one output. Keep those constants in one place
   (`keys.rs`) so drift is visible in a diff.
9. **Version every persisted format.** Wrapped vault keys, encrypted items,
   and KDF parameter records carry an explicit version/format field from the
   first commit. Retrofitting a version byte later means a migration on
   real user data.
10. **Store KDF parameters alongside the vault**, don't hardcode them at the
    read path. Argon2 costs must be raisable later without breaking existing
    vaults.
11. **Bind context into AEAD associated data** where it prevents blob
    swapping (e.g. item `id` and `version` as AAD on `encrypt_item`), so a
    substituted ciphertext fails authentication rather than decrypting.
12. **Validate all input lengths** before use — salts, nonces, keys, base64
    decode results. Return `InvalidInput`, never index blindly.
13. **The WASM layer is a marshalling layer only.** No crypto decisions, no
    branching on error kind, no extra error detail crossing into JS.

Changing any algorithm, key-derivation input, `info` string, or serialized
format after data exists is a **breaking, data-affecting change** — raise it
before implementing.

---

## 5. Dependency rules

1. Minimal surface. Every new dependency needs a stated reason.
2. Pin exact versions; no wildcards, no `*`, no loose `>=`.
3. Prefer RustCrypto / well-audited crates for anything security-relevant.
4. Run `cargo audit` (and `cargo deny` if configured) before adding or
   bumping, and read the changelog on bump — never bump blind.
5. `default-features = false` where practical; pull in only what's used.
6. No dependency that performs I/O, networking, or process spawning in the
   crypto core.

---

## 6. Verification — required before every commit

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo build --features wasm          # WASM feature must compile
cargo audit                          # when available
```

Testing requirements (from PROJECT.md, plus):
- Round trips: encrypt→decrypt, wrap→unwrap.
- Same salt + same password → same key; different salt → different key.
- Tampering with any ciphertext byte, nonce byte, or tag byte → failure.
- Wrong `VaultKey` → failure.
- All failure modes above return the *same* error variant (assert this
  explicitly — it's a security property, so it gets a test).
- Property tests (`proptest`) over arbitrary plaintext, including empty
  input and large input.
- **Known-answer tests**: pin fixed (password, salt, params) → expected key
  bytes, and fixed key + nonce + plaintext → expected ciphertext. These are
  what catch a refactor silently changing derivation.
- Tests must not print secret material on failure.

**Never report a test as passing without having run it.** If something
fails, say so and show the output.

---

## 7. Working process

1. Read the relevant PROJECT.md section before writing the module.
2. One module at a time, with its tests, building green before moving on.
3. Ask before: changing crypto choices, changing the key hierarchy, changing
   a serialized format, adding a dependency, initializing/pushing to a
   remote, or expanding beyond the current phase.
4. Don't narrow scope silently. If part of a task is blocked, finish the
   rest and say exactly what was left out and why.
5. Security-relevant reasoning goes in the code as a comment where a future
   reader would otherwise be tempted to "simplify" it away.
6. Keep a `SECURITY.md` with the threat model once the core lands — what the
   design defends against (compromised server, stolen ciphertext, tampered
   blobs) and what it does not (compromised client, keylogger, weak master
   password).

---

## 8. CI and releases

### 8.1 What runs, and when

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` → `gate` | every PR, push to `main` | fmt, clippy `-D warnings`, tests, WASM feature build |
| `ci.yml` → `commit-messages` | PRs only | rejects malformed commit subjects |
| `ci.yml` → `release` | push to `main`, **after `gate` passes** | tags and cuts the GitHub release |
| `audit.yml` | dependency changes, weekly cron, manual | `cargo audit` against the RustSec advisory database |

Release is a job inside `ci.yml`, not its own workflow, so `needs: gate` can
guarantee ordering. As a separate workflow it would run *in parallel* with the
checks, and a broken build could be tagged.

The weekly cron on `audit.yml` is the point of it: an advisory can land
against a dependency nobody touched.

### 8.2 Commit subjects decide the version

Version numbers are not edited by hand. git-cliff reads the
conventional-commit subjects since the last tag and derives the bump. A
malformed subject is therefore not a style problem — it silently produces the
wrong release, which is why `ci.yml` rejects one.

The mapping lives in `cliff.toml`: `commit_parsers` decides the changelog
section, `[bump]` decides the version.

| Subject | Changelog section | Bump while `0.x` | Bump at `1.0`+ |
|---|---|---|---|
| `feat:` | Added | minor | minor |
| `fix:` | Fixed | patch | patch |
| `perf:` | Performance | patch | patch |
| `refactor:` | Changed | patch | patch |
| `revert:` | Reverted | patch | patch |
| `docs:` `test:` `build:` `ci:` | own sections | patch | patch |
| `chore(deps):` | Dependencies | patch | patch |
| `feat!:` or `BREAKING CHANGE:` footer | Breaking | **minor** | **major** |
| `chore:` `style:` | hidden | none | none |

Note the `0.x` column: while the version is below `1.0`, a breaking change
bumps the *minor*, per SemVer. That changes the day `1.0.0` ships.

**Breaking, here, means data.** A change to an HKDF `info` string, a KDF
parameter default, an AAD layout or a serialized format makes existing vaults
undecryptable. That is a breaking change even when the Rust API is untouched,
and it must carry `!` or a `BREAKING CHANGE:` footer.

### 8.3 Release flow

1. Open a PR. `gate` and `commit-messages` run on it.
2. Merge into `main`. `gate` runs again on the merge commit.
3. Only if it passes, `release` computes the next version with
   `git cliff --bumped-version`.
4. If nothing since the last tag is releasable — only `chore:` and `style:` —
   the job exits quietly. Otherwise it tags `vX.Y.Z`, pushes the tag, and cuts
   a GitHub release with notes generated from the commit subjects.

Because the release is cut straight from `main`, **the commit message is the
last chance to catch a mistyped change** — there is no release PR to review
before the tag lands. A key-derivation change typed as `fix:` releases as a
patch. Get the subject right in the PR.

There is deliberately **no `CHANGELOG.md`** in the repo: the GitHub Releases
page is authoritative, and a committed copy would either go stale or force CI
to push commits back to `main`. Regenerate one whenever it is useful:

```bash
git cliff -o CHANGELOG.md     # full history
git cliff --unreleased        # what the next release would contain
```

The version lives only in git tags. Nothing bumps `Cargo.toml`.

### 8.4 Branch protection

`main` is **not** protected server-side. GitHub gates both classic branch
protection and rulesets behind a paid plan for private repositories, and this
repo is private on a free account — both API endpoints return
`403 Upgrade to GitHub Pro or make this repository public`.

Standing in for it: `.githooks/pre-push`, which refuses direct pushes to
`main`, refuses force-pushes, and lets branches and tags through so CI can
still push release tags. It is a guard rail on one machine, not a control —
`--no-verify` walks past it, which §3.6 forbids. Enable it after cloning:

```bash
git config core.hooksPath .githooks
```

**When the repo goes public** (or gets a Pro plan), replace it with the real
thing. The check names below are exact — a typo means the check never matches
and every PR blocks forever:

```bash
gh api -X PUT repos/rustiqz/Vaultiq/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["fmt · clippy · test · wasm", "conventional commits"]
  },
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "enforce_admins": false,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

Two traps in that payload:

- **`required_approving_review_count` must be 0** while this is a solo
  project. GitHub forbids approving your own PR, so any higher number locks
  you out of your own repository.
- **Never require `Tag and release`.** It only runs on push to `main`, never
  on a PR, so requiring it leaves every PR waiting on a check that cannot
  arrive.

### 8.5 Other settings that are not in this repo

- **Settings → Actions → General → "Allow GitHub Actions to create and
  approve pull requests"** is enabled. Releases no longer need it, but leave
  it on.
- The default `GITHUB_TOKEN` does not trigger workflows on PRs it creates. Not
  currently relevant — releases are cut directly rather than via a PR — but it
  matters if that ever changes.
