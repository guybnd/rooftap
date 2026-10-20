-- FLUX-150: make cross-device realtime fire for INSERT/DELETE, not just UPDATE.
--
-- Symptom: an in-place edit propagated to the other device instantly, but a
-- create or delete only showed up on the next focus/reconnect pull (a long lag).
--
-- Cause: Postgres logical replication only includes the FULL row image when a
-- table's REPLICA IDENTITY is FULL. With the default (primary key only), an
-- INSERT/DELETE — and the OLD image of an UPDATE — reach Supabase Realtime
-- without the non-PK columns, so the per-subscription `group_id=eq.<id>` filter
-- can't match and RLS can't be evaluated → those events are dropped. An UPDATE's
-- NEW image still carries every column, which is why edits arrived but
-- creates/deletes (incl. soft-delete tombstones, which are UPDATEs but whose
-- recipients still rely on the filter) lagged. FULL replica identity closes it.
--
-- REPLICA IDENTITY FULL is safe and reversible; the only cost is slightly larger
-- WAL records for these (small, low-write) household tables.

alter table public.grocery_items   replica identity full;
alter table public.household_tasks replica identity full;
alter table public.cost_items      replica identity full;
alter table public.setup_items     replica identity full;

-- Ensure each table is published on the realtime channel (idempotent — skip any
-- that are already members so re-running the migration never errors).
do $$
declare
  tbl text;
begin
  foreach tbl in array array['grocery_items', 'household_tasks', 'cost_items', 'setup_items']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = tbl
    ) then
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    end if;
  end loop;
end $$;
