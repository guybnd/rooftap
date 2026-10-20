-- FLUX-100: real-time multi-user sync for groceries + cost-line race guard.
--
-- 0) Collapse any pre-existing duplicate grocery "actual" lines for the same
--    group+day. The concurrent-sync race this migration guards against may have
--    already produced some in real data, which would block the unique index
--    below. Keep one row per (group_id, start_date) — the most recently created
--    — repoint any sessions that referenced a duplicate, then delete the rest.
do $$
begin
  -- Repoint sessions away from soon-to-be-deleted duplicates onto the keeper.
  update grocery_sessions s
     set cost_item_id = keep.id
    from (
      select distinct on (group_id, start_date) id, group_id, start_date
        from cost_items
       where category = 'grocery_estimate' and is_estimate = false
       order by group_id, start_date, created_at desc, id desc
    ) keep
    join cost_items dup
      on dup.group_id = keep.group_id
     and dup.start_date = keep.start_date
     and dup.category = 'grocery_estimate' and dup.is_estimate = false
   where s.cost_item_id = dup.id
     and dup.id <> keep.id;

  -- Delete every grocery actual line that is not its day's keeper.
  delete from cost_items c
   where c.category = 'grocery_estimate' and c.is_estimate = false
     and c.id <> (
       select keep.id
         from (
           select distinct on (group_id, start_date) id, group_id, start_date
             from cost_items
            where category = 'grocery_estimate' and is_estimate = false
            order by group_id, start_date, created_at desc, id desc
         ) keep
        where keep.group_id = c.group_id and keep.start_date = c.start_date
     );
end $$;

-- 1) Guarantee at most ONE grocery "actual" cost line per group per day. Without
--    this, two members marking items "Got it" at the same time can each INSERT a
--    "Groceries — <date>" line (one ends up orphaned). The app re-reads the
--    session's cost_item_id before inserting; this index is the hard backstop and
--    is what makes the 23505-recovery path fire.
create unique index if not exists uniq_grocery_actual_cost_line
  on cost_items (group_id, start_date)
  where category = 'grocery_estimate' and is_estimate = false;

-- 2) Stream grocery changes to group members in real time. RLS still applies, so
--    members only receive rows they're allowed to read.
--
--    replica identity full → DELETE/UPDATE events carry the full OLD row, so the
--    server-side `group_id=eq.<id>` filter can match on delete (default replica
--    identity exposes only the primary key, which would drop filtered deletes).
alter table grocery_items    replica identity full;
alter table grocery_sessions replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'grocery_items'
    ) then
      alter publication supabase_realtime add table grocery_items;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'grocery_sessions'
    ) then
      alter publication supabase_realtime add table grocery_sessions;
    end if;
  end if;
end $$;
