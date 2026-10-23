# Password generator

Vaultiq can make a password or a passphrase for you. It needs no unlocked
vault, and nothing it makes is stored: copy it, or let autofill use it, and it
is gone.

- **Extension:** overflow menu → **Password generator**, or **Settings →
  Tools** in the settings tab. On a sign-up form the autofill picker also
  offers a suggested password.
- **Android:** the round button at the bottom right of the Vault tab.

Everything is generated in the shared Rust core, from the operating system's
random number generator. The options only choose what it may contain.

## Password

- **Length**, 8 to 64 characters.
- **Types:** lowercase, uppercase, numbers and symbols. At least one stays on,
  and every type that is on appears at least once.
- **Avoid look-alike characters** leaves out `0 O o 1 l I`, for a password you
  will read off a screen or copy from paper. It costs about a third of a bit
  per character.

The strength shown is an estimate from the password's shape.

## Passphrase

Random words from the
[EFF long word list](https://www.eff.org/dice) (7,776 words), which are easier
to read, type and remember than a random string of the same strength.

- **Words**, 3 to 12.
- **Separator:** hyphen, space, period, underscore, comma or none.
- **Capitalize each word** changes how it looks, not how strong it is.
- **Add a number** puts one random digit on one random word.

Each word adds about 12.9 bits, so six words is about 77 bits. The figure shown
is exact, because it is a property of how the words were drawn. Six words is
plenty for most accounts; use eight or more for a master password.

The settings are remembered on the device. Nothing in them is secret.
