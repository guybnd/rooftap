import { NextResponse } from "next/server";
import { shopperRequest } from "@/lib/shopper/route-helpers";
import { readRun } from "@/lib/shopper/scout";

// HOUP-435: one Scout run and its picks, for an app that wants it now rather
// than waiting on sync.
type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const req = await shopperRequest();
  if ("error" in req) return req.error;
  const run = await readRun(req.admin, id);
  if (!run.search || run.search.group_id !== req.group.id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(run);
}
