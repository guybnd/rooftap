import { NextResponse } from "next/server";
import {
  actualsSinceOf,
  bankActualsOf,
  costActuals,
  costBankLinks,
  monthKeyAt,
  parseModuleList,
  resolveEnabledModules,
  summariseAccounts,
  summariseSpending,
  weeklyMoneyDigest,
  type CostItem,
} from "@homeup/core";
import { createAdminClient } from "@/lib/supabase/admin";
import { postHouseholdRoutine } from "@/lib/assistant/service";
import { notifyHousehold } from "@/lib/assistant/reads";
import { bankLinkRows, shareModeOf, upBankAllowed, visibleBankAccounts, visibleBankTransactions, type UpConnectionRow } from "@/lib/up-bank";

// Up Bank connector: the weekly money digest. Vercel Cron calls it on Sunday
// morning in Australia (apps/web/vercel.json) with
// `Authorization: Bearer $CRON_SECRET`; a self-hosted server schedules the
// same request itself (.docs/self-hosting.md). For each household with the
// Assistant and Costs on where someone shares Up with the household and
// keeps the digest on, the assistant posts the week's shared spending,
// nudges and bills ahead (core weeklyMoneyDigest) to the Household chat and
// members get a push. Only what the household already shares is read.
export const maxDuration = 60;

const DAY_MS = 86_400_000;
/** How far back payments are read: the cost lines' last payments and this year's actuals. */
const LOOKBACK_MS = 120 * DAY_MS;
const MARKER = "**Your week in money";

/** Date#getTimezoneOffset for an IANA zone at an instant: -600 in Sydney. */
function tzOffsetOf(timeZone: string, at: Date): number {
  try {
    const local = new Date(at.toLocaleString("en-US", { timeZone }));
    const utc = new Date(at.toLocaleString("en-US", { timeZone: "UTC" }));
    return Math.round((utc.getTime() - local.getTime()) / 60_000);
  } catch {
    return 0;
  }
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: conns, error } = await admin.from("up_bank_connections").select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // A household gets the digest while someone shares Up with it and keeps it on.
  const byGroup = new Map<string, UpConnectionRow>();
  for (const c of (conns ?? []) as UpConnectionRow[]) {
    if (shareModeOf(c) === "none" || c.weekly_digest === false || byGroup.has(c.group_id)) continue;
    byGroup.set(c.group_id, c);
  }

  const available = parseModuleList(process.env.HOMEUP_MODULES);
  const now = new Date();
  let posted = 0;
  let failed = 0;
  for (const [groupId, conn] of byGroup) {
    try {
      const { data: moduleRows } = await admin.from("group_modules").select("module_id, enabled").eq("group_id", groupId);
      const on = resolveEnabledModules({ available, rows: moduleRows ?? [] });
      if (!on.has("assistant") || !on.has("costs") || !(await upBankAllowed(admin, groupId))) continue;

      const { data: settings } = await admin.from("user_settings").select("timezone").eq("user_id", conn.user_id).maybeSingle();
      const tz = tzOffsetOf((settings?.timezone as string | undefined) || "UTC", now);
      // Household scope reads what each person shares, whoever is looking.
      const [rows, accounts, rules, { data: items }] = await Promise.all([
        visibleBankTransactions(admin, {
          userId: conn.user_id,
          groupId,
          from: new Date(Math.min(now.getTime() - LOOKBACK_MS, new Date(now.getFullYear(), 0, 1).getTime())).toISOString(),
          to: new Date(now.getTime() + DAY_MS).toISOString(),
          limit: 5000,
          scope: "household",
        }),
        visibleBankAccounts(admin, conn.user_id, groupId, "household"),
        bankLinkRows(admin, groupId),
        admin.from("cost_items").select("*").eq("group_id", groupId).eq("deleted", false),
      ]);
      const links = costBankLinks(rows, rules);
      const bank = bankActualsOf(costActuals(rows, tz), links, actualsSinceOf(rows, tz));
      const month = monthKeyAt(now.toISOString(), tz);
      const weekFrom = new Date(now.getTime() - 7 * DAY_MS).toISOString();
      const text = weeklyMoneyDigest({
        items: (items ?? []) as CostItem[],
        links,
        bank,
        accounts: summariseAccounts(accounts).accounts,
        week: rows.filter((r) => r.occurred_at >= weekFrom),
        monthSpentCents: summariseSpending(
          rows.filter((r) => monthKeyAt(r.occurred_at, tz) === month),
          month,
        ).spentCents,
        // Local clock time on the server's clock, so dates read in the household's days.
        now: new Date(now.getTime() - (tz - now.getTimezoneOffset()) * 60_000),
      });
      if (!text) continue;
      const done = await postHouseholdRoutine(admin, groupId, text, { marker: MARKER, quietDays: 5, now });
      if (!done) continue;
      posted++;
      await notifyHousehold({ admin, groupId, userId: "" }, done.conversation, done.message, { sleep: async () => {} });
    } catch (err) {
      failed++;
      console.warn(`[up-bank] digest failed for ${groupId}:`, err instanceof Error ? err.message : err);
    }
  }
  return NextResponse.json({ households: byGroup.size, posted, failed });
}
