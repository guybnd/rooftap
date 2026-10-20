-- FLUX-101: real-time multi-user sync for the Setup section.
-- Stream setup_items changes to group members. RLS still applies, so members
-- only receive rows they're allowed to read.
--
-- replica identity full → DELETE/UPDATE events carry the full OLD row, so the
-- server-side group_id=eq.<id> filter can still match on delete (default replica
-- identity exposes only the primary key, which would drop filtered deletes).
alter table setup_items replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'setup_items'
    ) then
      alter publication supabase_realtime add table setup_items;
    end if;
  end if;
end $$;
