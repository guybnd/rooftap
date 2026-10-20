-- Household plan and comp flag (Plus tier plan, slice 1:
-- /mnt/project-files/analysis/plus-tier-and-ai-gating.md). Read by the server
-- to size per-file upload caps (packages/core/src/entitlements.ts).
--
-- A separate table rather than columns on `groups`: group owners may update
-- their own `groups` row, so a column there would let a household grant itself
-- a plan. Members can read their household's row; there are no write
-- policies, so only the service role (server code, or SQL in the dashboard)
-- can set a plan or comp a household.
--
-- Additive and safe ahead of code: a household with no row is on the free plan.
create table if not exists group_entitlements (
  group_id uuid primary key references groups(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'plus')),
  plan_expires_at timestamptz,
  billing_exempt boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table group_entitlements enable row level security;

drop policy if exists "Members can view their household's plan" on group_entitlements;
create policy "Members can view their household's plan"
  on group_entitlements for select
  to authenticated
  using (is_group_member(group_id));

-- Comped households may upload files over 2 GB, which an integer can't hold.
-- Widening is safe for code that predates it.
alter table documents alter column size_bytes type bigint;

-- Bytes a household's live documents take up, for the plan's storage total.
-- Service role only (the /api/storage route).
create or replace function group_document_bytes(target_group_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(size_bytes), 0)::bigint
  from documents
  where group_id = target_group_id and not deleted;
$$;

revoke execute on function group_document_bytes(uuid) from public, anon, authenticated;
