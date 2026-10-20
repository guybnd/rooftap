-- FLUX-189: Recipes → groceries link columns.
--
-- When a recipe pushes a missing ingredient onto the shopping list it tags the
-- grocery item with an EPHEMERAL "250g for Lasagna"-style note. This gets its own
-- columns rather than overloading grocery_items.notes (which is user-owned free
-- text shown/searched everywhere) — so the recipe note is scopeable and clearing
-- it never clobbers the user's own note.
--
--   recipe_note      — the ephemeral amount note (e.g. "250 g for Lasagna").
--   recipe_source_id — the recipes.id this note came from (soft link, no FK: a
--                       recipe delete should leave the grocery item + its note
--                       intact rather than cascade-clearing the shopping list).
--
-- App code (src/lib/recipes.ts + the grocery status-change path) nulls BOTH when
-- the item's status leaves 'needed' (have/bought), including a manual status
-- change, while leaving `notes` untouched.
alter table grocery_items add column if not exists recipe_note text;
alter table grocery_items add column if not exists recipe_source_id uuid;
