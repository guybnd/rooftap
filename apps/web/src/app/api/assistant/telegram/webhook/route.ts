import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleTelegramUpdate, telegramApi, telegramConfig, type TgUpdate } from "@/lib/assistant/telegram";

// HOUP-446: Telegram delivers bot updates here, either directly (setWebhook
// with secret_token) or through the self-host poller, which forwards each
// update with the same secret header. Always 200 once the secret matches, so
// Telegram never retries an update the bot chose to ignore.
export const maxDuration = 60;

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function POST(request: Request) {
  const config = await telegramConfig();
  if (!config) return NextResponse.json({ error: "Telegram is not set up on this server." }, { status: 404 });
  const header = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!sameSecret(header, config.secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const update = (await request.json().catch(() => null)) as TgUpdate | null;
  if (!update || typeof update.update_id !== "number") return NextResponse.json({ ok: true });
  try {
    await handleTelegramUpdate(update, { admin: createAdminClient(), api: telegramApi(config.token), username: config.username });
  } catch (err) {
    console.error("[telegram] update failed", update.update_id, err);
  }
  return NextResponse.json({ ok: true });
}
