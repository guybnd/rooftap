import { NextResponse } from "next/server";
import { applicableManifests, sourceContext } from "@/lib/shopper/lookup";
import { shopperRequest } from "@/lib/shopper/route-helpers";

// HOUP-434: the sources that apply to the caller's household, so the apps can
// credit them under every price and say when none can search for prices.
export async function GET() {
  const req = await shopperRequest();
  if ("error" in req) return req.error;
  const manifests = await applicableManifests(sourceContext(req.group));
  return NextResponse.json({
    sources: manifests.map((m) => ({
      id: m.id,
      name: m.name,
      capabilities: m.capabilities,
      attribution: m.attribution,
      homepage: m.homepage,
    })),
  });
}
