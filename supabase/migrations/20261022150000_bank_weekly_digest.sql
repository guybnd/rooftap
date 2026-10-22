-- Up Bank connector, part five: the weekly money digest.
--
-- Each Sunday the server posts a short money note to the household's
-- Assistant chat: the week's shared spending, nudges worth a look and the
-- bills ahead. A person turns it off for their own connection with this
-- switch. The note goes out while anyone who shares money with the
-- household has it on.
--
-- Additive and safe ahead of code: one defaulted column. Code that predates
-- it never reads it, and the apps only offer the switch on servers that have
-- it ('connectors.up-bank-digest' in packages/core/src/server-features.ts).

alter table public.up_bank_connections
  add column if not exists weekly_digest boolean not null default true;
