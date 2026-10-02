# What Vaultiq protects, and what it does not

This is the short version for users. The full threat model, including the key
hierarchy and every scenario, is
[SECURITY.md](https://github.com/rustiqz/Vaultiq/blob/main/SECURITY.md).

## How it works, briefly

Your master password is stretched with **Argon2id** into a master key. Two
independent keys are derived from it with HKDF: an **auth key**, the only thing
that ever leaves your device, and an **encryption key** that wraps a random
**vault key**. Items are encrypted under the vault key with
**XChaCha20-Poly1305**, with each item's id and version bound in so a ciphertext
cannot be swapped for another.

The server never sees the master password, the master key or the vault key. The
cryptography lives in one Rust core shared by every client, which makes no
network calls.

## Defended against

- **A compromised or curious server.** It holds only ciphertext and a wrapped
  key.
- **A stolen database or backup file.** Useless without the master password.
- **Tampered or swapped ciphertext.** It fails authentication instead of
  decrypting.
- **Network eavesdropping.** Beyond TLS, the contents are already encrypted.

## Not defended against

- **A compromised device.** Malware or an attacker who can read the app's memory
  while it is unlocked sees what you see.
- **A keylogger,** or someone watching you type the master password.
- **A weak master password.** Argon2id slows guessing; it cannot stop a guessable
  password being guessed.
- **Metadata the server must see:** how many items you have, their sizes and when
  you sync.
- **You forgetting the master password.** There is no recovery and no escrow.
- **Phishing and fake apps** that fool you into filling a password. Autofill
  shows who is asking on Android; read it.

## Be honest about the maturity

Vaultiq has **not been independently audited.** One person wrote it. If that
matters for what you store, use a product that has been audited.

## Report a vulnerability

Do not open a public issue. Follow the private reporting steps in
[SECURITY.md](https://github.com/rustiqz/Vaultiq/blob/main/SECURITY.md#reporting-a-vulnerability).
