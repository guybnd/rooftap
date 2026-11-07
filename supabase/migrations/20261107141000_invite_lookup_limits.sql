-- Inviting by email tells less about strangers (security audit, 2026-10-29).
--
-- Any signed-in user could call lookup_user_id_by_email as often as they
-- liked to learn which emails have an account, then invite one and read the
-- person's name and photo through get_member_profiles while the invitation
-- waited. Now:
--
-- 1. lookup_user_id_by_email answers each person 20 times a day. Past that,
--    every email reads as "not found". (Everyone owns a household of their
--    own from sign-up, so limiting it to owners would not help.)
-- 2. While an invitation waits, the inviting household sees the email it
--    typed, but not the person's name or photo. Those show once the person
--    accepts and joins.
--
-- Safe ahead of code: the function signatures do not change. The new table
-- is reached only through the function, so the Data API roles get no grant
-- on it besides the service role.

create table if not exists public.email_lookup_hits (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  hits integer not null default 0,
  primary key (user_id, day)
);

alter table public.email_lookup_hits enable row level security;
grant select, insert, update, delete on public.email_lookup_hits to service_role;

-- 1 ------------------------------------------------------------------------
create or replace function public.lookup_user_id_by_email(p_email text)
returns uuid
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  used integer;
begin
  if caller is null then return null; end if;
  insert into public.email_lookup_hits as h (user_id, day, hits)
  values (caller, current_date, 1)
  on conflict (user_id, day) do update set hits = h.hits + 1
  returning hits into used;
  if used > 20 then return null; end if;
  return (
    select id from auth.users
    where lower(email) = lower(trim(p_email))
    limit 1
  );
end;
$$;

revoke all on function public.lookup_user_id_by_email(text) from public, anon;
grant execute on function public.lookup_user_id_by_email(text) to authenticated, service_role;

-- 2 ------------------------------------------------------------------------
create or replace function public.get_member_profiles(member_ids uuid[])
returns table (id uuid, email text, display_name text, avatar_url text)
language sql
stable
security definer
set search_path = ''
as $$
  with seen as (
    select
      u.*,
      (
        coalesce(auth.jwt()->>'role', '') = 'service_role'
        or u.id = auth.uid()
        or exists (
          select 1
          from public.group_members mine
          join public.group_members theirs on theirs.group_id = mine.group_id
          where mine.user_id = auth.uid() and theirs.user_id = u.id
        )
        or exists (
          select 1 from public.group_invitations i
          where i.status = 'pending' and i.invited_user_id = auth.uid() and i.invited_by = u.id
        )
      ) as full_profile,
      exists (
        select 1 from public.group_invitations i
        where i.status = 'pending'
          and i.invited_user_id = u.id
          and exists (
            select 1 from public.group_members m
            where m.group_id = i.group_id and m.user_id = auth.uid()
          )
      ) as invited_here
    from auth.users u
    where u.id = any(member_ids)
  )
  select
    s.id,
    s.email::text,
    case when s.full_profile
      then coalesce(s.raw_user_meta_data->>'full_name', s.raw_user_meta_data->>'name', '')
      else '' end::text as display_name,
    case when s.full_profile
      then coalesce(s.raw_user_meta_data->>'avatar_url', s.raw_user_meta_data->>'picture', '')
      else '' end::text as avatar_url
  from seen s
  where s.full_profile or s.invited_here;
$$;

revoke all on function public.get_member_profiles(uuid[]) from public, anon;
grant execute on function public.get_member_profiles(uuid[]) to authenticated, service_role;
