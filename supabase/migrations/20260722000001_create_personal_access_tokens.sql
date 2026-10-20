-- FLUX-HOUP-2: Personal Access Tokens for external agent read access (MCP server).
-- Service-role only, mirrors the google_calendar_* zero-client-RLS precedent
-- (20260713000001_create_google_calendar_tables.sql): RLS is enabled with ZERO
-- policies, so neither `anon` nor `authenticated` can touch this table directly —
-- every read/write goes through src/lib/pat.ts via the service-role admin client.
-- Only the SHA-256 hash of a token is ever stored; the raw value is shown once
-- at issuance time (scripts/issue-pat.mjs) and never persisted.
create table if not exists personal_access_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  label text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists idx_personal_access_tokens_user_id on personal_access_tokens(user_id);

alter table personal_access_tokens enable row level security;
-- No policies: this table is reachable only via the service-role admin client.
