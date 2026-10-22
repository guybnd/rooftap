import type { SupabaseClient } from "@supabase/supabase-js";
import { actualsSinceOf, costMonth, ledgerRows, listCostItems, type CostItem, type CostMonth } from "@homeup/core";
import { bankLinkRows, visibleBankTransactions } from "@/lib/up-bank";

// The Costs month on the server, for the assistant and the MCP tools: the
// same costMonth the apps show, from the household's cost lines and the bank
// payments the household shares. Months follow the person's timezone setting.

const DAY_MS = 86_400_000;

/** Minutes the zone is behind UTC at an instant, as Date#getTimezoneOffset reads (-600 in Sydney). */
export function zoneOffsetMinutes(timeZone: string | null | undefined, at: Date = new Date()): number {
  if (!timeZone) return 0;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(at);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    return Math.round((at.getTime() - wall) / 60_000);
  } catch {
    return 0;
  }
}

export interface ServerCostMonth {
  month: CostMonth;
  items: CostItem[];
  /** The household's monthly goal in cents, null when none is set. */
  goalCents: number | null;
}

/** A YYYY-MM month (the current one when left out) for the household. */
export async function householdCostMonth(
  admin: SupabaseClient,
  userId: string,
  groupId: string,
  month?: string,
): Promise<ServerCostMonth> {
  const { data: settings } = await admin
    .from("user_settings")
    .select("timezone, costs_budget_monthly")
    .eq("user_id", userId)
    .maybeSingle();
  const s = (settings ?? {}) as { timezone?: string | null; costs_budget_monthly?: number | null };
  const tz = zoneOffsetMinutes(s.timezone);
  // costMonth reads the calendar from a Date's local fields; on a UTC server
  // shifting the instant by the zone's offset gives the person's wall clock.
  const now = new Date(Date.now() - tz * 60_000);
  const [items, rows, links] = await Promise.all([
    listCostItems(admin, groupId),
    visibleBankTransactions(admin, {
      userId,
      groupId,
      from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, 1)).toISOString(),
      to: new Date(Date.now() + DAY_MS).toISOString(),
      scope: "household",
      limit: 8000,
    }).catch(() => []),
    bankLinkRows(admin, groupId).catch(() => []),
  ]);
  const key = month ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const result = costMonth({
    items,
    ledger: ledgerRows(rows, tz),
    month: key,
    now: new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    linked: new Set(links.map((l) => l.cost_item_id)),
    since: actualsSinceOf(rows, tz),
  });
  return { month: result, items, goalCents: s.costs_budget_monthly ?? null };
}
