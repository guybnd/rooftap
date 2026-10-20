-- Household task comments (mirrors setup_item_comments; group-scoped via parent task)
create table if not exists household_task_comments (
  id uuid primary key default gen_random_uuid(),
  household_task_id uuid not null references household_tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create index idx_household_task_comments_task on household_task_comments(household_task_id);

alter table household_task_comments enable row level security;

create policy "Group members can manage household task comments"
  on household_task_comments for all
  using (exists (
    select 1 from household_tasks
    where household_tasks.id = household_task_comments.household_task_id
    and is_group_member(household_tasks.group_id)
  ))
  with check (exists (
    select 1 from household_tasks
    where household_tasks.id = household_task_comments.household_task_id
    and is_group_member(household_tasks.group_id)
  ));
