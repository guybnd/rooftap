import { NextResponse } from "next/server";
import { isBankShareMode, upTokenLast4, upTokenLooksValid, type BankShareMode, type UpBankSaveInput, type UpBankSyncResult } from "@homeup/core";
import { canStoreHouseholdKeys, decryptHouseholdKey, encryptHouseholdKey } from "@/lib/ai/household-keys";
import {
  UP_NOT_ALLOWED,
  applyBankLinks,
  checkUpToken,
  createUpWebhook,
  deleteUpWebhook,
  shareModeOf,
  syncUp,
  upBankAllowed,
  upBankStatus,
  upConnectionRow,
  upErrorResponse,
  upRequest,
  upWebhookUrl,
  type UpConnectionRow,
} from "@/lib/up-bank";

// Up Bank connector: Settings > Connectors > Up Bank. Each person connects their
// own Up account; nobody else in the home can see or change it. GET reads
// the status, PUT connects (or changes the token or the sharing choice),
// POST reads new transactions from Up, DELETE disconnects and removes every
// transaction read from Up. The token never leaves the server once saved.

function origin(request: Request): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (host && proto) return `${proto}://${host}`;
  return new URL(request.url).origin;
}

/**
 * The columns that store a sharing choice. share_mode only goes in once the
 * server has it (the row read back carries it), so a token can still be saved
 * in the minutes before the migration lands.
 */
function sharingColumns(mode: BankShareMode, existing: UpConnectionRow | null) {
  const hasMode = !existing || existing.share_mode !== undefined;
  return { shared: mode !== "none", ...(hasMode ? { share_mode: mode } : {}) };
}

export async function GET() {
  const req = await upRequest();
  if ("error" in req) return req.error;
  return NextResponse.json(await upBankStatus(req.admin, req.userId, req.groupId));
}

export async function PUT(request: Request) {
  const req = await upRequest();
  if ("error" in req) return req.error;
  if (!(await upBankAllowed(req.admin, req.groupId))) return NextResponse.json({ error: UP_NOT_ALLOWED }, { status: 403 });
  const body = ((await request.json().catch(() => null)) ?? {}) as UpBankSaveInput;
  if (body.shared !== undefined && typeof body.shared !== "boolean") {
    return NextResponse.json({ error: "Sharing is on or off." }, { status: 400 });
  }
  if (body.shareMode !== undefined && !isBankShareMode(body.shareMode)) {
    return NextResponse.json({ error: "Share nothing, joint accounts or everything." }, { status: 400 });
  }
  // The older switch maps onto the new choices: on shares everything.
  const shareMode = body.shareMode ?? (body.shared === undefined ? undefined : body.shared ? "all" : "none");
  const existing = await upConnectionRow(req.admin, req.userId);
  const pasted = typeof body.token === "string" ? body.token.trim() : "";

  if (body.autoCosts !== undefined && typeof body.autoCosts !== "boolean") {
    return NextResponse.json({ error: "Filing payments as costs is on or off." }, { status: 400 });
  }
  if (body.weeklyDigest !== undefined && typeof body.weeklyDigest !== "boolean") {
    return NextResponse.json({ error: "The weekly digest is on or off." }, { status: 400 });
  }

  if (!pasted) {
    if (!existing) return NextResponse.json({ error: "Paste your personal access token from api.up.com.au." }, { status: 400 });
    // auto_costs only goes in once the server has it (the row read back carries it).
    const autoCosts = body.autoCosts !== undefined && existing.auto_costs !== undefined ? { auto_costs: body.autoCosts } : {};
    const digest = body.weeklyDigest !== undefined && existing.weekly_digest !== undefined ? { weekly_digest: body.weeklyDigest } : {};
    if (shareMode !== undefined || Object.keys(autoCosts).length || Object.keys(digest).length) {
      const { error } = await req.admin
        .from("up_bank_connections")
        .update({
          ...(shareMode !== undefined ? sharingColumns(shareMode, existing) : {}),
          ...autoCosts,
          ...digest,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", req.userId);
      if (error) return NextResponse.json({ error: "Could not save that." }, { status: 500 });
      // Turning filing on files what's there now; sharing changes who can see what.
      if (body.autoCosts === true) await applyBankLinks(req.admin, req.groupId);
    }
    return NextResponse.json(await upBankStatus(req.admin, req.userId, req.groupId));
  }

  if (!upTokenLooksValid(pasted)) {
    return NextResponse.json({ error: "That isn't an Up token. They start with up:yeah: and come from api.up.com.au." }, { status: 400 });
  }
  if (!canStoreHouseholdKeys()) {
    return NextResponse.json({ error: "This server isn't set up to store tokens yet (HOUSEHOLD_KEYS_SECRET)." }, { status: 503 });
  }
  try {
    await checkUpToken(pasted);
  } catch (err) {
    return upErrorResponse(err);
  }

  // A new token replaces the old webhook: it belongs to the old token.
  const oldToken = existing ? decryptHouseholdKey(existing.encrypted_token) : null;
  if (existing?.webhook_id && oldToken) await deleteUpWebhook(oldToken, existing.webhook_id);

  const now = new Date().toISOString();
  const { data: saved, error } = await req.admin
    .from("up_bank_connections")
    .upsert({
      user_id: req.userId,
      group_id: req.groupId,
      encrypted_token: encryptHouseholdKey(pasted),
      last4: upTokenLast4(pasted),
      ...sharingColumns(shareMode ?? (existing ? shareModeOf(existing) : "none"), existing),
      webhook_id: null,
      encrypted_webhook_secret: null,
      // A different account may sit behind the new token, so read it afresh.
      last_synced_at: null,
      updated_at: now,
    })
    .select("*")
    .single();
  if (error || !saved) return NextResponse.json({ error: `The connection couldn't be saved: ${error?.message}` }, { status: 500 });

  // Live updates when Up can reach this server; without them, transactions
  // arrive whenever someone opens Costs.
  const hookUrl = upWebhookUrl(origin(request), saved.hook_id as string);
  if (hookUrl) {
    try {
      const hook = await createUpWebhook(pasted, hookUrl);
      await req.admin
        .from("up_bank_connections")
        .update({ webhook_id: hook.id, encrypted_webhook_secret: encryptHouseholdKey(hook.secretKey) })
        .eq("user_id", req.userId);
    } catch (err) {
      console.warn("[up-bank] webhook not created", err instanceof Error ? err.message : err);
    }
  }

  try {
    const row = await upConnectionRow(req.admin, req.userId);
    if (row) await syncUp(req.admin, row, { force: true });
  } catch (err) {
    console.warn("[up-bank] first sync failed", err instanceof Error ? err.message : err);
  }
  return NextResponse.json(await upBankStatus(req.admin, req.userId, req.groupId));
}

export async function POST() {
  const req = await upRequest();
  if ("error" in req) return req.error;
  if (!(await upBankAllowed(req.admin, req.groupId))) return NextResponse.json({ error: UP_NOT_ALLOWED }, { status: 403 });
  const row = await upConnectionRow(req.admin, req.userId);
  if (!row) return NextResponse.json({ error: "Up isn't connected." }, { status: 404 });
  let saved: number | null;
  try {
    saved = await syncUp(req.admin, row);
  } catch (err) {
    return upErrorResponse(err);
  }
  const result: UpBankSyncResult = { status: await upBankStatus(req.admin, req.userId, req.groupId), saved: saved ?? 0 };
  return NextResponse.json(result);
}

export async function DELETE() {
  const req = await upRequest();
  if ("error" in req) return req.error;
  const row = await upConnectionRow(req.admin, req.userId);
  if (row?.webhook_id) {
    const token = decryptHouseholdKey(row.encrypted_token);
    if (token) await deleteUpWebhook(token, row.webhook_id);
  }
  const { error } = await req.admin.from("bank_transactions").delete().eq("user_id", req.userId).eq("source", "up");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await req.admin.from("bank_accounts").delete().eq("user_id", req.userId).eq("source", "up");
  const gone = await req.admin.from("up_bank_connections").delete().eq("user_id", req.userId);
  if (gone.error) return NextResponse.json({ error: gone.error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
