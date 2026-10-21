import { NextResponse } from "next/server";
import { assistantErrorResponse, assistantRequest } from "@/lib/assistant/service";

// HOUP-443: what the assistant remembers about the household. Any member can
// read, add or remove a memory; the assistant adds its own during turns.
export async function GET() {
  const ctx = await assistantRequest({ allowNoAccess: true });
  if ("error" in ctx) return ctx.error;
  const { data } = await ctx.admin
    .from("assistant_memories")
    .select("id, text, source, created_at")
    .eq("group_id", ctx.groupId)
    .eq("deleted", false)
    .order("created_at", { ascending: false });
  return NextResponse.json({ memories: data ?? [] });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { text?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return assistantErrorResponse(400, "text is required");
  const ctx = await assistantRequest({ allowNoAccess: true });
  if ("error" in ctx) return ctx.error;
  const { data, error } = await ctx.admin
    .from("assistant_memories")
    .insert({ group_id: ctx.groupId, text: text.slice(0, 500), source: "manual", created_by: ctx.userId })
    .select("id, text, source, created_at")
    .single();
  if (error) return assistantErrorResponse(500, error.message);
  return NextResponse.json({ memory: data });
}
