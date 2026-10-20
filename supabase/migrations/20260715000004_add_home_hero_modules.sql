-- FLUX-253: per-user on/off config for the summary-hero module registry. Flat
-- key -> boolean map; a missing key falls back to the module's own defaultOn.
-- Future ordering/density preferences get their own sibling columns, not a
-- reshape of this blob (jsonb makes adding a column free).
alter table user_settings
  add column if not exists home_hero_modules jsonb not null default '{}'::jsonb;
