-- FLUX-205: canonical item matching — split the transcribed descriptor
-- (`name`, e.g. "thinly sliced blood oranges, peeled") from the canonical
-- grocery item (`item_name`, e.g. "blood oranges") so have/need matching and
-- grocery-add flows key on the shopping item, not the full recipe line.
--
-- Additive + nullable: existing rows get item_name = null and keep matching
-- on `name` alone (app code keys on `item_name ?? name`, src/lib/recipes.ts).
alter table recipe_ingredients
  add column if not exists item_name text;
