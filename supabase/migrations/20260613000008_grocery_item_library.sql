-- Evolve the per-group shelf-life override table into a general "item library"
-- that also stores a typical price per item name. Shelf life becomes optional
-- (a library entry may carry only a price, or only a shelf life, or both).

alter table grocery_shelf_life_overrides rename to grocery_item_library;

alter table grocery_item_library
  add column if not exists typical_price_cents integer check (typical_price_cents is null or typical_price_cents >= 0);

-- Shelf life is no longer required (price-only entries are valid)
alter table grocery_item_library
  alter column shelf_life_days drop not null;
