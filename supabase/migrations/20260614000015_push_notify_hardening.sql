-- FLUX-128 follow-up: apply the push-notification hardening to environments where
-- 20260614000014 had already run before the review fixes were folded into it.
-- Editing an already-applied migration does not re-run it, so this idempotent
-- migration carries the deltas (REVOKE on the SECURITY DEFINER RPC + the
-- assigned-on-INSERT trigger). Safe to run anywhere — fresh installs get the same
-- end state from 14 and these statements are no-ops there.

-- Lock down the SECURITY DEFINER invoker so it can't be called as a PostgREST RPC.
revoke execute on function public.notify_edge_function(text, jsonb) from public;
revoke execute on function public.notify_edge_function(text, jsonb) from anon, authenticated;

-- Notify on tasks that are created already-assigned (the UPDATE trigger never sees these).
drop trigger if exists trg_notify_task_assigned_insert on household_tasks;
create trigger trg_notify_task_assigned_insert
  after insert on household_tasks
  for each row
  when (new.assigned_to is not null)
  execute function public.tg_notify_task_assigned();
