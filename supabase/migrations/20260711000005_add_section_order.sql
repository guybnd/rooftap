-- FLUX-165: per-user section order for the sidebar switcher (desktop grid +
-- mobile bottom bar). An array of section ids; the app applies it before the
-- FLUX-65 hidden_sections filter and appends any unknown/new sections at the
-- end (see orderSections in src/lib/sections.ts). Mirrors the hidden_sections
-- pattern (20260614000002); the hook degrades gracefully if this column is
-- missing (localStorage fallback).
alter table user_settings
  add column if not exists section_order jsonb not null default '[]'::jsonb;
