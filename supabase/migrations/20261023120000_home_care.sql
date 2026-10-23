-- Home care module: the upkeep a house needs, on a schedule the household
-- chooses (packages/core/src/modules/home-care/home-care.ts).
--
-- One new group-scoped table, care_jobs, with the full Legend-State sync
-- contract (created_at/updated_at + handle_times(), (group_id, updated_at)
-- index, deleted tombstone, replica identity full + realtime publication),
-- granted to the Data API roles.
--
-- A job's reminder is a household task keyed `care-reminder:<job id>:<due>`.
-- Two triggers keep the pair in step, so it works however the job or the
-- task is changed (either app, offline writes syncing later, the Assistant,
-- Telegram, MCP):
--   * care_jobs_sync_reminder: after a job changes, its one open reminder
--     task matches it (created, moved, renamed, or removed when the job is
--     paused, hidden, deleted or has reminders off).
--   * household_tasks_care_done: finishing a reminder task logs the job as
--     done and moves it to its next due date (the same rule as core
--     nextDueAfter); reopening that task undoes it.
--
-- Additive and safe ahead of code: a new table, and triggers that only act on
-- rows with a care-reminder key, which nothing writes before the home-care
-- module ships. The module is gated on this migration with minSchema.

create table if not exists care_jobs (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  title text not null,
  area text not null default 'other'
    check (area in ('safety', 'climate', 'kitchen', 'laundry', 'plumbing', 'outside', 'pool', 'garden', 'other')),
  room text,
  suggestion_id text,
  state text not null default 'active' check (state in ('active', 'paused', 'hidden')),
  every_n integer not null default 1 check (every_n between 1 and 999),
  every_unit text not null default 'month' check (every_unit in ('day', 'week', 'month', 'year')),
  season_month integer check (season_month is null or season_month between 1 and 12),
  next_due date,
  last_done date,
  assigned_to uuid references auth.users(id) on delete set null,
  remind boolean not null default true,
  remind_days_before integer not null default 0 check (remind_days_before between 0 and 90),
  notes text,
  done_log jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

grant select, insert, update, delete on public.care_jobs to anon, authenticated, service_role;

create index if not exists idx_care_jobs_group_updated_at on care_jobs(group_id, updated_at);

alter table care_jobs enable row level security;

drop policy if exists "Group members can manage care jobs" on care_jobs;
create policy "Group members can manage care jobs"
  on care_jobs for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

drop trigger if exists trg_care_jobs_handle_times on care_jobs;
create trigger trg_care_jobs_handle_times
  before insert or update on care_jobs
  for each row execute function public.handle_times();

alter table care_jobs replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'care_jobs'
    ) then
    alter publication supabase_realtime add table care_jobs;
  end if;
end $$;

-- When a job is next due after it was done on `done_on` (core nextDueAfter).
create or replace function public.care_next_due(
  p_every_n integer,
  p_every_unit text,
  p_season_month integer,
  p_done_on date
) returns date
language plpgsql
immutable
as $$
declare
  v date;
  n integer := greatest(1, coalesce(p_every_n, 1));
begin
  if p_season_month is not null then
    v := make_date(extract(year from p_done_on)::integer, p_season_month, 1);
    while v <= p_done_on loop
      v := (v + interval '1 year')::date;
    end loop;
    return v;
  end if;
  return case p_every_unit
    when 'day' then p_done_on + n
    when 'week' then p_done_on + n * 7
    when 'year' then (p_done_on + make_interval(years => n))::date
    else (p_done_on + make_interval(months => n))::date
  end;
end;
$$;

-- Keep a job's one open reminder task in step with the job.
create or replace function public.care_jobs_sync_reminder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  want boolean;
  key text;
  due date;
  keep_id uuid;
  today date := (now() at time zone 'utc')::date;
begin
  want := not new.deleted and new.state = 'active' and new.remind and new.next_due is not null;

  if not want then
    update household_tasks
      set deleted = true
      where group_id = new.group_id
        and template_key like 'care-reminder:' || new.id || ':%'
        and not done and not deleted;
    return null;
  end if;

  key := 'care-reminder:' || new.id || ':' || to_char(new.next_due, 'YYYY-MM-DD');
  due := greatest(new.next_due - new.remind_days_before, today);

  -- Prefer the task already keyed for this due date (an undo reopens it).
  select id into keep_id
    from household_tasks
    where group_id = new.group_id
      and template_key like 'care-reminder:' || new.id || ':%'
      and not done and not deleted
    order by (template_key = key) desc, updated_at desc
    limit 1;

  if keep_id is null then
    insert into household_tasks (group_id, title, due_date, recurrence_days, done, assigned_to, private, template_key, notes, sort_order)
      values (new.group_id, new.title, due, null, false, new.assigned_to, false, key, 'From Home care.', 0);
  else
    update household_tasks
      set title = new.title, due_date = due, assigned_to = new.assigned_to, template_key = key
      where id = keep_id
        and (title is distinct from new.title or due_date is distinct from due
             or assigned_to is distinct from new.assigned_to or template_key is distinct from key);
    update household_tasks
      set deleted = true
      where group_id = new.group_id
        and template_key like 'care-reminder:' || new.id || ':%'
        and not done and not deleted and id <> keep_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_care_jobs_sync_reminder on care_jobs;
create trigger trg_care_jobs_sync_reminder
  after insert or update on care_jobs
  for each row execute function public.care_jobs_sync_reminder();

-- Finishing a care reminder task finishes the job; reopening it undoes that.
create or replace function public.household_tasks_care_done()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  job care_jobs%rowtype;
  job_id uuid;
  rest text;
  done_on date;
  tz text;
  last_entry jsonb;
  log jsonb;
begin
  if new.template_key is null or new.template_key not like 'care-reminder:%' then
    return null;
  end if;
  if old.done is not distinct from new.done then
    return null;
  end if;

  rest := substr(new.template_key, length('care-reminder:') + 1);
  begin
    job_id := split_part(rest, ':', 1)::uuid;
  exception when others then
    return null;
  end;

  select * into job from care_jobs where id = job_id and group_id = new.group_id;
  if not found then
    return null;
  end if;

  if new.done then
    select timezone into tz from user_settings where user_id = new.completed_by;
    done_on := (coalesce(new.completed_at, now()) at time zone coalesce(nullif(tz, ''), 'UTC'))::date;
    log := job.done_log || jsonb_build_array(jsonb_build_object(
      'on', to_char(done_on, 'YYYY-MM-DD'),
      'by', new.completed_by,
      'prev_due', case when job.next_due is null then null else to_char(job.next_due, 'YYYY-MM-DD') end,
      'task_id', new.id
    ));
    -- Keep the last 20 (core CARE_LOG_MAX).
    if jsonb_array_length(log) > 20 then
      select coalesce(jsonb_agg(e order by i), '[]'::jsonb) into log
        from jsonb_array_elements(log) with ordinality as t(e, i)
        where i > jsonb_array_length(log) - 20;
    end if;
    update care_jobs
      set done_log = log,
          last_done = done_on,
          next_due = public.care_next_due(job.every_n, job.every_unit, job.season_month, done_on)
      where id = job.id;
  else
    last_entry := job.done_log -> -1;
    if last_entry is null or last_entry ->> 'task_id' is distinct from new.id::text then
      return null;
    end if;
    log := job.done_log - (jsonb_array_length(job.done_log) - 1);
    update care_jobs
      set done_log = log,
          last_done = nullif(log -> -1 ->> 'on', '')::date,
          next_due = nullif(last_entry ->> 'prev_due', '')::date
      where id = job.id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_household_tasks_care_done on household_tasks;
create trigger trg_household_tasks_care_done
  after update of done on household_tasks
  for each row execute function public.household_tasks_care_done();
