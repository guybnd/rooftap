-- HOUP-327: account-wide defaults for the checklist detail view (completed
-- band placement/collapse, default sort). Lives on user_settings alongside
-- grocery_sort_mode (auto-loaded via the existing select("*"), no RLS change
-- needed). Per-list overrides are device-local (see use-checklist-view-prefs.ts).
alter table user_settings
  add column if not exists checklists_completed_to_bottom boolean not null default true,
  add column if not exists checklists_collapse_completed boolean not null default false,
  add column if not exists checklists_default_sort text not null default 'manual';
