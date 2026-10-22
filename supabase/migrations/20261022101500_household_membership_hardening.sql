-- Household membership hardening (security audit, 2026-10-22).
--
-- 1. An invited user could UPDATE any column of their own pending invitation,
--    including group_id. Combined with a self-invite (an owner inviting
--    themselves to their own household), anyone who knew a household's id
--    could point the invitation at it and accept it: instant membership and
--    full read/write access. Accepting and declining already go through the
--    SECURITY DEFINER functions below, so clients never need a direct UPDATE.
--    The policy goes, and an owner can no longer invite themselves.
--
-- 2. An owner could INSERT any user id straight into group_members of their
--    own household, with no invitation. The apps pick the newest membership,
--    so the added person's apps switched to the other household and
--    everything they then entered went there. No client inserts members of
--    another user (new households insert their creator through "Users can
--    join their own created group"; the admin Users panel uses the service
--    role), so the policy goes.
--
-- 3. get_member_profiles returned the email of any user id to anyone,
--    including the anon role. It now returns only people the caller shares a
--    household with or has a pending invitation with. The service role (the
--    admin Users panel) still sees everyone.
--
-- 4. Accepting an invitation deleted (abandon) or moved (merge) the old
--    household's home-search rows even when other people were still in it.
--    Now the old household's rows are only touched when the person leaving
--    was its last member.
--
-- Additive for older app code: no client used the dropped policies, and the
-- RPC signatures do not change.

-- 1 ------------------------------------------------------------------------
drop policy if exists "Invited users can resolve invitations" on public.group_invitations;

drop policy if exists "Group owners can create invitations" on public.group_invitations;
create policy "Group owners can create invitations"
  on public.group_invitations for insert
  with check (
    invited_by = auth.uid()
    and invited_user_id <> auth.uid()
    and exists (
      select 1 from public.group_members
      where group_members.group_id = group_invitations.group_id
        and group_members.user_id = auth.uid()
        and group_members.role = 'owner'
    )
  );

-- 2 ------------------------------------------------------------------------
drop policy if exists "Owners can manage group members" on public.group_members;

-- 3 ------------------------------------------------------------------------
create or replace function public.get_member_profiles(member_ids uuid[])
returns table (id uuid, email text, display_name text, avatar_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    u.id,
    u.email::text,
    coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', '')::text as display_name,
    coalesce(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture', '')::text as avatar_url
  from auth.users u
  where u.id = any(member_ids)
    and (
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
        where i.status = 'pending'
          and (
            (i.invited_user_id = u.id and exists (
              select 1 from public.group_members m
              where m.group_id = i.group_id and m.user_id = auth.uid()
            ))
            or (i.invited_user_id = auth.uid() and i.invited_by = u.id)
          )
      )
    );
$$;

revoke all on function public.get_member_profiles(uuid[]) from public, anon;
grant execute on function public.get_member_profiles(uuid[]) to authenticated, service_role;

-- 4 ------------------------------------------------------------------------
create or replace function public.accept_invitation_abandon(invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  old_group_id uuid;
  others int;
begin
  select * into inv from group_invitations
  where id = invitation_id and invited_user_id = auth.uid() and status = 'pending';

  if not found then
    raise exception 'Invalid or already resolved invitation';
  end if;

  select group_id into old_group_id from group_members
  where user_id = auth.uid() limit 1;

  if old_group_id is not null and old_group_id <> inv.group_id then
    select count(*) into others from group_members
    where group_id = old_group_id and user_id <> auth.uid();

    -- Only a household the person is leaving empty loses its rows.
    if others = 0 then
      delete from apartments where group_id = old_group_id;
      delete from checklist_items where group_id = old_group_id;
      delete from agents where group_id = old_group_id;
      delete from saved_searches where group_id = old_group_id;
    end if;

    delete from group_members where user_id = auth.uid() and group_id = old_group_id;

    if others = 0 then
      delete from groups where id = old_group_id;
    end if;
  end if;

  delete from group_members where user_id = auth.uid() and group_id = inv.group_id;

  insert into group_members (group_id, user_id, role)
  values (inv.group_id, auth.uid(), 'member');

  update group_invitations
  set status = 'accepted', resolved_at = now()
  where id = invitation_id;
end;
$$;

create or replace function public.accept_invitation_merge(invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  old_group_id uuid;
  others int;
begin
  select * into inv from group_invitations
  where id = invitation_id and invited_user_id = auth.uid() and status = 'pending';

  if not found then
    raise exception 'Invalid or already resolved invitation';
  end if;

  select group_id into old_group_id from group_members
  where user_id = auth.uid() limit 1;

  if old_group_id is not null and old_group_id <> inv.group_id then
    select count(*) into others from group_members
    where group_id = old_group_id and user_id <> auth.uid();

    -- Shared rows stay with the people still in the old household.
    if others = 0 then
      update apartments set group_id = inv.group_id where group_id = old_group_id;
      update checklist_items set group_id = inv.group_id where group_id = old_group_id;
      update agents set group_id = inv.group_id where group_id = old_group_id;
      update saved_searches set group_id = inv.group_id where group_id = old_group_id;
    end if;

    delete from group_members where user_id = auth.uid() and group_id = old_group_id;

    if others = 0 then
      delete from groups where id = old_group_id;
    end if;
  end if;

  delete from group_members where user_id = auth.uid() and group_id = inv.group_id;

  insert into group_members (group_id, user_id, role)
  values (inv.group_id, auth.uid(), 'member');

  update group_invitations
  set status = 'accepted', resolved_at = now()
  where id = invitation_id;
end;
$$;

revoke all on function public.accept_invitation_abandon(uuid) from public, anon;
revoke all on function public.accept_invitation_merge(uuid) from public, anon;
revoke all on function public.decline_invitation(uuid) from public, anon;
grant execute on function public.accept_invitation_abandon(uuid) to authenticated;
grant execute on function public.accept_invitation_merge(uuid) to authenticated;
grant execute on function public.decline_invitation(uuid) to authenticated;
