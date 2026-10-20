-- Tracked Items (FLUX-130/131): one model for things with a provider, kind-
-- specific identifiers, an expiry, attached documents, and a reminder — warranty,
-- insurance, vehicle, lease. Warranties migrate onto this (kind='warranty');
-- other kinds are new. Group-scoped, mirrors the documents RLS pattern.

create table if not exists tracked_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  kind text not null
    check (kind in ('warranty','insurance','vehicle','lease')),
  name text not null,
  provider text,                                 -- manufacturer / insurer / counterparty
  identifiers jsonb not null default '{}',       -- kind-specific fields (model, policy_no, rego, …)
  expiry_date date,                              -- drives the unified reminder (FLUX-116)
  assigned_to uuid references auth.users(id) on delete set null,
  notes text,
  sort_order integer not null default 0,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_tracked_items_group on tracked_items(group_id);
create index idx_tracked_items_kind on tracked_items(kind);
create index idx_tracked_items_assigned_to on tracked_items(assigned_to);
create index idx_tracked_items_expiry on tracked_items(expiry_date) where expiry_date is not null;

alter table tracked_items enable row level security;

create policy "Group members can manage tracked items"
  on tracked_items for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

-- Documents can link to a tracked item.
alter table document_links drop constraint if exists document_links_entity_type_check;
alter table document_links add constraint document_links_entity_type_check
  check (entity_type in ('cost_item','warranty_asset','grocery_session','setup_item','tracked_item'));

-- Realtime: stream tracked_items changes to group members (replica identity full
-- so group-filtered deletes are delivered).
alter table tracked_items replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tracked_items'
    ) then
      alter publication supabase_realtime add table tracked_items;
    end if;
  end if;
end $$;
