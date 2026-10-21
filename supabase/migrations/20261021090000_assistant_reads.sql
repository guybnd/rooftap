-- Rooftap Assistant: "it answered" notifications (follow-up to HOUP-443;
-- mockups https://claude.ai/artifact/D75BBdptD4T3MKBvisdKZE).
--
-- - assistant_reads: how far each member has read each conversation. A
--   conversation whose last_active_at is past read_at shows an unread dot.
--   seen_at is when the app told them about a reply with an in-app banner,
--   which stands in for a push. No row means read, so conversations from
--   before this migration don't all light up.
-- - assistant_notify_prefs: per person, whether a reply that lands after
--   they left sends a push, and whether the push shows the reply's text.
--   No row means both on.
--
-- Only the server reads and writes these (the /api/assistant routes, with
-- the service role), so RLS is on with no policies and only service_role is
-- granted (CLAUDE.md migration rule 6). Additive and safe ahead of code: new
-- tables only, and code that predates them never touches them.

create table if not exists assistant_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references assistant_conversations(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  read_at timestamptz,
  seen_at timestamptz,
  primary key (user_id, conversation_id)
);

create index if not exists idx_assistant_reads_conversation on assistant_reads(conversation_id);

alter table assistant_reads enable row level security;
grant select, insert, update, delete on public.assistant_reads to service_role;

create table if not exists assistant_notify_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  replies boolean not null default true,
  preview boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table assistant_notify_prefs enable row level security;
grant select, insert, update, delete on public.assistant_notify_prefs to service_role;
