-- Costs redesign: archive a cost, change a recurring cost's price from a date
-- on, and an Income category for money in.
--
-- Additive: two new columns with defaults and a wider category check. Apps
-- that predate it never write them, and an archived row reads as live to
-- them, as before.

alter table public.cost_items
  add column if not exists archived boolean not null default false,
  add column if not exists price_changes jsonb not null default '[]'::jsonb;

alter table public.cost_items drop constraint if exists cost_items_price_changes_check;
alter table public.cost_items add constraint cost_items_price_changes_check
  check (jsonb_typeof(price_changes) = 'array');

alter table public.cost_items drop constraint if exists cost_items_category_check;
alter table public.cost_items add constraint cost_items_category_check
  check (category in ('rent','utilities','internet','insurance','subscription','grocery_estimate','moving','purchase','outing','transport','health','pets','family','other','income'));
