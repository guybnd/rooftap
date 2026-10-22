import { NextResponse } from "next/server";
import { mergeCostLine } from "@/lib/bank-actions";
import { upRequest } from "@/lib/up-bank";

// Up Bank connector: merges one cost line into another ({ into }). The line's
// payees join the other line's rule, its payments move over and the line
// goes (core cost-categories.ts says which lines the apps offer).

type Params = { params: Promise<{ costItemId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { costItemId } = await params;
  const req = await upRequest();
  if ("error" in req) return req.error;
  const body = (await request.json().catch(() => ({}))) as { into?: unknown };
  if (typeof body.into !== "string") return NextResponse.json({ error: "Pick a line to merge into." }, { status: 400 });
  const result = await mergeCostLine(req, costItemId, body.into);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.ok);
}
