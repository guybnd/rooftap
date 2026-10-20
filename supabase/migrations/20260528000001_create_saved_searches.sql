-- Saved searches: group-scoped bookmarked listing site URLs shared between members

create table saved_searches (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  name text not null,
  url text not null,
  created_at timestamptz not null default now()
);

alter table saved_searches enable row level security;

create index idx_saved_searches_group_id on saved_searches(group_id);

create policy "Group members can view saved searches"
  on saved_searches for select
  using (is_group_member(group_id));

create policy "Group members can create saved searches"
  on saved_searches for insert
  with check (is_group_member(group_id) and created_by = auth.uid());

create policy "Group members can delete saved searches"
  on saved_searches for delete
  using (is_group_member(group_id));
