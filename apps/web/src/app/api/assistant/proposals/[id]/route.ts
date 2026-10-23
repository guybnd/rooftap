import { NextResponse } from "next/server";
import type { ProposalPick } from "@homeup/core";
import { assistantErrorResponse, assistantRequest, decideProposal } from "@/lib/assistant/service";

// HOUP-443: the person's OK (or "not now") on changes the assistant proposed.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { decision?: unknown; picks?: unknown };
  // "pick" makes only the rows the person kept, with any names they changed.
  if (body.decision !== "confirm" && body.decision !== "decline" && body.decision !== "pick") {
    return assistantErrorResponse(400, "decision must be confirm, pick or decline");
  }
  const picks = body.decision === "pick" ? readPicks(body.picks) : undefined;
  if (body.decision === "pick" && !picks) return assistantErrorResponse(400, "picks must be a list of { key, text? }");
  const ctx = await assistantRequest();
  if ("error" in ctx) return ctx.error;
  const out = await decideProposal(ctx, id, body.decision === "decline" ? "decline" : "confirm", picks);
  if (!out.ok) return assistantErrorResponse(out.status, out.error);
  return NextResponse.json({ message: out.message, outcome: out.outcome });
}

function readPicks(value: unknown): ProposalPick[] | undefined {
  if (!Array.isArray(value) || value.length > 200) return undefined;
  const picks: ProposalPick[] = [];
  for (const v of value) {
    const p = v as { key?: unknown; text?: unknown };
    if (!p || typeof p.key !== "string" || !/^\d+(\.\d+)?$/.test(p.key)) return undefined;
    if (p.text !== undefined && (typeof p.text !== "string" || p.text.length > 200)) return undefined;
    picks.push(p.text === undefined ? { key: p.key } : { key: p.key, text: p.text });
  }
  return picks;
}
