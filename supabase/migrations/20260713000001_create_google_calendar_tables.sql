-- FLUX-157: Google Calendar integration.
--   * Push: appointments + dated household_tasks fan out to every connected group
--     member's Google Calendar (server-side, per-member tokens).
--   * Pull: the user's whole Google Calendar (not just house-viewing invites)
--     lands in a private-by-default staging table, rendered as a read-only
--     overlay; a suggestion classifier flags viewing-looking events; the user
--     can import (create a real appointment/to-do) or ad-hoc "share to group"
--     (visibility flip only, no push, no entity).
--
-- All three tables are service-role only: RLS is enabled with ZERO policies, so
-- neither `anon` nor `authenticated` can touch them directly — every read/write
-- goes through /api/calendar/* routes and the calendar-push/calendar-sync Edge
-- Functions, all of which use the service-role key (bypasses RLS entirely).
-- Google tokens must never be reachable via a client-side Supabase query.

-- ── google_calendar_connections ─────────────────────────────────────────────
-- One row per user. Holds the OAuth tokens captured by the dedicated
-- "Connect Google Calendar" flow (src/app/(auth)/calendar-callback/route.ts) —
-- separate from the main sign-in, which never requests Calendar scopes.
create table google_calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scopes text not null,
  -- Which of the user's Google calendars to pull from. 'primary' is the
  -- account's default calendar in the Google Calendar API.
  selected_calendar_ids text[] not null default array['primary'],
  -- Suggestion classifier config (Decision 5, layer 2): promote a pulled event
  -- to state='suggested' when it looks like a house viewing.
  suggest_mode text not null default 'both'
    check (suggest_mode in ('dedicated', 'keywords', 'both')),
  dedicated_calendar_id text,
  keywords text[] not null default array[
    'viewing', 'inspection', 'apartment', 'listing', 'tour', 'showing', 'open house'
  ],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table google_calendar_connections enable row level security;

drop trigger if exists trg_google_calendar_connections_handle_times on google_calendar_connections;
create trigger trg_google_calendar_connections_handle_times
  before insert or update on google_calendar_connections
  for each row
  execute function public.handle_times();

-- ── google_calendar_events ──────────────────────────────────────────────────
-- Staging table for EVERY event pulled from a user's selected Google calendars
-- (Decision 5, layer 1) — work meetings, haircuts, everything, not just
-- house-viewing invites. Never written directly into `appointments` (sidesteps
-- apartments.apartment_id NOT NULL); importing requires explicit user
-- confirmation via POST /api/calendar/import.
create table google_calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  gcal_event_id text not null,
  gcal_calendar_id text not null,
  title text,
  description text,
  location text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  -- Authoritative all-day flag captured straight from Google's response shape
  -- (start.date vs start.dateTime) at pull time — never re-derive this from
  -- starts_at later (a UTC-midnight heuristic misclassifies any timed event
  -- that happens to start at local midnight, and gets the timezone wrong for
  -- every other timed event too).
  is_all_day boolean not null default false,
  -- Google's own invite URL (Note 2 / Decision 2) — rendered as "Open in
  -- Google Calendar" in the overlay popover, the hub row, and the suggestion card.
  html_link text,
  -- Private to the pulling user by default (Note 1). "Share to group" (Decision 7)
  -- flips this to 'group' — a visibility elevation only, never a push or an entity.
  visibility text not null default 'private'
    check (visibility in ('private', 'group')),
  -- Fuzzy-matched against the group's apartments to pre-fill the import target.
  matched_apartment_id uuid references apartments(id) on delete set null,
  -- 'synced' = overlay-only. 'suggested' = classifier flagged it (viewing-looking).
  -- 'imported' = user converted it to an appointment/task. 'dismissed' = suggestion
  -- cleared but the overlay row stays. Never demote 'imported'/'dismissed' back to
  -- 'suggested' on a later pull (Plan Discipline / plan-review pass 4).
  state text not null default 'synced'
    check (state in ('synced', 'suggested', 'imported', 'dismissed')),
  imported_appointment_id uuid references appointments(id) on delete set null,
  imported_task_id uuid references household_tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, gcal_event_id)
);

alter table google_calendar_events enable row level security;

drop trigger if exists trg_google_calendar_events_handle_times on google_calendar_events;
create trigger trg_google_calendar_events_handle_times
  before insert or update on google_calendar_events
  for each row
  execute function public.handle_times();

-- Pull-side upsert keys on (user_id, gcal_event_id); read-side filters by state
-- and by the overlay's visible window.
create index idx_google_calendar_events_user_state on google_calendar_events(user_id, state);
create index idx_google_calendar_events_starts_at on google_calendar_events(starts_at);
-- Echo-skip lookup during pull: "is this gcal_event_id one HomeUp itself pushed?"
create index idx_google_calendar_events_gcal_event on google_calendar_events(user_id, gcal_event_id);

-- ── google_calendar_pushed_events ───────────────────────────────────────────
-- Per-user push mapping: one HomeUp entity -> one Google event per connected
-- member. The triggering user is irrelevant — the calendar-push Edge Function
-- holds every connected member's own tokens and fans out server-side.
create table google_calendar_pushed_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null check (entity_type in ('appointment', 'task')),
  entity_id uuid not null,
  gcal_event_id text not null,
  synced_at timestamptz not null default now(),
  -- 'push' (default): gcal_event_id is a Google event HomeUp itself created via
  -- createEvent — calendar-push/calendar-sync may freely update/delete it.
  -- 'import' (Decision 6 echo control): the importer adopted the ORIGINAL
  -- Google event's id into their own mapping row purely to suppress a
  -- duplicate push back to themselves. That event is the user's own
  -- pre-existing Google event, not one HomeUp owns — it must never be
  -- updated or deleted by the push/reconcile/disconnect paths.
  origin text not null default 'push' check (origin in ('push', 'import')),
  primary key (user_id, entity_type, entity_id)
);

alter table google_calendar_pushed_events enable row level security;

-- Reconciliation lookups (Decision 4): back-fill members with no mapping row,
-- and find-orphan (mapping whose entity no longer exists) both scan by entity.
create index idx_google_calendar_pushed_events_entity on google_calendar_pushed_events(entity_type, entity_id);

-- ── Push triggers (Decision 3) ───────────────────────────────────────────────
-- Fire-and-forget, mirroring tg_notify_task_assigned/notify_edge_function
-- (20260614000014): a DB trigger, not client code, so EVERY write path (direct
-- Supabase inserts from appointment-modal.tsx/calendar/page.tsx, Legend-State's
-- upserts for household_tasks, future call sites) reaches calendar-push with no
-- per-call-site hook to remember. The Edge Function does all the edge-case
-- logic (skip undated to-dos, delete-on-complete, private->assignee-only,
-- fan-out, echo control) — the trigger only forwards the raw row.
--
-- household_tasks never hard-deletes from the app (FLUX-148 soft-delete via
-- `deleted: true`), so DELETE is wired for completeness (e.g. an admin hard
-- delete) but the real "remove" signal arrives as an UPDATE with
-- new.deleted = true, which the Edge Function must also treat as a removal.
create or replace function public.tg_calendar_push_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.notify_edge_function(
    'calendar-push',
    jsonb_build_object(
      'entity_type', 'task',
      'type', tg_op,
      'record', case when tg_op = 'DELETE' then null else to_jsonb(new) end,
      'old_record', case when tg_op = 'INSERT' then null else to_jsonb(old) end
    )
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Split by event (mirroring trg_notify_task_assigned/_insert, 20260614000014) so
-- the UPDATE leg can carry a WHEN guard: only columns that affect push eligibility
-- or the pushed event body matter (title/notes/due_date/due_time/done/deleted/
-- private/assigned_to/recurrence_days/group_id) — a kanban reorder (sort_order),
-- template bookkeeping, or completed_at timestamp shouldn't fire an Edge Function
-- invocation. INSERT/DELETE always fire (no partial-column concept applies).
drop trigger if exists trg_calendar_push_task on household_tasks;
drop trigger if exists trg_calendar_push_task_ins on household_tasks;
drop trigger if exists trg_calendar_push_task_upd on household_tasks;
drop trigger if exists trg_calendar_push_task_del on household_tasks;

create trigger trg_calendar_push_task_ins
  after insert on household_tasks
  for each row
  execute function public.tg_calendar_push_task();

create trigger trg_calendar_push_task_upd
  after update on household_tasks
  for each row
  when (
    old.title is distinct from new.title
    or old.notes is distinct from new.notes
    or old.due_date is distinct from new.due_date
    or old.due_time is distinct from new.due_time
    or old.done is distinct from new.done
    or old.deleted is distinct from new.deleted
    or old.private is distinct from new.private
    or old.assigned_to is distinct from new.assigned_to
    or old.recurrence_days is distinct from new.recurrence_days
    or old.group_id is distinct from new.group_id
  )
  execute function public.tg_calendar_push_task();

create trigger trg_calendar_push_task_del
  after delete on household_tasks
  for each row
  execute function public.tg_calendar_push_task();

-- appointments hard-deletes from the app (appointment-modal.tsx / calendar page),
-- so DELETE is the real removal signal here.
create or replace function public.tg_calendar_push_appointment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.notify_edge_function(
    'calendar-push',
    jsonb_build_object(
      'entity_type', 'appointment',
      'type', tg_op,
      'record', case when tg_op = 'DELETE' then null else to_jsonb(new) end,
      'old_record', case when tg_op = 'INSERT' then null else to_jsonb(old) end
    )
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Same split as household_tasks above: only apartment_id/scheduled_at/notes feed
-- the pushed event body or its target group, so status/disposition changes
-- (viewing outcome tracking) shouldn't fire an Edge Function invocation.
drop trigger if exists trg_calendar_push_appointment on appointments;
drop trigger if exists trg_calendar_push_appointment_ins on appointments;
drop trigger if exists trg_calendar_push_appointment_upd on appointments;
drop trigger if exists trg_calendar_push_appointment_del on appointments;

create trigger trg_calendar_push_appointment_ins
  after insert on appointments
  for each row
  execute function public.tg_calendar_push_appointment();

create trigger trg_calendar_push_appointment_upd
  after update on appointments
  for each row
  when (
    old.apartment_id is distinct from new.apartment_id
    or old.scheduled_at is distinct from new.scheduled_at
    or old.notes is distinct from new.notes
  )
  execute function public.tg_calendar_push_appointment();

create trigger trg_calendar_push_appointment_del
  after delete on appointments
  for each row
  execute function public.tg_calendar_push_appointment();

-- ── Background sync schedule (Decision 4) ───────────────────────────────────
-- Every 6h: pull each connection's calendars, run the suggestion classifier,
-- and reconcile push state (re-push stale, back-fill missing members,
-- delete-orphan mappings). Reuses the same notify_edge_function() Vault-secret
-- invoker as notify-due-tasks-daily (20260614000014) — no new secrets needed.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'calendar-sync-periodic') then
    perform cron.unschedule('calendar-sync-periodic');
  end if;
  perform cron.schedule(
    'calendar-sync-periodic',
    '0 */6 * * *',
    $cron$ select public.notify_edge_function('calendar-sync', '{}'::jsonb) $cron$
  );
exception when others then
  raise notice 'pg_cron not available; schedule calendar-sync-periodic manually. (%)', sqlerrm;
end $$;
