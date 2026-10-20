-- Per-user window for the Tasks screen's Upcoming group: tasks due further
-- out than this many days sit under a collapsed "Later" group instead.
-- Null = the 90-day default (packages/core household-tasks.ts). Lives on
-- user_settings next to reminder_lead_days (auto-loaded via the existing
-- select("*"), no RLS change). Nullable and additive: code that predates it
-- never reads it.
alter table user_settings
  add column if not exists tasks_upcoming_days integer;
