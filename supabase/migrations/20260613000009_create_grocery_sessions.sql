-- Daily grocery shopping sessions (FLUX-95). One session per group per calendar
-- day; tallies "Got it" items into a single actual grocery cost line that lives
-- alongside the recurring grocery estimate in the Costs section.
create table if not exists grocery_sessions (
  id                  uuid        primary key default gen_random_uuid(),
  group_id            uuid        not null references groups(id) on delete cascade,
  session_date        date        not null,
  summed_total_cents  integer     not null default 0,             -- sum of bought-item typical prices
  override_total_cents integer    check (override_total_cents is null or override_total_cents >= 0),
  receipt_total_cents integer     check (receipt_total_cents is null or receipt_total_cents >= 0),
  retailer            text,
  receipt_path        text,                                       -- path in the cost-documents bucket
  receipt_name        text,
  tracking            text        not null default 'on'
                        check (tracking in ('on','skipped')),
  cost_item_id        uuid        references cost_items(id) on delete set null,
  created_by          uuid        references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (group_id, session_date)
);

create index if not exists idx_grocery_sessions_group on grocery_sessions(group_id);

alter table grocery_sessions enable row level security;

create policy "Group members can manage grocery sessions"
  on grocery_sessions for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));
