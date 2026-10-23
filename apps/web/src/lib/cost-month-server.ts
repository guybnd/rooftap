import type { SupabaseClient } from "@supabase/supabase-js";
import { actualsSinceOf, costBankLinks, costMonths, ledgerRows, listCostItems, type CostBankLink, type CostInsightMarks, type CostItem, type CostMonth } from "@homeup/core";
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
  /** Each bank-linked line's last payment, for when a bill is next due. */
  links: CostBankLink[];
  /** The start of the person's today, in the server's local fields (what billsDue reads). */
  today: Date;
}

/** A YYYY-MM month (the current one when left out) for the household. */
export async function householdCostMonth(
  admin: SupabaseClient,
  userId: string,
  groupId: string,
  month?: string,
): Promise<ServerCostMonth> {
  const { months, items, goalCents, links, now } = await householdCostMonths(admin, userId, groupId, (now) => [
    month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
  ]);
  return { month: months[0], items, goalCents, links, today: new Date(now.getFullYear(), now.getMonth(), now.getDate()) };
}

export interface ServerCostMonths {
  months: CostMonth[];
  items: CostItem[];
  goalCents: number | null;
  /** The person's wall clock, as costMonth reads it. */
  now: Date;
  /** Money insights the person hid or kept. */
  marks: CostInsightMarks;
  /** Each bank-linked line's last payment, for when a bill is next due. */
  links: CostBankLink[];
}

/** Several months for the household, worked out on the person's clock. `keysFor` picks them from it. */
export async function householdCostMonths(
  admin: SupabaseClient,
  userId: string,
  groupId: string,
  keysFor: (now: Date) => string[],
): Promise<ServerCostMonths> {
  const { data: settings } = await admin
    .from("user_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  const s = (settings ?? {}) as { timezone?: string | null; costs_budget_monthly?: number | null; money_insight_marks?: CostInsightMarks | null };
  const tz = zoneOffsetMinutes(s.timezone);
  // costMonth reads the calendar from a Date's local fields; on a UTC server
  // shifting the instant by the zone's offset gives the person's wall clock.
  const wall = new Date(Date.now() - tz * 60_000);
  const [items, rows, links] = await Promise.all([
    listCostItems(admin, groupId),
    visibleBankTransactions(admin, {
      userId,
      groupId,
      from: new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth() - 12, 1)).toISOString(),
      to: new Date(Date.now() + DAY_MS).toISOString(),
      scope: "household",
      limit: 8000,
    }).catch(() => []),
    bankLinkRows(admin, groupId).catch(() => []),
  ]);
  const now = new Date(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(), wall.getUTCHours(), wall.getUTCMinutes());
  const input = {
    items,
    ledger: ledgerRows(rows, tz),
    now: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    linked: new Set(links.map((l) => l.cost_item_id)),
    since: actualsSinceOf(rows, tz),
  };
  return {
    months: costMonths(input, keysFor(now)),
    items,
    goalCents: s.costs_budget_monthly ?? null,
    now,
    marks: s.money_insight_marks ?? {},
    links: costBankLinks(rows, links),
  };
}
