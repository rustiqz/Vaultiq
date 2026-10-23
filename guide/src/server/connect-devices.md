# Connect your devices

## First device

In the extension, create a vault and unlock it. Open **Sync**, enter the
server address, name the device, and choose **Set up a new server**. This uploads
the vault as it stands. Registration needs an invitation token: a fresh server
logs one at first boot, and the [admin CLI](administration.md) issues more.

On Android you can instead choose **Create a vault** on the first screen, which
generates the vault on the phone and registers it with the token.

## Adding a second device

Enrolment needs **both** a token and the master password. Either alone is not
enough.

1. On a device that already has the vault, choose **Add a device** (extension)
   or **Invite a device** (Android **Settings**). A QR code appears.
2. On the new device, choose **Join with a token** (extension) or **Join**
   (Android) and scan the QR code, or paste the token. The QR carries only the
   server address and the single-use token, never the master password.
3. Enter the master password on the new device.

Tokens are single-use and expire after a short time. If one expires, make
another.

## When sync happens

Sync runs when you unlock and shortly after any change. It also looks for
changes from your other devices on a timer, but only while the vault is already
unlocked:

- **Extension:** every five minutes. It does not count as using the vault, so it
  never delays auto-lock, and while the vault is locked it does nothing.
- **Android:** when you return to the app, and every five minutes while it stays
  open in front. Open lists refresh by themselves when something new arrives.
  Nothing runs in the background, so a change made on another device appears
  the next time you open the app.

There is no sync while locked, because the credential for the server is sealed
under the vault key, so a timer cannot keep anything alive that you have locked.

Edits made on two devices at once are never silently overwritten: the extension
keeps both copies of a conflicting item. On Android a conflicting save is
refused with a message, and nothing is lost.

## Moving a local vault onto a server

In the extension, a local vault can be connected to a new server and uploads
as-is, unless **Never sync this vault** is on. On Android there is no
conversion: restore a backup or re-create the items.

## Changing the master password

**Settings → Master password**, in either app. Items are not re-encrypted, so
nothing re-syncs. Other devices keep syncing and ask for the new password at
their next unlock. Outstanding device tokens are spent by the change. There is no
way back to the old password.
