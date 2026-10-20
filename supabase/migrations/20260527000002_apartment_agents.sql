-- Many-to-many junction table for apartments <-> agents
create table apartment_agents (
  apartment_id uuid references apartments(id) on delete cascade not null,
  agent_id uuid references agents(id) on delete cascade not null,
  created_at timestamptz default now(),
  primary key (apartment_id, agent_id)
);

alter table apartment_agents enable row level security;

create policy "Authenticated users can manage apartment_agents"
  on apartment_agents for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- Add notes column to agents table
alter table agents add column notes text;

-- Migrate existing agent_id relationships into junction table
insert into apartment_agents (apartment_id, agent_id)
select id, agent_id from apartments where agent_id is not null
on conflict do nothing;
