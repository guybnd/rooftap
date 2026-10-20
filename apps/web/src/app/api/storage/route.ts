import { NextResponse } from "next/server";
import {
  DOCUMENT_ACCEPTED_TYPES,
  SIGNED_URL_TTL_SECONDS,
  documentFileLimit,
  documentStorageLimit,
  type GroupEntitlements,
} from "@homeup/core";
import { getSessionUser } from "@/lib/supabase/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { getR2Config, groupIdFromPath, r2Delete, r2Exists, r2Key, r2UploadUrl, r2ViewUrl, R2_BUCKETS } from "@/lib/r2-storage";

// Documents-store file access when hosted storage is Cloudflare R2
// (.docs/r2-storage.md). Both apps call this from packages/core's
// document-storage seam (cookie on web, Bearer on native). It answers
// { provider: "supabase" } whenever R2 isn't configured or the object only
// exists in Supabase, and the client then uses Supabase Storage exactly as
// before, so self-hosted servers and not-yet-copied files keep working.
//
// Access mirrors the Supabase bucket policies (HOUP-291): the first path
// segment is the group id and the caller must be a member of that group.

const UPLOAD_URL_TTL_SECONDS = 900;

type Op = "upload" | "view" | "delete";

interface Body {
  op?: Op;
  bucket?: string;
  path?: string;
  mimeType?: string;
  sizeBytes?: number;
}

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return bad("Unauthorized", 401);

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad("Invalid JSON");
  }
  const { op, bucket, path } = body;
  if (op !== "upload" && op !== "view" && op !== "delete") return bad("Unknown op");
  if (!bucket || !path) return bad("bucket and path are required");

  const config = getR2Config();
  // r2: false tells clients to stop asking for a while (self-host).
  if (!config) return NextResponse.json({ provider: "supabase", r2: false });
  if (!R2_BUCKETS.has(bucket)) return NextResponse.json({ provider: "supabase" });

  const groupId = groupIdFromPath(path);
  if (!groupId) return bad("Invalid path");

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("group_members")
    .select("user_id")
    .eq("group_id", groupId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return bad("Not found", 404);

  const key = r2Key(bucket, path);

  try {
    if (op === "upload") {
      const { mimeType, sizeBytes } = body;
      if (!mimeType || !(DOCUMENT_ACCEPTED_TYPES as readonly string[]).includes(mimeType)) {
        return bad("Only images (JPG, PNG, WebP) or PDF files are allowed.");
      }
      if (typeof sizeBytes !== "number" || !Number.isInteger(sizeBytes) || sizeBytes <= 0) {
        return bad("Invalid file size.");
      }
      // Each household's cap comes from its plan (packages/core/src/entitlements.ts).
      const { data: entitlements } = await admin
        .from("group_entitlements")
        .select("plan, plan_expires_at, billing_exempt")
        .eq("group_id", groupId)
        .maybeSingle();
      const limit = documentFileLimit(entitlements as GroupEntitlements | null);
      if (sizeBytes > limit.bytes) {
        return NextResponse.json({ provider: "refused", error: `File is too large (max ${limit.label}).` });
      }
      const total = documentStorageLimit(entitlements as GroupEntitlements | null);
      if (total) {
        const { data: used, error: usedErr } = await admin.rpc("group_document_bytes", { target_group_id: groupId });
        if (usedErr) throw new Error(`group_document_bytes: ${usedErr.message}`);
        if (Number(used ?? 0) + sizeBytes > total.bytes) {
          return NextResponse.json({
            provider: "refused",
            error: `Your household's ${total.label} of document storage is full. Delete some documents to make room.`,
          });
        }
      }
      return NextResponse.json({
        provider: "r2",
        url: r2UploadUrl(config, key, mimeType, sizeBytes, UPLOAD_URL_TTL_SECONDS),
        headers: { "Content-Type": mimeType },
      });
    }

    if (op === "view") {
      if (!(await r2Exists(config, key))) return NextResponse.json({ provider: "supabase" });
      return NextResponse.json({ provider: "r2", url: r2ViewUrl(config, key, SIGNED_URL_TTL_SECONDS) });
    }

    await r2Delete(config, key);
    return NextResponse.json({ provider: "r2", ok: true });
  } catch (err) {
    console.error("storage route failed:", err);
    return bad("Storage is unavailable right now.", 502);
  }
}
