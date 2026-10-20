-- FLUX-182: add an optional priority to household_tasks so the redesigned
-- to-do modal can offer a Low/Med/High slider (mirrors setup_items.priority).
-- Additive + backfilled to 'medium' so existing rows read as the neutral default;
-- nullable with no NOT NULL so any task-construction site that omits it is fine.
-- A CHECK keeps it to the same three values setup_items uses.
alter table household_tasks
  add column if not exists priority text default 'medium';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'household_tasks_priority_check'
  ) then
    alter table household_tasks
      add constraint household_tasks_priority_check
      check (priority is null or priority in ('low', 'medium', 'high'));
  end if;
end $$;
