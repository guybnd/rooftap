-- FLUX-208: More robust grocery Item Library.
-- Additive columns on the per-group override table `grocery_item_library`:
--   * hidden      — tombstone flag so a built-in (seed) item can be hidden from
--                   the catalog without deleting compiled-in seed data.
--   * created_at  — supports the catalog's "Last added" sort.
-- RLS is inherited from the existing table policies (is_group_member); no policy
-- changes needed. All columns are default-safe so existing rows are unaffected.

alter table public.grocery_item_library
  add column if not exists hidden boolean not null default false,
  add column if not exists created_at timestamptz not null default now();
