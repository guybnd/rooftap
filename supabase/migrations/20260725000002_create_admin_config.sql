-- HOUP-25: Owner-editable third-party API keys, stored server-side.
-- Service-role only, mirrors the personal_access_tokens zero-client-RLS
-- precedent (20260722000001_create_personal_access_tokens.sql): RLS is
-- enabled with ZERO policies, so neither `anon` nor `authenticated` can touch
-- this table directly — every read/write goes through src/lib/admin-config.ts
-- via the service-role admin client.
create table if not exists admin_config (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

alter table admin_config enable row level security;
-- No policies: this table is reachable only via the service-role admin client.
