-- Leaving a household (security audit, 2026-10-29).
--
-- 1. The person who created a household could always add themselves back to
--    it as owner ("Users can join their own created group" only checked
--    groups.created_by). Someone who had moved to another household, leaving
--    the others behind, could walk back in, read everything and remove the
--    people still there. The policy now lets a creator join only while the
--    household has no members, which is the one case it exists for: the
--    apps make a new household and then add its creator. A creator who left
--    also kept reading the household's row (name, home address) through
--    "Creators can view their own group"; that now has the same limit.
--
-- 2. A person's bank data stayed with a household after they left it or were
--    removed. Their Up connection keeps the household it was made in, so new
--    payments, filed cost lines and the weekly digest kept reaching the
--    people they had left. When a membership ends, that person's bank
--    connection, accounts, payments and bank settings in that household are
--    now deleted. Up's webhook for the deleted connection is then ignored
--    (the route answers 200 for an unknown connection). The household keeps
--    its own cost lines and link rules. The person can connect again in
--    their new household.
--
-- Safe ahead of code: no app or server code changes with it. The new
-- function is SECURITY DEFINER with a pinned search_path, and it can't be
-- called through the API.

-- 1 ------------------------------------------------------------------------
create or replace function public.group_has_members(target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from group_members where group_id = target_group_id);
$$;

revoke execute on function public.group_has_members(uuid) from public, anon;
grant execute on function public.group_has_members(uuid) to authenticated, service_role;

drop policy if exists "Users can join their own created group" on public.group_members;
create policy "Users can join their own created group"
  on public.group_members for insert
  with check (
    user_id = auth.uid()
    and role = 'owner'
    and exists (
      select 1 from public.groups
      where groups.id = group_members.group_id
        and groups.created_by = auth.uid()
    )
    and not public.group_has_members(group_id)
  );

drop policy if exists "Creators can view their own group" on public.groups;
create policy "Creators can view their own group"
  on public.groups for select
  using (created_by = auth.uid() and not public.group_has_members(id));

-- 2 ------------------------------------------------------------------------
create or replace function public.group_members_drop_bank_data()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from bank_transactions where user_id = old.user_id and group_id = old.group_id;
  delete from bank_accounts where user_id = old.user_id and group_id = old.group_id;
  delete from up_bank_connections where user_id = old.user_id and group_id = old.group_id;
  delete from bank_feed_settings where user_id = old.user_id and group_id = old.group_id;
  return old;
end;
$$;

revoke execute on function public.group_members_drop_bank_data() from public, anon, authenticated;

drop trigger if exists group_members_drop_bank_data on public.group_members;
create trigger group_members_drop_bank_data
  after delete on public.group_members
  for each row execute function public.group_members_drop_bank_data();
