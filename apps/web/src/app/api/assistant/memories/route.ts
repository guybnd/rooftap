import { NextResponse } from "next/server";
import { assistantErrorResponse, assistantRequest } from "@/lib/assistant/service";

type MemoryRow = { id: string; text: string; source: "agent" | "manual"; created_at: string; created_by: string | null; owner_id: string | null };

// HOUP-443: what the assistant remembers about the household. Any member can
// read or add a shared memory, and the assistant adds its own during turns.
// A memory saved in someone's private chat or quick ask is theirs: only they
// see it. A shared memory can be removed by whoever added it or by an owner.
export async function GET() {
  const ctx = await assistantRequest({ allowNoAccess: true });
  if ("error" in ctx) return ctx.error;
  const { data } = await ctx.admin
    .from("assistant_memories")
    .select("id, text, source, created_at, created_by, owner_id")
    .eq("group_id", ctx.groupId)
    .eq("deleted", false)
    .or(`owner_id.is.null,owner_id.eq.${ctx.userId}`)
    .order("created_at", { ascending: false });
  const memories = ((data ?? []) as MemoryRow[]).map(({ created_by, owner_id, ...m }) => ({
    ...m,
    onlyYou: owner_id === ctx.userId,
    canRemove: owner_id === ctx.userId || ctx.isOwner || created_by === ctx.userId,
  }));
  return NextResponse.json({ memories });
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
  return NextResponse.json({ memory: { ...data, onlyYou: false, canRemove: true } });
}
