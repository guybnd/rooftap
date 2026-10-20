-- User-defined aisles per group (beyond the built-in 9)
create table if not exists grocery_aisles (
  id           uuid        primary key default gen_random_uuid(),
  group_id     uuid        not null references groups(id) on delete cascade,
  name         text        not null,
  color        text        not null default 'violet',
  sort_order   integer     not null default 0,
  created_at   timestamptz not null default now(),
  unique(group_id, name)
);

alter table grocery_aisles enable row level security;

create policy "group members can read grocery_aisles"
  on grocery_aisles for select
  using (is_group_member(group_id));

create policy "group members can insert grocery_aisles"
  on grocery_aisles for insert
  with check (is_group_member(group_id));

create policy "group members can update grocery_aisles"
  on grocery_aisles for update
  using (is_group_member(group_id));

create policy "group members can delete grocery_aisles"
  on grocery_aisles for delete
  using (is_group_member(group_id));
