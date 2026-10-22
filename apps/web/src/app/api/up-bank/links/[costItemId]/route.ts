import { NextResponse } from "next/server";
import { linkedPayments, type CostBankDetail } from "@homeup/core";
import { costItemInGroup, removeBankLinkRule, setBankLinkRule } from "@/lib/bank-actions";
import { bankLinkRows, upErrorResponse, upRequest, visibleBankTransactions, type UpRequest } from "@/lib/up-bank";

// Up Bank connector: one cost line's link to bank payments. GET reads the
// rule and the latest linked payments the caller can see; PUT sets the rule
// ({ match, keepAmount }); DELETE removes it. Changing a rule re-applies every
// rule in the household, so payments move to the right line straight away.

const LOOKBACK_MS = 400 * 86_400_000;

type Params = { params: Promise<{ costItemId: string }> };
type Caller = Exclude<UpRequest, { error: unknown }>;

async function detail(req: Caller, costItemId: string): Promise<CostBankDetail> {
  const [rules, rows, line] = await Promise.all([
    bankLinkRows(req.admin, req.groupId),
    visibleBankTransactions(req.admin, {
      userId: req.userId,
      groupId: req.groupId,
      from: new Date(Date.now() - LOOKBACK_MS).toISOString(),
      to: new Date(Date.now() + 86_400_000).toISOString(),
      limit: 5000,
    }),
    req.admin.from("cost_items").select("amount, is_estimate").eq("id", costItemId).maybeSingle(),
  ]);
  const rule = rules.find((r) => r.cost_item_id === costItemId);
  return {
    rule: rule ? { match: rule.match, keepAmount: rule.keep_amount } : null,
    payments: linkedPayments(rows, costItemId),
    amountCents: (line.data as { amount: number } | null)?.amount ?? undefined,
    estimate: (line.data as { is_estimate: boolean } | null)?.is_estimate ?? undefined,
  };
}

export async function GET(_request: Request, { params }: Params) {
  const { costItemId } = await params;
  const req = await upRequest();
  if ("error" in req) return req.error;
  if (!(await costItemInGroup(req, costItemId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json(await detail(req, costItemId));
  } catch (err) {
    return upErrorResponse(err);
  }
}

export async function PUT(request: Request, { params }: Params) {
  const { costItemId } = await params;
  const req = await upRequest();
  if ("error" in req) return req.error;
  const body = (await request.json().catch(() => ({}))) as { match?: unknown; keepAmount?: unknown };
  const result = await setBankLinkRule(req, costItemId, typeof body.match === "string" ? body.match : "", body.keepAmount === true);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  try {
    return NextResponse.json(await detail(req, costItemId));
  } catch (err) {
    return upErrorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const { costItemId } = await params;
  const req = await upRequest();
  if ("error" in req) return req.error;
  const result = await removeBankLinkRule(req, costItemId);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  try {
    return NextResponse.json(await detail(req, costItemId));
  } catch (err) {
    return upErrorResponse(err);
  }
}
