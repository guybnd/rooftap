import { NextResponse } from "next/server";
import { shopperRequest } from "@/lib/shopper/route-helpers";
import { readRun } from "@/lib/shopper/scout";
import { readThread } from "@/lib/shopper/scout-thread";

// HOUP-435: one Scout run and its picks, for an app that wants it now rather
// than waiting on sync. Since Scout threads it also carries the whole thread
// the run belongs to (every run, pick and message); older apps read only
// `search` and `picks`.
type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const req = await shopperRequest();
  if ("error" in req) return req.error;
  const [run, thread] = await Promise.all([readRun(req.admin, id), readThread(req.admin, id).catch(() => null)]);
  if (!run.search || run.search.group_id !== req.group.id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...run, thread });
}
