-- Module helpers (packages/core/src/module-helpers.ts): a chat with Rooftap
-- focused on one module, such as the Groceries helper. Each person has one
-- chat per helper, kept like a named chat.
--
-- Additive and safe ahead of code: one nullable column and a partial unique
-- index. Code that predates it never sets the column, so nothing changes for it.
alter table public.assistant_conversations add column if not exists helper text;

create unique index if not exists idx_assistant_helper_chat
  on public.assistant_conversations(owner_id, helper)
  where helper is not null and kind = 'chat' and not deleted;
