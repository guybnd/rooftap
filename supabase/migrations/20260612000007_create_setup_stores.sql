-- Setup stores: first-class store entities so items can be grouped/filtered by store
create table if not exists setup_stores (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  name text not null,
  url text,
  address text,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (group_id, name)
);

create index idx_setup_stores_group on setup_stores(group_id);

alter table setup_stores enable row level security;

create policy "Group members can manage setup stores"
  on setup_stores for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

-- Link setup_items to a store (keep where_to_buy for backfill/back-compat)
alter table setup_items
  add column if not exists store_id uuid references setup_stores(id) on delete set null;

create index if not exists idx_setup_items_store on setup_items(store_id);

-- Backfill: turn each distinct where_to_buy value into a store and link items
do $$
declare
  r record;
  new_store_id uuid;
begin
  for r in
    select distinct group_id, where_to_buy
    from setup_items
    where where_to_buy is not null and btrim(where_to_buy) <> ''
  loop
    insert into setup_stores (group_id, name, created_by)
    select r.group_id, r.where_to_buy, g.created_by
    from groups g
    where g.id = r.group_id
    on conflict (group_id, name) do nothing
    returning id into new_store_id;

    if new_store_id is null then
      select id into new_store_id
      from setup_stores
      where group_id = r.group_id and name = r.where_to_buy;
    end if;

    update setup_items
    set store_id = new_store_id
    where group_id = r.group_id and where_to_buy = r.where_to_buy;
  end loop;
end $$;
