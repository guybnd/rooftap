-- Meal plan: the week's dinners, planned in Recipes' "This week" tab
-- (packages/core/src/meal-plan.ts). One row per night: a recipe, or a label
-- for nights without one (Out, Leftovers, free text), and who cooks.
--
-- A group-scoped table with the full Legend-State sync contract
-- (created_at/updated_at + handle_times(), (group_id, updated_at) index,
-- deleted tombstone, replica identity full + realtime publication), granted
-- to the Data API roles (apps/web/src/lib/migration-grants.test.ts).
--
-- No unique (group_id, date, slot) constraint: two people can plan the same
-- night offline, and the app shows the newest row for a night. A unique key
-- would turn the second sync into a conflict.
--
-- Additive and safe ahead of code: a new table nothing reads until the
-- meals module ships. The module is gated on this migration with minSchema.

create table if not exists meal_plan_entries (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  date date not null,
  slot text not null default 'dinner' check (slot in ('breakfast', 'lunch', 'dinner')),
  recipe_id uuid references recipes(id) on delete set null,
  label text,
  cook_user_id uuid references auth.users(id) on delete set null,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

grant select, insert, update, delete on public.meal_plan_entries to anon, authenticated, service_role;

create index if not exists idx_meal_plan_entries_group_date on meal_plan_entries(group_id, date);
create index if not exists idx_meal_plan_entries_group_updated_at on meal_plan_entries(group_id, updated_at);

alter table meal_plan_entries enable row level security;

drop policy if exists "Group members can manage meal plan entries" on meal_plan_entries;
create policy "Group members can manage meal plan entries"
  on meal_plan_entries for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

-- Sync-ready: handle_times() keeps updated_at honest for changesSince pulls.
drop trigger if exists trg_meal_plan_entries_handle_times on meal_plan_entries;
create trigger trg_meal_plan_entries_handle_times
  before insert or update on meal_plan_entries
  for each row execute function public.handle_times();

alter table meal_plan_entries replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'meal_plan_entries'
    ) then
      alter publication supabase_realtime add table meal_plan_entries;
    end if;
  end if;
end $$;
