-- Central documents store (FLUX-98 / FLUX-103)
-- A single group-scoped store that all capture/intake flows write into, with a
-- polymorphic many-to-many join so one document can serve multiple services
-- ("use it for each service accordingly"). Greenfield/additive — the existing
-- cost_documents / warranty_files / grocery receipt_path silos keep working and
-- are unified later (FLUX-106).

-- The store itself: one row per uploaded artifact (invoice, receipt, warranty
-- doc, manual, contract, photo, ...). group_id is denormalized for simple RLS.
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  storage_path text not null,                   -- path in the 'documents' storage bucket
  filename text not null,
  mime_type text,
  size_bytes integer,
  doc_type text not null default 'other'
    check (doc_type in ('invoice','receipt','warranty','manual','contract','photo','other')),
  title text,                                   -- user-editable label
  parsed jsonb,                                 -- raw /api/parse-receipt output when parsed
  source text not null default 'capture'
    check (source in ('capture','cost','warranty','grocery','other')),
  uploaded_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index idx_documents_group on documents(group_id);
create index idx_documents_doc_type on documents(doc_type);

alter table documents enable row level security;

create policy "Group members can manage documents"
  on documents for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

-- Polymorphic many-to-many: a document can be linked to any number of services.
-- group_id is denormalized so RLS needs no FK-chain join.
create table if not exists document_links (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  entity_type text not null
    check (entity_type in ('cost_item','warranty_asset','grocery_session','setup_item')),
  entity_id uuid not null,
  link_role text,                               -- e.g. 'bill', 'receipt', 'manual'
  created_at timestamptz not null default now(),
  unique (document_id, entity_type, entity_id)
);

create index idx_document_links_document on document_links(document_id);
create index idx_document_links_entity on document_links(entity_type, entity_id);

alter table document_links enable row level security;

create policy "Group members can manage document links"
  on document_links for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));
