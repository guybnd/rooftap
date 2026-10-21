import { NextResponse } from "next/server";
import { usageMonth } from "@homeup/core";
import { assistantRequest, listConversations, monthUsage } from "@/lib/assistant/service";
import { resolveServerBrain } from "@/lib/assistant/provider";

// HOUP-443: what the Home space and the Plus sheet need to know: whether this
// household may use the assistant, whether a model is set up, what is
// waiting on this person, and this month's spend.
export async function GET() {
  const ctx = await assistantRequest({ allowNoAccess: true });
  if ("error" in ctx) return ctx.error;
  if (ctx.access === "none") {
    return NextResponse.json({ access: "none", ready: false, pending: 0, spentCents: 0, isOwner: ctx.isOwner });
  }
  const [brain, conversations, usage] = await Promise.all([resolveServerBrain(), listConversations(ctx), monthUsage(ctx.admin, ctx.groupId, usageMonth())]);
  const micros = usage.reduce((t, r) => t + Number(r.cost_micros ?? 0), 0);
  return NextResponse.json({
    access: ctx.access,
    ready: !!brain,
    pending: conversations.reduce((t, c) => t + c.pending, 0),
    spentCents: Math.ceil(micros / 10_000),
    isOwner: ctx.isOwner,
  });
}
