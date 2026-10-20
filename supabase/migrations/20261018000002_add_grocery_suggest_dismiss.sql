-- Per-user default for the X on a "Might be running low" suggestion:
-- 'not_now' (hide until next bought) or 'archive' (off the list, details kept
-- in the item library). Null = not chosen yet, so the first tap asks and
-- stores the pick. Lives on user_settings next to grocery_sort_mode
-- (auto-loaded via the existing select("*"), no RLS change). Nullable and
-- additive: code that predates it never reads it.
alter table user_settings
  add column if not exists grocery_suggest_dismiss text;
