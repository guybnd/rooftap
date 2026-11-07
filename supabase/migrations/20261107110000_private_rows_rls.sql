-- Private rows stay with their owner (security audit, 2026-10-29).
--
-- Tasks, events, grocery items and setup items have a `private` flag. Until
-- now only the Assistant and MCP tools honoured it: row-level security let
-- every household member read and change a private row, the synced stores
-- delivered it to their devices, and some screens showed it. The policies
-- now match the rule the tools use (lib/pat.ts visibleTasks and friends):
-- a private row is visible only to the person it belongs to. That is
-- `assigned_to` for tasks, grocery items and setup items, and `created_by`
-- for events. A private row with no owner stays visible to the household,
-- so no existing row disappears for everyone.
--
-- Additive for older app code: the apps never create private tasks, grocery
-- items or setup items, and they already hide other people's private events,
-- so nothing they show today goes missing. Loyalty cards already work this
-- way (20261021130000_rewards.sql).

drop policy if exists "Group members can manage household tasks" on public.household_tasks;
create policy "Group members can manage household tasks"
  on public.household_tasks for all
  using (is_group_member(group_id) and (not private or assigned_to is null or assigned_to = auth.uid()))
  with check (is_group_member(group_id) and (not private or assigned_to is null or assigned_to = auth.uid()));

drop policy if exists "Group members can manage grocery items" on public.grocery_items;
create policy "Group members can manage grocery items"
  on public.grocery_items for all
  using (is_group_member(group_id) and (not private or assigned_to is null or assigned_to = auth.uid()))
  with check (is_group_member(group_id) and (not private or assigned_to is null or assigned_to = auth.uid()));

drop policy if exists "Group members can manage setup items" on public.setup_items;
create policy "Group members can manage setup items"
  on public.setup_items for all
  using (is_group_member(group_id) and (not private or assigned_to is null or assigned_to = auth.uid()))
  with check (is_group_member(group_id) and (not private or assigned_to is null or assigned_to = auth.uid()));

drop policy if exists "Group members can manage events" on public.events;
create policy "Group members can manage events"
  on public.events for all
  using (is_group_member(group_id) and (not private or created_by is null or created_by = auth.uid()))
  with check (is_group_member(group_id) and (not private or created_by is null or created_by = auth.uid()));
