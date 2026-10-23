-- Occasions on the Calendar (calendar.occasions). Each occasion shows on the
-- Calendar unless someone switches it off for that occasion.
--
-- Additive and safe ahead of code: one new column with a default that the
-- old app never reads or writes. Apps gate the switch on this migration
-- (server-features.ts, occasions.calendar), so they never write the column
-- to a server without it, and read a missing value as on. The table is
-- already granted (20261023100000_occasions.sql).

alter table occasions add column if not exists on_calendar boolean not null default true;
