-- Add shelf_life_days and price columns to grocery_items (FLUX-71 UI improvements).
-- shelf_life_days: how many days this item typically lasts (displayed as "est. expiry").
-- price_cents: expected / typical price for this item (used for running total estimate).
alter table grocery_items
  add column if not exists shelf_life_days integer,
  add column if not exists price_cents integer;  -- minor units; replaces last_price as the "display" price
