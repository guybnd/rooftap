import { NextResponse } from "next/server";
import type { ConversationKind } from "@homeup/core";
import { assistantErrorResponse, assistantRequest, runChat } from "@/lib/assistant/service";

// HOUP-443: one assistant turn. Starts a quick ask or chat, continues one,
// or talks in the household thread, and answers with the stored messages.
export const maxDuration = 60;

const KINDS = new Set<ConversationKind>(["quick", "chat", "household"]);

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { text?: unknown; conversationId?: unknown; kind?: unknown };
  if (typeof body.text !== "string" || !body.text.trim()) return assistantErrorResponse(400, "text is required");
  if (body.text.length > 4000) return assistantErrorResponse(400, "That message is too long.");
  const ctx = await assistantRequest();
  if ("error" in ctx) return ctx.error;
  const kind = typeof body.kind === "string" && KINDS.has(body.kind as ConversationKind) ? (body.kind as ConversationKind) : "quick";
  const out = await runChat(ctx, {
    text: body.text,
    conversationId: typeof body.conversationId === "string" ? body.conversationId : null,
    kind,
  });
  if (!out.ok) return assistantErrorResponse(out.status, out.error, out.code);
  return NextResponse.json({ conversation: out.conversation, messages: out.messages, budget: out.budget });
}
