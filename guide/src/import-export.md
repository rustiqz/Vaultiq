# Import, backup and restore

## Import

Vaultiq imports from a file you export from another manager or browser.

| Format | What comes across |
|---|---|
| CSV (Chrome, Firefox, Bitwarden, LastPass, 1Password and similar) | Logins and secure notes |
| Bitwarden JSON | Logins, secure notes, cards and identities |
| Proton Pass JSON | Logins and secure notes (trashed items are skipped) |

Rows of any other type are skipped and counted, never guessed at. Authenticator
secrets are not imported from any format.

**Extension:** overflow menu → **Import**. **Android:** **Settings → Import from
file**. Pick the file; Vaultiq detects the format.

You then get a preview list with a checkbox on each row. Vaultiq checks each
row against what is already in your vault:

- An **identical** item is unchecked by default, so a repeat import does not
  clutter the vault.
- An item that looks like the same account but **differs** (a password changed
  since the export, say) is checked by default and imported as a new item. A
  **Replace the existing entry** toggle updates the old one instead. Vaultiq
  never silently overwrites.

> **Delete the export file once you have confirmed the import.** It is plain
> text, with your passwords in it, and it sits outside Vaultiq's control as soon
> as you create it.

Formats are read from their documented structure. If a migration looks wrong,
check the preview before importing, and keep the original manager until you are
sure.

## Backup and restore

An exported backup is a single file holding your wrapped vault key and every
item, all still encrypted. It is the only way to get a local-only vault off the
device, so make one regularly.

- **Export:** the extension's overflow menu → **Export backup**; Android
  **Settings → Export backup**. Trashed items are included.
- **Restore:** the extension's welcome screen → **Restore backup**; Android's
  first screen → **Restore**. You enter the backup's master password, which is
  checked before anything is written.

Things to know:

- A backup needs the master password it was made under. A backup does not
  rescue a forgotten password.
- A backup file is not encrypted a second time, because every field in it is
  already ciphertext or a wrapped key. Anyone holding the file can try to guess
  the master password offline, so store it as carefully as the vault itself, and
  choose a long password.
- On Android, exporting a server-backed vault first syncs, so it needs a
  connection. A local-only vault exports straight from the device.
- Restoring on Android always creates a **local-only** vault, even if the backup
  came from a server-backed one.
- Restoring in the extension needs an empty profile: it refuses to overwrite an
  existing vault.
