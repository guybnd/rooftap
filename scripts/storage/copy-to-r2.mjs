// Copy existing documents-store files from Supabase Storage to Cloudflare R2.
// See .docs/r2-storage.md for setup and the full runbook.
//
//   node --env-file=apps/web/.env.local scripts/storage/copy-to-r2.mjs           # dry run: list what would copy
//   node --env-file=apps/web/.env.local scripts/storage/copy-to-r2.mjs --apply   # copy
//
// Safety:
// - Never deletes or changes anything in Supabase. The originals stay as the backup.
// - Each upload sends Content-MD5, so R2 rejects a copy whose bytes don't match.
//   Then it HEADs the copy and checks size and checksum again.
// - The app serves a file from R2 only once its copy exists. Until then it
//   keeps reading the Supabase original, so a partial run is harmless.
// - Safe to re-run: files already in R2 with the right size are skipped.
//
// Needs SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
// R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET.

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { presignR2, r2ConfigFromEnv, r2Key } from "../../apps/web/src/lib/r2-sign.mjs";

const BUCKETS = ["documents"]; // keep in step with R2_BUCKETS in apps/web/src/lib/r2-storage.ts
const CONCURRENCY = 4;
const apply = process.argv.includes("--apply");

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const r2 = r2ConfigFromEnv(process.env);
if (!supabaseUrl || !serviceKey || !r2) {
  console.error("Missing env: SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET are all required.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

/** Every object under a bucket, walking folders. */
async function listAll(bucket, prefix = "") {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) out.push(...(await listAll(bucket, path))); // a folder
      else out.push({ bucket, path, size: item.metadata?.size ?? null, mimeType: item.metadata?.mimetype ?? "application/octet-stream" });
    }
    if (data.length < 1000) return out;
  }
}

/** { size, etag } of the R2 copy, or null when there isn't one. */
async function headR2(key) {
  const res = await fetch(presignR2(r2, { method: "HEAD", key, expiresIn: 60 }), { method: "HEAD" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HEAD ${key}: ${res.status}`);
  return { size: Number(res.headers.get("content-length")), etag: (res.headers.get("etag") ?? "").replaceAll('"', "") };
}

async function copyOne(obj) {
  const key = r2Key(obj.bucket, obj.path);
  const existing = await headR2(key);
  if (existing && obj.size !== null && existing.size === obj.size) return "skipped";
  if (!apply) return "would-copy";

  const { data: blob, error } = await supabase.storage.from(obj.bucket).download(obj.path);
  if (error || !blob) throw new Error(`download: ${error?.message ?? "no data"}`);
  const bytes = Buffer.from(await blob.arrayBuffer());
  const md5 = createHash("md5").update(bytes);
  const md5Hex = md5.copy().digest("hex");
  const md5Base64 = md5.digest("base64");

  const headers = { "content-type": obj.mimeType, "content-length": String(bytes.length), "content-md5": md5Base64 };
  const put = await fetch(presignR2(r2, { method: "PUT", key, expiresIn: 900, headers }), { method: "PUT", headers, body: bytes });
  if (!put.ok) throw new Error(`PUT: ${put.status} ${await put.text()}`);

  const copied = await headR2(key);
  if (!copied || copied.size !== bytes.length || copied.etag !== md5Hex) {
    throw new Error(`verify: R2 has ${JSON.stringify(copied)}, expected ${bytes.length} bytes, md5 ${md5Hex}`);
  }
  return "copied";
}

const objects = (await Promise.all(BUCKETS.map((b) => listAll(b)))).flat();
const totalBytes = objects.reduce((n, o) => n + (o.size ?? 0), 0);
console.log(`${objects.length} files (${(totalBytes / 1024 / 1024).toFixed(1)} MB) in ${BUCKETS.join(", ")}. ${apply ? "Copying." : "Dry run, pass --apply to copy."}`);

const results = [];
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < objects.length) {
      const obj = objects[next++];
      try {
        const outcome = await copyOne(obj);
        results.push({ ...obj, outcome });
        if (outcome === "copied") console.log(`copied  ${obj.bucket}/${obj.path}`);
      } catch (err) {
        results.push({ ...obj, outcome: "failed", error: String(err.message ?? err) });
        console.error(`FAILED  ${obj.bucket}/${obj.path}: ${err.message ?? err}`);
      }
    }
  }),
);

const count = (o) => results.filter((r) => r.outcome === o).length;
const report = `r2-copy-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(report, JSON.stringify(results, null, 2));
console.log(`copied ${count("copied")}, already there ${count("skipped")}, would copy ${count("would-copy")}, failed ${count("failed")}. Report: ${report}`);
console.log("Nothing was deleted from Supabase.");
process.exit(count("failed") ? 1 : 0);
