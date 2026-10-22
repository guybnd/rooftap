import { NextResponse } from "next/server";
import { bankTransactionView } from "@homeup/core";
import { changeBankTransaction, type BankTransactionChange } from "@/lib/bank-actions";
import { upRequest } from "@/lib/up-bank";

// Up Bank connector: change one of your own transactions. Hide it from
// spending, add a note, or file it under a cost line by hand (costItemId), or
// give it back to the link rules (costItemId: null). People who only see a
// transaction because its owner shares theirs can't change it.

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const req = await upRequest();
  if ("error" in req) return req.error;
  const body = (await request.json().catch(() => ({}))) as { hidden?: unknown; note?: unknown; costItemId?: unknown };
  const change: BankTransactionChange = {};
  if (typeof body.hidden === "boolean") change.hidden = body.hidden;
  if (body.note === null || typeof body.note === "string") change.note = body.note;
  if (body.costItemId === null || typeof body.costItemId === "string") change.costItemId = body.costItemId;
  const result = await changeBankTransaction(req, id, change);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(bankTransactionView(result.ok, req.userId));
}
