import { NextResponse } from "next/server";
import { assistantErrorResponse, assistantRequest } from "@/lib/assistant/service";
import { createLinkCode, telegramConfig } from "@/lib/assistant/telegram";

// HOUP-446: the signed-in member's Telegram link. GET says whether this
// server runs a bot and whether they're linked; POST makes a one-time code
// to send the bot as /start CODE; DELETE disconnects their account.

export async function GET() {
  const ctx = await assistantRequest({ allowNoAccess: true });
  if ("error" in ctx) return ctx.error;
  const config = await telegramConfig();
  const { data } = await ctx.admin
    .from("assistant_telegram_links")
    .select("telegram_username, created_at")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  const link = data as { telegram_username: string | null; created_at: string } | null;
  return NextResponse.json({
    configured: !!config,
    botUsername: config?.username ?? null,
    linked: link ? { username: link.telegram_username, since: link.created_at } : null,
  });
}

export async function POST() {
  const ctx = await assistantRequest();
  if ("error" in ctx) return ctx.error;
  const config = await telegramConfig();
  if (!config) return assistantErrorResponse(404, "Telegram is not set up on this server.");
  try {
    const { code, expiresAt } = await createLinkCode(ctx.admin, ctx.userId, ctx.groupId);
    const link = config.username ? `https://t.me/${config.username}?start=${code}` : null;
    return NextResponse.json({ code, expiresAt, link });
  } catch (err) {
    return assistantErrorResponse(500, err instanceof Error ? err.message : "Could not make a code");
  }
}

export async function DELETE() {
  const ctx = await assistantRequest({ allowNoAccess: true });
  if ("error" in ctx) return ctx.error;
  const { error } = await ctx.admin.from("assistant_telegram_links").delete().eq("user_id", ctx.userId);
  if (error) return assistantErrorResponse(500, error.message);
  return NextResponse.json({ ok: true });
}
