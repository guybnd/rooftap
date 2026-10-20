-- FLUX-120: real-time sync for the documents store so a capture shows up on the
-- /documents page immediately (no navigate-away-and-back). RLS still applies, so
-- members only receive rows they're allowed to read.
--
-- replica identity full → DELETE/UPDATE events carry the full OLD row, so the
-- server-side group_id=eq.<id> filter still matches on delete.
alter table documents      replica identity full;
alter table document_links replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'documents'
    ) then
      alter publication supabase_realtime add table documents;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'document_links'
    ) then
      alter publication supabase_realtime add table document_links;
    end if;
  end if;
end $$;
