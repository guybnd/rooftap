-- FLUX-128: wire the notify-* Edge Functions to the database.
--   * Phase 1: a daily pg_cron job invokes notify-due-tasks.
--   * Phase 2: AFTER triggers invoke notify-task-assigned / notify-task-comment
--     via pg_net when a task is reassigned or a comment is added.
--
-- The project URL + service-role key are read from Supabase Vault at call time, so
-- this migration hardcodes no secrets and is portable across environments. Until
-- the two Vault secrets exist the invoker is a safe no-op (it never blocks the
-- triggering write). Setup is documented in supabase/functions/README.md:
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<service-role-key>',        'service_role_key');

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Fire-and-forget POST to an Edge Function. No-ops (with a notice) if the Vault
-- secrets aren't configured, so a missing config can never break a task write.
create or replace function public.notify_edge_function(fn_name text, payload jsonb)
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  base_url text;
  service_key text;
begin
  select decrypted_secret into base_url
    from vault.decrypted_secrets where name = 'project_url' limit 1;
  select decrypted_secret into service_key
    from vault.decrypted_secrets where name = 'service_role_key' limit 1;

  if base_url is null or service_key is null then
    raise notice 'notify_edge_function: Vault secrets project_url/service_role_key not set; skipping %', fn_name;
    return;
  end if;

  perform net.http_post(
    url     := base_url || '/functions/v1/' || fn_name,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || service_key
               ),
    body    := payload
  );
end;
$$;

-- This SECURITY DEFINER function is exposed as a PostgREST RPC and would default to
-- PUBLIC execute, letting any authenticated user make the DB invoke an Edge Function
-- carrying the real service-role token. Lock it down to internal (trigger/cron) use.
revoke execute on function public.notify_edge_function(text, jsonb) from public;
revoke execute on function public.notify_edge_function(text, jsonb) from anon, authenticated;

-- ---- Phase 2 trigger functions -------------------------------------------------

create or replace function public.tg_notify_task_assigned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.notify_edge_function(
    'notify-task-assigned',
    jsonb_build_object('type', 'UPDATE', 'record', to_jsonb(new), 'old_record', to_jsonb(old))
  );
  return new;
end;
$$;

create or replace function public.tg_notify_task_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.notify_edge_function(
    'notify-task-comment',
    jsonb_build_object('type', 'INSERT', 'record', to_jsonb(new))
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_task_assigned on household_tasks;
create trigger trg_notify_task_assigned
  after update of assigned_to on household_tasks
  for each row
  when (old.assigned_to is distinct from new.assigned_to and new.assigned_to is not null)
  execute function public.tg_notify_task_assigned();

-- Tasks can be created already-assigned (move-template rows, "add + assign to
-- partner"), which the UPDATE trigger never sees. Fire on INSERT too so the new
-- assignee still gets an "assigned to you" push. The edge fn tolerates a null
-- old_record (on INSERT `old` is null), so it reuses the same handler.
drop trigger if exists trg_notify_task_assigned_insert on household_tasks;
create trigger trg_notify_task_assigned_insert
  after insert on household_tasks
  for each row
  when (new.assigned_to is not null)
  execute function public.tg_notify_task_assigned();

drop trigger if exists trg_notify_task_comment on household_task_comments;
create trigger trg_notify_task_comment
  after insert on household_task_comments
  for each row
  execute function public.tg_notify_task_comment();

-- ---- Phase 1 daily reminder (pg_cron) -----------------------------------------
-- 22:00 UTC ≈ 08:00 AEST / 09:00 AEDT. Adjust the cron expression for your TZ.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'notify-due-tasks-daily') then
    perform cron.unschedule('notify-due-tasks-daily');
  end if;
  perform cron.schedule(
    'notify-due-tasks-daily',
    '0 22 * * *',
    $cron$ select public.notify_edge_function('notify-due-tasks', '{}'::jsonb) $cron$
  );
exception when others then
  raise notice 'pg_cron not available; schedule notify-due-tasks-daily manually. (%)', sqlerrm;
end $$;
