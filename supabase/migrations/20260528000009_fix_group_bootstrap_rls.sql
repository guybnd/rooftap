-- Fix RLS catch-22 for new users bootstrapping their first group.
-- Without these policies, a user with no group_members entry cannot:
-- 1. SELECT their newly created group (needed for .insert().select())
-- 2. INSERT themselves into group_members (required to be owner first)

-- Allow users to see groups they created (needed for insert-then-select)
create policy "Creators can view their own group"
  on groups for select
  using (created_by = auth.uid());

-- Allow users to add themselves as owner of a group they created
-- (bootstraps the first membership row)
create policy "Users can join their own created group"
  on group_members for insert
  with check (
    user_id = auth.uid()
    and role = 'owner'
    and exists (
      select 1 from groups
      where groups.id = group_members.group_id
      and groups.created_by = auth.uid()
    )
  );
