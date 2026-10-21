-- The Home Assistant tool list, kept with the connection so an assistant turn
-- on a fresh server instance doesn't wait on Home Assistant's handshake and
-- listing (about 3 s from the hosted server) before the model can start.
-- The server refreshes it in the background after the reply.
--
-- Additive and safe ahead of code: two nullable columns. Code that predates
-- them never reads them and lists the tools live, as before.

alter table public.assistant_home_assistant
  add column if not exists tool_list jsonb,
  add column if not exists tool_list_at timestamptz;
