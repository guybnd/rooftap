# Document storage on Cloudflare R2

> **TL;DR** Hosted Rooftap keeps documents-store files in Cloudflare R2 (free up to 10 GB, no download fees, per-file cap by household plan). Supabase Storage stays the fallback: for self-hosted servers, for files not copied yet, and whenever R2 or the API can't be reached. Existing files are copied by a script that never deletes anything.

## How it works

- Scope: the `documents` bucket only (the documents store). Legacy buckets (`cost-documents`, `apartment-photos`, `photos`) stay in Supabase.
- R2 keys mirror Supabase paths: the object `documents/<group>/<doc>/<file>` in R2 is the copy of `<group>/<doc>/<file>` in the Supabase `documents` bucket. No database column records where a file lives.
- Both apps call `POST /api/storage` (`apps/web/src/app/api/storage/route.ts`) through packages/core's seam (`packages/core/src/document-storage.ts`, registered by each app's `lib/document-storage-env.ts`):
  - `upload`: returns a presigned PUT pinned to the file's type and size, or `supabase`.
  - `view`: returns a presigned GET when the R2 copy exists, otherwise `supabase` (the client signs a Supabase URL as before).
  - `delete`: removes the R2 copy. The Supabase original is removed by the client as before.
- Access mirrors the Supabase bucket policies (HOUP-291): the path's first segment is the group id, and the caller must be a member of it.
- When the four `R2_*` env vars are unset the route answers `{ provider: "supabase", r2: false }`, and clients stop asking for five minutes. Self-hosted servers need nothing.
- Caps: per household, from its plan in `group_entitlements` (`packages/core/src/entitlements.ts`): Free 20 MB per file and 2 GB in total, Plus 1 GB per file and 25 GB in total, comped (`billing_exempt`) 5 GB per file (R2's single-upload ceiling) with no total. The total counts live `documents` rows (`group_document_bytes`). The route enforces them; clients only pre-check against the largest. Supabase fallback stays 50 MB (`SUPABASE_DOCUMENT_MAX_BYTES`, the bucket limit and the Supabase Free maximum).
- Comping a household (service role only; members can read their row, nobody can write it from the app):
  ```sql
  insert into group_entitlements (group_id, billing_exempt) values ('<group id>', true)
  on conflict (group_id) do update set billing_exempt = true, updated_at = now();
  ```
- Native uploads from the pickers stream from disk (`FileSystem.uploadAsync`), so big files aren't held in JS memory.
- Signing is plain SigV4 in `apps/web/src/lib/r2-sign.mjs` (no S3 SDK), shared with the copy script and tested against AWS's published example.

## One-time setup (hosted)

1. Cloudflare dashboard → R2 → create a bucket (for example `homeup-files`), location Automatic, Standard storage class. Avoid Infrequent Access, which has retrieval fees and a 30-day minimum.
2. Bucket → Settings → CORS policy. The web app PUTs and GETs from the browser:
   ```json
   [
     {
       "AllowedOrigins": ["https://<your web domain>", "http://localhost:3000"],
       "AllowedMethods": ["GET", "PUT", "HEAD"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
3. R2 → Manage API tokens → Create token: Object Read & Write, scoped to that bucket. Note the Access Key ID, the Secret Access Key, and your account id.
4. Vercel → Project → Settings → Environment Variables (Production): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Redeploy.
5. Check: upload a document on web and on the phone, open it, and confirm it appears in the R2 bucket under `documents/`.

## Copying existing files

`scripts/storage/copy-to-r2.mjs`. Put the four `R2_*` values plus `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `apps/web/.env.local`, then:

```bash
node --env-file=apps/web/.env.local scripts/storage/copy-to-r2.mjs           # dry run: counts and sizes only
node --env-file=apps/web/.env.local scripts/storage/copy-to-r2.mjs --apply   # copy
```

- It never deletes or changes anything in Supabase. Originals stay as the backup.
- Each PUT carries Content-MD5, so R2 rejects a corrupted copy. Then the script HEADs the copy and checks size and MD5 again.
- A file switches to R2 only once its copy exists, so a partial or failed run is harmless. Re-running skips files already copied.
- It writes `r2-copy-report-<time>.json` (gitignored) listing every file's outcome, and exits non-zero if anything failed.

Freeing Supabase space (deleting the originals) is a separate, deliberate step. It isn't scripted.

## Turning R2 off

Removing the env vars sends everything back to Supabase, but files uploaded while R2 was on exist only in R2 and would stop opening. Copy those back to Supabase first.
