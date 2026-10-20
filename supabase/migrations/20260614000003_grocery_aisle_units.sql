-- FLUX-65 (follow-up): per-aisle default unit for groceries.
-- A per-user map of aisle id (built-in) or custom-aisle name -> default unit string
-- (e.g. {"produce":"kg","drinks":"L"}). New items added to an aisle prefill this unit.
-- Lives on user_settings alongside grocery_aisle_order (auto-loaded + realtime-synced).
alter table user_settings
  add column if not exists grocery_aisle_units jsonb not null default '{}'::jsonb;
