-- FLUX-189: Recipes section.
--
-- A group-shared recipe book. Each recipe carries structured ingredient rows
-- (name + optional quantity/unit) that name-match against grocery_items so the
-- recipe can show a live "have it / need it" fill bar and push missing items to
-- the shopping list. Two new tables (parent recipes + child recipe_ingredients),
-- both group-scoped with is_group_member() RLS and the full Legend-State sync
-- contract (created_at/updated_at + handle_times() trigger, (group_id, updated_at)
-- index, deleted tombstone, replica identity full + realtime publication) so they
-- read instantly from IndexedDB and sync offline.
--
-- Cross-section wiring: the recipe→grocery link is name-based (no hard FK) and
-- lives in application code (src/lib/recipes.ts); the ephemeral "250g for Lasagna"
-- note attaches via grocery_items.recipe_note / recipe_source_id (added in the
-- follow-up migration 20260711000004).

-- ── recipes ──────────────────────────────────────────────────────────────────
create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  title text not null,
  -- Free-text cuisine tags (e.g. Italian, Thai). Multi-select in the UI.
  cuisines text[] not null default '{}',
  -- Fixed cooking method enum. Nullable → "unset"/other in the UI.
  method text check (method in ('cooking','baking','roasting','other')),
  -- Optional free-text preparation instructions.
  instructions text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create index if not exists idx_recipes_group on recipes(group_id);
create index if not exists idx_recipes_group_updated_at on recipes(group_id, updated_at);

alter table recipes enable row level security;

create policy "Group members can manage recipes"
  on recipes for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

-- ── recipe_ingredients ─────────────────────────────────────────────────────────
-- Structured ingredient rows. `name` is what the have/need match keys on
-- (normalized in app code); quantity/unit are display-only amounts. `unit` stays
-- free text at the DB level — the recipe form constrains it to a bounded dropdown
-- (a form-level constraint, not a schema lock, so the unit set can grow freely).
create table if not exists recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  name text not null,
  quantity numeric,
  unit text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create index if not exists idx_recipe_ingredients_recipe on recipe_ingredients(recipe_id);
create index if not exists idx_recipe_ingredients_group on recipe_ingredients(group_id);
create index if not exists idx_recipe_ingredients_group_updated_at on recipe_ingredients(group_id, updated_at);

alter table recipe_ingredients enable row level security;

create policy "Group members can manage recipe ingredients"
  on recipe_ingredients for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

-- ── handle_times() triggers (bump updated_at on every write) ────────────────────────
-- Reuses the shared function from 20260618000001.
drop trigger if exists trg_recipes_handle_times on recipes;
create trigger trg_recipes_handle_times
  before insert or update on recipes
  for each row execute function public.handle_times();

drop trigger if exists trg_recipe_ingredients_handle_times on recipe_ingredients;
create trigger trg_recipe_ingredients_handle_times
  before insert or update on recipe_ingredients
  for each row execute function public.handle_times();

-- ── Realtime: full replica identity + publication (mirrors 20260618000003) ──────────
alter table public.recipes            replica identity full;
alter table public.recipe_ingredients replica identity full;

do $$
declare
  tbl text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach tbl in array array['recipes', 'recipe_ingredients']
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
