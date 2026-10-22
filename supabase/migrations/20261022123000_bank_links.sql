-- Up Bank connector, part two: account balances, the rest of each
-- transaction (Up tags, the bank's raw text), and links from bank payments to
-- the household's cost lines.
--
-- A link rule ties a cost line to payments: any payment whose description
-- contains `match` (ignoring case), or that carries the Up tag `#match`.
-- The server applies the rules after each read from Up and stores the result
-- on the transaction (cost_item_id, link_kind 'rule'). A person can also link
-- one payment by hand (link_kind 'manual'), hide it from spending totals, or
-- add a note. With keep_amount on, each new settled payment sets the cost
-- line's amount.
--
-- Like the tables from 20261022120000_up_bank, these are service role only:
-- the server decides who may see which person's accounts and payments.
--
-- Additive and safe ahead of code: one new table for balances, one for link
-- rules, and nullable or defaulted columns on bank_transactions. Code that
-- predates them never reads them, and the apps only show these features on
-- servers that have them ('connectors.up-bank-links' in
-- packages/core/src/server-features.ts).

create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'up' check (source in ('up')),
  external_id text not null,
  name text not null,
  account_type text not null default 'TRANSACTIONAL' check (account_type in ('TRANSACTIONAL', 'SAVER', 'HOME_LOAN')),
  ownership text not null default 'INDIVIDUAL' check (ownership in ('INDIVIDUAL', 'JOINT')),
  -- Minor units (cents) at the last read from the bank.
  balance_cents bigint not null default 0,
  currency text not null default 'AUD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, user_id, external_id)
);

create index if not exists idx_bank_accounts_group on public.bank_accounts(group_id);

alter table public.bank_accounts enable row level security;
grant select, insert, update, delete on public.bank_accounts to service_role;

create table if not exists public.bank_links (
  cost_item_id uuid primary key references public.cost_items(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  -- A payee's name, or '#tag' for an Up tag.
  match text not null check (length(match) between 2 and 200),
  keep_amount boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_bank_links_group on public.bank_links(group_id);

alter table public.bank_links enable row level security;
grant select, insert, update, delete on public.bank_links to service_role;

alter table public.bank_transactions
  add column if not exists tags text[] not null default '{}',
  add column if not exists raw_text text,
  add column if not exists cost_item_id uuid references public.cost_items(id) on delete set null,
  add column if not exists link_kind text check (link_kind in ('rule', 'manual')),
  add column if not exists hidden boolean not null default false,
  add column if not exists note text;

create index if not exists idx_bank_transactions_cost_item on public.bank_transactions(cost_item_id) where cost_item_id is not null;
