-- Rewards cards in Groceries: a household's loyalty cards (Flybuys, Everyday
-- Rewards...) shown as a scannable barcode or QR at the checkout. Group-scoped
-- and local-first (Legend-State store), like events. Additive: a new table
-- that code predating it never reads.
create table if not exists loyalty_cards (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  name text not null,
  number text not null,
  format text not null default 'code128' check (format in ('code128', 'ean13', 'qr')),
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_loyalty_cards_group_updated_at on loyalty_cards(group_id, updated_at);

alter table loyalty_cards enable row level security;

drop policy if exists "Group members can manage loyalty cards" on loyalty_cards;
create policy "Group members can manage loyalty cards"
  on loyalty_cards for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

-- Sync-ready: the shared handle_times() trigger keeps updated_at honest for
-- changesSince incremental pulls.
drop trigger if exists trg_loyalty_cards_handle_times on loyalty_cards;
create trigger trg_loyalty_cards_handle_times
  before insert or update on loyalty_cards
  for each row
  execute function public.handle_times();

alter table loyalty_cards replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'loyalty_cards'
    ) then
      alter publication supabase_realtime add table loyalty_cards;
    end if;
  end if;
end $$;
