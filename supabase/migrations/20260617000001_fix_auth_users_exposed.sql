-- Fix Supabase `auth_users_exposed` critical advisory (FLUX-141).
--
-- The previous `public.auth_users_view` selected id+email from auth.users and
-- was granted to `authenticated`. Because views run as their owner and are
-- exposed via PostgREST, any logged-in user could enumerate every user's email
-- by querying the view without an email filter.
--
-- Replace it with a security-definer function that only ever returns the single
-- id matching an exact (lowercased) email, mirroring get_member_profiles.

drop view if exists public.auth_users_view;

create or replace function public.lookup_user_id_by_email(p_email text)
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select id
  from auth.users
  where lower(email) = lower(trim(p_email))
  limit 1;
$$;

revoke all on function public.lookup_user_id_by_email(text) from public, anon;
grant execute on function public.lookup_user_id_by_email(text) to authenticated;
