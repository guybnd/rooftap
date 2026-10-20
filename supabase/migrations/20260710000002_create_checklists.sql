-- FLUX-156: Checklists section.
--
-- A general-purpose, group-shared checklist tool (packing, pre-flight, shopping
-- runs, chores) — distinct from the legacy apartment-scoring `checklist_items`
-- table. Four new tables, all group-scoped with is_group_member() RLS and the
-- full Legend-State sync contract (created_at/updated_at + handle_times() trigger,
-- (group_id, updated_at) index, deleted tombstone, replica identity full +
-- realtime publication) so they read instantly from IndexedDB and sync offline.
--
-- Cross-section wiring:
--   - checklists.scheduled_date → a linked household_tasks row (dashboard to-do);
--     household_tasks gains a nullable linked_checklist_id back-pointer.
--   - Shopping items log into cost_items via the existing linked_section='checklists'
--     convention (no cost-table schema change).

-- ── checklists ─────────────────────────────────────────────────────────────────
create table if not exists checklists (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  title text not null,
  -- ☑ plain · 🔁 repeating · 🛒 shopping. "Scheduled" is NOT a type — a due date is
  -- a cross-cutting attribute (scheduled_date) any type can carry.
  type text not null default 'plain'
    check (type in ('plain','repeating','shopping')),
  -- Well-known starter-template key this list was instantiated from (nullable).
  template_key text,
  -- When this run was cloned from a prior run (recurrence / Start again).
  source_checklist_id uuid references checklists(id) on delete set null,
  completed_at timestamptz,
  -- Cross-cutting due date → drives the linked dashboard to-do.
  scheduled_date date,
  linked_task_id uuid,                          -- household_tasks row created for the date
  -- Shopping: when on, checking an item logs a cost_items row.
  log_costs boolean not null default false,
  -- Repeating: cadence + renewal behaviour on each cadence date.
  repeat_cadence_days integer,
  repeat_renewal_mode text
    check (repeat_renewal_mode in ('clone','reset')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create index if not exists idx_checklists_group on checklists(group_id);
create index if not exists idx_checklists_group_updated_at on checklists(group_id, updated_at);

alter table checklists enable row level security;

create policy "Group members can manage checklists"
  on checklists for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

-- ── checklist_task_items ─────────────────────────────────────────────────────────
-- Named checklist_task_items (not checklist_items) to avoid colliding with the
-- legacy apartment-scoring checklist_items table.
create table if not exists checklist_task_items (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references checklists(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  label text not null,
  is_done boolean not null default false,
  -- Per-item attribution: who checked it and when (cleared on uncheck).
  checked_by uuid references auth.users(id) on delete set null,
  checked_at timestamptz,
  -- Shopping: unit cost in minor units (cents).
  cost_cents integer,
  -- Reverse pointer to the cost_items row logged when this item was checked.
  linked_cost_item_id uuid,
  "order" integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create index if not exists idx_checklist_task_items_checklist on checklist_task_items(checklist_id);
create index if not exists idx_checklist_task_items_group on checklist_task_items(group_id);
create index if not exists idx_checklist_task_items_group_updated_at on checklist_task_items(group_id, updated_at);

alter table checklist_task_items enable row level security;

create policy "Group members can manage checklist task items"
  on checklist_task_items for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

-- ── checklist_templates ───────────────────────────────────────────────────────────
-- User-authored, group-shared, editable templates. Starter templates ship as
-- seeded rows (idempotent by template_key), editable thereafter.
create table if not exists checklist_templates (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  title text not null,
  default_type text
    check (default_type in ('plain','repeating','shopping')),
  default_cadence_days integer,
  -- Well-known key for seeded starter templates (null for user-authored ones).
  template_key text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create index if not exists idx_checklist_templates_group on checklist_templates(group_id);
create index if not exists idx_checklist_templates_group_updated_at on checklist_templates(group_id, updated_at);

alter table checklist_templates enable row level security;

create policy "Group members can manage checklist templates"
  on checklist_templates for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

-- ── checklist_template_items ───────────────────────────────────────────────────────
create table if not exists checklist_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references checklist_templates(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  label text not null,
  default_cost_cents integer,
  "order" integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create index if not exists idx_checklist_template_items_template on checklist_template_items(template_id);
create index if not exists idx_checklist_template_items_group on checklist_template_items(group_id);
create index if not exists idx_checklist_template_items_group_updated_at on checklist_template_items(group_id, updated_at);

alter table checklist_template_items enable row level security;

create policy "Group members can manage checklist template items"
  on checklist_template_items for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

-- ── handle_times() triggers (bump updated_at on every write) ────────────────────────
-- Reuses the shared function from 20260618000001.
drop trigger if exists trg_checklists_handle_times on checklists;
create trigger trg_checklists_handle_times
  before insert or update on checklists
  for each row execute function public.handle_times();

drop trigger if exists trg_checklist_task_items_handle_times on checklist_task_items;
create trigger trg_checklist_task_items_handle_times
  before insert or update on checklist_task_items
  for each row execute function public.handle_times();

drop trigger if exists trg_checklist_templates_handle_times on checklist_templates;
create trigger trg_checklist_templates_handle_times
  before insert or update on checklist_templates
  for each row execute function public.handle_times();

drop trigger if exists trg_checklist_template_items_handle_times on checklist_template_items;
create trigger trg_checklist_template_items_handle_times
  before insert or update on checklist_template_items
  for each row execute function public.handle_times();

-- ── Additive to household_tasks: back-pointer to the checklist a dated to-do opens ──
alter table household_tasks add column if not exists linked_checklist_id uuid;

-- ── Realtime: full replica identity + publication (mirrors 20260618000003) ──────────
-- FULL replica identity so INSERT/DELETE and soft-delete tombstones carry the
-- non-PK columns the per-subscription group_id filter needs.
alter table public.checklists              replica identity full;
alter table public.checklist_task_items    replica identity full;
alter table public.checklist_templates     replica identity full;
alter table public.checklist_template_items replica identity full;

do $$
declare
  tbl text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach tbl in array array[
      'checklists', 'checklist_task_items', 'checklist_templates', 'checklist_template_items'
    ]
    loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = tbl
      ) then
        execute format('alter publication supabase_realtime add table public.%I', tbl);
      end if;
    end loop;
  end if;
end $$;
