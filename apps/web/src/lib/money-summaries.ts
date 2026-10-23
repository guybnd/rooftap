import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MONEY_SUMMARY_MARKER,
  MONEY_SUMMARY_QUIET_DAYS,
  actualsSinceOf,
  bankActualsOf,
  costActuals,
  costBankLinks,
  monthKeyAt,
  monthKeys,
  monthlyMoneyRecap,
  moneySummariesDue,
  resolveEnabledModules,
  summariseAccounts,
  summariseSpending,
  weeklyCostsSummary,
  weeklyMoneyDigest,
  type CostItem,
  type MoneySummaryKind,
  type MoneySummaryPrefs,
} from "@homeup/core";
import { postHouseholdRoutine } from "@/lib/assistant/service";
import { notifyHousehold } from "@/lib/assistant/reads";
import { householdCostMonths, zoneOffsetMinutes } from "@/lib/cost-month-server";
import { bankLinkRows, shareModeOf, upBankAllowed, visibleBankAccounts, visibleBankTransactions, type UpConnectionRow } from "@/lib/up-bank";

// Money summaries from the Assistant (money-insights module): the notes the
// server posts to a household's Assistant chat. A person asks for them in
// Costs (user_settings.money_summaries); someone sharing Up who never set it
// keeps the weekly digest their connection's switch gives them. The weekly
// note goes out on Sunday and the monthly recap on the 1st, by the asking
// person's clock. A household with a shared bank gets the bank's weekly
// digest (core weeklyMoneyDigest); without one the note comes from the costs
// added by hand (weeklyCostsSummary). Only what the household already shares
// is read.

const DAY_MS = 86_400_000;
/** How far back the bank digest reads payments: the cost lines' last payments and this year's actuals. */
const LOOKBACK_MS = 120 * DAY_MS;

interface Asker {
  userId: string;
  timezone: string | null;
  /** A connection that shares Up with the household, for the bank digest. */
  conn?: UpConnectionRow;
}

export interface MoneySummaryRun {
  households: number;
  posted: number;
  failed: number;
}

/**
 * Posts the notes that are due. `kinds` limits the run; `anyDay` posts them
 * whatever the day (the older weekly digest route, which a cron calls on Sunday).
 */
export async function runMoneySummaries(
  admin: SupabaseClient,
  opts: { available: readonly string[] | null; kinds?: MoneySummaryKind[]; anyDay?: boolean; now?: Date },
): Promise<MoneySummaryRun> {
  const now = opts.now ?? new Date();
  const kinds = new Set<MoneySummaryKind>(opts.kinds ?? ["weekly", "monthly"]);

  // Who asked, per household and kind.
  const askers = new Map<string, Map<MoneySummaryKind, Asker>>();
  const ask = (groupId: string, kind: MoneySummaryKind, asker: Asker) => {
    if (!kinds.has(kind)) return;
    const byKind = askers.get(groupId) ?? new Map<MoneySummaryKind, Asker>();
    const had = byKind.get(kind);
    // A bank connection makes the better weekly note: keep the asker who has one.
    if (!had || (!had.conn && asker.conn)) byKind.set(kind, asker);
    askers.set(groupId, byKind);
  };

  const [{ data: conns }, { data: settings }] = await Promise.all([
    admin.from("up_bank_connections").select("*"),
    admin.from("user_settings").select("*"),
  ]);
  const prefsOf = new Map<string, { prefs: MoneySummaryPrefs | null; timezone: string | null }>();
  for (const s of (settings ?? []) as { user_id: string; timezone?: string | null; money_summaries?: MoneySummaryPrefs | null }[]) {
    prefsOf.set(s.user_id, { prefs: s.money_summaries ?? null, timezone: s.timezone ?? null });
  }
  const connOf = new Map<string, UpConnectionRow>();
  for (const c of (conns ?? []) as UpConnectionRow[]) {
    if (shareModeOf(c) === "none") continue;
    connOf.set(`${c.group_id}|${c.user_id}`, c);
    // Never set in Costs: the connection's own switch decides the weekly note.
    if (prefsOf.get(c.user_id)?.prefs?.weekly == null && c.weekly_digest !== false) {
      ask(c.group_id, "weekly", { userId: c.user_id, timezone: prefsOf.get(c.user_id)?.timezone ?? null, conn: c });
    }
  }
  const asking = [...prefsOf].filter(([, p]) => p.prefs?.weekly || p.prefs?.monthly);
  if (asking.length) {
    const { data: members } = await admin
      .from("group_members")
      .select("group_id, user_id")
      .in("user_id", asking.map(([id]) => id));
    for (const m of (members ?? []) as { group_id: string; user_id: string }[]) {
      const p = prefsOf.get(m.user_id)!;
      const asker = { userId: m.user_id, timezone: p.timezone, conn: connOf.get(`${m.group_id}|${m.user_id}`) };
      if (p.prefs?.weekly) ask(m.group_id, "weekly", asker);
      if (p.prefs?.monthly) ask(m.group_id, "monthly", asker);
    }
  }

  let posted = 0;
  let failed = 0;
  for (const [groupId, byKind] of askers) {
    try {
      const { data: moduleRows } = await admin.from("group_modules").select("module_id, enabled").eq("group_id", groupId);
      const on = resolveEnabledModules({ available: opts.available, rows: moduleRows ?? [] });
      if (!on.has("assistant") || !on.has("costs") || !on.has("money-insights")) continue;
      for (const [kind, asker] of byKind) {
        const wall = new Date(now.getTime() - zoneOffsetMinutes(asker.timezone, now) * 60_000);
        const local = new Date(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate());
        if (!opts.anyDay && !moneySummariesDue(local).includes(kind)) continue;
        const text = await noteFor(admin, groupId, kind, asker, now);
        if (!text) continue;
        const done = await postHouseholdRoutine(admin, groupId, text, { marker: MONEY_SUMMARY_MARKER[kind], quietDays: MONEY_SUMMARY_QUIET_DAYS[kind], now });
        if (!done) continue;
        posted++;
        await notifyHousehold({ admin, groupId, userId: "" }, done.conversation, done.message, { sleep: async () => {} });
      }
    } catch (err) {
      failed++;
      console.warn(`[money-summaries] failed for ${groupId}:`, err instanceof Error ? err.message : err);
    }
  }
  return { households: askers.size, posted, failed };
}

async function noteFor(admin: SupabaseClient, groupId: string, kind: MoneySummaryKind, asker: Asker, now: Date): Promise<string | null> {
  if (kind === "weekly" && asker.conn && (await upBankAllowed(admin, groupId))) return bankWeeklyDigest(admin, asker.conn, groupId, asker.timezone, now);
  const back = kind === "monthly" ? 4 : 3;
  const data = await householdCostMonths(admin, asker.userId, groupId, (wall) => monthKeys(wall, -back, back + 1));
  const input = { items: data.items, months: data.months, goalCents: data.goalCents, marks: data.marks, now: data.now };
  return kind === "weekly" ? weeklyCostsSummary(input) : monthlyMoneyRecap(input);
}

/** The bank's weekly digest: the week's shared spending, nudges, bills ahead and the month's forecast. */
async function bankWeeklyDigest(admin: SupabaseClient, conn: UpConnectionRow, groupId: string, timezone: string | null, now: Date): Promise<string | null> {
  const tz = zoneOffsetMinutes(timezone || "UTC", now);
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
  return weeklyMoneyDigest({
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
}
