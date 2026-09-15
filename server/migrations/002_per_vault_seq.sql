-- A per-vault sequence, replacing the single global item_seq.
--
-- A sequence shared across every vault let each tenant's own seq gaps report
-- how much other tenants wrote in the interval -- a cross-tenant side
-- channel, harmless with one vault but not with several. `next_seq` gives
-- each vault its own counter instead, advanced by the application inside the
-- same transaction as the write it numbers, under a row lock on this vault so
-- two concurrent pushes to it cannot race for the same value.

alter table vaults add column next_seq bigint not null default 1;

-- Nothing has shipped, so there is no real data to migrate -- this only
-- matters for whatever a development database already holds.
update vaults v
   set next_seq = coalesce((select max(i.seq) + 1 from items i where i.vault_id = v.id), 1);

alter table items alter column seq drop default;
drop sequence item_seq;
