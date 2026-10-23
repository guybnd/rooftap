-- Feedback people send through the Assistant ("send this to the Rooftap
-- team"). It lands in the server operator's inbox (Settings > Integrations &
-- keys > Feedback), and on a server that names a GitHub repo it also opens
-- an issue there. Only the server reads and writes it, with the service role:
-- no member reads another household's feedback, so anon and authenticated
-- get no grant and RLS has no policies for them.
--
-- Additive and safe ahead of the code: a new table nothing reads yet.
create table if not exists public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  group_id uuid references public.groups (id) on delete set null,
  source text not null default 'assistant',
  message text not null,
  -- The server's commit, so a report can be matched to the code it ran.
  server_version text,
  issue_url text,
  done_at timestamptz,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.app_feedback to service_role;

alter table public.app_feedback enable row level security;

create index if not exists app_feedback_created_at_idx on public.app_feedback (created_at desc);
