import { NextResponse } from "next/server";
import { assistantRequest, listConversations } from "@/lib/assistant/service";

// HOUP-443: this person's quick asks and chats, plus the household thread.
export async function GET() {
  const ctx = await assistantRequest();
  if ("error" in ctx) return ctx.error;
  return NextResponse.json({ conversations: await listConversations(ctx) });
}
