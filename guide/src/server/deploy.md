# Deploy the server

The server is NestJS and PostgreSQL, run with Docker. The compose file starts
three containers: Postgres, the server, and Caddy, which obtains its own
certificate. Only Caddy is published; Postgres and the server are reachable
only on the internal network.

## Before you start

- A machine with Docker and Docker Compose.
- A domain name pointing at that machine, with ports 80 and 443 reachable.
  Caddy needs both to obtain and renew its certificate.

## Start it

```bash
git clone https://github.com/rustiqz/Vaultiq.git
cd Vaultiq
cp .env.example .env     # set POSTGRES_PASSWORD and VAULTIQ_DOMAIN
docker compose up -d
```

Set `POSTGRES_PASSWORD` to something long and random, and `VAULTIQ_DOMAIN` to
your domain. Keep `.env` private and out of version control.

## Get the first invitation

Registration is invite-only. On a fresh server with no accounts, the server
mints one registration token at boot and writes it to its log:

```bash
docker compose logs server
```

Use that token to create your account from the extension or the Android app.
After that, issue more invitations with the
[admin CLI](administration.md).

## Check that it is running

```bash
curl https://your.domain/health
docker compose logs server | head -1    # vaultiq-server <version> listening on 3000
```

The first line of the log names the running version.

## Things worth knowing

- The server sits behind Caddy and trusts exactly one proxy hop, so rate limits
  and the audit log see real client addresses. Do not put another proxy in
  front without understanding that.
- Each vault is limited to 10,000 items.
- Back up the Postgres volume if you want the server's copy preserved. The
  contents are ciphertext, so a backup of it does not expose your passwords,
  but it is useless without the master password.
- Updating: pull the new version, then `docker compose up -d --build`.
  Migrations run at boot and are safe to repeat.
