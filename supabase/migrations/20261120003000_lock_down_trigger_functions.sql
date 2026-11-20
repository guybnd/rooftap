-- Health check, 2026-11-20: lock down functions the Supabase security
-- advisor flags.
--
-- 1. Seven SECURITY DEFINER trigger functions could be called through
--    /rest/v1/rpc by anyone, signed in or not. They only ever run as
--    triggers. Postgres checks EXECUTE when a trigger is created, not when
--    it fires, so revoking it changes nothing for the triggers.
-- 2. Five plain functions had no fixed search_path.
--
-- Not changed on purpose: is_group_member (RLS policies call it as the
-- querying role), peek_household_invite (the invite page calls it before
-- sign-in), and the signed-in RPCs the app calls.
--
-- Additive and safe before any code ships: no signature or behavior change.

revoke execute on function public.care_jobs_sync_reminder() from public, anon, authenticated;
revoke execute on function public.handle_new_user_group() from public, anon, authenticated;
revoke execute on function public.household_tasks_care_done() from public, anon, authenticated;
revoke execute on function public.tg_calendar_push_appointment() from public, anon, authenticated;
revoke execute on function public.tg_calendar_push_task() from public, anon, authenticated;
revoke execute on function public.tg_notify_task_assigned() from public, anon, authenticated;
revoke execute on function public.tg_notify_task_comment() from public, anon, authenticated;

alter function public.grocery_items_stamp_updated_by() set search_path = public;
alter function public.handle_times() set search_path = public;
alter function public.document_folders_reject_cycle() set search_path = public;
alter function public.group_modules_stamp_updated_by() set search_path = public;
alter function public.care_next_due(integer, text, integer, date) set search_path = public;
