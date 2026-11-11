import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSessionUser } from "@/lib/supabase/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { getR2Config, r2Delete, r2Key } from "@/lib/r2-storage";

// Deletes the signed-in person's account (Play Store: in the app and on the
// web page /delete-account). prepare_account_deletion hands each shared
// household on, with what the person added, and deletes the households they
// had alone; the auth admin delete then removes the account, and its own rows
// (comments, settings, tokens, connections) go with it by cascade. Files of
// the deleted households are removed last; a file that can't be removed is
// logged and never stops the delete.
//
// The body must say { confirm: "delete" }, so a stray POST can't do it.

const BUCKETS = ["documents", "cost-documents", "assistant-photos", "apartment-photos"];

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (body?.confirm !== "delete") return NextResponse.json({ error: "Confirm the delete" }, { status: 400 });

  const admin = createAdminClient();

  // Document paths of the households that go, read before the rows cascade
  // away, for the R2 store (which has no folder listing here).
  const { data: plan, error: planError } = await admin.rpc("account_deletion_plan_for", { p_user: user.id });
  if (planError) return NextResponse.json({ error: "Could not read your households" }, { status: 500 });
  const goingIds = ((plan ?? []) as { group_id: string; outcome: string }[]).filter((r) => r.outcome === "deleted").map((r) => r.group_id);
  const r2Paths: string[] = [];
  if (goingIds.length > 0 && getR2Config()) {
    const { data: docs } = await admin.from("documents").select("storage_path").in("group_id", goingIds);
    for (const d of (docs ?? []) as { storage_path: string | null }[]) if (d.storage_path) r2Paths.push(d.storage_path);
  }

  const { data: deleted, error: prepError } = await admin.rpc("prepare_account_deletion", { p_user: user.id });
  if (prepError) {
    console.error("[account/delete] prepare failed:", prepError.message);
    return NextResponse.json({ error: "Could not delete your account" }, { status: 500 });
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error("[account/delete] auth delete failed:", deleteError.message);
    return NextResponse.json({ error: "Could not delete your account" }, { status: 500 });
  }

  await removeHouseholdFiles(admin, (deleted ?? []) as string[], r2Paths).catch((err) =>
    console.error("[account/delete] file cleanup failed:", err)
  );

  return NextResponse.json({ ok: true });
}

async function removeHouseholdFiles(admin: SupabaseClient, groupIds: string[], r2Paths: string[]) {
  for (const groupId of groupIds) {
    for (const bucket of BUCKETS) {
      const paths = await listAll(admin, bucket, groupId);
      for (let i = 0; i < paths.length; i += 100) {
        const { error } = await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
        if (error) console.error(`[account/delete] could not remove files in ${bucket}:`, error.message);
      }
    }
  }
  const r2 = getR2Config();
  if (r2) for (const path of r2Paths) await r2Delete(r2, r2Key("documents", path)).catch(() => {});
}

/** Every file under a folder, depth first. Folders come back with no id. */
async function listAll(admin: SupabaseClient, bucket: string, prefix: string, depth = 0): Promise<string[]> {
  if (depth > 6) return [];
  const out: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error || !data) break;
    for (const entry of data) {
      const path = `${prefix}/${entry.name}`;
      if (entry.id) out.push(path);
      else out.push(...(await listAll(admin, bucket, path, depth + 1)));
    }
    if (data.length < 1000) break;
  }
  return out;
}
