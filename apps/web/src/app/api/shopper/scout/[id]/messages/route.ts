import { NextResponse } from "next/server";
import { aiBlockedMessage, parseScoutFollowUp, PLUS_SCOUT_RUNS_PER_MONTH, scoutAsksUsed, scoutBriefChanges, scoutLatestRun, scoutRefineLine, SCOUT_THREAD_MAX_ASKS, type ScoutMessage } from "@homeup/core";
import { AiBlockedError, aiBlockedResponse } from "@/lib/ai/access";
import { llmClient } from "@/lib/assistant/llm";
import { shopperRequest } from "@/lib/shopper/route-helpers";
import { scoutBrain, sourceSearch, startScoutRun } from "@/lib/shopper/scout";
import { readThread, runFollowUp, threadRoot } from "@/lib/shopper/scout-thread";

// A follow-up in a Scout thread. The person's message is saved first, then
// Scout either answers in words or, when the person changed what they want,
// starts a new run in the same thread and says what it changed. Questions use
// the household's AI key (or the server's within the plan) without spending
// the monthly Scout runs; a new search spends one like any other run.
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const parsed = parseScoutFollowUp(await request.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const req = await shopperRequest();
  if ("error" in req) return req.error;

  const thread = await readThread(req.admin, id);
  if (!thread || threadRoot(thread).group_id !== req.group.id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const root = threadRoot(thread);
  if (scoutAsksUsed(thread.messages) >= SCOUT_THREAD_MAX_ASKS) {
    return NextResponse.json({ error: "This search has had a lot of questions. Start a new Scout search to keep going." }, { status: 429 });
  }
  const pick = parsed.pick_id ? (thread.picks.find((p) => p.id === parsed.pick_id) ?? null) : null;

  const decided = await scoutBrain(req.admin, req.group.id, { newRun: false });
  if ("blocked" in decided) return aiBlockedResponse(new AiBlockedError(decided.blocked));

  const save = async (row: Partial<ScoutMessage>): Promise<ScoutMessage | null> => {
    const { data, error } = await req.admin
      .from("shopper_scout_messages")
      .insert({ group_id: req.group.id, thread_id: root.id, created_by: req.userId, ...row })
      .select("*")
      .single();
    if (error) console.error("[scout] could not save message", error.message);
    return (data as ScoutMessage | null) ?? null;
  };

  const asked = await save({ role: "user", text: parsed.text, pick_id: pick?.id ?? null });
  if (!asked) return NextResponse.json({ error: "Could not send that. Try again." }, { status: 500 });

  let outcome: Awaited<ReturnType<typeof runFollowUp>>;
  try {
    outcome = await runFollowUp(thread, { text: parsed.text, pick }, req.group, {
      brain: decided.brain,
      llm: llmClient(decided.brain.connection),
      search: sourceSearch(req.group, (scoutLatestRun(thread) ?? root).brief),
    });
  } catch (err) {
    console.error("[scout] follow-up failed", root.id, err instanceof Error ? err.message : err);
    outcome = { kind: "error", text: "Scout hit a problem talking to the AI model. Try again in a minute." };
  }

  if (outcome.kind !== "refine") {
    const answer = await save({ role: "scout", text: outcome.text });
    return NextResponse.json({ messages: [asked, answer].filter(Boolean) });
  }

  // A new search spends a run, so it checks the plan's allowance this time.
  const forRun = await scoutBrain(req.admin, req.group.id);
  if ("blocked" in forRun) {
    const why =
      forRun.blocked === "ai_allowance_used"
        ? `This month's ${PLUS_SCOUT_RUNS_PER_MONTH} Scout searches on Plus are used up. Add your household's own AI key in Settings > AI keys to keep going.`
        : aiBlockedMessage(forRun.blocked);
    const answer = await save({ role: "scout", text: `I can't search again right now. ${why}` });
    return NextResponse.json({ messages: [asked, answer].filter(Boolean) });
  }
  const previous = (scoutLatestRun(thread) ?? root).brief;
  const run = await startScoutRun(req.admin, req.group, req.userId, outcome.brief, forRun.brain, { threadId: root.id });
  if (!run) {
    const answer = await save({ role: "scout", text: "I couldn't start the new search. Try again." });
    return NextResponse.json({ messages: [asked, answer].filter(Boolean) });
  }
  const answer = await save({ role: "scout", text: scoutRefineLine(outcome.summary, scoutBriefChanges(previous, outcome.brief)), search_id: run.id });
  return NextResponse.json({ messages: [asked, answer].filter(Boolean), search: run });
}
