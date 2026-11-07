import { NextResponse } from "next/server";
import { assistantErrorResponse, assistantRequest } from "@/lib/assistant/service";

type Params = { params: Promise<{ id: string }> };

// HOUP-443: forget one memory. Your own private memory, a shared one you
// added, or, for an owner, any shared one.
export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const ctx = await assistantRequest({ allowNoAccess: true });
  if ("error" in ctx) return ctx.error;
  const { data: row } = await ctx.admin
    .from("assistant_memories")
    .select("created_by, owner_id")
    .eq("id", id)
    .eq("group_id", ctx.groupId)
    .maybeSingle();
  const memory = row as { created_by: string | null; owner_id: string | null } | null;
  if (!memory || (memory.owner_id && memory.owner_id !== ctx.userId)) return assistantErrorResponse(404, "Not found");
  if (!memory.owner_id && !ctx.isOwner && memory.created_by !== ctx.userId) {
    return assistantErrorResponse(403, "Only the person who added this memory or a household owner can remove it.");
  }
  await ctx.admin.from("assistant_memories").update({ deleted: true }).eq("id", id).eq("group_id", ctx.groupId);
  return NextResponse.json({ ok: true });
}
