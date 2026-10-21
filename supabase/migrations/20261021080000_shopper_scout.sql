-- HOUP-435: Scout, Shopper's AI layer. A run (shopper_searches) holds the
-- household's brief and how the run went; its picks (shopper_picks) are what
-- the agent recommends, each with the sources behind it. Both are written
-- only by the server (service role) after it checks membership, plan and
-- key; members read them through sync. A pick watched from Scout becomes a
-- shopper_wants row linked back by search_id.
--
-- Additive and safe ahead of code: two new tables and one nullable column.
-- Nothing reads them until the Scout screens ship.

create table if not exists public.shopper_searches (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  brief jsonb not null,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  error text,
  stores_checked integer not null default 0,
  key_source text check (key_source in ('household', 'server')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  deleted boolean not null default false
);

create index if not exists idx_shopper_searches_group_updated_at on public.shopper_searches(group_id, updated_at);

alter table public.shopper_searches enable row level security;
grant select, insert, update, delete on public.shopper_searches to anon, authenticated, service_role;

drop policy if exists "Group members can view scout runs" on public.shopper_searches;
create policy "Group members can view scout runs"
  on public.shopper_searches for select
  using (is_group_member(group_id));

create table if not exists public.shopper_picks (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  search_id uuid not null references public.shopper_searches(id) on delete cascade,
  rank integer not null,
  label text not null default '',
  title text not null,
  why text not null default '',
  price_cents integer not null check (price_cents > 0),
  currency text not null,
  store text not null,
  url text,
  in_stock boolean,
  stretch boolean not null default false,
  sources jsonb not null default '[]',
  want_id uuid references public.shopper_wants(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create index if not exists idx_shopper_picks_search on public.shopper_picks(search_id);
create index if not exists idx_shopper_picks_group_updated_at on public.shopper_picks(group_id, updated_at);

alter table public.shopper_picks enable row level security;
grant select, insert, update, delete on public.shopper_picks to anon, authenticated, service_role;

drop policy if exists "Group members can view scout picks" on public.shopper_picks;
create policy "Group members can view scout picks"
  on public.shopper_picks for select
  using (is_group_member(group_id));

alter table public.shopper_wants add column if not exists search_id uuid references public.shopper_searches(id) on delete set null;

drop trigger if exists trg_shopper_searches_handle_times on public.shopper_searches;
create trigger trg_shopper_searches_handle_times
  before insert or update on public.shopper_searches
  for each row execute function public.handle_times();

drop trigger if exists trg_shopper_picks_handle_times on public.shopper_picks;
create trigger trg_shopper_picks_handle_times
  before insert or update on public.shopper_picks
  for each row execute function public.handle_times();

alter table public.shopper_searches replica identity full;
alter table public.shopper_picks    replica identity full;

do $$
declare
  tbl text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach tbl in array array['shopper_searches', 'shopper_picks']
    loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = tbl
      ) then
        execute format('alter publication supabase_realtime add table public.%I', tbl);
      end if;
    end loop;
  end if;
end $$;
