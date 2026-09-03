# Threat model

What Vaultiq defends against, what it does not, and why. Written to be read
before trusting it with anything — including by the person who wrote it, later,
when the reasoning has faded.

The design is in [PROJECT.md](PROJECT.md); the rules the code is held to are in
[CLAUDE.md](CLAUDE.md). This file is the claim those two are trying to make
true.

---

## What is being protected

Vault items — usernames, passwords, URLs, notes — and the metadata around them:
item names, how many there are, which sites they belong to, when they were
used. All of it is content, and all of it is encrypted. Nothing about an item
is stored in the clear anywhere, including on the server.

The master password protects everything and is stored nowhere. It is not
recoverable, by anyone, by any route. That is the point, and it is also the
sharpest edge in the design: **lose the master password and the vault is
gone.**

---

## The key hierarchy, and where each secret lives

```
Master password ──Argon2id(salt, 64 MiB, t=3, p=4)──▶ Master key
                                                          │
                        ┌──HKDF-SHA256 "vaultiq:v1:auth-key"──▶ Auth key
                        │                                       (leaves the device)
                        └──HKDF-SHA256 "vaultiq:v1:stretched-encryption-key"
                                                          │
                                                          ▼ XChaCha20-Poly1305
                                                     Vault key ──▶ items
```

| Secret | Where it exists | Lifetime |
|---|---|---|
| Master password | The user's head, and one form field | The keystroke |
| Master key | wasm linear memory | Freed as soon as the operation that needed it ends |
| Auth key | wasm memory, then over TLS to the server | One request |
| Stretched key | wasm memory | The wrap or unwrap that needed it |
| Vault key | wasm memory, plus `storage.session` | Until lock, or the browser closes |
| Wrapped vault key | IndexedDB, and the server's `vaults` row | Permanent |
| Item ciphertext | IndexedDB, and the server's `items` rows | Permanent |
| Device credential | Encrypted under the vault key in `storage.local` | Until revoked |

The two HKDF `info` strings are what make the auth key useless for decryption:
the key that goes to the server and the key that unwraps the vault come from
the same master key under different, versioned contexts — never from splitting
or truncating one output.

Secrets never reach JavaScript as values. The wasm layer hands back opaque
handles into linear memory, and `ZeroizeOnDrop` scrubs each one when it is
freed. The single exception is documented at `VaultKeyHandle::exportForSessionStorage`:
the vault key is exported, base64, into `storage.session` — held in memory,
never written to disk — because a Manifest V3 background context is suspended
when idle and would otherwise lose the key several times an hour.

---

## Defended against

**A fully compromised server.** The server stores ciphertext plus the fields
needed to address it, and those fields are exactly the ones bound into each
item's authentication tag. It never sees a master password, a vault key, or a
plaintext byte. Taking the server yields an encrypted vault and an Argon2id
hash of an auth key that decrypts nothing.

**Ciphertext at rest, taken from anywhere.** A stolen disk, a database dump, a
backup, an intercepted sync payload: all the same thing, all XChaCha20-Poly1305
under a 256-bit random vault key that was never derived from the password.

**Tampering with stored blobs.** Every item binds its format, id, type,
version and tombstone flag into the AEAD's associated data. A server that moves
one item's ciphertext onto another item's id, relabels its type, rolls its
version back to restore an old password, or flips a deletion, produces a record
that fails to authenticate rather than one that decrypts as something else.
Wrapped vault keys bind their own domain string and version the same way.

**A decryption oracle.** Wrong password, wrong key, tampered ciphertext,
tampered nonce, altered associated data and truncated input are one
indistinguishable `DecryptionFailed`, with one rendered message, all the way
out through the wasm boundary. This is asserted by a test, not assumed.

**A stolen device credential.** It authenticates to the server but decrypts
nothing, and it cannot change the master password — that needs the current auth
key, which only the password produces. Credentials are stored encrypted under
the vault key, so a stolen disk yields no working one, and any device can be
revoked from any other.

**An enrolment token on its own.** Joining a server needs both a token from an
already-trusted device and the auth key. A token found on a screen pulls
nothing; a master password without a token adds no device. Tokens are stored as
SHA-256 fingerprints, expire in fifteen minutes, are spent once, and are all
invalidated when the master password changes.

**Online guessing.** Registration, enrolment and password change are rate
limited, and every route sits under a global floor. The auth key is verified
with Argon2id, so even a leaked hash is not cheaply searchable.

**A page trying to read the vault.** The content script is handed names, not
values: a list to draw a picker from, with no password, card number or
authenticator secret in it. Values cross into the page one item at a time,
after a click, and never on page load.

A login can be asked for only by the tab's own site, as the *browser* reports
it —
never a site the page names for itself. The site is the registrable domain,
computed with the Public Suffix List including private suffixes: so
`google.com.attacker.test` does not match `google.com`, and `foo.github.io`
does not match `bar.github.io`. Subdomains of one registrable domain *do* share
a scope — `www.example.com` and `account.example.com` are one site.

**Cards, identities and codes on a hostile page.** These have no site to be
scoped to — the same card is used at every shop — so site matching cannot
protect them, and this is stated plainly rather than implied. What protects
them instead is that nothing is offered unless the user focuses a field
declaring itself as that kind, nothing is filled without a click on a named
item, and a fill writes only into the section of the form the focused field
belongs to. A page can therefore ask to be *shown* a picker; it cannot obtain
anything from one without the person at the keyboard choosing an item.

**A short PIN.** Quick unlock wraps the vault key under a PIN-derived key and
keeps it in `storage.session` only. Thirteen bits of PIN would fall to an
offline search in minutes — so there is nothing offline to attack. Closing the
browser ends it, and five wrong guesses tear it down.

---

## Not defended against

**A compromised client.** Malware on the device, a keylogger, a hostile
extension with the same permissions, a screen recorder: all of these see the
master password as it is typed, or the plaintext after it is decrypted. No
client-side encryption survives a compromised client, and nothing here pretends
otherwise.

**A weak master password.** The wrapped vault key, its salt and its Argon2
parameters are all stored on the server, and every device holds a copy. Anyone
with that row can guess passwords offline at Argon2id cost — 64 MiB and three
iterations per guess, which buys a great deal against a passphrase and very
little against `summer2024`. This is inherent to a zero-knowledge vault. The
master password is the whole security of the system.

**Availability, against a hostile server.** A compromised server can refuse to
answer, withhold items, or serve a vault record that no password opens. Devices
adopt the server's vault record on sync — that is how a password change
propagates — and the record cannot be verified without a password nobody has
typed at that moment. So a hostile server can lock a device out of its own
local copy. It learns nothing by doing so; what is checked before adopting is
that the record is well formed and its Argon2 costs have not been lowered,
since a weakened derivation is the one substitution that would still open.

**Traffic analysis.** The server sees how many items exist, how large each
ciphertext is, when each one changed, how many devices there are, and when each
syncs. It cannot read any of it, but the shape is visible. Padding item
ciphertext to a fixed size is a plausible future change; it is not done today.

**Memory on an unlocked device.** While the vault is unlocked, the vault key is
in `storage.session` and in wasm memory. Anyone who can read the process's
memory has it — but they already have everything else on that machine too.

**Losing the master password.** There is no recovery, no reset, no escrow, no
backdoor. This is a design decision, not an oversight.

**The supply chain.** Dependencies are pinned to exact versions, kept minimal,
preferred from RustCrypto, and checked weekly against the RustSec advisory
database. That reduces the surface; it does not eliminate it. The browser and
its extension APIs are trusted absolutely.

**Other users.** There is exactly one account per server and no sharing. Nothing
here has been designed to hold up between mutually distrusting users, and it
should not be assumed to.

---

## What keeps this true

The properties above are not aspirations; most of them are pinned by tests, and
the rest by rules the code is reviewed against:

- Known-answer vectors cross-computed with OpenSSL and libsodium, so a refactor
  cannot silently change a derivation.
- Tamper tests over every byte of ciphertext, nonce and tag, asserting one
  identical error for every failure mode.
- Property tests over arbitrary plaintext, including empty and large input.
- `#![forbid(unsafe_code)]`, no panics in library code, no `Debug` or
  `Serialize` derived on any secret type, constant-time comparison for anything
  derived from one.
- Database tests against a real PostgreSQL, because the single-account
  constraint, the token lock and the revocation filter live in SQL.

See [CLAUDE.md](CLAUDE.md) §2 and §4 for the rules in full.

---

## Reporting something

This is a personal, single-user project with no public deployment. If you have
found something anyway, open an issue describing the class of problem — not a
working exploit — or contact the repository owner directly.
