-- Add default appointment duration setting to user_settings
alter table user_settings
  add column if not exists appointment_duration_minutes integer not null default 20;
