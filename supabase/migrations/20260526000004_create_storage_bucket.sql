-- Create apartment-photos storage bucket
insert into storage.buckets (id, name, public)
values ('apartment-photos', 'apartment-photos', true)
on conflict (id) do nothing;

-- Allow authenticated users to upload to their own folder
create policy "Users can upload their own photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'apartment-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Allow authenticated users to read any photos (for shared access)
create policy "Anyone can view apartment photos"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'apartment-photos');

-- Allow users to delete their own photos
create policy "Users can delete their own photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'apartment-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
