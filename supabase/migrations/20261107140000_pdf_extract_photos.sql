-- Listing photos pulled out of a PDF are no longer readable by everyone
-- (security audit, 2026-10-29).
--
-- parse-listing saved these images as `pdf-extracts/<uuid>.jpg`, and the
-- bucket's select policy let any signed-in user read that whole folder. The
-- names are random, but they reach the people who saw the listing, and a
-- listing a household saved can show where it is looking to live. New images
-- go under `pdf-extracts/<household id>/<uuid>.jpg` and only that
-- household's members can read them. An older flat image stays readable to
-- the household whose saved listing uses it.
--
-- Safe ahead of code: older code still writes flat names, and the uploader
-- gets a signed link from the server, which skips this policy. Only an
-- unsaved flat image stops being readable to other users, which is the point.

drop policy if exists "Household members can view apartment photos" on storage.objects;

create policy "Household members can view apartment photos"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'apartment-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.apartments a
        where a.id::text = (storage.foldername(name))[2]
          and public.is_group_member(a.group_id)
      )
      or (
        (storage.foldername(name))[1] = 'pdf-extracts'
        and (
          exists (
            select 1 from public.group_members gm
            where gm.user_id = auth.uid()
              and gm.group_id::text = (storage.foldername(name))[2]
          )
          or exists (
            select 1 from public.photos p
            join public.apartments a on a.id = p.apartment_id
            where public.is_group_member(a.group_id)
              and position(objects.name in p.storage_path) > 0
          )
        )
      )
    )
  );
