-- HOUP-436: a household's own AI keys, and the count of AI reads made on the
-- server's key (receipts, recipes, listings, events), so hosted Plus can have
-- a monthly allowance.
--
-- Both tables are service role only: RLS on with no policies, and no grants
-- to anon or authenticated. Keys are encrypted by the web server
-- (AES-256-GCM with HOUSEHOLD_KEYS_SECRET) before they get here, and only
-- the last four characters are ever read back to the apps, through
-- /api/ai-keys.
--
-- Additive and safe ahead of code: two new tables and a new function. Code
-- that predates them never reads them, and with no rows every AI read falls
-- back to the server's key exactly as before.

create table if not exists public.household_ai_keys (
  group_id uuid not null references public.groups(id) on delete cascade,
  provider text not null check (provider in ('openai', 'openrouter', 'gemini', 'anthropic')),
  encrypted_key text not null,
  last4 text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (group_id, provider)
);

alter table public.household_ai_keys enable row level security;
grant select, insert, update, delete on public.household_ai_keys to service_role;

create table if not exists public.ai_usage (
  group_id uuid not null references public.groups(id) on delete cascade,
  -- YYYY-MM, UTC.
  month text not null,
  -- Only reads on the server's key are counted; the household's own key is uncapped.
  reads integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (group_id, month)
);

alter table public.ai_usage enable row level security;
grant select, insert, update, delete on public.ai_usage to service_role;

-- Counts one server-key read. Service role only (the parse routes).
create or replace function public.ai_record_read(p_group_id uuid, p_month text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into ai_usage (group_id, month, reads) values (p_group_id, p_month, 1)
  on conflict (group_id, month) do update set reads = ai_usage.reads + 1, updated_at = now();
$$;

revoke execute on function public.ai_record_read(uuid, text) from public, anon, authenticated;
grant execute on function public.ai_record_read(uuid, text) to service_role;
