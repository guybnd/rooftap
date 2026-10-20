-- FLUX-150 slice 3.5: Sync-ready schema for the remaining Legend-State sections
-- (Home Search: apartments/agents/apartment_agents/apartment_comments/saved_searches,
--  Appointments, the legacy apartment-scoring checklist: checklist_items/checklist_responses,
--  and Documents).
--
-- Same pattern as 20260618000001/20260618000002: deleted tombstone, handle_times()
-- trigger, (group_id, updated_at) index. No REPLICA IDENTITY FULL — deletes are
-- soft (an UPDATE setting deleted=true), so realtime never needs old-row values,
-- matching the already-synced tables.
--
-- apartment_comments, appointments, checklist_responses lack group_id entirely;
-- denormalized + backfilled here from the parent apartment (safe: apartment_id
-- is a NOT NULL FK with ON DELETE CASCADE, so every existing row has a live
-- parent with a non-null group_id — no orphan-handling branch needed).
--
-- apartment_agents additionally lacks a single-column id (it's a bare
-- (apartment_id, agent_id) composite-PK junction row) — Legend's SyncedRow
-- contract requires one, so this migration adds a surrogate `id` and moves the
-- primary key onto it, keeping the original pair as a unique constraint.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. apartments, agents — already have group_id + both timestamps.
-- ═══════════════════════════════════════════════════════════════════════════
alter table apartments add column if not exists deleted boolean not null default false;
alter table agents     add column if not exists deleted boolean not null default false;

drop trigger if exists trg_apartments_handle_times on apartments;
create trigger trg_apartments_handle_times
  before insert or update on apartments
  for each row execute function public.handle_times();

drop trigger if exists trg_agents_handle_times on agents;
create trigger trg_agents_handle_times
  before insert or update on agents
  for each row execute function public.handle_times();

create index if not exists idx_apartments_group_updated_at on apartments(group_id, updated_at);
create index if not exists idx_agents_group_updated_at on agents(group_id, updated_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. saved_searches, documents, checklist_items — have group_id + created_at,
--    missing updated_at.
-- ═══════════════════════════════════════════════════════════════════════════
alter table saved_searches  add column if not exists updated_at timestamptz not null default now();
alter table documents       add column if not exists updated_at timestamptz not null default now();
alter table checklist_items add column if not exists updated_at timestamptz not null default now();

alter table saved_searches  add column if not exists deleted boolean not null default false;
alter table documents       add column if not exists deleted boolean not null default false;
alter table checklist_items add column if not exists deleted boolean not null default false;

drop trigger if exists trg_saved_searches_handle_times on saved_searches;
create trigger trg_saved_searches_handle_times
  before insert or update on saved_searches
  for each row execute function public.handle_times();

drop trigger if exists trg_documents_handle_times on documents;
create trigger trg_documents_handle_times
  before insert or update on documents
  for each row execute function public.handle_times();

drop trigger if exists trg_checklist_items_handle_times on checklist_items;
create trigger trg_checklist_items_handle_times
  before insert or update on checklist_items
  for each row execute function public.handle_times();

create index if not exists idx_saved_searches_group_updated_at on saved_searches(group_id, updated_at);
create index if not exists idx_documents_group_updated_at on documents(group_id, updated_at);
create index if not exists idx_checklist_items_group_updated_at on checklist_items(group_id, updated_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. apartment_comments, appointments, checklist_responses — lack group_id
--    entirely; checklist_responses also lacks created_at/updated_at.
-- ═══════════════════════════════════════════════════════════════════════════
alter table apartment_comments  add column if not exists group_id uuid references groups(id) on delete cascade;
alter table appointments        add column if not exists group_id uuid references groups(id) on delete cascade;
alter table checklist_responses add column if not exists group_id uuid references groups(id) on delete cascade;

alter table apartment_comments  add column if not exists updated_at timestamptz not null default now();
alter table checklist_responses add column if not exists created_at timestamptz not null default now();
alter table checklist_responses add column if not exists updated_at timestamptz not null default now();

alter table apartment_comments  add column if not exists deleted boolean not null default false;
alter table appointments        add column if not exists deleted boolean not null default false;
alter table checklist_responses add column if not exists deleted boolean not null default false;

update apartment_comments c set group_id = a.group_id
  from apartments a where c.apartment_id = a.id and c.group_id is null;
update appointments ap set group_id = a.group_id
  from apartments a where ap.apartment_id = a.id and ap.group_id is null;
update checklist_responses r set group_id = a.group_id
  from apartments a where r.apartment_id = a.id and r.group_id is null;

alter table apartment_comments  alter column group_id set not null;
alter table appointments        alter column group_id set not null;
alter table checklist_responses alter column group_id set not null;

drop trigger if exists trg_apartment_comments_handle_times on apartment_comments;
create trigger trg_apartment_comments_handle_times
  before insert or update on apartment_comments
  for each row execute function public.handle_times();

drop trigger if exists trg_appointments_handle_times on appointments;
create trigger trg_appointments_handle_times
  before insert or update on appointments
  for each row execute function public.handle_times();

drop trigger if exists trg_checklist_responses_handle_times on checklist_responses;
create trigger trg_checklist_responses_handle_times
  before insert or update on checklist_responses
  for each row execute function public.handle_times();

create index if not exists idx_apartment_comments_group_updated_at on apartment_comments(group_id, updated_at);
create index if not exists idx_appointments_group_updated_at on appointments(group_id, updated_at);
create index if not exists idx_checklist_responses_group_updated_at on checklist_responses(group_id, updated_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. apartment_agents — composite-PK junction table: add a surrogate `id`,
--    plus group_id/updated_at/deleted, so it fits the same SyncedRow contract.
-- ═══════════════════════════════════════════════════════════════════════════
alter table apartment_agents add column if not exists id uuid not null default gen_random_uuid();
alter table apartment_agents add column if not exists group_id uuid references groups(id) on delete cascade;
alter table apartment_agents add column if not exists updated_at timestamptz not null default now();
alter table apartment_agents add column if not exists deleted boolean not null default false;

update apartment_agents ja set group_id = a.group_id
  from apartments a where ja.apartment_id = a.id and ja.group_id is null;
alter table apartment_agents alter column group_id set not null;

alter table apartment_agents drop constraint if exists apartment_agents_pkey;
alter table apartment_agents add constraint apartment_agents_pkey primary key (id);
alter table apartment_agents add constraint apartment_agents_apartment_agent_key unique (apartment_id, agent_id);

drop trigger if exists trg_apartment_agents_handle_times on apartment_agents;
create trigger trg_apartment_agents_handle_times
  before insert or update on apartment_agents
  for each row execute function public.handle_times();

create index if not exists idx_apartment_agents_group_updated_at on apartment_agents(group_id, updated_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. RLS: give the four newly group_id'd tables a direct is_group_member policy,
--    replacing the apartments-join they needed before they carried their own
--    group_id (FLUX-150 plan slice 9).
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists "Group members can manage apartment_agents" on apartment_agents;
create policy "Group members can manage apartment_agents"
  on apartment_agents for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

drop policy if exists "Group members can manage appointments" on appointments;
create policy "Group members can manage appointments"
  on appointments for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

drop policy if exists "Group members can manage checklist responses" on checklist_responses;
create policy "Group members can manage checklist responses"
  on checklist_responses for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

drop policy if exists "Group members can manage comments" on apartment_comments;
create policy "Group members can manage comments"
  on apartment_comments for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));
