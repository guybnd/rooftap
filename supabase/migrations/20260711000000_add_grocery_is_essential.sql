-- Add is_essential to grocery_items (FLUX-185 grocery improvement).
-- is_essential: staples (milk, toilet paper) the user wants surfaced on the Home
-- hub whenever they're still 'needed', so they can be grabbed opportunistically
-- on the way home instead of saved up for a full grocery run.
alter table grocery_items
  add column if not exists is_essential boolean not null default false;
