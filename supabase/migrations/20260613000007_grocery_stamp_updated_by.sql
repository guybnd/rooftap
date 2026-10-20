-- Automatically stamp updated_by with the acting user on every write,
-- so "last edited by" is correct regardless of which client path made the change.
create or replace function public.grocery_items_stamp_updated_by()
returns trigger
language plpgsql
as $$
begin
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_grocery_items_updated_by on grocery_items;
create trigger trg_grocery_items_updated_by
  before insert or update on grocery_items
  for each row
  execute function public.grocery_items_stamp_updated_by();

-- Backfill existing rows that predate the updated_by column so they show an actor.
update grocery_items set updated_by = created_by where updated_by is null;
