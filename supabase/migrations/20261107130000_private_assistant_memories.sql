-- Assistant memories from a private chat stay private (security audit,
-- 2026-10-29).
--
-- The Assistant saved what it learned in any chat as a household memory, and
-- every later turn, by anyone in the household, read all of them. So a fact
-- from someone's private chat or quick ask reached the others. A memory now
-- has an owner: one saved in a private chat or quick ask belongs to the
-- person who was talking, and only that person's turns and memory list see
-- it. A memory saved in the household thread, or added by hand in Settings,
-- has no owner and stays shared.
--
-- Safe ahead of code: the new column is nullable, and code that predates it
-- writes shared memories as before. Memories saved before this change keep no
-- owner, because the chat they came from was not recorded.

alter table public.assistant_memories
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;

create index if not exists idx_assistant_memories_owner
  on public.assistant_memories(owner_id) where owner_id is not null and not deleted;

drop policy if exists "Members can manage assistant memories" on public.assistant_memories;
create policy "Members can manage assistant memories"
  on public.assistant_memories for all
  using (is_group_member(group_id) and (owner_id is null or owner_id = auth.uid()))
  with check (is_group_member(group_id) and (owner_id is null or owner_id = auth.uid()));
