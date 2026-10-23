-- The Assistant's web lookups: searches (Google through SerpApi, paid per
-- search) and pages it reads. One counter row per household, day and kind,
-- so each household keeps to its daily allowance. Written only by the server
-- through assistant_web_lookup_hit().
--
-- Additive and safe ahead of code: a new table and a new function that
-- nothing reads until the web tools ship.

create table if not exists assistant_web_lookups (
  group_id uuid not null references groups(id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('search', 'page')),
  count integer not null default 0,
  primary key (group_id, day, kind)
);

-- Server only: no policies, so members and anonymous callers see no rows.
grant select, insert, update, delete on public.assistant_web_lookups to service_role;

alter table assistant_web_lookups enable row level security;

-- Counts one lookup and says whether it fits the day's allowance. Older days
-- for the household are cleared on the way.
create or replace function assistant_web_lookup_hit(p_group_id uuid, p_kind text, p_limit integer)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_count integer;
begin
  delete from assistant_web_lookups where group_id = p_group_id and day < v_day;

  insert into assistant_web_lookups (group_id, day, kind, count)
  values (p_group_id, v_day, p_kind, 1)
  on conflict (group_id, day, kind)
  do update set count = assistant_web_lookups.count + 1
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on function assistant_web_lookup_hit(uuid, text, integer) from public, anon, authenticated;
grant execute on function assistant_web_lookup_hit(uuid, text, integer) to service_role;
