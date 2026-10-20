-- Documents capture UX overhaul — metadata + permission split (FLUX-113 / epic FLUX-112)
-- Adds the metadata the redesigned capture flow files at intake (expiry, tags),
-- expands doc_type with household categories (ID, insurance, lease, tax, medical,
-- vehicle, appliance manual), and splits the single catch-all RLS policy so that
-- any group member can rename/recategorise a shared document but only the
-- uploader (or a group owner) can delete it.

-- ── New metadata columns ─────────────────────────────────────────────────────
alter table documents
  add column if not exists expiry_date date,                 -- warranties / IDs / insurance / rego
  add column if not exists tags text[] not null default '{}'; -- free-text filing tags (lowercased on save)

-- Index expiry so "expiring soon" surfaces (FLUX-116/118) stay cheap; partial,
-- since the vast majority of documents never expire.
create index if not exists idx_documents_expiry
  on documents(expiry_date)
  where expiry_date is not null;

-- ── Expanded doc_type categories ─────────────────────────────────────────────
-- The inline check from the create-table migration is named documents_doc_type_check.
alter table documents drop constraint if exists documents_doc_type_check;
alter table documents add constraint documents_doc_type_check
  check (doc_type in (
    'invoice','receipt','warranty','manual','contract','photo','other',
    'id_personal','insurance','lease_contract','tax_financial','medical','vehicle','appliance_manual'
  ));

-- ── Permission split ─────────────────────────────────────────────────────────
-- Replace the single FOR ALL policy with granular ones. Read / insert / update
-- stay open to all group members (collaborative household); delete is restricted
-- to the uploader or a group owner.
drop policy if exists "Group members can manage documents" on documents;

create policy "Group members can view documents"
  on documents for select
  using (is_group_member(group_id));

create policy "Group members can add documents"
  on documents for insert
  with check (is_group_member(group_id) and uploaded_by = auth.uid());

create policy "Group members can update documents"
  on documents for update
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

create policy "Uploader or group owner can delete documents"
  on documents for delete
  using (
    is_group_member(group_id)
    and (
      uploaded_by = auth.uid()
      or exists (
        select 1 from group_members
        where group_members.group_id = documents.group_id
        and group_members.user_id = auth.uid()
        and group_members.role = 'owner'
      )
    )
  );
