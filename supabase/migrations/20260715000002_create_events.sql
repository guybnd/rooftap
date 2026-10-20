-- FLUX-249: dedicated group-scoped `events` table for native, shared calendar
-- events ("doctor appointment", "moving day", "rent due") — distinct from the
-- user-scoped `appointments` (apartment viewings) and the read-only Google
-- overlay. Local-first (Legend-State store), like household_tasks.
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  title text not null,
  category text not null default 'general' check (
    category in ('general', 'medical', 'social', 'household', 'finance', 'school', 'travel', 'work')
  ),
  starts_at timestamptz not null,
  ends_at timestamptz,
  is_all_day boolean not null default false,
  location text,
  notes text,
  -- Client-side visibility filter (mirrors household_tasks.private) — NOT RLS-hard.
  private boolean not null default false,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_events_group_starts_at on events(group_id, starts_at);
create index idx_events_group_updated_at on events(group_id, updated_at);

alter table events enable row level security;

create policy "Group members can manage events"
  on events for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

-- Sync-ready: same handle_times() trigger every other Legend-State table uses
-- (20260618000001_sync_ready_columns.sql) so updated_at is always honest for
-- changesSince incremental pulls.
drop trigger if exists trg_events_handle_times on events;
create trigger trg_events_handle_times
  before insert or update on events
  for each row
  execute function public.handle_times();

-- Realtime — same pattern as 20260614000007_realtime_tasks_costs.sql.
alter table events replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'events'
    ) then
      alter publication supabase_realtime add table events;
    end if;
  end if;
end $$;
