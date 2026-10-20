-- Calendar event reminders. Additive and safe ahead of its code: a new
-- nullable column (null = the defaults, a week and a day before) and a daily
-- cron job for the new notify-upcoming-events function. Until that function
-- deploys, the job's call just fails quietly, as notify_edge_function's do.

alter table public.events
  add column if not exists reminder_days smallint[];

comment on column public.events.reminder_days is
  'Days before the event a push reminder goes out (0 = on the day). Null = defaults {7,1}; empty = none.';

-- Same slot as notify-due-tasks-daily: 22:00 UTC ≈ 08:00 AEST / 09:00 AEDT.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'notify-upcoming-events-daily') then
    perform cron.unschedule('notify-upcoming-events-daily');
  end if;
  perform cron.schedule(
    'notify-upcoming-events-daily',
    '0 22 * * *',
    $cron$ select public.notify_edge_function('notify-upcoming-events', '{}'::jsonb) $cron$
  );
exception when others then
  raise notice 'pg_cron not available; schedule notify-upcoming-events-daily manually. (%)', sqlerrm;
end $$;
