import { NextResponse, after } from "next/server";
import {
  MAX_ASSISTANT_PHOTOS,
  SSE_PING,
  encodeSseEvent,
  isAssistantPhotoPathFor,
  parseCookAskContext,
  type AssistantStreamEvent,
  type ConversationKind,
} from "@homeup/core";
import { assistantErrorResponse, assistantRequest, runChat, type AssistantContext, type ChatOutcome } from "@/lib/assistant/service";
import { notifyHousehold, notifyIfAway } from "@/lib/assistant/reads";

// HOUP-443: one assistant turn. Starts a quick ask or chat, continues one,
// or talks in the household thread, and answers with the stored messages.
// HOUP-509: a request that accepts `text/event-stream` gets the turn as it
// happens (core's AssistantStreamEvent), ending with the same body.
export const maxDuration = 60;

const KINDS = new Set<ConversationKind>(["quick", "chat", "household"]);

/** A quiet stream (a slow tool) still sends something this often, so proxies keep it open. */
const PING_MS = 10_000;

/** Pushes and bookkeeping once the reply is out. */
function afterTurn(ctx: AssistantContext, out: Extract<ChatOutcome, { ok: true }>) {
  // If the person left while Rooftap was thinking, the reply reaches them as a push.
  const reply = out.messages.findLast((m) => m.role === "assistant");
  const conversation = out.conversation;
  const posted = out.posted;
  return Promise.all([
    reply ? notifyIfAway(ctx, conversation, reply).catch((e) => console.error("[assistant] reply push failed", e)) : null,
    // A member's message in the household thread reaches the other members.
    posted ? notifyHousehold(ctx, conversation, posted).catch((e) => console.error("[assistant] household push failed", e)) : null,
    out.afterReply(),
  ]).then(() => undefined);
}

export async function POST(request: Request) {
  const receivedAt = Date.now();
  const body = (await request.json().catch(() => ({}))) as { text?: unknown; conversationId?: unknown; kind?: unknown; reopen?: unknown; lastWaitMs?: unknown; cook?: unknown; photos?: unknown };
  const sentPhotos = Array.isArray(body.photos) ? body.photos : [];
  if (typeof body.text !== "string" || (!body.text.trim() && sentPhotos.length === 0)) return assistantErrorResponse(400, "text is required");
  if (body.text.length > 4000) return assistantErrorResponse(400, "That message is too long.");
  if (sentPhotos.length > MAX_ASSISTANT_PHOTOS) return assistantErrorResponse(400, `Up to ${MAX_ASSISTANT_PHOTOS} photos at a time.`);
  const ctx = await assistantRequest();
  if ("error" in ctx) return ctx.error;
  // Only photos this person uploaded for this household (from /api/assistant/photos).
  if (!sentPhotos.every((p) => isAssistantPhotoPathFor(p, ctx.groupId, ctx.userId))) return assistantErrorResponse(400, "That photo can't be sent.");
  const kind = typeof body.kind === "string" && KINDS.has(body.kind as ConversationKind) ? (body.kind as ConversationKind) : "quick";
  const input = {
    text: body.text,
    conversationId: typeof body.conversationId === "string" ? body.conversationId : null,
    kind,
    reopen: body.reopen === true,
    receivedAt,
    lastWaitMs: typeof body.lastWaitMs === "number" && Number.isFinite(body.lastWaitMs) ? Math.round(body.lastWaitMs) : undefined,
    // Asked from cook mode (Recipes v2 R7): the recipe and step on screen.
    cook: parseCookAskContext(body.cook),
    photos: [...new Set(sentPhotos as string[])],
  };

  if (!request.headers.get("accept")?.includes("text/event-stream")) {
    const out = await runChat(ctx, input);
    if (!out.ok) return assistantErrorResponse(out.status, out.error, out.code);
    after(() => afterTurn(ctx, out));
    return NextResponse.json({ conversation: out.conversation, messages: out.messages, budget: out.budget });
  }

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  // The person may close the app mid-reply; the turn carries on (and its push goes out), the writes just stop.
  const write = (chunk: string) => void writer.write(encoder.encode(chunk)).catch(() => {});
  const send = (event: AssistantStreamEvent) => write(encodeSseEvent(event));
  const ping = setInterval(() => write(SSE_PING), PING_MS);
  const turn = runChat(ctx, { ...input, onStream: send })
    .then((out) => {
      if (out.ok) send({ type: "done", response: { conversation: out.conversation, messages: out.messages, budget: out.budget } });
      else send({ type: "error", status: out.status, error: out.error, code: out.code ?? null });
      return out;
    })
    .catch((e) => {
      console.error("[assistant] streamed turn failed", e);
      send({ type: "error", status: 500, error: "Something went wrong on Rooftap's side. Try again." });
      return null;
    })
    .finally(() => {
      clearInterval(ping);
      void writer.close().catch(() => {});
    });
  // Registered now, while the request is in scope; it runs once the stream has closed.
  after(async () => {
    const out = await turn;
    if (out?.ok) await afterTurn(ctx, out);
  });
  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      // nginx-style proxies (and some self-host setups) buffer responses unless told not to.
      "X-Accel-Buffering": "no",
    },
  });
}
