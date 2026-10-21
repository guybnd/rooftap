-- HOUP-437: Shopper sources a household has switched off in Settings > Shopper.
-- Written only by the server (/api/shopper/sources, service role) after it
-- checks the caller belongs to the household; the apps read it through
-- that route. Additive: an empty list means every applicable source is on,
-- which is how Shopper behaved before this column existed.
alter table public.groups
  add column if not exists shopper_disabled_sources text[] not null default '{}';
