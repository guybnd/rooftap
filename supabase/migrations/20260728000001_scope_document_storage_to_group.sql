-- HOUP-291: the `documents` and `cost-documents` bucket policies only checked
-- bucket_id + authenticated role, ignoring the `{group_id}/...` path prefix —
-- any signed-in member of any household could list/read/delete another
-- group's files. Add the same group-membership gate `apartment-photos` already
-- uses (20260526000004_create_storage_bucket.sql), via `is_group_member`
-- (defined in 20260527000005_groups_and_rls.sql). The upload path convention
-- is `{group_id}/{document_id}/{uuid}-{filename}` (packages/core/src/documents.ts),
-- so the first folder segment is always the group id.
--
-- `is_group_member` casts its argument to uuid and throws on a non-uuid path
-- segment — every object in these buckets MUST already conform to the
-- `{group_id}/...` convention before this migration is applied, or its policy
-- checks will error out and the object becomes unreadable/undeletable.

-- ── documents ────────────────────────────────────────────────────────────────
drop policy if exists "Authenticated users can upload documents" on storage.objects;
drop policy if exists "Authenticated users can read documents" on storage.objects;
drop policy if exists "Authenticated users can delete documents" on storage.objects;

create policy "Authenticated users can upload documents"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'documents'
    and is_group_member(((storage.foldername(name))[1])::uuid)
  );

create policy "Authenticated users can read documents"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'documents'
    and is_group_member(((storage.foldername(name))[1])::uuid)
  );

create policy "Authenticated users can delete documents"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'documents'
    and is_group_member(((storage.foldername(name))[1])::uuid)
  );

-- ── cost-documents ───────────────────────────────────────────────────────────
drop policy if exists "Authenticated users can upload cost documents" on storage.objects;
drop policy if exists "Authenticated users can read cost documents" on storage.objects;
drop policy if exists "Authenticated users can delete cost documents" on storage.objects;

create policy "Authenticated users can upload cost documents"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'cost-documents'
    and is_group_member(((storage.foldername(name))[1])::uuid)
  );

create policy "Authenticated users can read cost documents"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'cost-documents'
    and is_group_member(((storage.foldername(name))[1])::uuid)
  );

create policy "Authenticated users can delete cost documents"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'cost-documents'
    and is_group_member(((storage.foldername(name))[1])::uuid)
  );

-- ── warranty-files (retired, defense-in-depth) ──────────────────────────────
-- Bucket is unreferenced (20260614000011_retire_warranties_and_tracked_items.sql)
-- but left in place; harden it too in case it's ever reused. Guarded so this is
-- a no-op if the policies (or bucket) don't exist.
drop policy if exists "Authenticated users can upload warranty files" on storage.objects;
drop policy if exists "Authenticated users can read warranty files" on storage.objects;
drop policy if exists "Authenticated users can delete warranty files" on storage.objects;

create policy "Authenticated users can upload warranty files"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'warranty-files'
    and is_group_member(((storage.foldername(name))[1])::uuid)
  );

create policy "Authenticated users can read warranty files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'warranty-files'
    and is_group_member(((storage.foldername(name))[1])::uuid)
  );

create policy "Authenticated users can delete warranty files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'warranty-files'
    and is_group_member(((storage.foldername(name))[1])::uuid)
  );
