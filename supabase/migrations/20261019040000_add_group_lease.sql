-- Lease and notice period for rented homes, part of the home profile on
-- `groups` next to home_move_in_date. A lease end date marks the home as
-- rented; the notice period is how many days before it the household must
-- say whether it renews or leaves. Both nullable and additive, so the
-- columns are a no-op for code that predates them.
alter table public.groups
  add column if not exists lease_end_date date null,
  add column if not exists lease_notice_days integer null
    check (lease_notice_days is null or (lease_notice_days >= 0 and lease_notice_days <= 730));
