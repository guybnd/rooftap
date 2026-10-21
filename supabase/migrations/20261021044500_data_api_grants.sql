-- Explicit Data API grants on every existing public table and sequence.
--
-- From 2026-10-30 Supabase stops granting anon/authenticated/service_role on
-- new public tables by default, and that includes migrations replayed onto a
-- fresh project (new Supabase projects, preview branches, `supabase db
-- reset`, and self-host once its postgres image picks up the new defaults).
-- Until now every migration leaned on those default privileges, so a fresh
-- replay would leave the whole app answering "permission denied".
--
-- This re-states, explicitly, what the default privileges have granted so
-- far. On the hosted project, and any install that already has the tables,
-- it's a no-op. Row access is still decided by RLS, which every public table
-- has enabled. Tables created after this migration carry their own grants in
-- the migration that creates them (checked by
-- apps/web/src/lib/migration-grants.test.ts).

grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
