-- Bin night module (packages/core/src/modules/bins): which bins go out on
-- which night, the council's one-off changes, and the household's plan
-- (reminder time, whose turn it is, and whether tonight's bins are out).
--
-- Three new group-scoped tables with the full Legend-State sync contract
-- (created_at/updated_at + handle_times(), (group_id, updated_at) index,
-- deleted tombstone, replica identity full + realtime publication), each
-- granted to the Data API roles (apps/web/src/lib/migration-grants.test.ts).
-- bin_night_pushes is server-only: notify-bin-night records each push there so
-- a night is pushed once.
--
-- Additive and safe ahead of code: new tables and a cron job for the new
-- notify-bin-night function (until it deploys, the job's call fails quietly,
-- as notify_edge_function's do). The module is gated on this migration with
-- minSchema.

create table if not exists bin_streams (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  name text not null,
  lid text not null default 'other' check (lid in ('red', 'yellow', 'green', 'blue', 'purple', 'grey', 'other')),
  weekday smallint not null check (weekday between 0 and 6),
  every_weeks smallint not null default 1 check (every_weeks between 1 and 8),
  anchor_date date not null,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

grant select, insert, update, delete on public.bin_streams to anon, authenticated, service_role;

create index if not exists idx_bin_streams_group_updated_at on bin_streams(group_id, updated_at);

alter table bin_streams enable row level security;

drop policy if exists "Group members can manage bin streams" on bin_streams;
create policy "Group members can manage bin streams"
  on bin_streams for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

create table if not exists bin_changes (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  -- Null: every bin due that day.
  stream_id uuid references bin_streams(id) on delete cascade,
  on_date date not null,
  -- Null: no collection that day.
  moved_to date,
  note text,
  source text not null default 'manual' check (source in ('manual', 'council', 'home-assistant')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

grant select, insert, update, delete on public.bin_changes to anon, authenticated, service_role;

create index if not exists idx_bin_changes_group_updated_at on bin_changes(group_id, updated_at);

alter table bin_changes enable row level security;

drop policy if exists "Group members can manage bin changes" on bin_changes;
create policy "Group members can manage bin changes"
  on bin_changes for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

create table if not exists bin_plans (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  remind_at text not null default '19:00' check (remind_at ~ '^[0-2][0-9]:[0-5][0-9]$'),
  -- Null: no push.
  push_at text default '21:00' check (push_at is null or push_at ~ '^[0-2][0-9]:[0-5][0-9]$'),
  rotation uuid[] not null default '{}',
  rotation_anchor date,
  out_for date,
  out_by uuid references auth.users(id) on delete set null,
  timezone text,
  setup_source text not null default 'manual' check (setup_source in ('manual', 'council', 'home-assistant')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

grant select, insert, update, delete on public.bin_plans to anon, authenticated, service_role;

create index if not exists idx_bin_plans_group_updated_at on bin_plans(group_id, updated_at);

alter table bin_plans enable row level security;

drop policy if exists "Group members can manage bin plans" on bin_plans;
create policy "Group members can manage bin plans"
  on bin_plans for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

create table if not exists bin_night_pushes (
  group_id uuid not null references groups(id) on delete cascade,
  collection_date date not null,
  sent_at timestamptz not null default now(),
  primary key (group_id, collection_date)
);

grant select, insert, update, delete on public.bin_night_pushes to service_role;

alter table bin_night_pushes enable row level security;

-- Sync-ready: handle_times() keeps updated_at honest for changesSince pulls.
drop trigger if exists trg_bin_streams_handle_times on bin_streams;
create trigger trg_bin_streams_handle_times
  before insert or update on bin_streams
  for each row execute function public.handle_times();

drop trigger if exists trg_bin_changes_handle_times on bin_changes;
create trigger trg_bin_changes_handle_times
  before insert or update on bin_changes
  for each row execute function public.handle_times();

drop trigger if exists trg_bin_plans_handle_times on bin_plans;
create trigger trg_bin_plans_handle_times
  before insert or update on bin_plans
  for each row execute function public.handle_times();

alter table bin_streams replica identity full;
alter table bin_changes replica identity full;
alter table bin_plans replica identity full;

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['bin_streams', 'bin_changes', 'bin_plans'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table %I', t);
      end if;
    end loop;
  end if;
end $$;

-- The night-before push: every 15 minutes, notify-bin-night sends to
-- households whose push time has passed in their own time zone.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'notify-bin-night') then
    perform cron.unschedule('notify-bin-night');
  end if;
  perform cron.schedule(
    'notify-bin-night',
    '*/15 * * * *',
    $cron$ select public.notify_edge_function('notify-bin-night', '{}'::jsonb) $cron$
  );
exception when others then
  raise notice 'pg_cron not available; schedule notify-bin-night manually. (%)', sqlerrm;
end $$;
