-- Add aisle to grocery_item_library (FLUX-188 grocery improvement #2).
-- The item library previously stored only shelf_life_days + typical_price_cents.
-- Archiving an item now pushes its aisle too, so re-adding it later (via the
-- search "no match" suggestions) restores the aisle rather than dropping it into
-- "other". Nullable: existing library entries simply have no learned aisle.
alter table grocery_item_library
  add column if not exists aisle text;
