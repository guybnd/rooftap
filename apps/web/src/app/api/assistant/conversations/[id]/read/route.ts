import { NextResponse } from "next/server";
import { assistantErrorResponse, assistantRequest, findConversation } from "@/lib/assistant/service";
import { markConversationRead } from "@/lib/assistant/reads";

// The app read a conversation's reply on screen, or (`seen`) told the person
// about it with a banner elsewhere in the app. Either way no push goes out
// for it; only a read clears the unread dot.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { seen?: unknown };
  const ctx = await assistantRequest();
  if ("error" in ctx) return ctx.error;
  const conversation = await findConversation(ctx, id);
  if (!conversation) return assistantErrorResponse(404, "Not found");
  await markConversationRead(ctx, id, { seen: body.seen === true });
  return NextResponse.json({ ok: true });
}
