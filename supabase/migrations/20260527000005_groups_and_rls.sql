-- Per-user data ownership with sharing groups (FLUX-33)
-- Creates groups/group_members tables, adds group_id to scoped tables,
-- rewrites RLS from shared-access to group-scoped access.

-- ════════════════════════════════════════════════════════════════════════════════
-- Phase 1: Schema
-- ════════════════════════════════════════════════════════════════════════════════

create table groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table groups enable row level security;

create table group_members (
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table group_members enable row level security;

create index idx_group_members_user_id on group_members(user_id);

-- Add group_id FK to scoped tables (nullable for migration)
alter table apartments add column group_id uuid references groups(id) on delete cascade;
alter table checklist_items add column group_id uuid references groups(id) on delete cascade;
alter table agents add column group_id uuid references groups(id) on delete cascade;

-- ════════════════════════════════════════════════════════════════════════════════
-- Phase 2: Migration backfill
-- ════════════════════════════════════════════════════════════════════════════════

-- Create a default group for existing users and backfill group_id
do $$
declare
  default_group_id uuid;
  first_user_id uuid;
begin
  -- Find the first user to be the group creator
  select id into first_user_id from auth.users order by created_at limit 1;

  -- Only run backfill if there are existing users
  if first_user_id is not null then
    -- Create default group
    insert into groups (id, name, created_by)
    values (gen_random_uuid(), 'Home Group', first_user_id)
    returning id into default_group_id;

    -- Add all existing users as members (first user = owner, rest = members)
    insert into group_members (group_id, user_id, role)
    select default_group_id, id,
      case when id = first_user_id then 'owner' else 'member' end
    from auth.users;

    -- Backfill group_id on existing rows
    update apartments set group_id = default_group_id where group_id is null;
    update checklist_items set group_id = default_group_id where group_id is null;
    update agents set group_id = default_group_id where group_id is null;
  end if;
end $$;

-- Make group_id NOT NULL after backfill
alter table apartments alter column group_id set not null;
alter table checklist_items alter column group_id set not null;
alter table agents alter column group_id set not null;

-- ════════════════════════════════════════════════════════════════════════════════
-- Phase 3: RLS Rewrite
-- ════════════════════════════════════════════════════════════════════════════════

-- Helper: check if current user is a member of a given group
create or replace function is_group_member(target_group_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from group_members
    where group_id = target_group_id
    and user_id = auth.uid()
  );
$$;

-- ── groups ───────────────────────────────────────────────────────────────────
create policy "Members can view their group"
  on groups for select
  using (is_group_member(id));

create policy "Authenticated users can create groups"
  on groups for insert
  with check (auth.uid() is not null and created_by = auth.uid());

create policy "Owners can update their group"
  on groups for update
  using (exists (
    select 1 from group_members
    where group_id = groups.id
    and user_id = auth.uid()
    and role = 'owner'
  ));

create policy "Owners can delete their group"
  on groups for delete
  using (exists (
    select 1 from group_members
    where group_id = groups.id
    and user_id = auth.uid()
    and role = 'owner'
  ));

-- ── group_members ────────────────────────────────────────────────────────────
create policy "Members can view their group members"
  on group_members for select
  using (is_group_member(group_id));

create policy "Owners can manage group members"
  on group_members for insert
  with check (exists (
    select 1 from group_members gm
    where gm.group_id = group_members.group_id
    and gm.user_id = auth.uid()
    and gm.role = 'owner'
  ));

create policy "Owners can remove group members"
  on group_members for delete
  using (exists (
    select 1 from group_members gm
    where gm.group_id = group_members.group_id
    and gm.user_id = auth.uid()
    and gm.role = 'owner'
  ));

-- ── apartments ───────────────────────────────────────────────────────────────
drop policy "Authenticated users can manage all apartments" on apartments;

create policy "Group members can manage apartments"
  on apartments for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

-- ── checklist_items ──────────────────────────────────────────────────────────
drop policy "Authenticated users can manage all checklist items" on checklist_items;

create policy "Group members can manage checklist items"
  on checklist_items for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

-- ── agents ───────────────────────────────────────────────────────────────────
drop policy "Authenticated users can manage all agents" on agents;

create policy "Group members can manage agents"
  on agents for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

-- ── apartment_agents ─────────────────────────────────────────────────────────
drop policy "Authenticated users can manage apartment_agents" on apartment_agents;

create policy "Group members can manage apartment_agents"
  on apartment_agents for all
  using (exists (
    select 1 from apartments
    where apartments.id = apartment_agents.apartment_id
    and is_group_member(apartments.group_id)
  ))
  with check (exists (
    select 1 from apartments
    where apartments.id = apartment_agents.apartment_id
    and is_group_member(apartments.group_id)
  ));

-- ── appointments ─────────────────────────────────────────────────────────────
drop policy "Authenticated users can manage all appointments" on appointments;

create policy "Group members can manage appointments"
  on appointments for all
  using (exists (
    select 1 from apartments
    where apartments.id = appointments.apartment_id
    and is_group_member(apartments.group_id)
  ))
  with check (exists (
    select 1 from apartments
    where apartments.id = appointments.apartment_id
    and is_group_member(apartments.group_id)
  ));

-- ── checklist_responses ──────────────────────────────────────────────────────
drop policy "Authenticated users can manage all checklist responses" on checklist_responses;

create policy "Group members can manage checklist responses"
  on checklist_responses for all
  using (exists (
    select 1 from apartments
    where apartments.id = checklist_responses.apartment_id
    and is_group_member(apartments.group_id)
  ))
  with check (exists (
    select 1 from apartments
    where apartments.id = checklist_responses.apartment_id
    and is_group_member(apartments.group_id)
  ));

-- ── photos ───────────────────────────────────────────────────────────────────
drop policy "Authenticated users can manage all photos" on photos;

create policy "Group members can manage photos"
  on photos for all
  using (exists (
    select 1 from apartments
    where apartments.id = photos.apartment_id
    and is_group_member(apartments.group_id)
  ))
  with check (exists (
    select 1 from apartments
    where apartments.id = photos.apartment_id
    and is_group_member(apartments.group_id)
  ));

-- ── apartment_comments ───────────────────────────────────────────────────────
drop policy "Authenticated users can manage all comments" on apartment_comments;

create policy "Group members can manage comments"
  on apartment_comments for all
  using (exists (
    select 1 from apartments
    where apartments.id = apartment_comments.apartment_id
    and is_group_member(apartments.group_id)
  ))
  with check (exists (
    select 1 from apartments
    where apartments.id = apartment_comments.apartment_id
    and is_group_member(apartments.group_id)
  ));

-- ── user_settings remains per-user (no change needed) ────────────────────────

-- ════════════════════════════════════════════════════════════════════════════════
-- Phase 4: Auto-create group for new users (database trigger)
-- ════════════════════════════════════════════════════════════════════════════════

create or replace function handle_new_user_group()
returns trigger
language plpgsql
security definer
as $$
declare
  new_group_id uuid;
begin
  -- Only create a group if the user doesn't already have one
  if not exists (select 1 from group_members where user_id = new.id) then
    insert into groups (name, created_by)
    values ('My Group', new.id)
    returning id into new_group_id;

    insert into group_members (group_id, user_id, role)
    values (new_group_id, new.id, 'owner');
  end if;

  return new;
end;
$$;

-- Trigger on auth.users insert (fires after Supabase creates the user row)
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function handle_new_user_group();
