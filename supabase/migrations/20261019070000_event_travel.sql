-- Calendar "time to leave". Additive and safe ahead of its code: three
-- nullable columns on events and a 5-minute cron job for the new
-- notify-leave-time function (guarded like notify-due-tasks-daily; until the
-- function deploys, the job's call just fails quietly).

alter table public.events
  add column if not exists travel_mode text check (travel_mode in ('drive', 'walk', 'cycle')),
  add column if not exists travel_minutes integer check (travel_minutes is null or travel_minutes > 0),
  add column if not exists leave_notified_for timestamptz;

comment on column public.events.travel_mode is 'How the household gets there, for a time-to-leave push; null = off.';
comment on column public.events.travel_minutes is 'Travel time from home in minutes, worked out when the event was saved.';
comment on column public.events.leave_notified_for is 'The starts_at the last time-to-leave push was for (written by notify-leave-time).';

do $$
begin
  if exists (select 1 from cron.job where jobname = 'notify-leave-time') then
    perform cron.unschedule('notify-leave-time');
  end if;
  perform cron.schedule(
    'notify-leave-time',
    '*/5 * * * *',
    $cron$ select public.notify_edge_function('notify-leave-time', '{}'::jsonb) $cron$
  );
exception when others then
  raise notice 'pg_cron not available; schedule notify-leave-time manually. (%)', sqlerrm;
end $$;
