-- Up Bank connector, part three: share only joint accounts.
--
-- A person can now share nothing, only their joint accounts (such as a 2Up
-- account), or every account with the household. share_mode replaces the
-- shared switch; the server keeps `shared` in step (shared = share_mode is
-- not 'none') for code that predates it. Each transaction now also keeps the
-- bank's id for its account, so the server can tell joint-account payments
-- apart. Rows read before this keep only the account's name, which the server
-- matches instead.
--
-- Additive and safe ahead of code: two new columns with defaults or nulls.
-- Code that predates them never reads them, and the apps only offer the new
-- choices on servers that have them ('connectors.up-bank-sharing' in
-- packages/core/src/server-features.ts). People who shared before keep
-- sharing everything.

alter table public.up_bank_connections
  add column if not exists share_mode text not null default 'none'
    check (share_mode in ('none', 'joint', 'all'));

update public.up_bank_connections set share_mode = 'all' where shared and share_mode = 'none';

alter table public.bank_transactions
  add column if not exists account_id text;
