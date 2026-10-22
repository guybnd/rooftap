import { NextResponse } from "next/server";
import { linkedPayments, normaliseBankMatch, type CostBankDetail } from "@homeup/core";
import { applyBankLinks, bankLinkRows, upErrorResponse, upRequest, visibleBankTransactions, type UpRequest } from "@/lib/up-bank";

// Up Bank connector: one cost line's link to bank payments. GET reads the
// rule and the latest linked payments the caller can see; PUT sets the rule
// ({ match, keepAmount }); DELETE removes it. Changing a rule re-applies every
// rule in the household, so payments move to the right line straight away.

const LOOKBACK_MS = 400 * 86_400_000;

type Params = { params: Promise<{ costItemId: string }> };
type Caller = Exclude<UpRequest, { error: unknown }>;

async function costItemInGroup(req: Caller, costItemId: string) {
  const { data } = await req.admin
    .from("cost_items")
    .select("id")
    .eq("id", costItemId)
    .eq("group_id", req.groupId)
    .maybeSingle();
  return !!data;
}

async function detail(req: Caller, costItemId: string): Promise<CostBankDetail> {
  const [rules, rows] = await Promise.all([
    bankLinkRows(req.admin, req.groupId),
    visibleBankTransactions(req.admin, {
      userId: req.userId,
      groupId: req.groupId,
      from: new Date(Date.now() - LOOKBACK_MS).toISOString(),
      to: new Date(Date.now() + 86_400_000).toISOString(),
      limit: 5000,
    }),
  ]);
  const rule = rules.find((r) => r.cost_item_id === costItemId);
  return {
    rule: rule ? { match: rule.match, keepAmount: rule.keep_amount } : null,
    payments: linkedPayments(rows, costItemId),
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
  if (!(await costItemInGroup(req, costItemId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { match?: unknown; keepAmount?: unknown };
  const match = typeof body.match === "string" ? normaliseBankMatch(body.match) : null;
  if (!match || match.length > 200) return NextResponse.json({ error: "Pick a payee or an Up tag." }, { status: 400 });
  const { error } = await req.admin.from("bank_links").upsert(
    {
      cost_item_id: costItemId,
      group_id: req.groupId,
      match,
      keep_amount: body.keepAmount === true,
      created_by: req.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "cost_item_id" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  try {
    await applyBankLinks(req.admin, req.groupId);
    return NextResponse.json(await detail(req, costItemId));
  } catch (err) {
    return upErrorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const { costItemId } = await params;
  const req = await upRequest();
  if ("error" in req) return req.error;
  if (!(await costItemInGroup(req, costItemId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { error } = await req.admin.from("bank_links").delete().eq("cost_item_id", costItemId).eq("group_id", req.groupId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  try {
    await applyBankLinks(req.admin, req.groupId);
    return NextResponse.json(await detail(req, costItemId));
  } catch (err) {
    return upErrorResponse(err);
  }
}
