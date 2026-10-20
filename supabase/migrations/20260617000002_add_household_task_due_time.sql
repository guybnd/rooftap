-- FLUX-144: optional wall-clock time for household tasks.
-- A nullable `due_time` sits alongside the existing `due_date` (a plain `date`).
-- Deliberately a wall-clock `time`, NOT a timestamptz: a household chore time
-- means "7am wherever you are", so the time is interpreted in the viewer's local
-- zone at render. This keeps all the timezone-safe YYYY-MM-DD date logic intact
-- and avoids freezing the time to whichever zone happened to write the row.
-- Existing date-only tasks simply have a null due_time (treated as all-day).
alter table household_tasks
  add column if not exists due_time time;
