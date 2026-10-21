import { NextResponse } from "next/server";
import { assistantErrorResponse, assistantRequest } from "@/lib/assistant/service";

// HOUP-444: an owner sets one person's monthly allowance or limits them to
// lookups. The allowance follows the person everywhere they use the
// assistant (the app now, Telegram later).
export async function PUT(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { userId?: unknown; monthlyBudgetCents?: unknown; readOnly?: unknown };
  const ctx = await assistantRequest({ allowNoAccess: true });
  if ("error" in ctx) return ctx.error;
  if (!ctx.isOwner) return assistantErrorResponse(403, "Only household owners can change allowances.");
  if (typeof body.userId !== "string") return assistantErrorResponse(400, "userId is required");

  const { data: member } = await ctx.admin
    .from("group_members")
    .select("user_id")
    .eq("group_id", ctx.groupId)
    .eq("user_id", body.userId)
    .maybeSingle();
  if (!member) return assistantErrorResponse(404, "Not found");

  const row: Record<string, unknown> = { group_id: ctx.groupId, user_id: body.userId };
  if (body.monthlyBudgetCents !== undefined) {
    row.monthly_budget_cents =
      typeof body.monthlyBudgetCents === "number" && Number.isFinite(body.monthlyBudgetCents) && body.monthlyBudgetCents >= 0
        ? Math.round(body.monthlyBudgetCents)
        : null;
  }
  if (typeof body.readOnly === "boolean") row.read_only = body.readOnly;

  const { error } = await ctx.admin.from("assistant_member_limits").upsert(row, { onConflict: "group_id,user_id" });
  if (error) return assistantErrorResponse(500, error.message);
  return NextResponse.json({ ok: true });
}
