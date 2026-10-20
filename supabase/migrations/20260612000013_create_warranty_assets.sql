-- Warranties & Receipts section (FLUX-72, Phase 4)
-- Owned-asset records: model + warranty expiry + receipt files, group-scoped.
-- An asset owns its budget line (linked_cost_id → cost_items) and may originate
-- from a purchased setup item (linked_setup_item_id → setup_items).
create table if not exists warranty_assets (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  name text not null,
  model text,
  serial text,
  category text not null default 'other'
    check (category in ('appliance','electronics','furniture','other')),
  retailer text,
  purchase_date date,
  price integer not null default 0,             -- minor units (cents)
  warranty_expiry date,
  reminder_lead_days integer not null default 30,  -- days before expiry to remind
  return_by date,                               -- return/refund window (optional)
  cost_category text not null default 'purchase'
    check (cost_category in ('rent','utilities','internet','insurance','subscription','grocery_estimate','moving','purchase','other')),
  room text,
  notes text,
  assigned_to uuid references auth.users(id) on delete set null,
  linked_cost_id uuid references cost_items(id) on delete set null,
  linked_setup_item_id uuid references setup_items(id) on delete set null,
  sort_order integer not null default 0,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_warranty_assets_group on warranty_assets(group_id);
create index idx_warranty_assets_assigned_to on warranty_assets(assigned_to);
create index idx_warranty_assets_expiry on warranty_assets(warranty_expiry);
create index idx_warranty_assets_linked_cost on warranty_assets(linked_cost_id);

-- Fuzzy search over name / model / serial / retailer.
create extension if not exists pg_trgm;
create index idx_warranty_assets_search on warranty_assets using gin (
  (coalesce(name,'') || ' ' || coalesce(model,'') || ' ' || coalesce(serial,'') || ' ' || coalesce(retailer,'')) gin_trgm_ops
);

alter table warranty_assets enable row level security;

create policy "Group members can manage warranty assets"
  on warranty_assets for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

-- Receipt / manual files attached to an asset (one asset → many files).
create table if not exists warranty_files (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references warranty_assets(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  storage_path text not null,                   -- path in the warranty files storage bucket
  filename text not null,
  kind text not null default 'receipt'
    check (kind in ('receipt','manual','other')),
  uploaded_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index idx_warranty_files_asset on warranty_files(asset_id);
create index idx_warranty_files_group on warranty_files(group_id);

alter table warranty_files enable row level security;

create policy "Group members can manage warranty files"
  on warranty_files for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));
