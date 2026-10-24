-- One price search per item, region and day, shared by every household that
-- watches the same thing. The daily price check and an opened item look here
-- before they ask a paid source again. Written and read only by the server.
--
-- Additive and safe ahead of code: a new table that nothing reads until the
-- lookup that uses it ships. Rows older than a few days are cleared by the
-- daily price check.

create table if not exists shopper_source_cache (
  source_id text not null,
  -- REGION:CURRENCY:normalised query (core sourceCacheKey).
  key text not null,
  day date not null,
  offers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (source_id, key, day)
);

-- Server only: no policies, so members and anonymous callers see no rows.
grant select, insert, update, delete on public.shopper_source_cache to service_role;

alter table shopper_source_cache enable row level security;
