import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";
import { patExpiryDays } from '@homeup/core';
import { getActivePat, issueToken, revokePat } from '@/lib/pat';

// Self-service PAT management for the signed-in user (HOUP-4). user_id is
// always resolved server-side from the session — personal_access_tokens has
// zero client RLS, so this route (via the service-role admin client) is the
// only way a browser can touch it.
const BOT_TOKEN_LABEL = "Rooftap bot access";

// POST/PUT take an optional `{ expiry }` (a PatExpiryChoice); no body means
// the default, which is never.
async function requestedExpiryDays(req: Request): Promise<number | null | undefined> {
  const body = await req.json().catch(() => null);
  return patExpiryDays(body?.expiry);
}

function invalidExpiry() {
  return NextResponse.json({ error: "Unknown expiry choice." }, { status: 400 });
}

// GET /api/pat — status of the caller's active token (never the hash).
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const pat = await getActivePat(admin, user.id);
  return NextResponse.json({ active: !!pat, pat });
}

// POST /api/pat — generate a new token. Refuses if one is already active
// (one-active-token-per-user); use PUT to refresh instead. An expired token
// doesn't count as active: it is revoked and replaced.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const expiresInDays = await requestedExpiryDays(req);
  if (expiresInDays === undefined) return invalidExpiry();

  const admin = createAdminClient();
  const existing = await getActivePat(admin, user.id);
  if (existing && !existing.expired) {
    return NextResponse.json({ error: "A token is already active. Refresh or revoke it first." }, { status: 409 });
  }
  if (existing) await revokePat(admin, user.id);

  const token = await issueToken(admin, user.id, BOT_TOKEN_LABEL, expiresInDays);
  return NextResponse.json({ token });
}

// PUT /api/pat — refresh: revoke the existing token and issue a new one.
export async function PUT(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const expiresInDays = await requestedExpiryDays(req);
  if (expiresInDays === undefined) return invalidExpiry();

  const admin = createAdminClient();
  await revokePat(admin, user.id);
  const token = await issueToken(admin, user.id, BOT_TOKEN_LABEL, expiresInDays);
  return NextResponse.json({ token });
}

// DELETE /api/pat — revoke the caller's active token.
export async function DELETE() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  await revokePat(admin, user.id);
  return NextResponse.json({ ok: true });
}
