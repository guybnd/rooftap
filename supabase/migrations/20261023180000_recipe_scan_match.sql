-- Recipes scan match: the household's staples and the names it taught the
-- match step (packages/core/src/modules/recipes/scan-match.ts).
--
-- recipe_staples: things the household always has (salt, oil). They never go
-- on the shopping list. The app has built-in defaults, so a row either adds a
-- staple (staple = true) or switches a default off (staple = false).
--
-- ingredient_aliases: "arborio rice" means our "Risotto rice". Answering
-- "Same" in the match step records one, so the next scan links on its own.
-- An alias whose item_name is itself means "its own item, stop asking".
--
-- Group-scoped tables with the full Legend-State sync contract
-- (created_at/updated_at + handle_times(), (group_id, updated_at) index,
-- deleted tombstone, replica identity full + realtime publication), granted
-- to the Data API roles (apps/web/src/lib/migration-grants.test.ts).
--
-- No unique (group_id, name) constraint: two people can answer offline, and
-- the app reads the newest row for a name. A unique key would turn the second
-- sync into a conflict.
--
-- Additive and safe ahead of code: new tables nothing reads until the app
-- gates on server feature recipes.scan-match (server-features.ts).

create table if not exists recipe_staples (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  name text not null,
  staple boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

grant select, insert, update, delete on public.recipe_staples to anon, authenticated, service_role;

create index if not exists idx_recipe_staples_group_updated_at on recipe_staples(group_id, updated_at);

alter table recipe_staples enable row level security;

drop policy if exists "Group members can manage recipe staples" on recipe_staples;
create policy "Group members can manage recipe staples"
  on recipe_staples for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

drop trigger if exists trg_recipe_staples_handle_times on recipe_staples;
create trigger trg_recipe_staples_handle_times
  before insert or update on recipe_staples
  for each row execute function public.handle_times();

alter table recipe_staples replica identity full;

create table if not exists ingredient_aliases (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  alias text not null,
  item_name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

grant select, insert, update, delete on public.ingredient_aliases to anon, authenticated, service_role;

create index if not exists idx_ingredient_aliases_group_updated_at on ingredient_aliases(group_id, updated_at);

alter table ingredient_aliases enable row level security;

drop policy if exists "Group members can manage ingredient aliases" on ingredient_aliases;
create policy "Group members can manage ingredient aliases"
  on ingredient_aliases for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

drop trigger if exists trg_ingredient_aliases_handle_times on ingredient_aliases;
create trigger trg_ingredient_aliases_handle_times
  before insert or update on ingredient_aliases
  for each row execute function public.handle_times();

alter table ingredient_aliases replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'recipe_staples'
    ) then
      alter publication supabase_realtime add table recipe_staples;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ingredient_aliases'
    ) then
      alter publication supabase_realtime add table ingredient_aliases;
    end if;
  end if;
end $$;
