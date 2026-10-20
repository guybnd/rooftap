-- FLUX-228: proper calendar integration.
--   * user_settings: client-editable calendar preferences (to-do scheduling
--     mode, per-user timezone, dashboard visibility of pulled events).
--   * google_calendar_connections: service-role-only push/pull config (the
--     dedicated "HomeUp" calendar id, pull window, default import visibility).

-- ── user_settings ────────────────────────────────────────────────────────────
alter table user_settings
  -- Undated (due_date but no due_time) household_tasks: 'all_day' (unchanged
  -- default) or 'timed_block' (pushed as a fixed-length block at a chosen
  -- time-of-day, see calendar_todo_default_time/_duration_minutes below).
  add column if not exists calendar_todo_mode text not null default 'all_day'
    check (calendar_todo_mode in ('all_day', 'timed_block')),
  -- 24h "HH:MM" wall-clock time the timed block starts at, when
  -- calendar_todo_mode = 'timed_block'.
  add column if not exists calendar_todo_default_time text not null default '09:00',
  -- One of 15/30/60 minutes.
  add column if not exists calendar_todo_default_duration_minutes integer not null default 30
    check (calendar_todo_default_duration_minutes in (15, 30, 60)),
  -- Show this user's pulled-in Google Calendar events in the /home to-do feed.
  -- Independent of the Home Search section's hidden/visible toggle (excludes
  -- HomeUp-generated/pushed events by definition — those are never in the
  -- pulled set).
  add column if not exists calendar_show_pulled_events_in_todo boolean not null default true,
  -- IANA timezone used for wall-clock -> Google event conversion (undated
  -- timed-block to-dos, dated-but-time to-dos). Defaults to the prior
  -- hardcoded behavior so existing users see no change until they set it.
  add column if not exists timezone text not null default 'Australia/Sydney';

-- ── google_calendar_connections ──────────────────────────────────────────────
alter table google_calendar_connections
  -- Id of the per-connection "HomeUp" Google Calendar that all pushed events
  -- (appointments + dated tasks) target, once created. Distinct from
  -- dedicated_calendar_id, which is an existing calendar the user picks for
  -- pull-side house-viewing classification (suggest_mode='dedicated'/'both') —
  -- these two ids serve unrelated purposes and must never be conflated.
  -- Null until the first push after this migration ships; resolved lazily
  -- (idempotent get-or-create) rather than backfilled, so already-pushed
  -- events stay in the user's primary calendar (Decision: don't migrate
  -- existing events).
  add column if not exists homeup_calendar_id text,
  -- Pull window, in days, around "now" — replaces the previously hardcoded
  -- PULL_WINDOW_PAST_DAYS/PULL_WINDOW_FUTURE_DAYS constants.
  add column if not exists pull_window_past_days integer not null default 7
    check (pull_window_past_days >= 0),
  add column if not exists pull_window_future_days integer not null default 30
    check (pull_window_future_days >= 0),
  -- Default visibility assigned to newly-pulled google_calendar_events rows.
  add column if not exists default_import_visibility text not null default 'private'
    check (default_import_visibility in ('private', 'group'));
