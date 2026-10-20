-- FLUX-148: Sync-ready schema for the Legend-State local-first migration (FLUX-147).
--
-- Legend-State's incremental `changesSince` sync requires each synced table to
-- carry created_at, updated_at (timestamptz) and a `deleted` boolean, with a
-- trigger that bumps updated_at on every write. grocery_items and household_tasks
-- already have created_at/updated_at, but NOTHING currently bumps updated_at on
-- UPDATE (the existing grocery trigger only stamps updated_by) — so incremental
-- sync would miss edits. This migration fills both gaps.
--
-- Additive and non-destructive: existing rows backfill to deleted=false and the
-- current app keeps working unchanged (it still reads deleted=false rows via
-- `select *`, and continues to hard-delete; soft-delete usage arrives with the
-- Legend-State pilot in FLUX-149).

-- 1. Soft-delete flag (tombstone so offline clients learn about deletions on sync).
alter table grocery_items   add column if not exists deleted boolean not null default false;
alter table household_tasks add column if not exists deleted boolean not null default false;

-- 2. Shared trigger function: keep updated_at honest on every write so a
--    `changesSince` pull never misses a change. created_at is set once on insert
--    and never moved.
create or replace function public.handle_times()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'INSERT') then
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := coalesce(new.updated_at, now());
  else
    new.updated_at := now();
    new.created_at := old.created_at;  -- created_at is immutable
  end if;
  return new;
end;
$$;

-- 3. Attach to both tables. Composes with the existing grocery updated_by trigger
--    (different column, runs as a separate BEFORE trigger).
drop trigger if exists trg_grocery_items_handle_times on grocery_items;
create trigger trg_grocery_items_handle_times
  before insert or update on grocery_items
  for each row
  execute function public.handle_times();

drop trigger if exists trg_household_tasks_handle_times on household_tasks;
create trigger trg_household_tasks_handle_times
  before insert or update on household_tasks
  for each row
  execute function public.handle_times();

-- 4. Indexes to keep group-scoped `changesSince` pulls (where group_id = ? and
--    updated_at > last_sync) efficient.
create index if not exists idx_grocery_items_group_updated_at
  on grocery_items(group_id, updated_at);
create index if not exists idx_household_tasks_group_updated_at
  on household_tasks(group_id, updated_at);
