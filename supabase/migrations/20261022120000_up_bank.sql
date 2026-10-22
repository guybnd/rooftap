-- Up Bank connector: a person's Up Bank connection and the transactions read
-- from it.
--
-- Each person connects their own Up account with a personal access token
-- (Up allows its API for personal use only). The web server encrypts the
-- token (AES-256-GCM with HOUSEHOLD_KEYS_SECRET, as household_ai_keys) before
-- it gets here, and only its last four characters are read back to the apps,
-- through /api/up-bank. Up can push new transactions to the server through a
-- webhook; its signing secret is encrypted the same way.
--
-- Transactions are private to the person who connected them unless they
-- share them with the household (`shared`). The server applies that rule,
-- so both tables are service role only: RLS on with no policies, and no
-- grants to anon or authenticated.
--
-- Additive and safe ahead of code: two new tables. Code that predates them
-- never reads them, and the apps only show the connector on servers that
-- have them ('connectors.up-bank' in packages/core/src/server-features.ts).

create table if not exists public.up_bank_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  encrypted_token text not null,
  last4 text not null,
  -- The household can see this person's spending.
  shared boolean not null default false,
  -- The webhook URL is /api/up-bank/webhook/<hook_id>, so it never names the person.
  hook_id uuid not null default gen_random_uuid() unique,
  webhook_id text,
  encrypted_webhook_secret text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_up_bank_connections_group on public.up_bank_connections(group_id);

alter table public.up_bank_connections enable row level security;
grant select, insert, update, delete on public.up_bank_connections to service_role;

create table if not exists public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'up' check (source in ('up')),
  -- The bank's own id for the transaction.
  external_id text not null,
  account_name text,
  description text not null,
  message text,
  -- Minor units (cents); money out is negative.
  amount_cents bigint not null,
  currency text not null default 'AUD',
  -- The bank's category ids, e.g. 'takeaway' under 'good-life'.
  category text,
  parent_category text,
  status text not null default 'SETTLED' check (status in ('HELD', 'SETTLED')),
  -- A move between the person's own accounts (round ups, savers).
  is_transfer boolean not null default false,
  occurred_at timestamptz not null,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, user_id, external_id)
);

create index if not exists idx_bank_transactions_group_time on public.bank_transactions(group_id, occurred_at desc);
create index if not exists idx_bank_transactions_user_time on public.bank_transactions(user_id, occurred_at desc);

alter table public.bank_transactions enable row level security;
grant select, insert, update, delete on public.bank_transactions to service_role;
