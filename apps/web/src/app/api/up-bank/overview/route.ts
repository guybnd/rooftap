import { NextResponse } from "next/server";
import { actualsSinceOf, costActuals, costBankLinks, summariseAccounts, summariseSpending, type UpOverview } from "@homeup/core";
import { bankLinkRows, upErrorResponse, upRequest, visibleBankAccounts, visibleBankTransactions } from "@/lib/up-bank";

// Up Bank connector: what the Costs screen shows. One month of spending (the
// month runs in the device's local time, so the app sends its edges as
// instants), the balances of the accounts the caller may see, and each linked
// cost line's latest payment and what each line was really paid per month
// this year. The caller sees their own data and that of people who share
// theirs.

const MAX_RANGE_MS = 32 * 86_400_000;
/** How far back a cost line's latest linked payment is looked for. */
const LINK_LOOKBACK_MS = 120 * 86_400_000;

export async function GET(request: Request) {
  const req = await upRequest();
  if ("error" in req) return req.error;
  const params = new URL(request.url).searchParams;
  const month = params.get("month") ?? "";
  const from = Date.parse(params.get("from") ?? "");
  const to = Date.parse(params.get("to") ?? "");
  // Whose spending and accounts: what the household shares, or all of the
  // caller's own. Cost-line links always read everything the caller may see.
  // Apps before 'connectors.up-bank-sharing' send no scope and get both.
  const raw = params.get("scope");
  const scope = raw === "mine" || raw === "household" ? raw : null;
  // The device's offset from UTC in minutes, so actuals land in its months.
  const tzRaw = Number(params.get("tz"));
  const tz = Number.isFinite(tzRaw) && Math.abs(tzRaw) <= 14 * 60 ? tzRaw : 0;
  if (!/^\d{4}-\d{2}(-01)?$/.test(month) || !Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > MAX_RANGE_MS) {
    return NextResponse.json({ error: "Send a month with its start and end." }, { status: 400 });
  }
  try {
    const now = Date.now();
    const [monthRows, recentRows, accounts, rules] = await Promise.all([
      visibleBankTransactions(req.admin, {
        userId: req.userId,
        groupId: req.groupId,
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        scope: scope ?? "all",
      }),
      visibleBankTransactions(req.admin, {
        userId: req.userId,
        groupId: req.groupId,
        // This year's months for the actuals, and at least the link lookback.
        from: new Date(Math.min(now - LINK_LOOKBACK_MS, new Date(new Date(now).getFullYear(), 0, 1).getTime())).toISOString(),
        to: new Date(now + 86_400_000).toISOString(),
        limit: 5000,
      }),
      visibleBankAccounts(req.admin, req.userId, req.groupId, scope ?? "all"),
      bankLinkRows(req.admin, req.groupId),
    ]);
    const body: UpOverview = {
      ...summariseSpending(monthRows, month),
      ...summariseAccounts(accounts),
      links: costBankLinks(recentRows, rules),
      actuals: costActuals(recentRows, tz),
      actualsSince: actualsSinceOf(recentRows, tz),
      ...(scope ? { scope } : {}),
    };
    return NextResponse.json(body);
  } catch (err) {
    return upErrorResponse(err);
  }
}
