-- Connectors: bank statement import (CSV), and one sharing choice for every
-- bank connector.
--
-- A person can now fill an account from a CSV statement their bank exports.
-- The server saves those payments in bank_transactions with source 'csv',
-- next to Up's. The source check becomes a format check, so the next bank
-- connector needs no migration for its source. A statement may have no
-- balance column, so bank_accounts gets has_balance, and Costs leaves an
-- account without a known balance out of the balance totals.
--
-- bank_feed_settings keeps what a person shares with the household and
-- whether their joint payments are filed as costs, for people who have no
-- Up connection to keep it on. The server keeps it in step with
-- up_bank_connections for people who have both. Like the other bank tables
-- it is service role only: RLS on with no policies, and no grants to anon
-- or authenticated.
--
-- Additive and safe ahead of code: a looser check, one column with a
-- default and one new table. Code that predates them never reads them, and
-- the apps only offer the import on servers that have them
-- ('connectors.bank-import' in packages/core/src/server-features.ts).

alter table public.bank_transactions drop constraint if exists bank_transactions_source_check;
alter table public.bank_transactions
  add constraint bank_transactions_source_check check (source ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

alter table public.bank_accounts drop constraint if exists bank_accounts_source_check;
alter table public.bank_accounts
  add constraint bank_accounts_source_check check (source ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

alter table public.bank_accounts
  add column if not exists has_balance boolean not null default true;

create table if not exists public.bank_feed_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  share_mode text not null default 'none' check (share_mode in ('none', 'joint', 'all')),
  auto_costs boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_bank_feed_settings_group on public.bank_feed_settings(group_id);

alter table public.bank_feed_settings enable row level security;
grant select, insert, update, delete on public.bank_feed_settings to service_role;
