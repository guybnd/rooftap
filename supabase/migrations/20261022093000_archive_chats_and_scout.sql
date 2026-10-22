-- Archiving Assistant chats and Scout searches. An archived chat or search
-- drops out of its list and waits under "Archived", where it can come back or
-- be deleted. A chat is archived for the person who owns it. A Scout search
-- belongs to the household, so archiving it hides it for everyone. Both are
-- written only by the server (service role) after it checks access.
--
-- Additive and safe ahead of code: one nullable column on each table. Code
-- that predates it never reads them, and null means not archived.

alter table public.assistant_conversations add column if not exists archived_at timestamptz;
alter table public.shopper_searches add column if not exists archived_at timestamptz;
