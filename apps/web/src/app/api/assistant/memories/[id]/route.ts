import { NextResponse } from "next/server";
import { assistantRequest } from "@/lib/assistant/service";

type Params = { params: Promise<{ id: string }> };

// HOUP-443: forget one memory.
export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const ctx = await assistantRequest({ allowNoAccess: true });
  if ("error" in ctx) return ctx.error;
  await ctx.admin.from("assistant_memories").update({ deleted: true }).eq("id", id).eq("group_id", ctx.groupId);
  return NextResponse.json({ ok: true });
}
