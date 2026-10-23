import { after, NextResponse } from "next/server";
import { isKeptFrom, type ShopperPick } from "@homeup/core";
import { runLookup } from "@/lib/shopper/lookup";
import { shopperRequest } from "@/lib/shopper/route-helpers";
import { readRun, watchPick } from "@/lib/shopper/scout";

// HOUP-435: act on a Scout pick. `watch` puts it on the household's
// watchlist (linked to its run) and answers at once. The first price check
// runs after the response: it calls every price source and can take most of
// a minute, and the item page shows the offers when the check lands. Picks
// are written by the server only, which is why this goes through the API
// rather than sync.
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const { action } = (await request.json().catch(() => ({}))) as { action?: string };
  if (action !== "watch") return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const req = await shopperRequest();
  if ("error" in req) return req.error;

  const { data } = await req.admin.from("shopper_picks").select("*").eq("id", id).eq("deleted", false).maybeSingle();
  const pick = data as ShopperPick | null;
  if (!pick || pick.group_id !== req.group.id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { search } = await readRun(req.admin, pick.search_id);
  if (!search || isKeptFrom(search, req.userId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const want = await watchPick(req.admin, pick, search, req.userId);
    // A failed first check is fine: the daily refresh picks it up.
    const check = () => runLookup(req.admin, want, req.group).catch((err) => console.warn("[scout] first check failed", err instanceof Error ? err.message : err));
    after(check);
    return NextResponse.json({ want });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not watch it." }, { status: 500 });
  }
}
