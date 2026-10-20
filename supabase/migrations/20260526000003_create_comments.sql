-- Apartment comments table
create table if not exists apartment_comments (
  id uuid primary key default gen_random_uuid(),
  apartment_id uuid not null references apartments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

alter table apartment_comments enable row level security;

create policy "Authenticated users can manage all comments"
  on apartment_comments for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);
