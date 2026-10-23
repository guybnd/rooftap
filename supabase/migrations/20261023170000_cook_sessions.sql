-- Recipes v2: running cooks and their timers.
--
-- One row per person per recipe they are cooking now: the step they are on
-- and the timers they started (packages/core/src/modules/recipes/cook.ts).
-- A timer stores when it ends, so it keeps time with the app closed. Rows
-- are the person's own: web and phone share them, and nobody else in the
-- household sees them. Finishing a cook tombstones its row.
--
-- A group-scoped table with the full Legend-State sync contract
-- (created_at/updated_at + handle_times(), (group_id, updated_at) index,
-- deleted tombstone, replica identity full + realtime publication), granted
-- to the Data API roles (apps/web/src/lib/migration-grants.test.ts).
--
-- Additive and safe ahead of code: a new table nothing reads until the app
-- knows the server has it (`recipes.cook` in server-features.ts).

create table if not exists cook_sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  recipe_id uuid not null references recipes(id) on delete cascade,
  step integer not null default 0,
  timers jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

grant select, insert, update, delete on public.cook_sessions to anon, authenticated, service_role;

create index if not exists idx_cook_sessions_group_updated_at on cook_sessions(group_id, updated_at);
create index if not exists idx_cook_sessions_user on cook_sessions(user_id) where not deleted;

alter table cook_sessions enable row level security;

drop policy if exists "People manage their own cooks" on cook_sessions;
create policy "People manage their own cooks"
  on cook_sessions for all
  using (user_id = auth.uid() and is_group_member(group_id))
  with check (user_id = auth.uid() and is_group_member(group_id));

drop trigger if exists trg_cook_sessions_handle_times on cook_sessions;
create trigger trg_cook_sessions_handle_times
  before insert or update on cook_sessions
  for each row execute function public.handle_times();

alter table cook_sessions replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cook_sessions'
    ) then
      alter publication supabase_realtime add table cook_sessions;
    end if;
  end if;
end $$;
