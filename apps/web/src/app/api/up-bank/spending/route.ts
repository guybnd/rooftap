import { NextResponse } from "next/server";
import { summariseSpending } from "@homeup/core";
import { upErrorResponse, upRequest, visibleBankTransactions } from "@/lib/up-bank";

// Up Bank connector: one month of spending for the Costs card. The month runs
// in the device's local time, so the app sends its edges as instants. The
// caller sees their own transactions and those of people who share theirs.

const MAX_RANGE_MS = 32 * 86_400_000;

export async function GET(request: Request) {
  const req = await upRequest();
  if ("error" in req) return req.error;
  const params = new URL(request.url).searchParams;
  const month = params.get("month") ?? "";
  const from = Date.parse(params.get("from") ?? "");
  const to = Date.parse(params.get("to") ?? "");
  if (!/^\d{4}-\d{2}(-01)?$/.test(month) || !Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > MAX_RANGE_MS) {
    return NextResponse.json({ error: "Send a month with its start and end." }, { status: 400 });
  }
  try {
    const rows = await visibleBankTransactions(req.admin, {
      userId: req.userId,
      groupId: req.groupId,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    });
    return NextResponse.json(summariseSpending(rows, month));
  } catch (err) {
    return upErrorResponse(err);
  }
}
