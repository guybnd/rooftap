-- Warranty asset comments (mirrors setup_item_comments; group-scoped via parent asset)
create table if not exists warranty_asset_comments (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references warranty_assets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create index idx_warranty_asset_comments_asset on warranty_asset_comments(asset_id);

alter table warranty_asset_comments enable row level security;

create policy "Group members can manage warranty asset comments"
  on warranty_asset_comments for all
  using (exists (
    select 1 from warranty_assets
    where warranty_assets.id = warranty_asset_comments.asset_id
    and is_group_member(warranty_assets.group_id)
  ))
  with check (exists (
    select 1 from warranty_assets
    where warranty_assets.id = warranty_asset_comments.asset_id
    and is_group_member(warranty_assets.group_id)
  ));
