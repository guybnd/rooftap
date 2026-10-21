-- Rooftap Assistant: rolling summaries for long conversations. Messages that
-- leave the context window are folded into assistant_conversations.summary
-- (already there since 20261021020000_assistant) in batches after a reply;
-- summary_through marks the newest message folded so far.
--
-- Additive and safe ahead of code: one nullable column, which code that
-- predates it never reads.

alter table assistant_conversations add column if not exists summary_through timestamptz;
