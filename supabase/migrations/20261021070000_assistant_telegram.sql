-- HOUP-446: the Rooftap Assistant on Telegram (design:
-- /mnt/project-files/design/ai-agent/tickets.md, card 7).
--
-- - assistant_telegram_links: one Telegram account per member. The bot knows
--   who is speaking, so it applies that person's private items, trust and
--   allowance. `conversation_id` is the chat their private messages go to;
--   null means the household thread.
-- - assistant_telegram_codes: one-time codes a member makes in Settings and
--   sends as `/start CODE` (10 minutes).
-- - assistant_telegram_updates: Telegram update ids already handled, so a
--   webhook retry or a poller restart never answers twice.
--
-- Only the server touches these (the webhook route and the link routes, with
-- the service role), so RLS is on with no policies and only service_role is
-- granted (CLAUDE.md migration rule 6). Additive and safe ahead of code: new
-- tables only.

create table if not exists assistant_telegram_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  telegram_user_id bigint not null unique,
  telegram_username text,
  private_chat_id bigint,
  conversation_id uuid references assistant_conversations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.assistant_telegram_links to service_role;

create index if not exists idx_assistant_telegram_links_group on assistant_telegram_links(group_id);

alter table assistant_telegram_links enable row level security;

create table if not exists assistant_telegram_codes (
  code text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.assistant_telegram_codes to service_role;

create index if not exists idx_assistant_telegram_codes_user on assistant_telegram_codes(user_id);

alter table assistant_telegram_codes enable row level security;

create table if not exists assistant_telegram_updates (
  update_id bigint primary key,
  received_at timestamptz not null default now()
);

grant select, insert, update, delete on public.assistant_telegram_updates to service_role;

create index if not exists idx_assistant_telegram_updates_received on assistant_telegram_updates(received_at);

alter table assistant_telegram_updates enable row level security;

drop trigger if exists trg_assistant_telegram_links_handle_times on assistant_telegram_links;
create trigger trg_assistant_telegram_links_handle_times
  before insert or update on assistant_telegram_links
  for each row execute function public.handle_times();
