-- Fix the search path of the remaining SECURITY DEFINER functions (security
-- audit, 2026-10-22). Without a fixed search_path, a SECURITY DEFINER
-- function resolves table names through the caller's path. That is the first
-- thing a Supabase security review flags.
--
-- It also fixes a real bug on self-hosted servers: GoTrue runs the
-- on_auth_user_created trigger with search_path=auth, so
-- handle_new_user_group() could not find public.groups, and its exception
-- handler hid the error. New accounts there got no personal household until
-- the app made one.
--
-- Additive: no signature or behavior changes for callers.

alter function public.is_group_member(uuid) set search_path = public;
alter function public.handle_new_user_group() set search_path = public;
alter function public.decline_invitation(uuid) set search_path = public;
