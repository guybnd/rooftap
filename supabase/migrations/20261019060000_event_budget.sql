-- Calendar: an event's ticket cost as a Budget line. Additive and safe ahead of
-- its code: a nullable link column on events, and the cost_items category
-- check widened to allow 'outing' (Going out). Existing rows are untouched.

alter table public.events
  add column if not exists cost_item_id uuid references public.cost_items(id) on delete set null;

comment on column public.events.cost_item_id is
  'The Budget line (cost_items, category outing) for this event''s tickets, if any.';

alter table public.cost_items drop constraint if exists cost_items_category_check;
alter table public.cost_items add constraint cost_items_category_check
  check (category in ('rent','utilities','internet','insurance','subscription','grocery_estimate','moving','purchase','outing','other'));
