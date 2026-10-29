-- Crash reports from the error screen ("This screen didn't load") land in the
-- operator's Feedback inbox next to Assistant feedback (source 'crash', or
-- 'crash-upstream' for reports the hosted server takes from self-hosted
-- servers). One row per distinct crash: `signature` names it across app
-- versions, and repeats count up `seen_count` instead of adding rows.
-- `forwarded_at` marks a self-hosted server's report as passed on to the
-- Rooftap team. `report` keeps the scrubbed report itself (core crash-report.ts),
-- so it can be passed on later.
--
-- Additive: new nullable columns and a defaulted counter, so code from
-- before this migration keeps working.

alter table public.app_feedback add column if not exists signature text;
alter table public.app_feedback add column if not exists seen_count integer not null default 1;
alter table public.app_feedback add column if not exists last_seen_at timestamptz;
alter table public.app_feedback add column if not exists forwarded_at timestamptz;
alter table public.app_feedback add column if not exists report jsonb;

create index if not exists app_feedback_signature_idx on public.app_feedback (signature) where signature is not null;
