-- FLUX-102: real-time multi-user sync for the Tasks list + Costs sections.
-- Stream household_tasks and cost_items changes to group members. RLS still
-- applies, so members only receive rows they're allowed to read.
--
-- replica identity full → DELETE/UPDATE events carry the full OLD row, so the
-- server-side group_id=eq.<id> filter can still match on delete.
alter table household_tasks replica identity full;
alter table cost_items      replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'household_tasks'
    ) then
      alter publication supabase_realtime add table household_tasks;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cost_items'
    ) then
      alter publication supabase_realtime add table cost_items;
    end if;
  end if;
end $$;
