# Troubleshooting and FAQ

## Questions

**What if I forget my master password?**
The vault stays locked. Nothing can reset it, because nobody can read the vault,
you included. Backups do not help: they still need the master password.

**Can the server operator read my passwords?**
No. The server holds sealed items and a wrapped key, never the keys to open
them. It can see how many items you have, their sizes and when you sync.

**Does it phone home?**
No telemetry, analytics or update checks. The crypto core makes no network calls
at all, and the apps talk only to the server you point them at, if any.

**Can several people share one server?**
Yes, by invitation. Each person has a separate vault the others cannot read.
Sharing items between people is not built.

**Can I move from local-only to a server later?**
In the extension, yes, unless **Never sync this vault** is on. On Android there
is no conversion.

**Is there an iOS app?**
No. Today it is Firefox, Chrome and Android.

**Is it free?**
Yes. It is licensed under the AGPL-3.0. There is no hosted service; you run the
server yourself.

## Troubleshooting

**Registration is refused.**
You need a valid, unspent registration token. A fresh server logs one at boot
(`docker compose logs server`); the [admin CLI](server/administration.md) mints
more. Tokens expire.

**Joining a device fails.**
A device-join token is single-use and short-lived, and enrolment also needs the
master password. Make a new one with **Add a device**.

**The server certificate is not issued.**
Caddy needs `VAULTIQ_DOMAIN` to resolve to the machine and ports 80 and 443 to
be reachable. Check `docker compose logs caddy`.

**A version conflict appears when saving.**
Another device saved the item first. In the extension both copies are kept; on
Android reload and re-apply your edit.

**Firefox removed the extension.**
Temporary add-ons are removed on restart. Load it again from `about:debugging`.

**Autofill does not appear on Android.**
Check that Vaultiq is selected as the autofill service in system settings, and
that the form has a username and password field. Detection relies on the
field hints the app or browser provides, so a few older forms are missed.

**Fingerprint unlock asks for the password.**
The device's enrolled fingerprints changed, which invalidates the cached
password on purpose. Unlock once with the master password and turn fingerprint
unlock on again.

**Still stuck?**
Open an [issue](https://github.com/rustiqz/Vaultiq/issues). Support is best
effort, and a vulnerability goes through
[SECURITY.md](https://github.com/rustiqz/Vaultiq/blob/main/SECURITY.md), not an
issue.
