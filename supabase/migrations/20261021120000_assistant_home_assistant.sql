-- HOUP-449: a household's Home Assistant connection for the assistant.
--
-- Rooftap talks to Home Assistant's own MCP Server integration (/api/mcp) with
-- a long-lived access token. The token is encrypted by the web server
-- (AES-256-GCM with HOUSEHOLD_KEYS_SECRET, as household_ai_keys) before it
-- gets here, and only its last four characters are ever read back to the
-- apps, through /api/assistant/home-assistant.
--
-- Service role only: RLS on with no policies, and no grants to anon or
-- authenticated.
--
-- Additive and safe ahead of code: one new table. Code that predates it
-- never reads it, and with no row the assistant has no Home Assistant tools,
-- exactly as before.

create table if not exists public.assistant_home_assistant (
  group_id uuid primary key references public.groups(id) on delete cascade,
  -- The Home Assistant base URL, e.g. https://home.example.com (no /api/mcp).
  url text not null,
  encrypted_token text not null,
  last4 text not null,
  -- read | ask | act, as the per-module assistant trust.
  trust text not null default 'ask' check (trust in ('read', 'ask', 'act')),
  -- Home Assistant tool names the assistant may use; null means all of them.
  allowed_tools text[],
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.assistant_home_assistant enable row level security;
grant select, insert, update, delete on public.assistant_home_assistant to service_role;
