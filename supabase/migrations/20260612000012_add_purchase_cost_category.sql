-- FLUX-74: add built-in 'purchase' cost category (used by the Warranties section, FLUX-72).
-- Widen the cost_items.category CHECK constraint so 'purchase' is insertable.
alter table cost_items drop constraint if exists cost_items_category_check;

alter table cost_items add constraint cost_items_category_check
  check (category in ('rent','utilities','internet','insurance','subscription','grocery_estimate','moving','purchase','other'));
