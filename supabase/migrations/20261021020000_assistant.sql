-- HOUP-441: Rooftap Assistant data (design: /mnt/project-files/design/ai-agent/,
-- rules: packages/core/src/assistant.ts).
--
-- - assistant_settings: one row per household, owners write (trust per
--   module, models, context size, quick-ask idle window, budget).
-- - assistant_member_limits: a person's allowance inside the household,
--   owners write.
-- - assistant_conversations / assistant_messages: quick asks, chats and the
--   one household thread. A person sees their own quick asks and chats plus
--   the household thread. Messages are written only by the server (service
--   role), which runs the model and the tools.
-- - assistant_memories: facts the assistant (or a member) keeps about the
--   household. Members manage them.
-- - assistant_usage: tokens and spend per person, month, feature and model,
--   written only by the server through assistant_record_usage().
--
-- Additive and safe ahead of code: new tables and a new function only;
-- nothing reads them until the assistant module ships and is switched on.

create table if not exists assistant_settings (
  group_id uuid primary key references groups(id) on delete cascade,
  trust jsonb not null default '{}'::jsonb,
  chat_model text,
  quick_model text,
  context_messages integer,
  quick_ask_idle_minutes integer,
  monthly_budget_cents integer check (monthly_budget_cents is null or monthly_budget_cents >= 0),
  at_limit text not null default 'warn' check (at_limit in ('warn', 'cheap', 'stop')),
  warn_at_percent integer check (warn_at_percent is null or warn_at_percent between 1 and 100),
  show_cost_per_reply boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table assistant_settings enable row level security;

drop policy if exists "Members can view assistant settings" on assistant_settings;
create policy "Members can view assistant settings"
  on assistant_settings for select
  using (is_group_member(group_id));

drop policy if exists "Owners can insert assistant settings" on assistant_settings;
create policy "Owners can insert assistant settings"
  on assistant_settings for insert
  with check (exists (
    select 1 from public.group_members gm
    where gm.group_id = assistant_settings.group_id
    and gm.user_id = auth.uid()
    and gm.role = 'owner'
  ));

drop policy if exists "Owners can update assistant settings" on assistant_settings;
create policy "Owners can update assistant settings"
  on assistant_settings for update
  using (exists (
    select 1 from public.group_members gm
    where gm.group_id = assistant_settings.group_id
    and gm.user_id = auth.uid()
    and gm.role = 'owner'
  ))
  with check (exists (
    select 1 from public.group_members gm
    where gm.group_id = assistant_settings.group_id
    and gm.user_id = auth.uid()
    and gm.role = 'owner'
  ));

create table if not exists assistant_member_limits (
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  monthly_budget_cents integer check (monthly_budget_cents is null or monthly_budget_cents >= 0),
  read_only boolean not null default false,
  routines boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table assistant_member_limits enable row level security;

drop policy if exists "Members can view assistant member limits" on assistant_member_limits;
create policy "Members can view assistant member limits"
  on assistant_member_limits for select
  using (is_group_member(group_id));

drop policy if exists "Owners can manage assistant member limits" on assistant_member_limits;
create policy "Owners can manage assistant member limits"
  on assistant_member_limits for all
  using (exists (
    select 1 from public.group_members gm
    where gm.group_id = assistant_member_limits.group_id
    and gm.user_id = auth.uid()
    and gm.role = 'owner'
  ))
  with check (exists (
    select 1 from public.group_members gm
    where gm.group_id = assistant_member_limits.group_id
    and gm.user_id = auth.uid()
    and gm.role = 'owner'
  ));

create table if not exists assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  -- Null only for the household thread, which belongs to everyone.
  owner_id uuid references auth.users(id) on delete cascade,
  kind text not null check (kind in ('quick', 'chat', 'household')),
  title text,
  pinned boolean not null default false,
  -- Rolling summary of messages older than the context window.
  summary text,
  summarized_through timestamptz,
  last_active_at timestamptz not null default now(),
  -- Quick asks only: when it stops taking follow-ups.
  closes_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  check ((kind = 'household') = (owner_id is null))
);

create index if not exists idx_assistant_conversations_group on assistant_conversations(group_id, last_active_at desc);
create index if not exists idx_assistant_conversations_owner on assistant_conversations(owner_id, last_active_at desc);
create unique index if not exists idx_assistant_household_thread
  on assistant_conversations(group_id) where kind = 'household' and not deleted;

alter table assistant_conversations enable row level security;

drop policy if exists "Members can view their assistant conversations" on assistant_conversations;
create policy "Members can view their assistant conversations"
  on assistant_conversations for select
  using (is_group_member(group_id) and (kind = 'household' or owner_id = auth.uid()));

-- Renaming, pinning and deleting your own chats; the server creates them.
drop policy if exists "Members can update their own assistant conversations" on assistant_conversations;
create policy "Members can update their own assistant conversations"
  on assistant_conversations for update
  using (is_group_member(group_id) and owner_id = auth.uid())
  with check (is_group_member(group_id) and owner_id = auth.uid());

create table if not exists assistant_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references assistant_conversations(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  -- Who spoke (user messages) or who the turn ran for (assistant and tool messages).
  user_id uuid references auth.users(id) on delete set null,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text not null default '',
  tool_calls jsonb,
  -- Changes waiting on a tap (trust level "ask"), and what became of them.
  proposal jsonb,
  proposal_state text check (proposal_state is null or proposal_state in ('pending', 'confirmed', 'declined', 'expired')),
  channel text not null default 'app' check (channel in ('app', 'telegram', 'routine')),
  model text,
  input_tokens integer,
  output_tokens integer,
  cost_micros bigint,
  created_at timestamptz not null default now()
);

create index if not exists idx_assistant_messages_conversation on assistant_messages(conversation_id, created_at);
create index if not exists idx_assistant_messages_pending
  on assistant_messages(group_id) where proposal_state = 'pending';

alter table assistant_messages enable row level security;

drop policy if exists "Members can view messages in their assistant conversations" on assistant_messages;
create policy "Members can view messages in their assistant conversations"
  on assistant_messages for select
  using (exists (
    select 1 from assistant_conversations c
    where c.id = assistant_messages.conversation_id
    and is_group_member(c.group_id)
    and (c.kind = 'household' or c.owner_id = auth.uid())
  ));

create table if not exists assistant_memories (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  text text not null check (length(trim(text)) > 0),
  source text not null default 'manual' check (source in ('agent', 'manual')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create index if not exists idx_assistant_memories_group on assistant_memories(group_id) where not deleted;

alter table assistant_memories enable row level security;

drop policy if exists "Members can manage assistant memories" on assistant_memories;
create policy "Members can manage assistant memories"
  on assistant_memories for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

create table if not exists assistant_usage (
  group_id uuid not null references groups(id) on delete cascade,
  -- Null for household-level work such as routines.
  user_id uuid references auth.users(id) on delete set null,
  month date not null,
  feature text not null check (feature in ('chat', 'quick', 'household', 'routine', 'voice', 'telegram')),
  model text not null,
  -- Whose key paid: the household's own, or the server's (Plus allowance or operator).
  key_source text not null check (key_source in ('household', 'server')),
  turns integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_micros bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- user_id is nullable, so uniqueness goes through an expression index.
create unique index if not exists idx_assistant_usage_key
  on assistant_usage(group_id, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), month, feature, model, key_source);

alter table assistant_usage enable row level security;

drop policy if exists "Members can view assistant usage" on assistant_usage;
create policy "Members can view assistant usage"
  on assistant_usage for select
  using (is_group_member(group_id));

-- Adds one turn's tokens and spend. Service role only (the assistant routes).
create or replace function assistant_record_usage(
  p_group_id uuid,
  p_user_id uuid,
  p_month date,
  p_feature text,
  p_model text,
  p_key_source text,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_cost_micros bigint
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into assistant_usage (group_id, user_id, month, feature, model, key_source, turns, input_tokens, output_tokens, cost_micros)
  values (p_group_id, p_user_id, p_month, p_feature, p_model, p_key_source, 1, p_input_tokens, p_output_tokens, p_cost_micros)
  on conflict (group_id, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), month, feature, model, key_source)
  do update set
    turns = assistant_usage.turns + 1,
    input_tokens = assistant_usage.input_tokens + excluded.input_tokens,
    output_tokens = assistant_usage.output_tokens + excluded.output_tokens,
    cost_micros = assistant_usage.cost_micros + excluded.cost_micros,
    updated_at = now();
$$;

revoke execute on function assistant_record_usage(uuid, uuid, date, text, text, text, bigint, bigint, bigint) from public, anon, authenticated;

drop trigger if exists trg_assistant_settings_handle_times on assistant_settings;
create trigger trg_assistant_settings_handle_times
  before insert or update on assistant_settings
  for each row execute function public.handle_times();

drop trigger if exists trg_assistant_member_limits_handle_times on assistant_member_limits;
create trigger trg_assistant_member_limits_handle_times
  before insert or update on assistant_member_limits
  for each row execute function public.handle_times();

drop trigger if exists trg_assistant_conversations_handle_times on assistant_conversations;
create trigger trg_assistant_conversations_handle_times
  before insert or update on assistant_conversations
  for each row execute function public.handle_times();

drop trigger if exists trg_assistant_memories_handle_times on assistant_memories;
create trigger trg_assistant_memories_handle_times
  before insert or update on assistant_memories
  for each row execute function public.handle_times();
