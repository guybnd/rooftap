-- FLUX-65: per-section settings + whole-section nav visibility.
-- All per-user prefs live on user_settings (auto-loaded + realtime-synced via data-cache).
-- Note: Setup "stores" intentionally reuse the existing group-scoped setup_stores table
-- (20260612000007), not a user_settings column — they're household-shared, not per-user.
alter table user_settings
  add column if not exists hidden_sections jsonb not null default '[]'::jsonb,
  add column if not exists costs_period text,
  add column if not exists costs_budget_monthly integer,        -- stored in cents
  add column if not exists grocery_aisle_order jsonb,
  add column if not exists reminder_lead_days integer default 14;
