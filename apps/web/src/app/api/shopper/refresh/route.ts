import { NextResponse } from "next/server";
import { resolveEnabledModules, parseModuleList, type Group, type ShopperWant } from "@homeup/core";
import { createAdminClient } from "@/lib/supabase/admin";
import { runLookup } from "@/lib/shopper/lookup";

// HOUP-434: the daily price check. Vercel Cron calls it (apps/web/vercel.json)
// with `Authorization: Bearer $CRON_SECRET`; a self-hosted server schedules
// the same request itself (.docs/shopper-sources.md). Checks watching wants
// whose last check is older than CHECK_AFTER_MS, oldest first, in households
// that still have Shopper on, up to MAX_PER_RUN per call.
export const maxDuration = 60;

const CHECK_AFTER_MS = 20 * 60 * 60 * 1000;
const MAX_PER_RUN = 40;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - CHECK_AFTER_MS).toISOString();
  const { data: wants, error } = await admin
    .from("shopper_wants")
    .select("*")
    .eq("deleted", false)
    .eq("status", "watching")
    .or(`last_checked_at.is.null,last_checked_at.lt.${cutoff}`)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(MAX_PER_RUN);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const available = parseModuleList(process.env.HOMEUP_MODULES);
  const groups = new Map<string, { group: Group | null; on: boolean }>();
  let checked = 0;
  let failed = 0;
  const deadline = Date.now() + 50_000;
  for (const want of (wants ?? []) as ShopperWant[]) {
    if (Date.now() > deadline) break;
    let entry = groups.get(want.group_id);
    if (!entry) {
      const [{ data: group }, { data: rows }] = await Promise.all([
        admin.from("groups").select("*").eq("id", want.group_id).maybeSingle(),
        admin.from("group_modules").select("module_id, enabled").eq("group_id", want.group_id),
      ]);
      entry = { group: (group as Group) ?? null, on: resolveEnabledModules({ available, rows: rows ?? [] }).has("shopper") };
      groups.set(want.group_id, entry);
    }
    if (!entry.group || !entry.on) continue;
    try {
      await runLookup(admin, want, entry.group);
      checked++;
    } catch (err) {
      failed++;
      console.warn(`shopper refresh failed for ${want.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return NextResponse.json({ checked, failed, pending: (wants?.length ?? 0) - checked - failed });
}
