-- Private storage bucket for the central documents store (FLUX-98 / FLUX-103).
-- Dedicated bucket (NOT overloading cost-documents/warranty-files). Private since
-- documents are sensitive — the UI mints signed URLs to view. Type/size enforced
-- server-side: 10 MB cap, images + PDF only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  10485760,                                     -- 10 MB
  array['image/jpeg','image/png','image/webp','application/pdf']
)
on conflict (id) do nothing;

-- Authenticated users may upload. Path convention: {group_id}/{document_id}/{uuid}-{filename}
-- The documents metadata rows are themselves group-scoped via their RLS.
create policy "Authenticated users can upload documents"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'documents');

-- Authenticated users may read (needed to mint signed URLs).
create policy "Authenticated users can read documents"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'documents');

-- Authenticated users may delete documents.
create policy "Authenticated users can delete documents"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'documents');
