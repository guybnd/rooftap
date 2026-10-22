-- Scout threads: follow-up questions and refined searches on a Scout run.
-- A run's page becomes a thread. Each message the person writes, and each
-- answer Scout gives, is a shopper_scout_messages row on the first run of the
-- thread. When the person changes the search, Scout starts a new run linked
-- to that first run by thread_id, so a refined search counts as a run like
-- any other. Both are written only by the server (service role) after it
-- checks membership, plan and key. Members read them through the API.
--
-- Additive and safe ahead of code: one new table and one nullable column.
-- Code that predates it never reads either, and a run without thread_id is a
-- thread of its own.

alter table public.shopper_searches
  add column if not exists thread_id uuid references public.shopper_searches(id) on delete cascade;

create index if not exists idx_shopper_searches_thread on public.shopper_searches(thread_id) where thread_id is not null;

create table if not exists public.shopper_scout_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  -- The first run of the thread.
  thread_id uuid not null references public.shopper_searches(id) on delete cascade,
  role text not null check (role in ('user', 'scout')),
  text text not null default '',
  -- The pick a question was about, when it came from a pick.
  pick_id uuid references public.shopper_picks(id) on delete set null,
  -- The run this message started, for "Searching again" answers.
  search_id uuid references public.shopper_searches(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create index if not exists idx_shopper_scout_messages_thread on public.shopper_scout_messages(thread_id, created_at);

alter table public.shopper_scout_messages enable row level security;
grant select, insert, update, delete on public.shopper_scout_messages to anon, authenticated, service_role;

drop policy if exists "Group members can view scout messages" on public.shopper_scout_messages;
create policy "Group members can view scout messages"
  on public.shopper_scout_messages for select
  using (is_group_member(group_id));

drop trigger if exists trg_shopper_scout_messages_handle_times on public.shopper_scout_messages;
create trigger trg_shopper_scout_messages_handle_times
  before insert or update on public.shopper_scout_messages
  for each row execute function public.handle_times();
