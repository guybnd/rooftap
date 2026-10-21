-- HOUP-434: Shopper module. Things the household wants to buy, the offers
-- price sources find for them, and a daily price history behind the deal
-- rating (packages/core/src/shopper.ts).
--
-- Three group-scoped tables with the full Legend-State sync contract
-- (created_at/updated_at + handle_times(), (group_id, updated_at) index,
-- deleted tombstone, replica identity full + realtime publication).
-- Members read and write their wants. Offers and snapshots are written only
-- by the server's source lookups (service role), so members get read access
-- and nothing else.
--
-- Additive and safe ahead of code: new tables only, nothing reads them until
-- the shopper module ships and is switched on.

create table if not exists shopper_wants (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  title text not null,
  query text,
  target_cents integer check (target_cents is null or target_cents > 0),
  budget_cents integer check (budget_cents is null or budget_cents > 0),
  status text not null default 'watching' check (status in ('watching', 'idea', 'bought')),
  need_by date,
  notes text,
  best_cents integer,
  best_store text,
  last_checked_at timestamptz,
  bought_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create index if not exists idx_shopper_wants_group on shopper_wants(group_id);
create index if not exists idx_shopper_wants_group_updated_at on shopper_wants(group_id, updated_at);

alter table shopper_wants enable row level security;

drop policy if exists "Group members can manage shopper wants" on shopper_wants;
create policy "Group members can manage shopper wants"
  on shopper_wants for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

create table if not exists shopper_offers (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  want_id uuid not null references shopper_wants(id) on delete cascade,
  source_id text not null,
  store text not null,
  title text not null,
  url text,
  price_cents integer not null check (price_cents > 0),
  currency text not null,
  in_stock boolean,
  distance_m integer,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create index if not exists idx_shopper_offers_want on shopper_offers(want_id);
create index if not exists idx_shopper_offers_group_updated_at on shopper_offers(group_id, updated_at);

alter table shopper_offers enable row level security;

drop policy if exists "Group members can view shopper offers" on shopper_offers;
create policy "Group members can view shopper offers"
  on shopper_offers for select
  using (is_group_member(group_id));

create table if not exists shopper_price_snapshots (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  want_id uuid not null references shopper_wants(id) on delete cascade,
  source_id text not null,
  store text not null,
  price_cents integer not null check (price_cents > 0),
  currency text not null,
  captured_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  unique (want_id, source_id, store, captured_on)
);

create index if not exists idx_shopper_snapshots_group_updated_at on shopper_price_snapshots(group_id, updated_at);

alter table shopper_price_snapshots enable row level security;

drop policy if exists "Group members can view shopper price snapshots" on shopper_price_snapshots;
create policy "Group members can view shopper price snapshots"
  on shopper_price_snapshots for select
  using (is_group_member(group_id));

drop trigger if exists trg_shopper_wants_handle_times on shopper_wants;
create trigger trg_shopper_wants_handle_times
  before insert or update on shopper_wants
  for each row execute function public.handle_times();

drop trigger if exists trg_shopper_offers_handle_times on shopper_offers;
create trigger trg_shopper_offers_handle_times
  before insert or update on shopper_offers
  for each row execute function public.handle_times();

drop trigger if exists trg_shopper_snapshots_handle_times on shopper_price_snapshots;
create trigger trg_shopper_snapshots_handle_times
  before insert or update on shopper_price_snapshots
  for each row execute function public.handle_times();

alter table public.shopper_wants           replica identity full;
alter table public.shopper_offers          replica identity full;
alter table public.shopper_price_snapshots replica identity full;

do $$
declare
  tbl text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach tbl in array array['shopper_wants', 'shopper_offers', 'shopper_price_snapshots']
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
