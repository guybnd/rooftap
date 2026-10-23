-- Occasions module: birthdays, anniversaries and other yearly days, the gift
-- ideas for them, and each member's wishlist (packages/core/src/modules/occasions).
--
-- The key rule is "Keep it from": a gift idea (or a whole occasion) lists
-- the members it is hidden from in hidden_from, and the select policy drops
-- the row for them. It is enforced here, not only in the app, so their synced
-- cache never receives the row. A Shopper watch made from a hidden idea
-- carries the same list, and its offers and price history follow the watch.
--
-- Three new group-scoped tables with the full Legend-State sync contract
-- (created_at/updated_at + handle_times(), (group_id, updated_at) index,
-- deleted tombstone, replica identity full + realtime publication), each
-- granted to the Data API roles (apps/web/src/lib/migration-grants.test.ts).
--
-- Additive and safe ahead of code: new tables, a new column with an empty
-- default on shopper_wants, and Shopper policies that hide only rows whose
-- hidden_from names the reader, which nothing sets before this module ships.
-- The module is gated on this migration with minSchema.

-- True when the signed-in person is in the list. Never true for the service
-- role (no auth.uid()), which bypasses RLS anyway.
create or replace function public.hidden_from_me(hidden uuid[])
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(auth.uid() = any(hidden), false)
$$;

create table if not exists occasions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  title text not null,
  kind text not null default 'birthday' check (kind in ('birthday', 'anniversary', 'holiday', 'other')),
  -- The day it falls on; with repeats, every year on that month and day.
  date date not null,
  repeats boolean not null default true,
  -- Who it is for: a member, or a name (Mum, Jess). Both null for shared days.
  person_id uuid references auth.users(id) on delete set null,
  person_name text,
  budget_cents integer check (budget_cents is null or budget_cents >= 0),
  notes text,
  hidden_from uuid[] not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

grant select, insert, update, delete on public.occasions to anon, authenticated, service_role;

create index if not exists idx_occasions_group_updated_at on occasions(group_id, updated_at);

alter table occasions enable row level security;

drop policy if exists "Group members can manage occasions they can see" on occasions;
create policy "Group members can manage occasions they can see"
  on occasions for all
  using (is_group_member(group_id) and not hidden_from_me(hidden_from))
  with check (is_group_member(group_id) and not hidden_from_me(hidden_from));

create table if not exists wishlist_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  -- Whose wishlist it is. Everyone in the household can read it; only they change it.
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  url text,
  price_cents integer check (price_cents is null or price_cents >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

grant select, insert, update, delete on public.wishlist_items to anon, authenticated, service_role;

create index if not exists idx_wishlist_items_group_updated_at on wishlist_items(group_id, updated_at);

alter table wishlist_items enable row level security;

drop policy if exists "Group members can read wishlists" on wishlist_items;
create policy "Group members can read wishlists"
  on wishlist_items for select
  using (is_group_member(group_id));

drop policy if exists "Members keep their own wishlist" on wishlist_items;
create policy "Members keep their own wishlist"
  on wishlist_items for insert
  with check (is_group_member(group_id) and user_id = auth.uid());

drop policy if exists "Members change their own wishlist" on wishlist_items;
create policy "Members change their own wishlist"
  on wishlist_items for update
  using (is_group_member(group_id) and user_id = auth.uid())
  with check (is_group_member(group_id) and user_id = auth.uid());

drop policy if exists "Members delete from their own wishlist" on wishlist_items;
create policy "Members delete from their own wishlist"
  on wishlist_items for delete
  using (is_group_member(group_id) and user_id = auth.uid());

create table if not exists gift_ideas (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  occasion_id uuid references occasions(id) on delete set null,
  -- Who the gift is for: a member, or a name.
  for_user_id uuid references auth.users(id) on delete set null,
  for_name text,
  title text not null,
  status text not null default 'idea' check (status in ('idea', 'watching', 'bought', 'booked')),
  price_cents integer check (price_cents is null or price_cents >= 0),
  url text,
  notes text,
  wishlist_item_id uuid references wishlist_items(id) on delete set null,
  shopper_want_id uuid references shopper_wants(id) on delete set null,
  cost_item_id uuid references cost_items(id) on delete set null,
  hidden_from uuid[] not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

grant select, insert, update, delete on public.gift_ideas to anon, authenticated, service_role;

create index if not exists idx_gift_ideas_occasion on gift_ideas(occasion_id);
create index if not exists idx_gift_ideas_group_updated_at on gift_ideas(group_id, updated_at);

alter table gift_ideas enable row level security;

drop policy if exists "Group members can manage gift ideas they can see" on gift_ideas;
create policy "Group members can manage gift ideas they can see"
  on gift_ideas for all
  using (is_group_member(group_id) and not hidden_from_me(hidden_from))
  with check (is_group_member(group_id) and not hidden_from_me(hidden_from));

-- Shopper: a watch made from a hidden gift idea is hidden from the same
-- people, and so are its offers and price history.
alter table shopper_wants add column if not exists hidden_from uuid[] not null default '{}';

drop policy if exists "Group members can manage shopper wants" on shopper_wants;
create policy "Group members can manage shopper wants"
  on shopper_wants for all
  using (is_group_member(group_id) and not hidden_from_me(hidden_from))
  with check (is_group_member(group_id) and not hidden_from_me(hidden_from));

-- The subquery runs under shopper_wants' own policy, so it finds the watch
-- only when the reader can see it.
drop policy if exists "Group members can view shopper offers" on shopper_offers;
create policy "Group members can view shopper offers"
  on shopper_offers for select
  using (is_group_member(group_id) and exists (select 1 from shopper_wants w where w.id = shopper_offers.want_id));

drop policy if exists "Group members can view shopper price snapshots" on shopper_price_snapshots;
create policy "Group members can view shopper price snapshots"
  on shopper_price_snapshots for select
  using (is_group_member(group_id) and exists (select 1 from shopper_wants w where w.id = shopper_price_snapshots.want_id));

-- Sync-ready: handle_times() keeps updated_at honest for changesSince pulls.
drop trigger if exists trg_occasions_handle_times on occasions;
create trigger trg_occasions_handle_times
  before insert or update on occasions
  for each row execute function public.handle_times();

drop trigger if exists trg_wishlist_items_handle_times on wishlist_items;
create trigger trg_wishlist_items_handle_times
  before insert or update on wishlist_items
  for each row execute function public.handle_times();

drop trigger if exists trg_gift_ideas_handle_times on gift_ideas;
create trigger trg_gift_ideas_handle_times
  before insert or update on gift_ideas
  for each row execute function public.handle_times();

alter table occasions replica identity full;
alter table wishlist_items replica identity full;
alter table gift_ideas replica identity full;

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['occasions', 'wishlist_items', 'gift_ideas'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table %I', t);
      end if;
    end loop;
  end if;
end $$;
