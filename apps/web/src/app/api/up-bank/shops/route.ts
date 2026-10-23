import { NextResponse } from "next/server";
import { ownCostCategory } from "@homeup/core";
import { hideShopPayments, moveShopToCategory } from "@/lib/bank-actions";
import { upRequest } from "@/lib/up-bank";

// Up Bank connector: change every payment at one shop at once, from a Costs
// row's swipe or hold menu. { vendor, category } moves the shop (and its later
// payments) to a category. { vendor, from, to, hidden } hides or shows the
// caller's own payments there between two instants; { ids, hidden } undoes
// that.

export async function POST(request: Request) {
  const req = await upRequest();
  if ("error" in req) return req.error;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const vendor = typeof body.vendor === "string" ? body.vendor : null;
  if (typeof body.hidden === "boolean") {
    const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string") : null;
    const range = vendor && typeof body.from === "string" && typeof body.to === "string" ? { vendor, from: body.from, to: body.to } : null;
    if (!ids?.length && !range) return NextResponse.json({ error: "Pick a shop and a month." }, { status: 400 });
    const result = await hideShopPayments(req, ids?.length ? { ids } : range!, body.hidden);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.ok);
  }
  const category = typeof body.category === "string" ? ownCostCategory(body.category) : null;
  if (!vendor || !category) return NextResponse.json({ error: "Pick a shop and a category." }, { status: 400 });
  const result = await moveShopToCategory(req, vendor, category);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.ok);
}
