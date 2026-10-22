import { NextResponse } from "next/server";
import { archivedCount, assistantRequest, listConversations } from "@/lib/assistant/service";

// HOUP-443: this person's quick asks and chats, plus the household thread.
// `?archived=1` lists only the chats they archived; the plain list says how
// many there are, for the "Archived" link.
export async function GET(request: Request) {
  const ctx = await assistantRequest();
  if ("error" in ctx) return ctx.error;
  if (new URL(request.url).searchParams.get("archived") === "1") {
    return NextResponse.json({ conversations: await listConversations(ctx, { archived: true }) });
  }
  const [conversations, archived] = await Promise.all([listConversations(ctx), archivedCount(ctx)]);
  return NextResponse.json({ conversations, archived });
}
