-- Track which user last updated a grocery item
alter table grocery_items
  add column if not exists updated_by uuid references auth.users(id) on delete set null;
