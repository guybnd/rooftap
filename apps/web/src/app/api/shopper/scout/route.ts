import { NextResponse } from "next/server";
import { cleanKeepFrom, parseScoutBrief } from "@homeup/core";
import { AiBlockedError, aiBlockedResponse } from "@/lib/ai/access";
import { groupMemberIds, shopperRequest } from "@/lib/shopper/route-helpers";
import { hasOfferSources, scoutBrain, startScoutRun } from "@/lib/shopper/scout";

// HOUP-435: start a Scout run. Checks the household may use AI (its own key,
// else the server's within the plan) and has a price source to search, saves
// the run as running and answers straight away; the research carries on
// after the response, and the run and its picks reach the apps through sync
// (GET /scout/:id reads one on demand). The app may pass the run's id so it
// can open the results screen before the answer arrives, and `hidden_from`,
// the members it is kept from (a present for them): the database then hides
// the run, its picks and its thread from them.
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { id?: unknown; hidden_from?: unknown } | null;
  const parsed = parseScoutBrief(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const req = await shopperRequest();
  if ("error" in req) return req.error;
  const hiddenFrom = cleanKeepFrom(body?.hidden_from, await groupMemberIds(req.admin, req.group.id), req.userId);
  if (!hiddenFrom) return NextResponse.json({ error: "You can only keep it from people in your household." }, { status: 400 });

  const decided = await scoutBrain(req.admin, req.group.id);
  if ("blocked" in decided) return aiBlockedResponse(new AiBlockedError(decided.blocked));
  if (!(await hasOfferSources(req.group))) {
    return NextResponse.json({ error: "No price sources are set up on this server yet, so Scout has nothing to search." }, { status: 503 });
  }

  const id = typeof body?.id === "string" && UUID.test(body.id) ? body.id : undefined;
  const search = await startScoutRun(req.admin, req.group, req.userId, parsed.brief, decided.brain, { id, hiddenFrom });
  if (!search) return NextResponse.json({ error: "Could not start Scout. Try again." }, { status: 500 });
  return NextResponse.json({ search }, { status: 202 });
}
