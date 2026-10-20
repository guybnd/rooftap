-- Grocery items table for the Groceries section (FLUX-71, Phase 1).
-- Phase 1: shared aisle-grouped shopping list with check-off.
-- Later-phase columns are added nullable now so we only migrate once.
create table if not exists grocery_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  name text not null,
  aisle text not null default 'other',
  quantity numeric,
  unit text,
  status text not null default 'needed',  -- 'needed' | 'bought'
  notes text,
  assigned_to uuid references auth.users(id) on delete set null,
  private boolean not null default false,
  template_key text,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Phase 2: auto-replenish
  recurrence_days integer,
  last_purchased_at date,
  -- Phase 3: price capture
  last_price integer,    -- minor units (cents)
  lowest_price integer,  -- minor units (cents)
  -- Phase 4: expiry
  expiry_date date
);

create index idx_grocery_items_group_id on grocery_items(group_id);
create index idx_grocery_items_assigned_to on grocery_items(assigned_to);
create index idx_grocery_items_template_key on grocery_items(template_key);
create index idx_grocery_items_status on grocery_items(group_id, status);

alter table grocery_items enable row level security;

create policy "Group members can manage grocery items"
  on grocery_items for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));
