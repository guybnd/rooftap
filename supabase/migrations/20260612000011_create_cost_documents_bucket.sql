-- Private storage bucket for cost documents (contracts, bills, receipts).
-- Private (not public) since these are sensitive — the UI uses signed URLs to view.
insert into storage.buckets (id, name, public)
values ('cost-documents', 'cost-documents', false)
on conflict (id) do nothing;

-- Authenticated users may upload. Path convention: {group_id}/{cost_item_id}/{filename}
create policy "Authenticated users can upload cost documents"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'cost-documents');

-- Authenticated users may read (needed to mint signed URLs). Document metadata
-- rows are themselves group-scoped via cost_documents RLS.
create policy "Authenticated users can read cost documents"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'cost-documents');

-- Authenticated users may delete cost documents.
create policy "Authenticated users can delete cost documents"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'cost-documents');
