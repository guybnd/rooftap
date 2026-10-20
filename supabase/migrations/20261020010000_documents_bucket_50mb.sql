-- Raise the documents bucket's per-file cap from 10 MB to 50 MB, the most a
-- Supabase Free project allows (its global file size limit). Larger files need
-- the Pro plan's global limit raised in the dashboard first, then another bump
-- here and in DOCUMENT_MAX_BYTES (packages/core/src/documents.ts).
-- Additive and safe ahead of code: older clients keep checking 10 MB locally.
-- Reverse with file_size_limit = 10485760.
update storage.buckets
set file_size_limit = 52428800  -- 50 MB
where id = 'documents';
