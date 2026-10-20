-- Add re_add_snoozed_until to grocery_items (FLUX-207 grocery improvement:
-- suggest re-add after expiry). Snoozing a "suggest re-add" suggestion (still
-- have it) hides it from the suggestion surfaces until this date. Nullable:
-- absent/legacy rows are simply never snoozed. Mirrors the shape of
-- 20260711000001_add_grocery_status_changed_at.sql.
alter table grocery_items
  add column if not exists re_add_snoozed_until timestamptz;
