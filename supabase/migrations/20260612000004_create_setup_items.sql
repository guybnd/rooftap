-- Create setup_items table for home setup section (FLUX-59, FLUX-61)
create table if not exists setup_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  name text not null,
  description text,
  room text,
  status text not null default 'needed' check (status in ('needed', 'researching', 'ordered', 'delivered', 'installed')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  est_price integer,
  actual_price integer,
  where_to_buy text,
  url text,
  notes text,
  assigned_to uuid references auth.users(id) on delete set null,
  template_key text,
  sort_order integer default 0,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Create index for common queries
create index idx_setup_items_group_id on setup_items(group_id);
create index idx_setup_items_assigned_to on setup_items(assigned_to);
create index idx_setup_items_room on setup_items(room);

-- Enable RLS
alter table setup_items enable row level security;

-- RLS policy: group members can manage setup items in their group
create policy "Group members can manage setup items"
  on setup_items for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));
