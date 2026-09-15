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
3. **Vault recovery, not multi-tenancy, is the hard part.** Adding accounts
   is plumbing. Letting an organization recover an employee's vault means
   escrowing the vault key, which changes what "zero-knowledge" means for
   that deployment. That decision is **explicitly not made by this
   document** — see [Recovery and escrow](#recovery-and-escrow).

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
`grants_role` (`'member' | 'admin'`), decided by whoever issues it.

**Bootstrap, for a personal or fresh server:** on first boot, if `users` is
empty, the server mints one account-creation token with `grants_role =
'admin'` and logs it — the pattern Vaultwarden and Gitea both use. A solo
self-hoster spends it once and never sees another; the behavior is identical
to today's single-account server, just reached through the same mechanism an
org uses, rather than a special case.

**For an organization:** an admin issues account-creation tokens through the
CLI (below) as new people need to be onboarded. `grants_role` defaults to
`'member'`; an admin can grant a new admin the same way.

### The invite payload, unified

`extension/src/lib/enrollment-qr.ts` already produces
`vaultiq://enroll?server=...&token=...`, scanned by mobile's Join Vault flow.
Both token kinds reuse this: add an optional `kind` parameter
(`device` | `account`), defaulting to `device` for compatibility with
anything already generated. The client asks the server what a pasted or
scanned token is for — the server, not the client, is the source of truth on
`kind`, since a client blindly trusting a `kind` param it can't verify would
let a malformed or malicious link claim to be the more powerful kind.
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

This introduces the first real role. `users` gains a `role` column
(`'member' | 'admin'`, default `'member'`). An admin can mint
account-creation tokens and revoke accounts; nothing about the role grants
cryptographic access — an admin cannot read anyone's vault, today or ever,
independent of whatever the [escrow](#recovery-and-escrow) decision turns
out to be.

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

- **Invite someone**: pick member or admin, pick an expiry, type the
  server's own URL, get back a plaintext token and a terminal-rendered QR
  (`qrcode`) encoding the same `vaultiq://enroll` shape the extension's
  device-join QR already uses, with `kind=account` added.
- **List users and devices**, **list outstanding invitations**, **revoke a
  user** (revokes every device on the account and spends its outstanding
  device-join tokens — there's no separate "delete account" concept, since a
  device credential is the only thing that reaches a vault at all).
- **Recover a locked-out account**: present but inert — prints a pointer to
  this document's escrow section rather than a dead menu item that looks
  broken. Stays inert until (and unless) escrow is decided and built.

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
onboarding shape:

- **"I have an invite"** — paste or scan. The client asks the server what
  kind of token it is and routes to the matching flow (join this device to
  an existing vault, or create a new vault under this token's granted role).
- **"Create a new vault"** — always attempted the same way; the server
  either has a live bootstrap token waiting (fresh personal server) or
  demands one (org server with registration already used).
- **Invite another device** — available from *any* unlocked client, not
  just the extension, since the server route already allows it. This is
  UI work on mobile (and later desktop), not a new server capability.

No cryptographic changes. This is UI parity work reusing
`enrollWithServer`/`unlock` (extension) and their mobile equivalents
end-to-end.

---

## Recovery and escrow

**Left undecided on purpose.** This section lays out both paths so the
decision can be made deliberately later, not by drift. Nothing in Work
Items 1–3 forecloses either one.

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

### Path A — no escrow, ever

Org admins can provision (issue account-creation tokens) and deprovision
(revoke devices, revoke accounts) but can never read vault contents. A
forgotten password loses that vault, same as personal use today, with no
exception for org deployments. This keeps one guarantee true across every
deployment Vaultiq ever runs: nobody but the vault's owner can open it. It
also means Vaultiq is not viable for organizations that require IT to
recover a departed employee's data — a real, disqualifying gap for some
buyers, not a hypothetical one.

### Path B — organization escrow

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

### What staying undecided requires now

To avoid foreclosing Path B while doing everything else in this document:

- The account-creation token record and the admin role are shaped so a
  future "this vault is escrowed" flag or a second wrapped-key record slot
  cleanly onto them — no redesign, just an addition.
- Nothing added here binds a user's identity into the server in a way that
  would make distributing/pinning a future org public key harder.
- SECURITY.md and PROJECT.md state escrow as **explicitly open**, not
  silently ruled out and not silently assumed — anyone reading either file
  should know this is a live decision, not settled ground.

If the decision is ever made, it gets its own PROJECT.md phase, its own
SECURITY.md rewrite, and the design review named above — before any code,
per CLAUDE.md §7.3 ("ask before... changing a serialized format").

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
   removes the unauthenticated `register` route, introduces the first role.
3. **Symmetric client enrollment** (Work Item 3) — mobile (then desktop)
   gain create-a-vault and invite-a-device parity with the extension.
4. **Publish** — license, secret-history audit, branch protection,
   SECURITY.md updated to describe the org model honestly, including that
   escrow is an open question, not a shipped feature.
5. **Escrow** — untouched unless and until it's deliberately decided. Its
   own PROJECT.md phase, its own SECURITY.md rewrite, its own design
   review, if it happens at all.

Steps 1–4 are worth doing even if the answer on escrow ends up being
Path A forever. Step 5 is the one place the product's central promise gets
renegotiated, and it should be reached on purpose.

---

## Open decisions

- Path A or Path B for organization recovery — deliberately not decided
  here (see [Recovery and escrow](#recovery-and-escrow)).
- If Path B: a single organization-key holder, or a threshold scheme
  across several admins? The latter is materially safer and materially
  harder to build.
- If Path B: how is the organization public key distributed and pinned so
  a compromised server can't substitute its own?
- One `enrollment_tokens` table with a `kind` column, or two tables? This
  document assumes one; revisit if the two kinds' access patterns diverge
  enough to make that awkward.
- Is `role` a plain column on `users`, or does it need to become a
  separate table with granular capabilities later? Start with the column;
  a table is a cheap migration away if a second capability ever needs
  its own permission.
