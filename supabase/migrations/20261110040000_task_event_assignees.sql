-- Several people on one to-do or event (HOUP-627). `assignees` lists everyone
-- the row is for; `assigned_to` keeps the first of them, so apps and servers
-- that predate the list still see one person. When an older app changes
-- assigned_to without touching the list, readers drop the stale list
-- (packages/core/src/assignees.ts). Additive and nullable.
alter table public.household_tasks add column if not exists assignees uuid[];
alter table public.events add column if not exists assignees uuid[];

-- "Assigned to you" pushes also fire when someone is added to the list.
drop trigger if exists trg_notify_task_assigned on public.household_tasks;
create trigger trg_notify_task_assigned
  after update of assigned_to, assignees on public.household_tasks
  for each row
  when (
    (old.assigned_to is distinct from new.assigned_to or old.assignees is distinct from new.assignees)
    and new.assigned_to is not null
  )
  execute function public.tg_notify_task_assigned();
