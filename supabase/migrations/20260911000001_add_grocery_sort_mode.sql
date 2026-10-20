-- HOUP-317: per-user groceries list view mode ('aisle' | 'flat', "One list").
-- Lives on user_settings alongside grocery_aisle_order/grocery_aisle_units
-- (auto-loaded via the existing select("*"), no RLS change needed).
alter table user_settings
  add column if not exists grocery_sort_mode text not null default 'aisle';
