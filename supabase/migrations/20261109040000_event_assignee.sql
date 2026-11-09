-- Who an event is for: one household member, or null for everyone. Shown on
-- the event sheet and the Assistant's event tools. Additive and nullable, so
-- apps that predate it keep working; new apps gate the Who row on
-- server-features 'calendar.event-assignee'.
alter table public.events add column if not exists assigned_to uuid references auth.users(id) on delete set null;
create index if not exists idx_events_assigned_to on public.events(assigned_to);
