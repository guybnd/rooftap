-- FLUX-258: per-user pinned event for the summary-hero countdown module.
-- Nullable with no default (unlike home_hero_modules' '{}' map) — "nothing
-- pinned" is the expected state. Sibling column, not a reshape of
-- home_hero_modules, per that migration's own comment.
alter table user_settings
  add column if not exists home_hero_countdown jsonb;
