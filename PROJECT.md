# Vaultiq — Design & Build Plan

## Context

**Vaultiq** — personal, zero-knowledge password manager. Primarily used in
browser and mobile, with desktop support planned. Single user for now (the
owner), but built with enough correctness/rigor that it could be released
for others later — so no shortcuts that only work for a single trusted user
(e.g. no skipping auth separation, no plaintext metadata "just for now").

This doc is the confirmed design. Treat it as settled — the point of this
handoff is to *build*, not to re-litigate architecture. If something here
turns out to be genuinely unworkable during implementation, flag it and
explain why before deviating, rather than silently changing approach.

---

## Core principle: zero-knowledge

The server must never be able to see plaintext vault data, even if fully
compromised. All encryption/decryption happens client-side. The server only
ever stores and moves encrypted blobs plus the minimum metadata required to
sync and authenticate.

---

## Build order (phases)

Build in this order. Each phase should produce something functional before
moving to the next — don't jump ahead.

1. **Rust crypto core** (this is the current phase — see below)
2. **Browser extension** (WebExtension, Manifest V3) — local storage only
   (IndexedDB), no server yet. Crypto core compiled to WASM.
3. **Sync server** — NestJS + PostgreSQL, zero-knowledge blob storage,
   item-level sync with version-based optimistic concurrency
4. **Native mobile apps** (Kotlin for Android, Swift for iOS) — same Rust
   core via FFI bindings, plus platform Autofill integration (Android
   Autofill Framework / iOS AutoFill Credential Provider) and biometric
   unlock
5. **Tauri desktop app** — same Rust core natively (no WASM needed, Tauri's
   backend is Rust)
6. **Multi-tenancy and self-hosted distribution** — see below. Full
   rationale and sequencing in [MULTI-TENANCY.md](MULTI-TENANCY.md); this
   section is the settled subset of it.

**Why this order:** the crypto core and data model are the hard-to-retrofit
parts. Getting them right once, in isolation, before adding network sync,
multi-client concerns, or platform-specific UI, avoids a rewrite later. The
browser extension is the proving ground because it's the fastest client to
iterate on while validating that the core + data model actually work
end-to-end.

---

## Data model

- Vault items are encrypted **individually**, not as one vault-wide blob.
  This allows partial sync (update one item without re-touching the rest)
  once sync exists.
- Item types: login (username/password/URL/notes) for v1; secure notes,
  cards, identities, TOTP secrets are later item types (same encryption
  mechanism, different plaintext schema inside).
- Every item has: `id`, `type`, encrypted `content` blob, `nonce`, `version`
  (integer, incremented on every update), `updated_at`, and a `deleted`
  tombstone flag. **Never hard-delete** — tombstone and let sync propagate
  the deletion later.
- Folder/tag/favorite metadata should also be encrypted, not left as
  plaintext server-side fields. Even against your own future server,
  metadata like folder names or item counts is a leakage surface worth
  avoiding from the start.
- Sync conflict handling (for phase 3): version-based optimistic
  concurrency. Client pushes item with known `version`; server rejects if
  its stored version is higher, client resolves. Last-write-wins is
  acceptable for single-user v1; do not over-engineer CRDT-style merging
  now.

---

## Crypto design (current phase: Rust crypto core)

### Key hierarchy

```
Master Password
      │
      ▼ Argon2id (KDF)
Master Key (32 bytes, never leaves device, never transmitted)
      │
      ├──▶ Auth Key       (derived separately, sent to server for login;
      │                    cannot be used to decrypt anything)
      │
      └──▶ Stretched Encryption Key
                  │
                  ▼ wraps/unwraps
            Vault Key (random 32-byte symmetric key, generated once,
                        this is what actually encrypts/decrypts items)
                  │
                  ▼ AEAD (XChaCha20-Poly1305)
            Encrypted Vault Items
```

Rationale for the Vault Key indirection: master password rotation only
requires re-wrapping the Vault Key with a new Stretched Encryption Key, not
re-encrypting every vault item.

### Algorithm choices (confirmed, do not substitute without discussion)

- **KDF:** Argon2id (not PBKDF2/bcrypt) — memory-hard, current OWASP
  recommendation for new designs.
- **AEAD cipher:** XChaCha20-Poly1305 — 24-byte extended nonce makes random
  nonce collisions across many items a non-concern (vs. 12-byte ChaCha20 or
  AES-GCM, which need careful nonce management at scale).
- **Randomness:** OS-backed CSPRNG (`rand` crate, `OsRng` source) for all
  salts and nonces.
- **Memory hygiene:** secret material (`MasterKey`, `VaultKey`, derived
  keys) must implement `Zeroize`/`ZeroizeOnDrop` so key material doesn't
  linger in memory after use.

### Error handling philosophy

Decryption failures (wrong password, tampered ciphertext, wrong key,
truncated data) must all surface as the **same generic error** to callers —
do not let error messages distinguish *why* decryption failed. This avoids
leaking information useful for oracle-style attacks. More specific
diagnostics can exist in client-side logs only, never in what crosses a
trust boundary (e.g. never in what a WASM binding returns to JS, never in
an API response).

### Crate structure (already scaffolded, needs implementation)

Location: this directory (`pw-crypto-core/`). Cargo.toml is already written
with dependencies pinned (argon2, chacha20poly1305, rand, zeroize, serde,
base64, thiserror, optional wasm-bindgen behind a `wasm` feature).

Module responsibilities:

- **`src/error.rs`** — `CryptoError` enum, `Result<T>` alias. Variants:
  `DecryptionFailed`, `KeyDerivationFailed(String)`, `InvalidInput(String)`,
  `Serialization(String)`, `Encoding(String)`. See "Error handling
  philosophy" above for what `DecryptionFailed` must NOT reveal.

- **`src/kdf.rs`** — master password → `MasterKey`.
  - `Argon2Params { memory_kib, iterations, parallelism }` with sane
    defaults (research current OWASP-recommended Argon2id parameters for
    interactive login use — balance security vs. mobile device performance,
    since this will eventually run on phones).
  - `Salt` — 16 bytes, `generate()` via CSPRNG, `from_bytes()`,
    `as_bytes()`.
  - `MasterKey` — 32 bytes, zeroizing, `derive(password, salt, params)`.

- **`src/keys.rs`** — key hierarchy beyond the master key.
  - `derive_auth_key(&MasterKey) -> AuthKey` and
    `derive_stretched_encryption_key(&MasterKey) -> StretchedEncryptionKey`
    — these must be derived such that knowing one gives no advantage in
    computing the other (e.g. HKDF with distinct context/info strings, not
    just truncating/splitting the same output).
  - `VaultKey::generate()` — fresh random 32-byte key, generated once per
    vault, never derived from the password.
  - `wrap_vault_key` / `unwrap_vault_key` — encrypts/decrypts the
    `VaultKey` itself using the `StretchedEncryptionKey`, AEAD, returns/
    consumes a `WrappedVaultKey { ciphertext, nonce }`.

- **`src/vault_item.rs`** — per-item encryption.
  - `EncryptedItem { id, item_type, ciphertext, nonce, version, updated_at,
    deleted }`.
  - `encrypt_item(plaintext_json: &str, &VaultKey) -> Result<EncryptedItem>`
    — caller passes already-serialized item content as JSON; this module
    doesn't need to know about specific item schemas (login vs. note vs.
    card), keeping it generic.
  - `decrypt_item(&EncryptedItem, &VaultKey) -> Result<String>` — returns
    the plaintext JSON string back to the caller for deserialization.

- **`src/wasm.rs`** (feature-gated behind `wasm`) — thin `#[wasm_bindgen]`
  wrappers over the above for the browser extension to call. Keep all real
  logic in the non-WASM modules; this file should just marshal
  JsValue/base64 ⇄ Rust types and call into `kdf`/`keys`/`vault_item`.

- **`src/lib.rs`** — re-exports the public API from the above modules.

### Testing requirements

- Unit tests per module (encrypt→decrypt round trip, wrap→unwrap round
  trip, derive twice with same salt → same key, derive with different salt
  → different key).
- Property-based tests (via `proptest`, already a dev-dependency) for
  encrypt/decrypt round-tripping over arbitrary plaintext inputs.
- A test that confirms tampering with ciphertext bytes causes decryption to
  fail (AEAD authentication working as expected).
- A test that confirms wrong `VaultKey` fails to decrypt an item encrypted
  with a different `VaultKey`.

### Build/verification commands

```bash
cargo build                      # native build
cargo test                       # run unit + property tests
cargo build --features wasm      # verify WASM feature compiles
cargo clippy -- -D warnings      # lint, should be clean
```

(Note: the crate was scaffolded in an environment without a Rust toolchain
available, so `Cargo.toml` and module structure exist but have not yet been
compiled/tested. First build may surface minor dependency version issues —
resolve by checking current crates.io versions if `cargo build` fails on
dependency resolution.)

---

## Phase 6: multi-tenancy and self-hosted distribution

Precondition met: phases 1–3 (crypto core, extension, sync server) are
complete end to end. Full reasoning and the isolation-defect list live in
[MULTI-TENANCY.md](MULTI-TENANCY.md). This section states only the settled
parts.

- **Isolation is unconditional, not a deployment mode.** No
  `single|multi` toggle. A per-vault sequence replaces the current global
  `item_seq`; rate limiting keys authenticated requests by `deviceId`
  rather than IP; each vault gets a storage quota. All three are strict
  improvements to the existing single-user deployment and apply regardless
  of anything else in this phase.
- **Registration is always invite-only**, via an account-creation token —
  never a bare "first account wins" check. A personal server auto-mints one
  bootstrap token on first boot (spent once, then registration is closed
  exactly as it is today); an organization's admin mints more as needed.
  This replaces, and is a strict improvement over, today's
  count-the-`users`-table gate in `AuthService.register`.
- **Admin capabilities, granular rather than one `role` column.**
  `user_capabilities` grants specific capabilities (`manage_invitations`,
  `manage_devices`, `view_audit_log`) rather than an all-or-nothing role.
  None of them are cryptographic access — nothing changes about who can
  read a vault.
- **An audit log** (`audit_log`) records security-relevant events —
  registrations, enrolments and their refusals, revocations, master
  password changes, invitations issued — with a timestamp and which
  account/device they concern, never a credential, token, or key
  material. Source IP is recorded only for refused registration/enrolment
  attempts, the one deliberate exception to this project's "a database
  dump identifies nobody" stance — see SECURITY.md.
- **Recovery: decided, Path A.** No escrow, ever, in any deployment — a
  forgotten master password loses the vault, with no exception for
  organizations. See MULTI-TENANCY.md's "Recovery and escrow" for the
  reasoning kept alongside the decision.
- **Two kinds of invite token, one mechanism.** A device-join token (adds a
  device to a vault that exists — already built) and an account-creation
  token (creates a new vault — new). Both single-use, hashed at rest, short
  expiry, shown as **QR and plaintext** alike. Any already-enrolled device
  may mint a device-join token, not only the extension.
- **Every client app is symmetric.** Extension, mobile, and desktop (once
  it exists) each offer the same two entry points, as two explicit screens:
  "I have an invite" (join this device to an existing vault) and "create a
  new vault" (works unconditionally on a fresh personal server, requires a
  token otherwise). A scanned QR still auto-routes on its embedded kind;
  manual entry doesn't need to, since picking the screen already said which
  one was meant. No app is privileged as "the first device" — that was ever
  only true because the extension shipped first.
- **Administration is a guided CLI**, not a fourth app or a new
  authenticated HTTP surface: `server/src/admin/cli.ts` (`pnpm run admin`;
  `docker compose exec server node dist/admin/cli.js` against a real
  deployment), run with direct database access, in the interactive
  numbered-prompt style of tools like `p10k configure` rather than a
  flag-per-operation script.

## Explicitly deferred (do not build yet)

- Passkey/WebAuthn support
- Password health check / breach checking
- Import from other password managers
- SSO (SAML/OIDC), SCIM provisioning, shared collections — named in
  MULTI-TENANCY.md as things buyers will ask for; none are started, and
  shared collections in particular would need asymmetric primitives this
  project doesn't have (the same ones Path B recovery was declined for).

Multi-user support and self-hosted distribution are no longer on this list —
see Phase 6 above. Item types beyond login (secure notes, cards, identities,
TOTP) were on this list until phases 1–3 were done end to end, which was the
condition originally set for them; they have since been built.
