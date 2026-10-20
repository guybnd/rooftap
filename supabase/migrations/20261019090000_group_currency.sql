-- A household can pick the currency its money is shown in, separately from
-- its region (an expat household, or one that budgets in another currency).
-- Null means "follow the region", which is what every existing household
-- gets, so this is a no-op until someone picks one. Amounts carry no currency
-- of their own: switching relabels them, it doesn't convert.
--
-- Additive and nullable, so code from before this migration ignores it.

alter table groups
add column if not exists currency text;

alter table groups
drop constraint if exists valid_currency;

alter table groups
add constraint valid_currency check (currency is null or currency ~ '^[A-Z]{3}$');

comment on column groups.currency is
  'ISO 4217 currency the household''s money is shown in. Null = the region''s currency (packages/core/src/currency.ts).';
