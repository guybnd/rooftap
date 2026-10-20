-- Costs / Budget section (FLUX-66, Phase 3)
-- Recurring & one-off household cost lines, group-scoped.
create table if not exists cost_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  name text not null,
  category text not null default 'other'
    check (category in ('rent','utilities','internet','insurance','subscription','grocery_estimate','moving','other')),
  amount integer not null default 0,          -- minor units (cents)
  cadence text not null default 'monthly'
    check (cadence in ('weekly','fortnightly','monthly','quarterly','yearly','one_off')),
  is_estimate boolean not null default false,
  start_date date,
  end_date date,                              -- contract term end → expiry reminder
  discount_end_date date,                     -- intro-rate / joining-discount expiry → reminder
  provider text,
  assigned_to uuid references auth.users(id) on delete set null,
  linked_section text,                        -- e.g. 'groceries' for future auto-fill
  notes text,
  sort_order integer not null default 0,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_cost_items_group on cost_items(group_id);
create index idx_cost_items_assigned_to on cost_items(assigned_to);
create index idx_cost_items_end_date on cost_items(end_date);

alter table cost_items enable row level security;

create policy "Group members can manage cost items"
  on cost_items for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

-- Documents attached to a cost line (contracts, bills, receipts)
create table if not exists cost_documents (
  id uuid primary key default gen_random_uuid(),
  cost_item_id uuid not null references cost_items(id) on delete cascade,
  storage_path text not null,                 -- path in the 'cost-documents' storage bucket
  filename text not null,
  doc_type text not null default 'other'
    check (doc_type in ('contract','bill','receipt','other')),
  uploaded_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index idx_cost_documents_item on cost_documents(cost_item_id);

alter table cost_documents enable row level security;

create policy "Group members can manage cost documents"
  on cost_documents for all
  using (exists (
    select 1 from cost_items
    where cost_items.id = cost_documents.cost_item_id
    and is_group_member(cost_items.group_id)
  ))
  with check (exists (
    select 1 from cost_items
    where cost_items.id = cost_documents.cost_item_id
    and is_group_member(cost_items.group_id)
  ));

-- Comments on a cost line (reuses the EntityComments component pattern)
create table if not exists cost_item_comments (
  id uuid primary key default gen_random_uuid(),
  cost_item_id uuid not null references cost_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create index idx_cost_item_comments_item on cost_item_comments(cost_item_id);

alter table cost_item_comments enable row level security;

create policy "Group members can manage cost item comments"
  on cost_item_comments for all
  using (exists (
    select 1 from cost_items
    where cost_items.id = cost_item_comments.cost_item_id
    and is_group_member(cost_items.group_id)
  ))
  with check (exists (
    select 1 from cost_items
    where cost_items.id = cost_item_comments.cost_item_id
    and is_group_member(cost_items.group_id)
  ));
