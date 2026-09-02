-- The whole schema, and the shape of the promise.
--
-- The server stores ciphertext and the few fields needed to address it. Those
-- fields are exactly the ones already bound into each item's authentication
-- tag, so the server cannot alter any of them undetected — and it holds
-- nothing else. There is no column here for a login's name, username, URL or
-- notes, because all of those live inside the ciphertext.

create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),

  -- Argon2id of the auth key the client derives, never the auth key itself.
  -- The auth key is already 256 bits of uniform entropy, so a fast hash would
  -- technically do; a memory-hard one costs nothing here and covers the case
  -- where that assumption turns out wrong.
  auth_key_hash text not null,

  created_at timestamptz not null default now()
);

-- What a new device needs to rebuild the key hierarchy from the master
-- password. None of it is secret: the salt and costs are public by design,
-- and the wrapped vault key is useless without the password.
--
-- It is, however, offline-attackable — anyone holding this row can guess
-- passwords at Argon2id cost. That is inherent to a zero-knowledge vault and
-- is why the master password carries the weight it does.
create table vaults (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users (id) on delete cascade,

  salt_b64 text not null,
  kdf_memory_kib integer not null,
  kdf_iterations integer not null,
  kdf_parallelism integer not null,
  wrapped_vault_key jsonb not null,

  created_at timestamptz not null default now()
);

-- Only enrolled devices may talk to the server. The first is enrolled at
-- registration; any later one needs a token generated on an already-trusted
-- device, so reaching the vault takes both the master password and an
-- approved device rather than either alone.
create table devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,

  name text not null,
  credential_hash text not null,

  enrolled_at timestamptz not null default now(),

  -- Revocation rather than expiry: a device that holds the credential also
  -- holds a full local copy of the ciphertext, so timing it out protects
  -- nothing that revoking it does not.
  revoked_at timestamptz
);

create index devices_by_user on devices (user_id) where revoked_at is null;

create table enrollment_tokens (
  token_hash text primary key,
  user_id uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

-- One sequence across every vault, so a client can ask for "everything after
-- N" and get a stable answer. Timestamps would not do: clocks skew, and two
-- writes in the same millisecond are ambiguous.
create sequence item_seq;

create table items (
  vault_id uuid not null references vaults (id) on delete cascade,
  item_id text not null,

  -- Advanced on every write, not only on insert, so an update is picked up by
  -- a cursor that has already passed the row.
  seq bigint not null default nextval('item_seq'),

  -- Everything below is bound into the item's authentication tag by the
  -- client. The server can serve them back but cannot change them unnoticed.
  item_type text not null,
  version bigint not null,
  updated_at bigint not null,
  deleted boolean not null,
  format integer not null,

  ciphertext bytea not null,
  nonce bytea not null,

  primary key (vault_id, item_id)
);

create index items_by_seq on items (vault_id, seq);
