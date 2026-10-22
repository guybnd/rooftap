import { NextResponse } from "next/server";
import { bankTransactionView, type BankTransaction, type BankTransactionPage } from "@homeup/core";
import { upErrorResponse, upRequest, visibleUserIds } from "@/lib/up-bank";

// Up Bank connector: the Money view's transaction list, newest first, 50 at a
// time. `before` (an instant) pages back; `hidden=1` lists the ones hidden
// from spending instead. The caller sees their own transactions and those of
// people who share theirs; a joint account connected by two people shows the
// caller's own copy once.

const PAGE = 50;

export async function GET(request: Request) {
  const req = await upRequest();
  if ("error" in req) return req.error;
  const params = new URL(request.url).searchParams;
  const beforeMs = Date.parse(params.get("before") ?? "");
  const hidden = params.get("hidden") === "1";
  try {
    const people = await visibleUserIds(req.admin, req.userId, req.groupId);
    let query = req.admin
      .from("bank_transactions")
      .select("*")
      .eq("group_id", req.groupId)
      .in("user_id", people)
      .eq("hidden", hidden)
      .order("occurred_at", { ascending: false })
      .limit(PAGE * 2);
    if (Number.isFinite(beforeMs)) query = query.lt("occurred_at", new Date(beforeMs).toISOString());
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as BankTransaction[];

    // Keep the caller's own copy of a joint account's transaction.
    const byExternal = new Map<string, BankTransaction>();
    for (const r of rows) {
      const seen = byExternal.get(r.external_id);
      if (!seen || (seen.user_id !== req.userId && r.user_id === req.userId)) byExternal.set(r.external_id, r);
    }
    const all = rows.filter((r) => byExternal.get(r.external_id) === r);
    const unique = all.slice(0, PAGE);
    const more = rows.length === PAGE * 2 || all.length > PAGE;
    const body: BankTransactionPage = {
      transactions: unique.map((r) => bankTransactionView(r, req.userId)),
      next: more ? unique[unique.length - 1]?.occurred_at ?? null : null,
    };
    return NextResponse.json(body);
  } catch (err) {
    return upErrorResponse(err);
  }
}
