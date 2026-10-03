# Autofill and saving logins

## In the browser

When you focus a sign-in field, the extension offers matching logins. A login is
offered only to the site it belongs to. Cards and identities have no site, so
the same card can be used anywhere, but nothing is offered until you focus a
field that asks for it, and no value leaves the background until you pick one
item by hand.

The popup also has a **Fill on this site** action for the active tab.

When you sign in somewhere new, or change a password, the extension offers to
save it.

## On Android

Vaultiq is an Android autofill service for **logins**. Turn it on in system
settings (see [Install the Android app](../install/android.md)).

When a sign-in form appears, Android shows one suggestion, **Fill with
Vaultiq**. Tapping it opens Vaultiq over the form. If the vault is locked you
unlock it first (fingerprint or password). Then you see up to three matches,
each with a **Fill** button, plus **Search vault** and **Save new**.

When you sign in to a new app or site, Android's own "Save to Vaultiq?" prompt
leads to a confirm sheet in Vaultiq.

### Check who is asking

The sheet always shows who requested the fill. For a browser page it shows the
verified website domain. For a native app it shows the app's name and
package, marked **Not a verified website**. A fake app can imitate a login
screen, so read that line before you fill.

## Limits

Identity and card autofill on Android is not built. Autofill never fills into
Vaultiq's own unlock fields.
