-- FLUX-233 #5: explicit on/off switches for Google Calendar pull and to-do push.
--   Previously neither had a real toggle — pull ran whenever
--   selected_calendar_ids was non-empty, and to-do push fired unconditionally
--   for every connected member. This adds the missing gates.

alter table google_calendar_connections
  -- Whether calendar-sync should pull this connection's selected calendars at
  -- all. Read-only and low-risk, so defaults ON — a freshly connected account
  -- keeps behaving like before this migration.
  add column if not exists pull_enabled boolean not null default true,
  -- Whether calendar-push (and calendar-sync's reconcile pass) should push
  -- household_tasks to-dos to this member's Google Calendar. Writes external
  -- data, so defaults OFF — existing connections must opt in explicitly.
  -- Appointment pushes are untouched by this flag (Decision: to-do-specific).
  add column if not exists push_todos_enabled boolean not null default false;
