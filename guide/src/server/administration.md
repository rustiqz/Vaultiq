# Invitations, users and devices

Administration is a terminal wizard that runs inside the server container. It
has no web interface and no HTTP surface, so there is nothing to expose.

```bash
docker compose exec server node dist/admin/cli.js
```

An administrator can issue invitations and revoke devices. An administrator
**cannot read anyone's vault**: the server never has the keys.

## What the menu does

| Entry | What it does |
|---|---|
| Invite someone | Creates a single-use registration token. You choose how long it stays valid (1 hour, 24 hours or 7 days) and which capabilities the new account gets. The token is shown as text and as a QR code. |
| List users and devices | Shows every account and the devices enrolled on it. |
| List outstanding invitations | Shows tokens that have been issued and not yet used or expired. |
| Revoke a user | Revokes every device on the account and spends its outstanding device-join tokens. |
| View audit log | Shows the security event history. |
| Prune audit log | Deletes audit entries older than a number of days you choose. Retention is manual. |
| Recover a locked-out account | Present but does nothing. See below. |

## Capabilities

Accounts can carry capabilities that describe what an administrator may do:
manage invitations, manage devices, view the audit log. They are granular, not
all-or-nothing.

## The audit log

The log records registrations and enrolments (including refusals), device
revocations, master password changes and invitations issued. It never records a
credential, token or key. Source IP addresses are recorded only for refused
registrations and enrolments, so abuse can be traced.

## Locked out? There is no recovery

If someone forgets their master password, nobody can recover their vault. The
server holds no copy of the key and there is deliberately no escrow. The
"Recover a locked-out account" entry exists so that its absence is not mistaken
for a missing feature. The only way out is an
[encrypted backup](../import-export.md) plus the password that opens it.

## Revoking a single device

Users can revoke their own devices from the app: the device list in **Settings** on
Android, and in the extension's Settings.
