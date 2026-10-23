import { NextResponse } from "next/server";
import { isKeptFrom } from "@homeup/core";
import { shopperRequest } from "@/lib/shopper/route-helpers";
import { readRun } from "@/lib/shopper/scout";
import { readThread } from "@/lib/shopper/scout-thread";

// HOUP-435: one Scout run and its picks, for an app that wants it now rather
// than waiting on sync. Since Scout threads it also carries the whole thread
// the run belongs to (every run, pick and message); older apps read only
// `search` and `picks`.
//
// PATCH archives a search (`archived`), deletes it (`deleted: true`) or takes
// a delete back (`deleted: false`). A search belongs to the household, so any
// member may. It acts on the whole thread: the first run and every refined
// run in it.
type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const req = await shopperRequest();
  if ("error" in req) return req.error;
  const [run, thread] = await Promise.all([readRun(req.admin, id), readThread(req.admin, id).catch(() => null)]);
  // A search kept from this person (a present for them) doesn't exist for them.
  if (!run.search || run.search.group_id !== req.group.id || isKeptFrom(run.search, req.userId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...run, thread });
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { archived?: unknown; deleted?: unknown };
  const patch: Record<string, unknown> = {};
  if (typeof body.archived === "boolean") patch.archived_at = body.archived ? new Date().toISOString() : null;
  if (typeof body.deleted === "boolean") patch.deleted = body.deleted;
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  const req = await shopperRequest();
  if ("error" in req) return req.error;
  // Deleted rows still count here, so a delete can be taken back.
  const { data: run } = await req.admin.from("shopper_searches").select("id, group_id, thread_id, hidden_from").eq("id", id).maybeSingle();
  if (!run || run.group_id !== req.group.id || isKeptFrom(run, req.userId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const rootId = (run.thread_id as string | null) ?? (run.id as string);
  const { error } = await req.admin
    .from("shopper_searches")
    .update(patch)
    .eq("group_id", req.group.id)
    .or(`id.eq.${rootId},thread_id.eq.${rootId}`);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
