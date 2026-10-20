-- Create household_tasks table for the Home Setup section (FLUX-58 schema, FLUX-60 feature).
-- Generic household tasks & reminders: recurring chores, technician visits, and
-- moving-template tasks all live here. Moving is just one template that writes rows in.
--
-- NOTE: FLUX-58 specced this table but only shipped the setup_items migration; this
-- migration fills that gap so the household tasks feature (FLUX-60) is functional.
create table if not exists household_tasks (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  title text not null,
  due_date date,
  offset_days integer,                 -- relative to move-in date, for move-template tasks
  recurrence_days integer,             -- non-null = recurring; on completion the next occurrence is scheduled this many days ahead
  done boolean not null default false,
  assigned_to uuid references auth.users(id) on delete set null,
  private boolean not null default false,
  template_key text,                   -- non-null = generated from a template; prevents duplicate regeneration
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for common queries
create index idx_household_tasks_group_id on household_tasks(group_id);
create index idx_household_tasks_assigned_to on household_tasks(assigned_to);
create index idx_household_tasks_due_date on household_tasks(due_date);
create index idx_household_tasks_template_key on household_tasks(template_key);

-- Enable RLS
alter table household_tasks enable row level security;

-- RLS policy: group members can manage household tasks in their group
-- (same is_group_member() pattern as setup_items / 20260527000005_groups_and_rls.sql)
create policy "Group members can manage household tasks"
  on household_tasks for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));
