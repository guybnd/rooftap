-- Time-to-leave lead time per person. Additive and safe ahead of its code: a
-- nullable user_settings column (null = an hour) and a server-only table that
-- records whom notify-leave-time pushed for which start time, replacing the
-- single per-event events.leave_notified_for now that each reader has their
-- own alert time. Until the new function deploys the old one keeps working.

alter table public.user_settings
  add column if not exists leave_alert_minutes smallint
    check (leave_alert_minutes is null or leave_alert_minutes in (30, 60));

comment on column public.user_settings.leave_alert_minutes is
  'Minutes before leaving that a time-to-leave push comes (30 or 60); null = 60.';

create table if not exists public.event_leave_notices (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  starts_at timestamptz not null,
  sent_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

comment on table public.event_leave_notices is
  'Which event start time each person was last sent a time-to-leave push for (written by notify-leave-time only).';

-- Server-only: RLS on with no policies, so only the service role reads or writes it.
alter table public.event_leave_notices enable row level security;
