import { NextResponse } from "next/server";
import { bankTransactionView, type BankTransactionPage } from "@homeup/core";
import { upErrorResponse, upRequest, visibleBankTransactions } from "@/lib/up-bank";

// Up Bank connector: the Money view's transaction list, newest first, 50 at a
// time, or a whole month with `from` and `to`. `before` (an instant) pages back; `hidden=1` lists the ones hidden
// from spending instead; `scope=mine` lists all of the caller's own accounts
// instead of what the household shares. A joint account connected by two
// people shows the caller's own copy once.

const PAGE = 50;
/** A month at once, up to this many rows. */
const MONTH_MAX = 1500;

export async function GET(request: Request) {
  const req = await upRequest();
  if ("error" in req) return req.error;
  const params = new URL(request.url).searchParams;
  const beforeMs = Date.parse(params.get("before") ?? "");
  // A month (from/to instants, the device's local month) lists the whole month at once.
  const fromMs = Date.parse(params.get("from") ?? "");
  const toMs = Date.parse(params.get("to") ?? "");
  const ranged = Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs > fromMs && toMs - fromMs <= 32 * 86_400_000;
  const scope = params.get("scope") === "mine" ? "mine" : params.get("scope") === "household" ? "household" : "all";
  try {
    const read: { count: number; oldest: string | null } = { count: 0, oldest: null };
    const rows = await visibleBankTransactions(req.admin, {
      read,
      userId: req.userId,
      groupId: req.groupId,
      from: ranged ? new Date(fromMs).toISOString() : undefined,
      to: ranged ? new Date(toMs).toISOString() : Number.isFinite(beforeMs) ? new Date(beforeMs).toISOString() : undefined,
      hidden: params.get("hidden") === "1",
      scope,
      limit: ranged ? MONTH_MAX : PAGE * 2,
    });

    // Keep the caller's own copy of a joint account's transaction.
    const byExternal = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const seen = byExternal.get(r.external_id);
      if (!seen || (seen.user_id !== req.userId && r.user_id === req.userId)) byExternal.set(r.external_id, r);
    }
    const all = rows.filter((r) => byExternal.get(r.external_id) === r);
    const unique = ranged ? all : all.slice(0, PAGE);
    // More may wait when the read was full (some rows fell outside the scope)
    // or this page didn't use every row it read.
    let next: string | null = null;
    if (ranged) next = null;
    else if (all.length > PAGE) next = unique[unique.length - 1].occurred_at;
    else if (read.count === PAGE * 2) next = read.oldest;
    const body: BankTransactionPage = {
      transactions: unique.map((r) => bankTransactionView(r, req.userId)),
      next,
    };
    return NextResponse.json(body);
  } catch (err) {
    return upErrorResponse(err);
  }
}
