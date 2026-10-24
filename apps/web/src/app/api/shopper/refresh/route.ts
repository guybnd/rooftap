import { NextResponse, after } from "next/server";
import {
  autoCheckedWants,
  entitlementTier,
  resolveEnabledModules,
  parseModuleList,
  wantDue,
  SHOPPER_DAILY_CHECK_MS,
  type EntitlementTier,
  type Group,
  type GroupEntitlements,
  type ShopperWant,
} from "@homeup/core";
import { createAdminClient } from "@/lib/supabase/admin";
import { billingMode } from "@/lib/billing";
import { pruneSourceCache, runLookup } from "@/lib/shopper/lookup";

// HOUP-434: the daily price check. Vercel Cron calls it (apps/web/vercel.json)
// with `Authorization: Bearer $CRON_SECRET`; a self-hosted server schedules
// the same request itself (.docs/shopper-sources.md). It works through every
// watched item that is due (core shopper-checks.ts: daily on Plus and
// self-hosted, every few days on Free, a Free household's first ten items
// only), oldest check first, a few at a time. When time runs out it calls
// itself again for the rest, up to MAX_HOPS times a day.
export const maxDuration = 60;

const PAGE = 200;
const PARALLEL = 4;
const MAX_HOPS = 30;
const BUDGET_MS = 45_000;

interface Household {
  group: Group | null;
  on: boolean;
  tier: EntitlementTier;
  auto: Set<string>;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const hop = Math.max(0, Number(url.searchParams.get("hop")) || 0);

  const admin = createAdminClient();
  const billing = billingMode();
  const available = parseModuleList(process.env.HOMEUP_MODULES);
  const households = new Map<string, Household>();
  const deadline = Date.now() + BUDGET_MS;
  // Nothing checked in the last 20 hours is due on any plan.
  const cutoff = new Date(Date.now() - SHOPPER_DAILY_CHECK_MS).toISOString();
  if (hop === 0) await pruneSourceCache(admin);

  async function household(groupId: string): Promise<Household> {
    const known = households.get(groupId);
    if (known) return known;
    const [{ data: group }, { data: rows }, { data: ent }, { data: watching }] = await Promise.all([
      admin.from("groups").select("*").eq("id", groupId).maybeSingle(),
      admin.from("group_modules").select("module_id, enabled").eq("group_id", groupId),
      admin.from("group_entitlements").select("*").eq("group_id", groupId).maybeSingle(),
      admin.from("shopper_wants").select("id, created_at").eq("group_id", groupId).eq("deleted", false).eq("status", "watching"),
    ]);
    const tier = entitlementTier(ent as GroupEntitlements | null);
    const entry: Household = {
      group: (group as Group) ?? null,
      on: resolveEnabledModules({ available, rows: rows ?? [] }).has("shopper"),
      tier,
      auto: autoCheckedWants((watching ?? []) as Pick<ShopperWant, "id" | "created_at">[], tier, billing),
    };
    households.set(groupId, entry);
    return entry;
  }

  let checked = 0;
  let failed = 0;
  let skipped = 0;
  let offset = 0;
  let more = false;
  outer: for (;;) {
    const { data: page, error } = await admin
      .from("shopper_wants")
      .select("*")
      .eq("deleted", false)
      .eq("status", "watching")
      .or(`last_checked_at.is.null,last_checked_at.lt.${cutoff}`)
      .order("last_checked_at", { ascending: true, nullsFirst: true })
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const wants = (page ?? []) as ShopperWant[];
    const due: { want: ShopperWant; group: Group }[] = [];
    for (const want of wants) {
      const h = await household(want.group_id);
      if (!h.group || !h.on || !h.auto.has(want.id) || !wantDue(want, h.tier, billing)) {
        skipped++;
        continue;
      }
      due.push({ want, group: h.group });
    }
    // Checked items leave the "older than 20 hours" window, so only skipped ones move the page on.
    offset += wants.length - due.length;
    for (let i = 0; i < due.length; i += PARALLEL) {
      if (Date.now() > deadline) {
        more = true;
        break outer;
      }
      const results = await Promise.allSettled(due.slice(i, i + PARALLEL).map(({ want, group }) => runLookup(admin, want, group)));
      results.forEach((r, j) => {
        if (r.status === "fulfilled") checked++;
        else {
          failed++;
          // A failed check moves on too, so it isn't asked again in the same run.
          offset++;
          console.warn(`shopper refresh failed for ${due[i + j].want.id}:`, r.reason instanceof Error ? r.reason.message : r.reason);
        }
      });
    }
    if (wants.length < PAGE) break;
    if (Date.now() > deadline) {
      more = true;
      break;
    }
  }

  // The rest in a fresh call, so one run is never cut off by the time limit.
  if (more && hop < MAX_HOPS) {
    const next = new URL(url);
    next.searchParams.set("hop", String(hop + 1));
    // Only the start of the call is waited on: the next run goes on after this one hangs up.
    after(() =>
      fetch(next, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(5000) }).then(
        () => {},
        () => {}
      )
    );
  }
  return NextResponse.json({ checked, failed, skipped, more, hop });
}
