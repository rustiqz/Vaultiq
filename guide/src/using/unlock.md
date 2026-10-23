# Unlocking and locking

Your master password unlocks the vault. Everything else here is a convenience
layered on top.

## Auto-lock

Both apps lock after a period of inactivity. The default is 15 minutes.

- **Extension:** choose 5, 15 or 30 minutes, 1, 4, 8 or 24 hours, or never,
  under **Settings → Security**. A longer time is more convenient but leaves the
  vault open for longer if you step away. A locked vault drops the keys from
  memory, and the vault always locks when the browser closes.
- **Android:** choose 1, 5, 15 or 30 minutes, or never, in **Settings →
  Auto-lock**. The timer runs while the app is in the foreground; if Android
  kills the app in the background the key is gone anyway.

## PIN (extension)

A PIN lets you unlock the extension without typing the master password. It is
**session-only**: it lasts until the browser closes, after which you need the
master password again.

Manage it under **Settings → Security → Quick unlock**. The card says whether a
PIN is set, and lets you set, change or remove it. A PIN is at least four
digits, and you type it twice so a slip does not leave you with one you cannot
enter.

- **Locking on idle keeps it.** After the auto-lock time the vault locks and
  asks for the PIN.
- **Locking by hand removes it.** The **Lock vault** button also forgets the
  PIN, so the next unlock needs the master password.
- **Five wrong tries remove it.** The card shows how many are left once you have
  used any. After that only the master password works.

The PIN is held in memory only, never written to disk. That is what makes a
short PIN safe to use: there is nothing stored for an attacker to guess
offline.

## Fingerprint (Android)

After one password unlock, enable fingerprint unlock in **Settings**. Your
master password is then cached encrypted under a key in the Android Keystore
that needs your fingerprint for every single use. A fingerprint cannot derive
your key by itself; it only releases the cached password.

If you add or remove a fingerprint on the device, the key is invalidated and
Vaultiq asks for the master password again. That is intended: a newly added
fingerprint must not inherit access.

## Changing the master password

**Settings → Master password**, in either app. You need the current password.
No items are re-encrypted. If a server is connected, it is updated first, then
the local copy. There is no way back and no recovery.

## Theme

Both apps follow the system light or dark setting. Android also has a manual
override (System, Light or Dark) in **Settings**.
