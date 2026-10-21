import { NextResponse } from "next/server";
import { applicableManifests, householdDisabledSources, sourceContext } from "@/lib/shopper/lookup";
import { shopperRequest } from "@/lib/shopper/route-helpers";

// HOUP-434: the sources that apply to the caller's household, so the apps can
// credit them under every price and say when none can search for prices.
// HOUP-437: each carries `enabled`, the household's Settings > Shopper
// switch, and PUT flips one. Switched-off sources stay listed here so they
// can be switched back on; the lookup leaves them out.
export async function GET() {
  const req = await shopperRequest();
  if ("error" in req) return req.error;
  const off = householdDisabledSources(req.group);
  const manifests = await applicableManifests(sourceContext(req.group));
  return NextResponse.json({
    sources: manifests.map((m) => ({
      id: m.id,
      name: m.name,
      capabilities: m.capabilities,
      attribution: m.attribution,
      homepage: m.homepage,
      enabled: !off.has(m.id),
    })),
  });
}

export async function PUT(request: Request) {
  const req = await shopperRequest();
  if ("error" in req) return req.error;
  const body = (await request.json().catch(() => null)) as { id?: unknown; enabled?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : null;
  if (!id || typeof body?.enabled !== "boolean") {
    return NextResponse.json({ error: "Send a source id and enabled true or false." }, { status: 400 });
  }
  const manifests = await applicableManifests(sourceContext(req.group));
  if (!manifests.some((m) => m.id === id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const off = householdDisabledSources(req.group);
  if (body.enabled) off.delete(id);
  else off.add(id);
  const { error } = await req.admin
    .from("groups")
    .update({ shopper_disabled_sources: Array.from(off).sort() })
    .eq("id", req.group.id);
  if (error) return NextResponse.json({ error: "Could not save that." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
