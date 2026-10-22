import { NextResponse } from "next/server";
import { bankTransactionView } from "@homeup/core";
import { bankCostPreview, makeCostFromPayment } from "@/lib/bank-actions";
import { upRequest } from "@/lib/up-bank";

// Up Bank connector: "Make it a cost". GET shows what the new cost line would
// be: the payee's name, this payment's amount, a category from Up's, and how
// often from the payee's past payments. POST creates the line, files this
// payment under it by hand, and with linkPayee links the payee's other
// payments to it as well. Only the person who connected the account can do
// this for its payments.

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const req = await upRequest();
  if ("error" in req) return req.error;
  const result = await bankCostPreview(req, id);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.ok);
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const req = await upRequest();
  if ("error" in req) return req.error;
  const body = (await request.json().catch(() => ({}))) as { name?: unknown; linkPayee?: unknown };
  const result = await makeCostFromPayment(req, id, {
    name: typeof body.name === "string" ? body.name : undefined,
    linkPayee: body.linkPayee === true,
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ costItemId: result.ok.costItemId, transaction: bankTransactionView(result.ok.transaction, req.userId) });
}
