import { NextResponse } from "next/server";
import { bankPayees, CATEGORY_META, type CostCategory } from "@homeup/core";
import { upErrorResponse, upRequest, visibleBankTransactions } from "@/lib/up-bank";

// Up Bank connector: payees and Up tags from the caller's recent payments,
// to link a cost line to. Ones Up files under a category that fits the line
// come first.

const LOOKBACK_MS = 180 * 86_400_000;

export async function GET(request: Request) {
  const req = await upRequest();
  if ("error" in req) return req.error;
  const params = new URL(request.url).searchParams;
  const raw = params.get("category");
  const category = raw && raw in CATEGORY_META ? (raw as CostCategory) : null;
  const query = (params.get("q") ?? "").slice(0, 100);
  try {
    const now = Date.now();
    const rows = await visibleBankTransactions(req.admin, {
      userId: req.userId,
      groupId: req.groupId,
      from: new Date(now - LOOKBACK_MS).toISOString(),
      to: new Date(now + 86_400_000).toISOString(),
      limit: 5000,
    });
    return NextResponse.json(bankPayees(rows, { category, query }));
  } catch (err) {
    return upErrorResponse(err);
  }
}
