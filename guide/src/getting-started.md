# Choose how to use Vaultiq

You pick one of two modes when you create a vault. Read both before choosing,
because the choice is hard to change later.

## Local only: no server at all

The vault lives on one device. Nothing syncs and nothing listens on a port.

- Pick **Use without a server** when creating the vault (in the extension, the
  **Create your vault** screen; on Android, the same option on the first screen).
- Losing the device loses the vault, so keep an
  [encrypted backup](import-export.md).
- In the extension, turning on **Never sync this vault** in Settings makes this
  permanent: the extension then refuses to connect to any server.
- On Android there is no way to convert a local vault into a server-backed one.
  The extension can upload a local vault to a new server; see
  [Connect your devices](server/connect-devices.md).

## Self-hosted sync

You run the Vaultiq server (Docker, PostgreSQL and Caddy). Your devices sync
through it. Choose this if you want the same vault on a laptop and a phone.

- The server holds sealed items and a wrapped key. It never holds the keys that
  open them. It can still see how many items you have, their sizes and when you
  sync.
- Registration is invite-only, so a stranger who finds your domain cannot
  create an account.
- You need a machine with Docker and a domain name that points at it.

Follow [Deploy the server](server/deploy.md) first, then install the apps.

## Pick a master password

Choose a long one and use it nowhere else. It is the only thing between an
attacker and your vault if they get a copy of your data. Vaultiq cannot recover
or reset it, and nobody else can.
