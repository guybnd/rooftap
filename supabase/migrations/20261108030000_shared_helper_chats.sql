-- Shared helper chats and extra instructions per helper (core module-helpers.ts).
--
-- - assistant_settings.helpers: per helper id, { shared, instructions }.
--   Owners set it with the rest of the household's assistant settings.
-- - A helper chat the household shares is a `household` conversation with a
--   `helper`, so it is read like the household thread (owner_id null) and
--   every member sees it through the existing policies.
-- - The household thread's unique index now leaves helper chats out, and a
--   new one keeps each household to one shared chat per helper.
--
-- Additive and safe ahead of code: a new column with a default, and code from
-- before this change never writes a household row with a helper, so the
-- narrower index still holds it to one household thread.

alter table public.assistant_settings add column if not exists helpers jsonb not null default '{}'::jsonb;

drop index if exists public.idx_assistant_household_thread;
create unique index if not exists idx_assistant_household_thread
  on public.assistant_conversations(group_id) where kind = 'household' and helper is null and not deleted;

create unique index if not exists idx_assistant_helper_household_chat
  on public.assistant_conversations(group_id, helper) where kind = 'household' and helper is not null and not deleted;
