-- Setup item comments table (mirrors apartment_comments, group-scoped via parent item)
create table if not exists setup_item_comments (
  id uuid primary key default gen_random_uuid(),
  setup_item_id uuid not null references setup_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create index idx_setup_item_comments_item on setup_item_comments(setup_item_id);

alter table setup_item_comments enable row level security;

-- Group members can manage comments on items in their group
create policy "Group members can manage setup item comments"
  on setup_item_comments for all
  using (exists (
    select 1 from setup_items
    where setup_items.id = setup_item_comments.setup_item_id
    and is_group_member(setup_items.group_id)
  ))
  with check (exists (
    select 1 from setup_items
    where setup_items.id = setup_item_comments.setup_item_id
    and is_group_member(setup_items.group_id)
  ));
