-- Money summaries from the Assistant: which notes each person asked for in
-- Costs, as {"weekly": true, "monthly": true}. The server posts a note to the
-- household's Assistant chat while anyone in it has that kind on
-- (GET /api/money/summaries, daily). For someone sharing Up who never set it,
-- the weekly note follows their connection's weekly_digest switch.
--
-- Additive and safe ahead of the code: a nullable column nothing reads yet.
alter table public.user_settings
  add column if not exists money_summaries jsonb;
