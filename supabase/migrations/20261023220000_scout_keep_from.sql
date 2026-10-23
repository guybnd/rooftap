-- Scout searches can be kept from members, like a Shopper watch or a gift
-- idea: research for a present stays out of sight of the person it's for.
-- hidden_from on the search hides it, its picks and its follow-up messages
-- (the picks and messages policies look the search up under its own
-- policy). Refined runs and watches made from a pick carry the same list.
-- Additive: an empty list (the default) changes nothing for existing rows
-- or for code that predates it.

alter table public.shopper_searches add column if not exists hidden_from uuid[] not null default '{}';

drop policy if exists "Group members can view scout runs" on public.shopper_searches;
create policy "Group members can view scout runs"
  on public.shopper_searches for select
  using (is_group_member(group_id) and not hidden_from_me(hidden_from));

drop policy if exists "Group members can view scout picks" on public.shopper_picks;
create policy "Group members can view scout picks"
  on public.shopper_picks for select
  using (is_group_member(group_id) and exists (select 1 from public.shopper_searches s where s.id = shopper_picks.search_id));

drop policy if exists "Group members can view scout messages" on public.shopper_scout_messages;
create policy "Group members can view scout messages"
  on public.shopper_scout_messages for select
  using (is_group_member(group_id) and exists (select 1 from public.shopper_searches s where s.id = shopper_scout_messages.thread_id));
