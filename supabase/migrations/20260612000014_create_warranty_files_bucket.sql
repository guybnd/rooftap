-- Private storage bucket for warranty files (receipts, manuals). FLUX-75.
-- Private since receipts are sensitive — the UI mints signed URLs to view.
-- Type/size are enforced server-side at the bucket level: 10 MB cap, jpg/png/pdf only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'warranty-files',
  'warranty-files',
  false,
  10485760,                                     -- 10 MB
  array['image/jpeg','image/png','application/pdf']
)
on conflict (id) do nothing;

-- Authenticated users may upload. Path convention: {group_id}/{asset_id}/{uuid}-{filename}
create policy "Authenticated users can upload warranty files"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'warranty-files');

-- Authenticated users may read (needed to mint signed URLs). The warranty_files
-- metadata rows are themselves group-scoped via their RLS.
create policy "Authenticated users can read warranty files"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'warranty-files');

-- Authenticated users may delete warranty files.
create policy "Authenticated users can delete warranty files"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'warranty-files');
