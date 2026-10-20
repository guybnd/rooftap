-- MCP hardening: personal access tokens expire, and each token is rate limited.
-- HOUP-2 shipped the MCP endpoint for private networks only (no expiry, no rate
-- limiting); hosted deployments expose it publicly, so both are added here.
--
-- Additive and safe ahead of its code: older code never reads expires_at or
-- calls pat_rate_limit_hit, so it keeps working unchanged.

alter table personal_access_tokens add column if not exists expires_at timestamptz;

-- Tokens issued before expiry existed get a full 90-day window from today
-- instead of expiring the moment the new code ships.
update personal_access_tokens
set expires_at = now() + interval '90 days'
where expires_at is null and revoked_at is null;

-- One row per token per minute. Service-role only, like personal_access_tokens.
create table if not exists pat_rate_limits (
  pat_id uuid not null references personal_access_tokens(id) on delete cascade,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (pat_id, window_start)
);

alter table pat_rate_limits enable row level security;
-- No policies: reachable only via the service-role admin client.

-- Counts one request for the token in the current minute and returns whether
-- it is within p_limit. Older windows for the token are dropped as it goes.
create or replace function pat_rate_limit_hit(p_pat_id uuid, p_limit integer)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_window timestamptz := date_trunc('minute', now());
  v_count integer;
begin
  delete from pat_rate_limits where pat_id = p_pat_id and window_start < v_window;

  insert into pat_rate_limits (pat_id, window_start, count)
  values (p_pat_id, v_window, 1)
  on conflict (pat_id, window_start)
  do update set count = pat_rate_limits.count + 1
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on function pat_rate_limit_hit(uuid, integer) from public, anon, authenticated;
grant execute on function pat_rate_limit_hit(uuid, integer) to service_role;
