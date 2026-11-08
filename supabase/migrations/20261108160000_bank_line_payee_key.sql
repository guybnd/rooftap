-- One bank-made cost line per payee per household.
--
-- Up's webhooks and an app sync can file the same new payee at the same
-- moment, and each run made its own line (#662). The runs cleaned up after
-- each other in app code. This key lets the database refuse the second line,
-- so the second run joins the first run's line instead.
--
-- Additive and safe before the code ships: the column is nullable, older code
-- never sets it, and the index covers only rows that have a key. Lines made
-- before this migration keep a null key, so existing duplicates cannot block
-- the index; the app's clean-up still removes those.
alter table public.cost_items add column if not exists bank_payee_key text;

create unique index if not exists uniq_bank_payee_line
  on public.cost_items (group_id, bank_payee_key)
  where bank_payee_key is not null and deleted = false;
