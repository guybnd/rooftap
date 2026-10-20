-- Per-user preliminary scores (replaces single preliminary_score column on apartments)
create table apartment_preliminary_scores (
  id uuid primary key default gen_random_uuid(),
  apartment_id uuid not null references apartments(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  score integer not null constraint score_range check (score >= 1 and score <= 10),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (apartment_id, user_id)
);

-- RLS: users can see scores within their group
alter table apartment_preliminary_scores enable row level security;

create policy "Users can view scores for apartments in their group"
  on apartment_preliminary_scores for select
  using (
    apartment_id in (
      select a.id from apartments a
      inner join group_members gm on gm.group_id = a.group_id
      where gm.user_id = auth.uid()
    )
  );

create policy "Users can insert their own scores"
  on apartment_preliminary_scores for insert
  with check (user_id = auth.uid());

create policy "Users can update their own scores"
  on apartment_preliminary_scores for update
  using (user_id = auth.uid());

create policy "Users can delete their own scores"
  on apartment_preliminary_scores for delete
  using (user_id = auth.uid());
