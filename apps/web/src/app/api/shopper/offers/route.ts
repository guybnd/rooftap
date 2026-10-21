import { NextResponse } from "next/server";
import { addManualOffer } from "@/lib/shopper/lookup";
import { shopperRequest } from "@/lib/shopper/route-helpers";

// HOUP-434: a price the household found themselves ("$1,795 at JB Hi-Fi").
// Stored as a `manual` offer, so it counts toward the best price and the
// price history like any source's, and works with no source configured.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    wantId?: string;
    store?: string;
    price_cents?: number;
    url?: string | null;
    in_stock?: boolean | null;
  };
  if (!body.wantId || !body.store?.trim() || !Number.isInteger(body.price_cents) || (body.price_cents ?? 0) <= 0) {
    return NextResponse.json({ error: "wantId, store and a positive price_cents are required" }, { status: 400 });
  }
  const req = await shopperRequest(body.wantId);
  if ("error" in req) return req.error;
  try {
    await addManualOffer(req.admin, req.want!, req.group, {
      store: body.store.slice(0, 120),
      price_cents: body.price_cents!,
      url: body.url ?? null,
      in_stock: body.in_stock ?? null,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not save" }, { status: 500 });
  }
}

// Removes one manual offer (source offers are replaced by the next check).
export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const offerId = url.searchParams.get("offerId");
  const wantId = url.searchParams.get("wantId");
  if (!offerId || !wantId) return NextResponse.json({ error: "wantId and offerId are required" }, { status: 400 });
  const req = await shopperRequest(wantId);
  if ("error" in req) return req.error;
  await req.admin
    .from("shopper_offers")
    .update({ deleted: true })
    .eq("id", offerId)
    .eq("want_id", wantId)
    .eq("source_id", "manual");
  return NextResponse.json({ ok: true });
}
