-- Money insights (the "Worth a look" card on Costs): what each person hid,
-- and the subscriptions they chose to keep. A map of insight key to the time
-- it was marked, e.g. {"price:<cost id>:2499": "2026-10-23T02:30:00Z",
-- "keep:sub:netflix": "..."}. Per person, like the other Costs preferences.
--
-- Additive and safe ahead of the code: a nullable column nothing reads yet.
alter table public.user_settings
  add column if not exists money_insight_marks jsonb;
