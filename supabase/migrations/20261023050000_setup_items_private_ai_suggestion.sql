-- Both apps have always sent `private` and `ai_suggestion` when they create a
-- setup item (packages/core SetupItem), but no migration ever added the two
-- columns. A database built only from these migrations (self-hosted, a fresh
-- `supabase db reset`) rejects that insert with PGRST204, and the sync layer
-- drops the write, so new setup items never reach the server. Additive and
-- guarded, so it is a no-op where the columns already exist.
alter table public.setup_items
  add column if not exists private boolean not null default false,
  add column if not exists ai_suggestion jsonb;
