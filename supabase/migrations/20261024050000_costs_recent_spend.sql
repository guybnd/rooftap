-- Recent spending on the Costs Latest card: which windows each person shows
-- and whether bills count, as {"windows": [1, 3, 7], "skipBills": true,
-- "show": true}. Read by core recent-spend.ts readRecentSpendPrefs.
--
-- Additive and safe ahead of the code: a nullable column nothing reads yet.
alter table public.user_settings
  add column if not exists costs_recent_spend jsonb;
