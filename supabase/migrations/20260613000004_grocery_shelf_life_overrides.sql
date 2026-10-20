create table if not exists grocery_shelf_life_overrides (
  group_id       uuid    not null references groups(id) on delete cascade,
  item_name      text    not null,
  shelf_life_days integer not null check (shelf_life_days > 0),
  primary key (group_id, item_name)
);

alter table grocery_shelf_life_overrides enable row level security;

create policy "group_members_select_shelf_life"
  on grocery_shelf_life_overrides for select
  using (is_group_member(group_id));

create policy "group_members_insert_shelf_life"
  on grocery_shelf_life_overrides for insert
  with check (is_group_member(group_id));

create policy "group_members_update_shelf_life"
  on grocery_shelf_life_overrides for update
  using (is_group_member(group_id));

create policy "group_members_delete_shelf_life"
  on grocery_shelf_life_overrides for delete
  using (is_group_member(group_id));
