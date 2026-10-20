-- Create agents table and link to apartments

create table agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null default auth.uid(),
  name text not null,
  phone text,
  color text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table agents enable row level security;

create policy "Authenticated users can manage all agents"
  on agents for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- Add agent_id FK to apartments
alter table apartments add column agent_id uuid references agents(id) on delete set null;
