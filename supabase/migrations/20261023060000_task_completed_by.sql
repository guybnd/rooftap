-- Who ticked a to-do off, so the household (and the assistant) can answer
-- "did anyone do the bins?". A trigger fills it from the signed-in person on
-- every completion, so the web app, the Android app, the widget and offline
-- replays all record it with no app change. Server tools that write with the
-- service role (no signed-in person) set it themselves, and the trigger keeps
-- their value. Un-ticking a to-do clears it, like completed_at.
--
-- Additive and safe ahead of the code: a nullable column and a trigger that
-- only fills it. Code that predates it never reads it.
alter table public.household_tasks
  add column if not exists completed_by uuid;

create or replace function public.tg_household_task_completed_by()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.done then
    if tg_op = 'INSERT' or not coalesce(old.done, false) then
      new.completed_by := coalesce(auth.uid(), new.completed_by);
    end if;
  else
    new.completed_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_household_task_completed_by on public.household_tasks;
create trigger trg_household_task_completed_by
  before insert or update of done on public.household_tasks
  for each row execute function public.tg_household_task_completed_by();
