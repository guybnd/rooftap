-- Add re_add_dismissed_at to grocery_items. Dismissing a "might be running
-- low" suggestion (a one-off you neither want to buy nor snooze) stamps this
-- time; the suggestion stays hidden while the dismissal is newer than the
-- item's status_changed_at, so it comes back on its own after the next time
-- the item is bought and marked have-it. Nullable and additive: absent/legacy
-- rows are simply never dismissed, and code that predates the column ignores
-- it. Mirrors 20260712000003_add_grocery_re_add_snooze.sql.
alter table grocery_items
  add column if not exists re_add_dismissed_at timestamptz;
