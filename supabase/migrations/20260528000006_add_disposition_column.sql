-- Add disposition column to apartments for triage independent of appointments
alter table apartments
  add column if not exists disposition text default null
  check (disposition in ('to_book', 'skipped', 'rebook'));
