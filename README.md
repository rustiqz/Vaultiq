# Vaultiq

A personal, zero-knowledge password manager. Everything is encrypted and
decrypted on the client; the server stores ciphertext and the few fields
needed to address it, and holds nothing that could decrypt any of it.

See [PROJECT.md](PROJECT.md) for the design, [SECURITY.md](SECURITY.md) for what
it does and does not defend against, and [CLAUDE.md](CLAUDE.md) for the rules
the code is held to.

```
pw-crypto-core/   Rust. Every cryptographic decision lives here. Compiles
                  natively and to WebAssembly.
extension/        Browser extension (Manifest V3) for Firefox and Chrome. Vault UI
                  and autofill.
server/           NestJS + PostgreSQL sync server.
```

## Prerequisites

| | Version used | Notes |
|---|---|---|
| Rust | 1.98 | plus the `wasm32-unknown-unknown` target (`rust-wasm` on Arch) |
| Node | 24 | |
| pnpm | 11.3 | |
| wasm-pack | any | builds the browser bundle and runs the browser tests |
| Docker | any | for Postgres, and for the deployment |

Enable the local git hooks once after cloning — they stand in for branch
protection, which GitHub gates behind a paid plan for private repositories:

```bash
git config core.hooksPath .githooks
```

## The crypto core

```bash
cargo test                                    # 102 unit tests
cargo clippy --all-targets -- -D warnings
cargo fmt --check
cargo build --features wasm                   # the wasm feature must compile
cargo audit
```

The bindings are tested in a real browser, not on the host: `SysRng` resolves
to a different backend there, so a host test cannot tell whether
`Crypto.getRandomValues` is actually reachable.

```bash
cd pw-crypto-core
wasm-pack test --headless --firefox -- --features wasm    # 18 tests
```

Run it from inside the crate rather than passing its path — given a path
argument, wasm-pack silently drops the trailing cargo arguments and the build
then fails for want of the `wasm` feature.

## The extension

```bash
cd extension
pnpm install
pnpm run build      # builds the wasm package, then bundles into dist/
pnpm test           # 273 tests
pnpm run typecheck
pnpm run lint
```

One build runs in both browsers: the manifest carries `background.scripts`
for Firefox and `background.service_worker` for Chrome, and each ignores the
other. To load it:

- **Firefox**: `pnpm run dev` rebuilds on change and launches Firefox with the
  extension installed. By hand, open `about:debugging` → **This Firefox** →
  **Load Temporary Add-on** and pick `extension/dist/manifest.json`.
- **Chrome** (and other Chromium browsers): `pnpm run dev:chrome` does the same
  with Chrome. By hand, open `chrome://extensions`, turn on **Developer mode**,
  **Load unpacked**, and pick `extension/dist/`. Set `CHROME_PATH` if Chrome
  is not in a standard location.

There is a manual test page at `extension/testbed/index.html` with fourteen
cases for exercising autofill without registering anywhere real: sign-in,
sign-up with confirmation, a change-password form, honeypot and disabled
fields, two forms on one page, a form rendered late, one that submits by XHR
with no form event, one each inside an iframe and a closed shadow root, a
checkout form that declares its fields and one that does not, billing and
shipping in a single form, and a one-time code box.

## The server

The tests run against a real PostgreSQL, because half of what they cover lives
in SQL: the single-account constraint, the enrolment token lock, the
revocation filter. **Without `DATABASE_URL` they skip rather than fail**, so
check the count if you expect them to run.

```bash
docker run -d --name vaultiq-test-db \
  -e POSTGRES_PASSWORD=test -e POSTGRES_USER=vaultiq -e POSTGRES_DB=vaultiq \
  -p 5433:5432 postgres:17-alpine

cd server
pnpm install
export DATABASE_URL="postgres://vaultiq:test@127.0.0.1:5433/vaultiq"
pnpm run migrate    # migrations are idempotent; they also run at boot
pnpm test           # 45 tests
pnpm run dev        # http://localhost:3000
curl localhost:3000/health
```

Test files run one at a time, not in parallel: they share one database and
would otherwise clear each other's rows mid-test.

## Deploying it

```bash
cp .env.example .env     # set POSTGRES_PASSWORD and VAULTIQ_DOMAIN
docker compose up -d
```

Postgres publishes no ports — it exists only on the internal network, so there
is nothing to reach from outside. Caddy obtains its own certificate for
`VAULTIQ_DOMAIN`, which must already point at the machine.

To see which build is running, read the first line of the server's log:

```bash
docker compose logs server | head -1    # vaultiq-server 0.19.0 listening on 3000
```

There is also `GET /version`, but it sits behind the device guard rather than
beside `/health`. `/health` has to be reachable by a container runtime, and an
exact build number on an unauthenticated endpoint tells anyone who finds the
domain which advisories apply to it.

## Connecting the two

1. In the extension popup, create a vault and unlock it.
2. Under **Sync**, enter the server address, name the device, and choose
   **Set up a new server**. This uploads the vault as it stands, and the
   server accepts exactly one account for its whole life.
3. On a second device, use **Add a device** on the first to mint a token,
   then **Join with a token** on the second. Enrolment needs both the token
   and the master password — either alone is not enough.

Sync runs on unlock and shortly after any change. There is no periodic
background sync: it would mean keeping the vault key alive on a timer.

## What a vault holds

Five item types, all encrypted the same way and told apart by a field in the
record header — which is bound into each item's authentication tag, so a
server cannot relabel one:

| Type | What it is | Autofills |
|---|---|---|
| Login | Username, password, site | Yes, on its own site only |
| Card | Cardholder, number, expiry, security code, optional PIN | Yes, anywhere |
| Identity | Name, company, email, phone, address, date of birth, national ID | Yes, anywhere |
| Authenticator | A TOTP secret and the shape of its codes | Yes, into a one-time-code field |
| Secure note | A name and free text | No — no field on any page is a note |

A login is offered only to the site it belongs to. The other types have no
site — the same card is used at every shop — so what protects them is that
nothing is ever offered without the user focusing a field that asks for it,
and no value leaves the background until they pick one item by hand. The
content script is handed names only, never values.

Authenticator accounts accept the `otpauth://` link an issuer prints beside
its QR code, which carries the algorithm, digit count and period that a
hand-typed secret leaves to guesswork. Codes are computed in the Rust core
against RFC 6238's own published vectors, so every client agrees.

## Changing the master password

Under **Settings → Master password**. The vault key is unwrapped with the old
password and wrapped again with the new one, so no item is re-encrypted and
nothing has to re-sync — a rotation rewrites one record whatever the vault
holds. It also moves to a fresh salt and to today's Argon2 costs, which is how
a vault created years ago stops using that year's parameters.

Connected to a server, the server is written first and the local record second.
That order is deliberate: the server holds the record every other device reads,
so a half-applied change leaves this device still opening with the old password
and adopting the new record on its next sync. The other order would leave this
device on a password the server had never heard of.

Other devices pick the change up when they next sync — the vault key is
unchanged, so they keep syncing throughout and simply need the new password at
their next unlock. Outstanding enrolment tokens are spent by the change.

There is no way back and no recovery: the old password then opens nothing,
anywhere.

## Before committing

```bash
cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
cargo build --features wasm && cargo audit
(cd extension && pnpm run typecheck && pnpm run lint && pnpm test)
(cd server && pnpm run typecheck && pnpm run lint && pnpm test)
```

Version numbers are never edited by hand — git-cliff derives them from the
commit subjects, so a malformed subject produces the wrong release rather than
a style complaint. The mapping is in [CLAUDE.md §8.2](CLAUDE.md).
