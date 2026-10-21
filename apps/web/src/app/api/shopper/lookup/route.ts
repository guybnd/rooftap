import { NextResponse } from "next/server";
import { runLookup } from "@/lib/shopper/lookup";
import { shopperRequest } from "@/lib/shopper/route-helpers";

// HOUP-434: check a want's prices now, across every source that applies to
// the household. The apps call this when a want is added and when one is
// opened after its last check went stale (core isWantStale); the daily
// refresh covers the rest. Results land in the synced offer and snapshot
// tables; the response only says how it went.
export const maxDuration = 60;

export async function POST(request: Request) {
  const { wantId } = (await request.json().catch(() => ({}))) as { wantId?: string };
  if (!wantId) return NextResponse.json({ error: "wantId is required" }, { status: 400 });
  const req = await shopperRequest(wantId);
  if ("error" in req) return req.error;
  if (!req.want || req.want.status === "bought") return NextResponse.json({ offers: 0, sources: [], failed: [] });
  try {
    return NextResponse.json(await runLookup(req.admin, req.want, req.group));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lookup failed" }, { status: 502 });
  }
}
