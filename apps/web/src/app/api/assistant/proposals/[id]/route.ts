import { NextResponse } from "next/server";
import { assistantErrorResponse, assistantRequest, decideProposal } from "@/lib/assistant/service";

// HOUP-443: the person's OK (or "not now") on changes the assistant proposed.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { decision?: unknown };
  if (body.decision !== "confirm" && body.decision !== "decline") return assistantErrorResponse(400, "decision must be confirm or decline");
  const ctx = await assistantRequest();
  if ("error" in ctx) return ctx.error;
  const out = await decideProposal(ctx, id, body.decision);
  if (!out.ok) return assistantErrorResponse(out.status, out.error);
  return NextResponse.json({ message: out.message, outcome: out.outcome });
}
