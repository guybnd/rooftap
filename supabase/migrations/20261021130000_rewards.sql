-- Rewards module: loyalty schemes, the partner stores they work at, and the
-- perks they give there (packages/core/src/rewards.ts). Cards stay in
-- loyalty_cards (Groceries' rewards cards), which gains a scheme link,
-- "Just me" cards, an expiry and notes.
--
-- Three new group-scoped tables with the full Legend-State sync contract
-- (created_at/updated_at + handle_times(), (group_id, updated_at) index,
-- deleted tombstone, replica identity full + realtime publication), each
-- granted to the Data API roles (CLAUDE.md migration rule 6).
--
-- Additive and safe ahead of code: new tables, new nullable or defaulted
-- columns, and a select policy that hides only rows marked private, which
-- nothing can mark before the rewards module ships. The module is gated on
-- this migration with minSchema.

create table if not exists reward_schemes (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  name text not null,
  kind text not null default 'loyalty' check (kind in ('loyalty', 'membership', 'discount', 'card_perk', 'other')),
  website text,
  partners_url text,
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  catalog_id text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

grant select, insert, update, delete on public.reward_schemes to anon, authenticated, service_role;

create index if not exists idx_reward_schemes_group_updated_at on reward_schemes(group_id, updated_at);

alter table reward_schemes enable row level security;

drop policy if exists "Group members can manage reward schemes" on reward_schemes;
create policy "Group members can manage reward schemes"
  on reward_schemes for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

create table if not exists reward_partners (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  scheme_id uuid not null references reward_schemes(id) on delete cascade,
  name text not null,
  brand_key text not null,
  category text,
  online_only boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

grant select, insert, update, delete on public.reward_partners to anon, authenticated, service_role;

create index if not exists idx_reward_partners_scheme on reward_partners(scheme_id);
create index if not exists idx_reward_partners_group_updated_at on reward_partners(group_id, updated_at);

alter table reward_partners enable row level security;

drop policy if exists "Group members can manage reward partners" on reward_partners;
create policy "Group members can manage reward partners"
  on reward_partners for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

create table if not exists reward_perks (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  scheme_id uuid not null references reward_schemes(id) on delete cascade,
  partner_id uuid references reward_partners(id) on delete cascade,
  title text not null,
  kind text not null default 'other' check (kind in ('percent', 'amount', 'points', 'freebie', 'other')),
  value numeric check (value is null or value >= 0),
  conditions text,
  valid_until date,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

grant select, insert, update, delete on public.reward_perks to anon, authenticated, service_role;

create index if not exists idx_reward_perks_scheme on reward_perks(scheme_id);
create index if not exists idx_reward_perks_group_updated_at on reward_perks(group_id, updated_at);

alter table reward_perks enable row level security;

drop policy if exists "Group members can manage reward perks" on reward_perks;
create policy "Group members can manage reward perks"
  on reward_perks for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

-- Cards: link to a scheme, and "Just me" cards only their holder sees.
alter table loyalty_cards add column if not exists scheme_id uuid references reward_schemes(id) on delete set null;
alter table loyalty_cards add column if not exists private boolean not null default false;
alter table loyalty_cards add column if not exists expires_on date;
alter table loyalty_cards add column if not exists notes text;

drop policy if exists "Group members can manage loyalty cards" on loyalty_cards;
create policy "Group members can manage loyalty cards"
  on loyalty_cards for all
  using (is_group_member(group_id) and (not private or created_by = auth.uid()))
  with check (is_group_member(group_id) and (not private or created_by = auth.uid()));

-- Sync-ready: handle_times() keeps updated_at honest for changesSince pulls.
drop trigger if exists trg_reward_schemes_handle_times on reward_schemes;
create trigger trg_reward_schemes_handle_times
  before insert or update on reward_schemes
  for each row execute function public.handle_times();

drop trigger if exists trg_reward_partners_handle_times on reward_partners;
create trigger trg_reward_partners_handle_times
  before insert or update on reward_partners
  for each row execute function public.handle_times();

drop trigger if exists trg_reward_perks_handle_times on reward_perks;
create trigger trg_reward_perks_handle_times
  before insert or update on reward_perks
  for each row execute function public.handle_times();

alter table reward_schemes replica identity full;
alter table reward_partners replica identity full;
alter table reward_perks replica identity full;

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['reward_schemes', 'reward_partners', 'reward_perks'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table %I', t);
      end if;
    end loop;
  end if;
end $$;
