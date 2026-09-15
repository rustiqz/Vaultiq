-- Capabilities replace the single member/admin role, and an audit log for
-- investigating an incident without storing anything an incident could
-- steal.
--
-- A column can only ever be all-or-nothing. `user_capabilities` lets a
-- server hand out narrower admin scopes -- issue invitations without being
-- able to revoke anyone's devices; read the audit log without either --
-- which the flat `role` this replaces could never express.

create table user_capabilities (
  user_id uuid not null references users (id) on delete cascade,
  capability text not null check (
    capability in ('manage_invitations', 'manage_devices', 'view_audit_log')
  ),
  granted_at timestamptz not null default now(),
  primary key (user_id, capability)
);

alter table users drop column role;

alter table enrollment_tokens
  drop column grants_role,
  add column grants_capabilities text[] not null default '{}';

-- Same reasoning as the kind-shape constraint this replaces the half of
-- (dropping grants_role above already dropped that constraint along with
-- it, since it referenced the column): a device-join token still grants
-- nothing (it doesn't create an account), an account-creation token's
-- capabilities are whatever the issuer chose, possibly none (a plain
-- member).
alter table enrollment_tokens add constraint enrollment_tokens_kind_shape check (
  (kind = 'device_join' and user_id is not null and grants_capabilities = '{}')
  or
  (kind = 'account_create' and user_id is null)
);

alter table enrollment_tokens add constraint enrollment_tokens_capabilities_known check (
  grants_capabilities <@ array['manage_invitations', 'manage_devices', 'view_audit_log']::text[]
);

-- What is logged is deliberately narrow: an event type, timing, which
-- account/device it concerns, and a small detail blob that never carries a
-- credential, a token (not even a fingerprint of one), or key material --
-- the same "never log" list in CLAUDE.md §2.3 applies here as anywhere else.
-- source_ip exists only for the auth-failure/refusal events where knowing
-- where a guess came from is worth the one deliberate exception to this
-- project's usual "a database dump identifies nobody" stance -- see
-- SECURITY.md.
create table audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  event_type text not null,
  user_id uuid references users (id) on delete set null,
  device_id uuid references devices (id) on delete set null,
  source_ip inet,
  detail jsonb not null default '{}'::jsonb
);

create index audit_log_by_time on audit_log (occurred_at);
create index audit_log_by_user on audit_log (user_id) where user_id is not null;
