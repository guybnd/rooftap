-- MCP sign-in (OAuth 2.1 with PKCE and dynamic client registration), so apps
-- like Claude can connect to /api/mcp by signing in to Rooftap instead of
-- pasting a bot API key. See .docs/architecture.md ("MCP sign-in").
--
-- Additive and safe ahead of its code: new tables and a new function only.
-- Older code never touches them, and bot API keys keep working unchanged.
-- Every table is service-role only (RLS on, no policies), like
-- personal_access_tokens.

-- Apps that registered themselves (RFC 7591). Public clients: no secret.
create table if not exists oauth_clients (
  id text primary key,
  client_name text,
  redirect_uris text[] not null,
  created_at timestamptz not null default now()
);

alter table oauth_clients enable row level security;

-- Single-use authorization codes, stored hashed, valid for a few minutes.
create table if not exists oauth_authorization_codes (
  code_hash text primary key,
  client_id text not null references oauth_clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table oauth_authorization_codes enable row level security;

-- One row per signed-in app connection. Access tokens are short-lived and
-- refresh tokens rotate on use; both stored hashed. Revoking the row
-- disconnects the app.
create table if not exists oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references oauth_clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  access_token_hash text not null unique,
  access_expires_at timestamptz not null,
  refresh_token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists oauth_tokens_user_idx on oauth_tokens (user_id) where revoked_at is null;

alter table oauth_tokens enable row level security;

-- Per-connection MCP rate limit, same shape as pat_rate_limits.
create table if not exists oauth_rate_limits (
  token_id uuid not null references oauth_tokens(id) on delete cascade,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (token_id, window_start)
);

alter table oauth_rate_limits enable row level security;

create or replace function oauth_rate_limit_hit(p_token_id uuid, p_limit integer)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_window timestamptz := date_trunc('minute', now());
  v_count integer;
begin
  delete from oauth_rate_limits where token_id = p_token_id and window_start < v_window;

  insert into oauth_rate_limits (token_id, window_start, count)
  values (p_token_id, v_window, 1)
  on conflict (token_id, window_start)
  do update set count = oauth_rate_limits.count + 1
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on function oauth_rate_limit_hit(uuid, integer) from public, anon, authenticated;
grant execute on function oauth_rate_limit_hit(uuid, integer) to service_role;
