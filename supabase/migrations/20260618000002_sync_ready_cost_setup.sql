-- FLUX-150 slices 2+3: Extend sync-ready schema to cost_items and setup_items.
--
-- Mirrors exactly what 20260618000001 did for grocery_items / household_tasks:
--   - deleted tombstone for offline soft-deletes
--   - handle_times() trigger so updated_at stays honest (Legend changesSince)
--   - (group_id, updated_at) index for efficient incremental pulls
--
-- Additive and non-destructive: existing rows backfill to deleted=false and the
-- app continues to hard-delete today; soft-delete usage arrives with the Legend
-- store pilot in FLUX-150.

-- 1. Soft-delete tombstone.
alter table cost_items  add column if not exists deleted boolean not null default false;
alter table setup_items add column if not exists deleted boolean not null default false;

-- 2. Attach the shared handle_times() trigger (defined in 20260618000001).
drop trigger if exists trg_cost_items_handle_times on cost_items;
create trigger trg_cost_items_handle_times
  before insert or update on cost_items
  for each row
  execute function public.handle_times();

drop trigger if exists trg_setup_items_handle_times on setup_items;
create trigger trg_setup_items_handle_times
  before insert or update on setup_items
  for each row
  execute function public.handle_times();

-- 3. Indexes for group-scoped changesSince pulls.
create index if not exists idx_cost_items_group_updated_at
  on cost_items(group_id, updated_at);

create index if not exists idx_setup_items_group_updated_at
  on setup_items(group_id, updated_at);
