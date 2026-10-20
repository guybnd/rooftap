-- Make the `apartment-photos` bucket private. Until now it was public (anyone
-- with a photo's link could open it) and its select policy let any signed-in
-- user read every household's photos. The apps load photos through signed
-- URLs since #411 (packages/core/src/photos.ts apartmentPhotoUrls), which
-- need only the select policy below.
--
-- Paths: `<uploader id>/<apartment id>/<file>` for uploads from the apps, and
-- `pdf-extracts/<uuid>.jpg` for images parse-listing pulls out of listing
-- PDFs (random names, not tied to an apartment until saved). Comparisons are
-- on text so an odd path segment can't make the uuid cast throw.

update storage.buckets set public = false where id = 'apartment-photos';

drop policy if exists "Anyone can view apartment photos" on storage.objects;

create policy "Household members can view apartment photos"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'apartment-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or (storage.foldername(name))[1] = 'pdf-extracts'
      or exists (
        select 1 from apartments a
        where a.id::text = (storage.foldername(name))[2]
          and is_group_member(a.group_id)
      )
    )
  );
