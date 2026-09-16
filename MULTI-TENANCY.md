# Multi-tenancy, invitations, and self-hosted distribution

What it takes for Vaultiq to serve more than one person — a self-hoster
running it for themselves, or an organization running it for a group of
people with administrators — and in what order. This is the source of record
referenced by PROJECT.md's Phase 5; where the two disagree, fix PROJECT.md,
since that's the settled design and this is the reasoning behind it.

Nothing in this document is built yet. It exists so the decision is made
against something concrete, and so the parts that are cheap stay visibly
separate from the one part that isn't.

---

## Three things worth knowing before any of the rest

1. **The schema is already multi-tenant.** `vaults.user_id unique`, every
   `items` row keyed by `(vault_id, item_id)`, every query in
   `sync.service.ts` scoped to `vaultId` via `DeviceGuard`. The only thing
   holding the server to one account is a single count-check in
   `AuthService.register` (`server/src/auth/auth.service.ts:67`). The model
   was never narrowed to fit single-user; it was built this way and gated
   shut.
2. **A `single|multi` deployment-mode toggle is the wrong shape.** Isolation
   should be unconditionally correct in every deployment — a personal
   server's security should not depend on a flag nobody flips, and a flag
   nobody flips is also a flag nobody tests. The only thing that genuinely
   differs between a personal server and an organization's is *who is
   allowed to register*, and that's one extension point, not a mode.
3. **Vault recovery was the hard decision, not multi-tenancy — decided:
   Path A, no escrow, ever.** Adding accounts is plumbing. Letting an
   organization recover an employee's vault would have meant escrowing the
   vault key, changing what "zero-knowledge" means for that deployment —
   see [Recovery and escrow](#recovery-and-escrow) for the reasoning kept
   alongside the decision.

---

## Two kinds of token, not one

Today `enrollment_tokens` does one job: adding a *device* to a vault that
already exists. `POST devices/enrollment-token` already requires no
particular caller device type — any enrolled device can mint one, behind
`DeviceGuard`, which is a detail worth stating plainly since it means the
server side of "any device can invite another device" already exists. What's
missing is a second job — creating a *new* vault on a server that isn't
handing out accounts to anyone who asks — and UI parity so every client can
do both jobs, not just the extension.

| | Device-join token | Account-creation token |
|---|---|---|
| Purpose | Add a device to a vault that exists | Create a brand-new vault (= a new `users` row) |
| Minted by | Any already-enrolled device on that vault | An admin (or the server itself, once, on first boot) |
| Scoped to | The vault being joined | Nothing yet — no vault exists until it's spent |
| Exists today | Yes — `enrollment_tokens`, `POST devices/enrollment-token` | No |

Proposal: extend the existing `enrollment_tokens` table with a `kind`
column (`'device_join' | 'account_create'`) rather than a second table —
both rows are "a hashed, single-use, expiring bearer secret," and splitting
them into two tables would duplicate the expiry/spend/hash logic for no
isolation benefit. An account-creation row additionally carries
`grants_capabilities` (an array — see
[Work item 4](#work-item-4--admin-capabilities-and-an-audit-log); an empty
array grants a plain member), decided by whoever issues it.

**Bootstrap, for a personal or fresh server:** on first boot, if `users` is
empty, the server mints one account-creation token granting every
capability and logs it — the pattern Vaultwarden and Gitea both use. A solo
self-hoster spends it once and never sees another; the behavior is identical
to today's single-account server, just reached through the same mechanism an
org uses, rather than a special case.

**For an organization:** an admin issues account-creation tokens through the
CLI (below) as new people need to be onboarded, choosing which capabilities
each invitation grants — none, by default, for a plain member.

### The invite payload, unified

`extension/src/lib/enrollment-qr.ts` already produces
`vaultiq://enroll?server=...&token=...`, scanned by mobile's Join Vault flow.
Both token kinds reuse this, with an explicit `kind` parameter added
(`device` | `account`).

Built simpler than first planned here: no server round trip to ask "what is
this token for." Manual paste/type stays two explicit screens — "I have an
invite" (join) and "Create a new vault" — so the user's own choice of screen
already says which kind they mean, the same way it already worked before
this phase. `kind` in the QR exists only to auto-route a *scan*, since
scanning skips that choice: each screen's scanner checks the embedded kind
and rejects a mismatch (scan a `kind=account` invite on the join screen, get
"not a Vaultiq enrollment invite," not a wrong-flow attempt). A `kind` the
client got wrong or a forged one costs nothing beyond that UX bounce — the
server independently enforces kind on every route regardless
(`register` only accepts `account_create`, `enroll`/`enrollment-params` only
`device_join`, per Work Item 2), so `kind` is a routing hint, not a trust
decision, and there is no oracle worth building just to double-check it
before showing a screen.

Whatever a client shows or accepts, it does so as **both QR and plaintext**,
since a QR that can't be read out loud or typed on a device with no camera
isn't an accessible invite.

---

## Work item 1 — isolation defects

Worth doing regardless of anything else below: these are latent bugs a
single-tenant deployment can't trigger, not new capabilities.

**1a — `item_seq` is one global sequence across every vault.**
(`server/migrations/001_initial.sql:75,83`) Sound with one vault: a sequence
gives a stable "everything after N" cursor without relying on skewed clocks.
With several vaults it becomes a cross-tenant side channel — the size of the
gaps in your own sequence numbers reports how much other tenants wrote in the
interval. Fix: a per-vault counter (e.g. `vaults.next_seq`, advanced in the
same transaction as the write) so the cursor keeps its monotonicity without
leaking across tenants. Data-affecting; needs a migration.

**1b — rate limiting is per-IP and global.**
(`server/src/app.module.ts:17`, 120 req/min) Correct for one person. An
organization's employees sit behind one corporate NAT and share the bucket —
the busiest office rate-limits itself, indistinguishable from a bug. Raising
the ceiling instead weakens the one thing throttling offline... rather,
*online* guesses at the auth key, which the comment beside it is right to
call out. Fix: key authenticated requests by `deviceId`; keep a tight IP
limit only on the unauthenticated routes (`register`, `enrollment-params`,
`enroll`) where the caller has no identity yet.

**1c — no per-vault quota.** (`server/src/sync/sync.service.ts`)
Self-limiting with one user; with several, one account fills the disk for
everyone else. Fix: an item-count or byte ceiling enforced at the upsert.

None of this changes the threat model. It should land before Work Item 2,
and before the repository goes public — self-hosters will find 1a and 1b
quickly.

---

## Work item 2 — registration policy and the admin role

**Registration is always invite-only**, in every deployment — this replaces
today's "refuse if any account exists" with "refuse without a valid,
unspent account-creation token," which is a strict improvement even for a
single-user server: it closes the unauthenticated write endpoint instead of
merely gating it once.

This introduces the first real admin concept, originally shipped as a plain
`role` column (`'member' | 'admin'`) and later replaced by a capabilities
table — see [Work item 4](#work-item-4--admin-capabilities-and-an-audit-log)
for why and what changed. Nothing about either shape grants cryptographic
access — an admin cannot read anyone's vault, today or ever, independent of
the [escrow](#recovery-and-escrow) decision below.

### Admin interface: a guided CLI, not a fourth app

None of the three client apps is a natural home for server administration,
and building one just for this is scope the org use case doesn't need yet.
Instead: `server/src/admin/cli.ts` (`pnpm run admin` locally; in a real
deployment, `docker compose exec server node dist/admin/cli.js`, since
Postgres is deliberately not reachable from the host any other way — see
§8.5's reasoning applied to the database instead of the API). An interactive
terminal wizard in the shape of tools like `p10k configure` — numbered/
arrow-key prompts guiding a step at a time (`@clack/prompts`), rather than a
flag-per-operation CLI someone has to look up. Menu:

- **Invite someone**: multi-select which capabilities to grant (none for a
  plain member), pick an expiry, type the server's own URL, get back a
  plaintext token and a terminal-rendered QR (`qrcode`) encoding the same
  `vaultiq://enroll` shape the extension's device-join QR already uses,
  with `kind=account` added.
- **List users and devices**, **list outstanding invitations**, **revoke a
  user** (revokes every device on the account and spends its outstanding
  device-join tokens — there's no separate "delete account" concept, since a
  device credential is the only thing that reaches a vault at all).
- **View audit log**, **prune audit log** — [Work item 4](#work-item-4--admin-capabilities-and-an-audit-log).
- **Recover a locked-out account**: present but permanently inert, per the
  Path A decision below — prints a pointer to this document's escrow
  section rather than a dead menu item that looks broken.

No separate "first run" mode: `ensureBootstrapToken` (called from `main.ts`
right after migrations run) already mints the very first account-creation
token automatically whenever `users` is empty, so the CLI's first real use
is typically "invite the next person," not bootstrapping.

This script talks to the database directly (it already lives in the
server's pnpm workspace and runs on the host, same trust level as the
server process itself) rather than through a new authenticated HTTP admin
API — smaller surface, nothing new to secure against the network.

---

## Work item 3 — symmetric client enrollment

Today only the extension can create a new vault; mobile can only join one
that already exists (`mobile/src/vault.ts`'s `enrollAndUnlock` has no
`register` counterpart). That was an artifact of build order, not a design
choice, and it stops being defensible once "create a vault" requires an
invite the same way "join a vault" already does — there's no reason the
first app someone opens should decide which capability they get.

Every client — extension, mobile, and desktop once it exists — gets the same
two entry points, as two explicit screens rather than one input that guesses
(see "The invite payload, unified" above for why a guess isn't needed):

- **"I have an invite"** — paste, or scan (auto-routes on the QR's `kind`
  if it was reached via a "scan" shortcut rather than the explicit choice).
  Joins this device to an existing vault under a device-join token.
- **"Create a new vault"** — takes an account-creation token; the server
  either has a live bootstrap one waiting (fresh personal server) or demands
  one from an admin (org server with registration already used).
- **Invite another device** — available from *any* unlocked client, not
  just the extension, since the server route already allowed this; it only
  ever lacked UI elsewhere.

Built: mobile gained both. `GetStartedScreen.tsx` is the new first screen on
an unenrolled device, routing to the existing `JoinVaultScreen.tsx` (now
kind-checked on scan) or a new `CreateVaultScreen.tsx` mirroring its wizard
shape. `SettingsScreen.tsx` gained "Invite a device," rendering a QR
(`react-native-qrcode-svg`, new dependency — mobile had scanning but no
generation before) alongside the plaintext token, same as the extension.

Creating a vault from scratch needed native crypto mobile never had a bridge
for: `pw-crypto-core` already exports `generate_vault_key`/`wrap_vault_key`/
`derive_master_key`/`default_argon2_params` over FFI (the extension's wasm
bindings already use them for its own "create a new vault" path), so this is
new methods on `CryptoCoreModule.kt` — `createVault`/`defaultArgon2Params` —
calling existing exports, not new Rust. No changes to `pw-crypto-core`
itself.

The extension needed one fix, not a new feature: `auth/register` started
requiring a token in Work Item 2, but `connectServer()` (the extension's own
"upload this local vault to a fresh server" path) never sent one — a real
break, not a hypothetical, caught here rather than by a user. Its form gained
a registration-token field; nothing else about that flow changed.

---

## Work item 4 — admin capabilities and an audit log

Two decisions that came out of using Work Items 1–3 in practice, not
planned from the start: `role` is a plain column, which can only ever be
all-or-nothing, and there was no way to answer "what happened" after the
fact beyond what each table's own current state shows.

**Capabilities replace `role`.** `user_capabilities` (`user_id`,
`capability`, `granted_at`) — one row per capability a user holds, out of
`manage_invitations` (issue/list/revoke registration tokens),
`manage_devices` (revoke any account's devices), `view_audit_log` (read
the log below). An account with none is a plain member. This is a real
authorization model only in the sense that it's *recorded*: nothing today
enforces `view_audit_log` at an HTTP layer, because nothing admin-facing
runs over HTTP — the CLI already has full database trust, the same as
before, so a capability check inside it would be checking an operator
against themselves. The value now is expressiveness (an invitation can
grant exactly what a new admin needs, not "everything or nothing") and
being the thing a future authenticated admin surface, if one is ever
built, would enforce against.

`enrollment_tokens.grants_capabilities` (a `text[]`, checked against the
known set) replaces `grants_role`. The kind-shape constraint updates with
it: a device-join token still grants nothing; an account-creation token's
array can be empty.

**The audit log — `audit_log`** — records what's listed in SECURITY.md's
"An investigation, without exposing what it's investigating" entry:
registrations, enrolments and their refusals, device revocations, master
password changes, and invitations issued. Never a credential, a token, or
key material — CLAUDE.md §2.3's rules apply here exactly as everywhere
else. Two things worth being explicit about:

- **A refusal is logged even though the operation's own transaction rolls
  back.** The write goes through the plain connection pool, not whatever
  transaction the caller is mid-way through — logging inside that
  transaction would roll the log entry back along with the refusal it's
  recording, which is exactly backwards.
- **Source IP, only for refusals, is the one deliberate exception to "a
  database dump identifies nobody."** Decided explicitly, not a default:
  the single most useful signal for telling a mistake from an attack is
  whether the failures share a source. Nowhere else does this project log
  an IP.

Retention is manual for now — a CLI "prune older than N days" action, no
scheduler. Automatic retention with a fixed window is a reasonable
follow-up, not needed to make the log useful today.

**Also decided, while this was in front of us: Path A for recovery** (see
[Recovery and escrow](#recovery-and-escrow) below) — no escrow, ever, on
every deployment. Making that decision here rather than continuing to defer
it is what let this work item settle on capabilities as *permissions*, not
as a stand-in for "who could eventually unlock what."

**Caught along the way, unrelated to either feature directly:** the real
deployment sits behind Caddy (`Caddyfile`'s `reverse_proxy`), and the
server never trusted it as a proxy — `req.ip` resolved to Caddy's own
container address for every request, not the real caller's. Harmless until
something needed a real IP to mean anything: Work Item 1's IP-keyed rate
limiting on the three bootstrap routes was silently ineffective in the real
deployment the whole time (every caller collapsed into one shared bucket,
the exact NAT problem that work item exists to prevent, just one hop
further out), and the audit log's source IP would have recorded Caddy's
address for every refusal rather than the attacker's. Fixed with
`app.set('trust proxy', 1)` — trust exactly one hop, since exactly one
reverse proxy ever sits in front.

---

## Recovery and escrow

**Decided: Path A. No escrow, ever.** Both paths are kept below because the
reasoning that ruled Path B out is worth keeping alongside the decision, not
because it's still open.

### The problem

An employee forgets their master password, or leaves the company. By design
today (SECURITY.md: "Losing the master password... no recovery, no reset, no
escrow, no backdoor. This is a design decision, not an oversight") the vault
is gone, permanently. That's correct for a personal vault. Whether it's
acceptable for an organization is exactly the open question.

**Email/SMS does not solve this**, and it's worth saying why since it's the
intuitive answer: those solve *account* recovery — proving identity to a
server that can then act. Here the server can't act; it never has the vault
key. Mailing a reset link produces access to an account that still can't be
opened. Binding an email address to an account would also cost the server's
present anonymity (a database dump today identifies nobody) for a benefit it
doesn't actually deliver.

### Path A — no escrow, ever (chosen)

Org admins can provision (issue account-creation tokens) and deprovision
(revoke devices, revoke accounts) but can never read vault contents. A
forgotten password loses that vault, same as personal use today, with no
exception for org deployments. This keeps one guarantee true across every
deployment Vaultiq ever runs: nobody but the vault's owner can open it. It
also means Vaultiq is not viable for organizations that require IT to
recover a departed employee's data — a real, disqualifying gap for some
buyers, accepted knowingly rather than a hypothetical one.

SECURITY.md already states this correctly and needed no change: "Losing the
master password... no recovery, no reset, no escrow, no backdoor. This is a
design decision, not an oversight" was never conditional on how
multi-tenancy turned out.

### Path B — organization escrow (not pursued)

The vault key gets a second wrapping, under an organization public key held
by admins, alongside the existing wrapping under the stretched
password-derived key. This is structurally cheap because the indirection
already exists — the vault key is one random 32-byte key; wrapping it a
second time re-encrypts nothing else, changes no item format.

```
Master password ──▶ Stretched key ──▶ wraps ──┐
                                                ├──▶ Vault key ──▶ items (unchanged)
      Org public key ──▶ wraps ─────────────────┘
```

What it needs that doesn't exist today:

- **Asymmetric crypto in `pw-crypto-core`**, which currently has none —
  Argon2id, XChaCha20-Poly1305, HKDF, SHA-2, HMAC, `rand`, nothing
  asymmetric. X25519 sealed-box or HPKE would be a new dependency under
  CLAUDE.md §5, with its own known-answer vectors, in its own module.
- **A versioned escrow record format**, versioned from its first commit
  per CLAUDE.md §4.9, alongside the existing wrapped-vault-key record.
- **A way to pin the organization public key that a compromised server
  can't substitute.** This is the sharpest risk in the whole idea: a server
  that swaps in its own public key receives an escrow copy of every vault
  key it hands out, silently. Pinning or out-of-band verification isn't an
  implementation detail to settle while coding — it's the design review
  that has to happen before any of this is built.

What it costs: the sentence at the top of SECURITY.md changes, for any
vault under escrow, from "nobody but you can read this" to "you, and
whoever holds the organization recovery key." 1Password and Bitwarden both
make this trade for enterprise tiers, but it has to be deliberate, and
visible to the person whose vault it is — not a quiet default. It argues
for personal and escrowed vaults staying distinguishable *to the user*,
not just the operator: someone should be able to see, in the app, whether
their vault has an escrow copy or not.

### Revisiting this later

Nothing built under Work Items 1–3 forecloses Path B mechanically, even
though it isn't being pursued now — the account-creation token record and
the capability model (below) are shaped so a future "this vault is
escrowed" flag or a second wrapped-key record slot on cleanly, as an
addition rather than a redesign. If this is ever revisited, it still gets
its own PROJECT.md phase, its own SECURITY.md rewrite, and the design
review named above, before any code — a decision this size doesn't get
reopened by drift either.

---

## What else buyers will ask for

Not required for a first organizational release, but worth naming now
since two of these have design implications:

- **SSO (SAML/OIDC)** is in real tension with zero-knowledge: SSO
  authenticates a person to the *server*, which still can't produce a
  vault key it never had. Bitwarden built a dedicated trusted-device/
  key-connector design to reconcile the two. Treat as its own phase, not
  a library to drop in.
- **SCIM provisioning** — deprovisioning here is exactly the escrow
  question again: revoking a device is easy today; recovering the vault
  is the open part.
- **Audit logging** is straightforward on its own, but a useful log and a
  server that stores no metadata are in real tension — scope it carefully
  when it comes up.
- **Shared collections** (what most buyers mean by "team password
  manager") is out of scope here entirely, and needs the same asymmetric
  primitives escrow does — another reason Path B, if chosen, should be
  built with sharing in mind rather than as a one-off.

---

## Going public

Independent of everything above, and blocking it in the sense that a
private repo can defer these but a public one can't:

- **No `LICENSE` file exists.** Without one, default copyright applies and
  nobody may legally use the published code — pick one before publishing,
  not after.
- **Audit the commit history for secrets first**, per CLAUDE.md §2.2 —
  anything found is compromised permanently, and checking now is far
  cheaper than rotating after the repo is public.
- **Enable branch protection.** Becomes available on GitHub's free plan
  once the repo is public — CLAUDE.md §8.5 has the exact payload and its
  two traps (review count must be 0; never require the release-only
  check). The `.githooks` guard rails only ever protected one machine.
- **SECURITY.md's lockout procedure is safe to publish as-is** — it needs
  database access and reveals nothing a database dump wouldn't already.
- **Work Item 1 should land before publication, not after** — self-hosters
  will find the isolation defects quickly if it doesn't.

---

## Sequencing

1. **Isolation defects** (Work Item 1) — strict improvements, no new
   concepts, ship regardless of anything else here.
2. **Registration policy + admin role + CLI wizard** (Work Item 2) —
   removes the unauthenticated `register` route, introduces the first
   admin concept.
3. **Symmetric client enrollment** (Work Item 3) — mobile (then desktop)
   gain create-a-vault and invite-a-device parity with the extension.
4. **Admin capabilities and an audit log** (Work Item 4) — replaces the
   role column with granular capabilities, adds the audit log, decides
   recovery (Path A), fixes the trust-proxy gap both of those surfaced.
5. **Publish** — license, secret-history audit, branch protection.
   SECURITY.md already describes the org model and the recovery decision
   honestly; nothing left pending on that front.

Every step so far was worth doing on its own terms, including the recovery
decision — Path A was chosen deliberately, not arrived at by running out of
steps to defer it with.

---

## Decisions made

Everything this document originally left open has been decided:

- **Recovery: Path A, no escrow, ever.** See
  [Recovery and escrow](#recovery-and-escrow). The threshold-scheme and
  org-key-pinning questions that would have followed from Path B are moot.
- **One `enrollment_tokens` table with a `kind` column**, not two. Built
  this way from Work Item 2; confirmed rather than revisited — the two
  kinds' access patterns haven't diverged enough to make the shared table
  awkward.
- **`role` becomes a capabilities table, not a plain column.** See
  [Work item 4](#work-item-4--admin-capabilities-and-an-audit-log) — a
  single `member`/`admin` column doesn't let a server hand out narrower
  admin scopes (issue invitations, but not revoke devices; view the audit
  log, but not either), and the audit log makes that distinction worth
  having from the start rather than retrofitting later.
