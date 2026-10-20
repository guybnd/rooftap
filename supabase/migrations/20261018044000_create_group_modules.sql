-- Modules: households choose their features (.docs/modules.md).
--
-- One row per (household, module) the owner has switched. No row means the
-- module's default from packages/core/src/modules.ts, so shipping a new module
-- never needs a data migration. module_id is free text on purpose (no CHECK,
-- no enum): adding a module must not need a schema change.

create table if not exists public.group_modules (
  group_id   uuid not null references public.groups(id) on delete cascade,
  module_id  text not null,
  enabled    boolean not null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (group_id, module_id)
);

alter table public.group_modules enable row level security;

-- Every member reads the household's switches (they decide what each member's
-- app shows); only the owner changes them.
drop policy if exists "Members can view their group's modules" on public.group_modules;
create policy "Members can view their group's modules"
  on public.group_modules for select
  using (is_group_member(group_id));

drop policy if exists "Owners can insert their group's modules" on public.group_modules;
create policy "Owners can insert their group's modules"
  on public.group_modules for insert
  with check (exists (
    select 1 from public.group_members gm
    where gm.group_id = group_modules.group_id
    and gm.user_id = auth.uid()
    and gm.role = 'owner'
  ));

drop policy if exists "Owners can update their group's modules" on public.group_modules;
create policy "Owners can update their group's modules"
  on public.group_modules for update
  using (exists (
    select 1 from public.group_members gm
    where gm.group_id = group_modules.group_id
    and gm.user_id = auth.uid()
    and gm.role = 'owner'
  ))
  with check (exists (
    select 1 from public.group_members gm
    where gm.group_id = group_modules.group_id
    and gm.user_id = auth.uid()
    and gm.role = 'owner'
  ));

-- Timestamps: the same handle_times() every synced table uses.
drop trigger if exists trg_group_modules_handle_times on public.group_modules;
create trigger trg_group_modules_handle_times
  before insert or update on public.group_modules
  for each row
  execute function public.handle_times();

-- Who flipped the switch, stamped server-side so a client can't misattribute
-- it. Service-role writes (auth.uid() is null) keep whatever they sent.
create or replace function public.group_modules_stamp_updated_by()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_group_modules_stamp_updated_by on public.group_modules;
create trigger trg_group_modules_stamp_updated_by
  before insert or update on public.group_modules
  for each row
  execute function public.group_modules_stamp_updated_by();

-- Existing households keep everything on. New households start from the
-- registry defaults (Tasks, Calendar, Checklists, Documents) and add the rest
-- in Settings > Modules. Keep this list in sync with MODULES at the time of
-- this migration; later modules default via the registry, not a backfill.
insert into public.group_modules (group_id, module_id, enabled)
select g.id, m.module_id, true
from public.groups g
cross join (values
  ('household'), ('calendar'), ('checklists'), ('documents'), ('groceries'),
  ('recipes'), ('costs'), ('setup'), ('search')
) as m(module_id)
on conflict (group_id, module_id) do nothing;

-- Realtime, so a switch reaches every member's open app without a reload.
alter table public.group_modules replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'group_modules'
    ) then
      alter publication supabase_realtime add table public.group_modules;
    end if;
  end if;
end $$;
