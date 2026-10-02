# Items and what they hold

A vault holds five types of item. All are encrypted the same way, and the type
is bound into each item's authentication tag, so a server cannot relabel one.

| Type | What it holds | Autofills |
|---|---|---|
| Login | Username, password, site | Yes, on its own site only |
| Card | Cardholder, number, expiry, security code, optional PIN | Yes (extension) |
| Identity | Name, company, email, phone, address, date of birth, national ID | Yes (extension) |
| Authenticator | A TOTP secret and the shape of its codes | Yes, into a one-time-code field (extension) |
| Secure note | A name and free text | No |

## Creating and editing

Use the **New item** button (the extension's header, or **+** on Android's
Vault screen) and pick a type. The same form edits an existing item. Fields you
use every time are always shown; the rest start as add-chips and become fields
once tapped.

Every change is stored as a new encrypted version of the item. Nothing is
modified in place.

## Deleting

Deleting moves an item to **Trash**, where it can be restored. Emptying it, or
purging one item, is permanent: the content is replaced and cannot be recovered.

## Copying secrets

Copy buttons put a value on the clipboard. On Android the clipboard is cleared
after 30 seconds, but only if nothing else was copied in the meantime.

## Favorites and sorting (Android)

Tap the heart on an item to favorite it. The Vault list sorts last-used first by
default, and that history stays on the device.

## The Android layout

The bottom tabs are **Vault** (logins, with tiles for Cards, Identities and
Notes), **Codes** (live authenticator codes) and **Settings**.
