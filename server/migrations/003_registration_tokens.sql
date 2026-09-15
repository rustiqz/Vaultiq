-- Registration becomes always-invite-only, and the first real role.
--
-- `enrollment_tokens` already models "a hashed, single-use, expiring bearer
-- secret" for joining a vault that exists. An account-creation invitation is
-- the same shape put to a different purpose -- creating a vault that doesn't
-- exist yet -- so it gets a `kind` column rather than a second table.

alter table users
  add column role text not null default 'member' check (role in ('member', 'admin'));

alter table enrollment_tokens
  alter column user_id drop not null,
  add column kind text not null default 'device_join'
    check (kind in ('device_join', 'account_create')),
  add column grants_role text check (grants_role in ('member', 'admin')),
  add column created_by uuid references users (id) on delete set null;

-- A device-join token belongs to the vault it joins and grants no role; an
-- account-creation token belongs to no vault yet and carries the role it
-- will grant instead. Neither shape can drift into the other's.
alter table enrollment_tokens
  add constraint enrollment_tokens_kind_shape check (
    (kind = 'device_join' and user_id is not null and grants_role is null)
    or
    (kind = 'account_create' and user_id is null and grants_role is not null)
  );
