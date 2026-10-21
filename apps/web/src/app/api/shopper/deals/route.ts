import { NextResponse } from "next/server";
import { findDeals } from "@/lib/shopper/lookup";
import { shopperRequest } from "@/lib/shopper/route-helpers";

// HOUP-434: community and retailer deals matching a want, from every deals
// source that applies (OzBargain in Australia). Not stored: deals come and go
// faster than a daily check, so the detail screen asks when it opens.
export async function GET(request: Request) {
  const wantId = new URL(request.url).searchParams.get("wantId");
  if (!wantId) return NextResponse.json({ error: "wantId is required" }, { status: 400 });
  const req = await shopperRequest(wantId);
  if ("error" in req) return req.error;
  return NextResponse.json({ deals: await findDeals(req.want!, req.group) });
}
