-- ════════════════════════════════════════════════════════════════════════════════
-- Group Invitations: pending invite flow with merge/abandon acceptance
-- ════════════════════════════════════════════════════════════════════════════════

create table group_invitations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  invited_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index idx_group_invitations_pending
  on group_invitations(group_id, invited_user_id)
  where status = 'pending';

create index idx_group_invitations_invited_user
  on group_invitations(invited_user_id)
  where status = 'pending';

alter table group_invitations enable row level security;

-- ── RLS policies ─────────────────────────────────────────────────────────────

create policy "Users can view their invitations"
  on group_invitations for select
  using (invited_user_id = auth.uid() or is_group_member(group_id));

create policy "Group owners can create invitations"
  on group_invitations for insert
  with check (
    invited_by = auth.uid()
    and exists (
      select 1 from group_members
      where group_id = group_invitations.group_id
      and user_id = auth.uid()
      and role = 'owner'
    )
  );

create policy "Invited users can resolve invitations"
  on group_invitations for update
  using (invited_user_id = auth.uid() and status = 'pending')
  with check (invited_user_id = auth.uid());

create policy "Owners can cancel pending invitations"
  on group_invitations for delete
  using (
    status = 'pending'
    and exists (
      select 1 from group_members
      where group_id = group_invitations.group_id
      and user_id = auth.uid()
      and role = 'owner'
    )
  );

-- Allow invited users to see the group name for display purposes
create policy "Invited users can view group name"
  on groups for select
  using (
    exists (
      select 1 from group_invitations
      where group_invitations.group_id = groups.id
      and group_invitations.invited_user_id = auth.uid()
      and group_invitations.status = 'pending'
    )
  );

-- ── RPC: accept_invitation_merge ─────────────────────────────────────────────
-- Moves ALL data from user's old group into the new group, then joins it.

create or replace function accept_invitation_merge(invitation_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  inv record;
  old_group_id uuid;
  remaining_members int;
begin
  select * into inv from group_invitations
  where id = invitation_id and invited_user_id = auth.uid() and status = 'pending';

  if not found then
    raise exception 'Invalid or already resolved invitation';
  end if;

  select group_id into old_group_id from group_members
  where user_id = auth.uid() limit 1;

  if old_group_id is not null and old_group_id <> inv.group_id then
    update apartments set group_id = inv.group_id where group_id = old_group_id;
    update checklist_items set group_id = inv.group_id where group_id = old_group_id;
    update agents set group_id = inv.group_id where group_id = old_group_id;
    update saved_searches set group_id = inv.group_id where group_id = old_group_id;

    delete from group_members where user_id = auth.uid() and group_id = old_group_id;

    select count(*) into remaining_members from group_members where group_id = old_group_id;
    if remaining_members = 0 then
      delete from groups where id = old_group_id;
    end if;
  end if;

  -- Remove any existing membership (shouldn't exist, but be safe)
  delete from group_members where user_id = auth.uid() and group_id = inv.group_id;

  insert into group_members (group_id, user_id, role)
  values (inv.group_id, auth.uid(), 'member');

  update group_invitations
  set status = 'accepted', resolved_at = now()
  where id = invitation_id;
end;
$$;

grant execute on function accept_invitation_merge(uuid) to authenticated;

-- ── RPC: accept_invitation_abandon ───────────────────────────────────────────
-- Deletes all data in user's old group, then joins the new group fresh.

create or replace function accept_invitation_abandon(invitation_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  inv record;
  old_group_id uuid;
  remaining_members int;
begin
  select * into inv from group_invitations
  where id = invitation_id and invited_user_id = auth.uid() and status = 'pending';

  if not found then
    raise exception 'Invalid or already resolved invitation';
  end if;

  select group_id into old_group_id from group_members
  where user_id = auth.uid() limit 1;

  if old_group_id is not null and old_group_id <> inv.group_id then
    delete from apartments where group_id = old_group_id;
    delete from checklist_items where group_id = old_group_id;
    delete from agents where group_id = old_group_id;
    delete from saved_searches where group_id = old_group_id;

    delete from group_members where user_id = auth.uid() and group_id = old_group_id;

    select count(*) into remaining_members from group_members where group_id = old_group_id;
    if remaining_members = 0 then
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

grant execute on function accept_invitation_abandon(uuid) to authenticated;

-- ── RPC: decline_invitation ──────────────────────────────────────────────────

create or replace function decline_invitation(invitation_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  update group_invitations
  set status = 'declined', resolved_at = now()
  where id = invitation_id
    and invited_user_id = auth.uid()
    and status = 'pending';

  if not found then
    raise exception 'Invalid or already resolved invitation';
  end if;
end;
$$;

grant execute on function decline_invitation(uuid) to authenticated;
