import { NextResponse } from "next/server";
import { assistantErrorResponse, assistantRequest, conversationMessages, findConversation, pendingCounts, toConversation } from "@/lib/assistant/service";
import { markConversationRead } from "@/lib/assistant/reads";

// HOUP-443: one conversation's messages; renaming, pinning or deleting your own.
type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const ctx = await assistantRequest();
  if ("error" in ctx) return ctx.error;
  // All three reads at once; the messages are only returned once the access check passes.
  const [conversation, pending, messages] = await Promise.all([
    findConversation(ctx, id),
    pendingCounts(ctx, [id]),
    conversationMessages(ctx, id),
  ]);
  if (!conversation) return assistantErrorResponse(404, "Not found");
  // Opening a conversation reads it.
  await markConversationRead(ctx, conversation.id);
  return NextResponse.json({
    conversation: toConversation(conversation, pending.get(conversation.id) ?? 0),
    messages,
  });
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { title?: unknown; pinned?: unknown; deleted?: unknown };
  const ctx = await assistantRequest();
  if ("error" in ctx) return ctx.error;
  const conversation = await findConversation(ctx, id);
  // The household thread belongs to everyone, so nobody renames or deletes it.
  if (!conversation || conversation.kind === "household") return assistantErrorResponse(404, "Not found");
  const patch: Record<string, unknown> = {};
  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim().slice(0, 80);
  if (typeof body.pinned === "boolean") patch.pinned = body.pinned;
  if (body.deleted === true) patch.deleted = true;
  // Keeping a quick ask turns it into a chat that never closes.
  if (body.pinned === true && conversation.kind === "quick") Object.assign(patch, { kind: "chat", closes_at: null });
  if (Object.keys(patch).length) {
    const { error } = await ctx.admin.from("assistant_conversations").update(patch).eq("id", id).eq("owner_id", ctx.userId);
    if (error) return assistantErrorResponse(500, error.message);
  }
  return NextResponse.json({ ok: true });
}
