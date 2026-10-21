import { NextResponse } from "next/server";
import {
  homeAssistantBaseUrl,
  homeAssistantTokenLast4,
  isTrustLevel,
  type HomeAssistantSaveInput,
  type HomeAssistantStatus,
  type HomeAssistantToolInfo,
} from "@homeup/core";
import { assistantErrorResponse, assistantRequest, type AssistantContext } from "@/lib/assistant/service";
import { canStoreHouseholdKeys, decryptHouseholdKey, encryptHouseholdKey } from "@/lib/ai/household-keys";
import {
  checkHomeAssistantHost,
  forgetHomeAssistantTools,
  homeAssistantRow,
  homeAssistantToolInfo,
  toConnection,
} from "@/lib/assistant/home-assistant";

// HOUP-449: Settings > Assistant > Home Assistant. Everyone in the home sees
// whether it is connected (address and the token's last four characters);
// owners connect it, pick the trust level and which tools the assistant may
// use, and disconnect it. A new address or token is tried before it is
// saved, so a typo never replaces a working connection. The token never
// leaves the server once saved.

async function status(ctx: AssistantContext): Promise<HomeAssistantStatus> {
  const row = await homeAssistantRow(ctx.admin, ctx.groupId);
  return { connection: row ? toConnection(row) : null, isOwner: ctx.isOwner, canStore: canStoreHouseholdKeys() };
}

const OWNERS_ONLY = "Only household owners can change the Home Assistant connection.";

export async function GET() {
  const ctx = await assistantRequest({ allowNoAccess: true });
  if ("error" in ctx) return ctx.error;
  return NextResponse.json(await status(ctx));
}

/** Lists what Home Assistant offers, with the saved connection. */
export async function POST() {
  const ctx = await assistantRequest();
  if ("error" in ctx) return ctx.error;
  if (!ctx.isOwner) return assistantErrorResponse(403, OWNERS_ONLY);
  const row = await homeAssistantRow(ctx.admin, ctx.groupId);
  if (!row) return assistantErrorResponse(404, "Home Assistant isn't connected.");
  const token = decryptHouseholdKey(row.encrypted_token);
  if (!token) return assistantErrorResponse(409, "The saved token can't be read on this server. Paste it again.");
  try {
    return NextResponse.json({ tools: await homeAssistantToolInfo(row.url, token) });
  } catch (err) {
    return assistantErrorResponse(502, err instanceof Error ? err.message : "Couldn't reach Home Assistant.");
  }
}

export async function PUT(request: Request) {
  const ctx = await assistantRequest();
  if ("error" in ctx) return ctx.error;
  if (!ctx.isOwner) return assistantErrorResponse(403, OWNERS_ONLY);
  const body = ((await request.json().catch(() => null)) ?? {}) as HomeAssistantSaveInput;
  const existing = await homeAssistantRow(ctx.admin, ctx.groupId);

  const url = body.url !== undefined ? homeAssistantBaseUrl(body.url) : existing?.url ?? null;
  if (!url) return assistantErrorResponse(400, "That doesn't look like a Home Assistant address.");
  const pasted = typeof body.token === "string" ? body.token.trim() : "";
  const token = pasted || (existing ? decryptHouseholdKey(existing.encrypted_token) : null);
  if (!token) return assistantErrorResponse(400, "Paste a long-lived access token from your Home Assistant profile.");
  if (body.trust !== undefined && !isTrustLevel(body.trust)) return assistantErrorResponse(400, "Unknown trust level.");
  const allowed =
    body.allowedTools === undefined
      ? existing?.allowed_tools ?? null
      : body.allowedTools === null
        ? null
        : Array.isArray(body.allowedTools) && body.allowedTools.every((t) => typeof t === "string")
          ? [...new Set(body.allowedTools)].slice(0, 500)
          : undefined;
  if (allowed === undefined) return assistantErrorResponse(400, "Tools must be a list of names.");

  // A new address or token is tried first, and only saved once it answers.
  const changesConnection = !existing || url !== existing.url || !!pasted;
  let tools: HomeAssistantToolInfo[] | null = null;
  if (changesConnection) {
    if (!canStoreHouseholdKeys()) {
      return assistantErrorResponse(503, "This server isn't set up to store tokens yet (HOUSEHOLD_KEYS_SECRET).");
    }
    const refused = await checkHomeAssistantHost(url);
    if (refused) return assistantErrorResponse(400, refused);
    try {
      tools = await homeAssistantToolInfo(url, token, { fresh: true });
    } catch (err) {
      return assistantErrorResponse(502, err instanceof Error ? err.message : "Couldn't reach Home Assistant.");
    }
  }

  const now = new Date().toISOString();
  const { error } = await ctx.admin.from("assistant_home_assistant").upsert({
    group_id: ctx.groupId,
    url,
    encrypted_token: pasted ? encryptHouseholdKey(pasted) : existing!.encrypted_token,
    last4: pasted ? homeAssistantTokenLast4(pasted) : existing!.last4,
    trust: body.trust ?? existing?.trust ?? "ask",
    allowed_tools: allowed,
    created_by: existing ? undefined : ctx.userId,
    updated_at: now,
  });
  if (error) return assistantErrorResponse(500, `The connection couldn't be saved: ${error.message}`);
  forgetHomeAssistantTools(ctx.groupId);
  return NextResponse.json({ status: await status(ctx), tools });
}

export async function DELETE() {
  const ctx = await assistantRequest({ allowNoAccess: true });
  if ("error" in ctx) return ctx.error;
  if (!ctx.isOwner) return assistantErrorResponse(403, OWNERS_ONLY);
  const { error } = await ctx.admin.from("assistant_home_assistant").delete().eq("group_id", ctx.groupId);
  if (error) return assistantErrorResponse(500, error.message);
  forgetHomeAssistantTools(ctx.groupId);
  return NextResponse.json({ ok: true });
}
