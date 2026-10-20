-- Apartments table
create table if not exists apartments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  address text not null,
  suburb text,
  rent_per_week numeric,
  bedrooms integer,
  bathrooms integer,
  parking boolean,
  listing_url text,
  notes text,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table apartments enable row level security;

create policy "Users can manage their own apartments"
  on apartments for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Checklist items table
create table if not exists checklist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  category text not null default '',
  weight integer not null default 5 check (weight between 1 and 10),
  is_dealbreaker boolean not null default false,
  "order" integer not null default 0,
  created_at timestamptz not null default now()
);

alter table checklist_items enable row level security;

create policy "Users can manage their own checklist items"
  on checklist_items for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Checklist responses table
create table if not exists checklist_responses (
  id uuid primary key default gen_random_uuid(),
  apartment_id uuid not null references apartments(id) on delete cascade,
  checklist_item_id uuid not null references checklist_items(id) on delete cascade,
  value boolean,
  notes text,
  unique (apartment_id, checklist_item_id)
);

alter table checklist_responses enable row level security;

create policy "Users can manage responses for their apartments"
  on checklist_responses for all
  using (
    exists (
      select 1 from apartments
      where apartments.id = checklist_responses.apartment_id
      and apartments.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from apartments
      where apartments.id = checklist_responses.apartment_id
      and apartments.user_id = auth.uid()
    )
  );

-- Photos table
create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  apartment_id uuid not null references apartments(id) on delete cascade,
  storage_path text not null,
  caption text,
  created_at timestamptz not null default now()
);

alter table photos enable row level security;

create policy "Users can manage photos for their apartments"
  on photos for all
  using (
    exists (
      select 1 from apartments
      where apartments.id = photos.apartment_id
      and apartments.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from apartments
      where apartments.id = photos.apartment_id
      and apartments.user_id = auth.uid()
    )
  );
