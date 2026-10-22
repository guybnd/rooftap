import { NextResponse } from "next/server";
import { decryptHouseholdKey } from "@/lib/ai/household-keys";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyUpEvent, upBankAllowed, upSignatureValid, type UpConnectionRow } from "@/lib/up-bank";

// Up Bank connector: Up pushes each new, settled or dropped transaction here.
// The path names the connection by a random id, never the person, and every
// delivery must carry Up's HMAC signature made with that connection's secret.
// Up retries anything that isn't a 200, so a delivery for a connection that
// is gone still answers 200 and is ignored.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface UpWebhookEvent {
  data?: {
    attributes?: { eventType?: string };
    relationships?: { transaction?: { data?: { id?: string } } };
  };
}

export async function POST(request: Request, { params }: { params: Promise<{ hookId: string }> }) {
  const { hookId } = await params;
  const raw = await request.text();
  if (!UUID.test(hookId)) return NextResponse.json({ ok: true });

  const admin = createAdminClient();
  const { data } = await admin.from("up_bank_connections").select("*").eq("hook_id", hookId).maybeSingle();
  const row = data as UpConnectionRow | null;
  if (!row?.encrypted_webhook_secret) return NextResponse.json({ ok: true });

  const secret = decryptHouseholdKey(row.encrypted_webhook_secret);
  if (!secret || !upSignatureValid(raw, request.headers.get("x-up-authenticity-signature"), secret)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }
  if (!(await upBankAllowed(admin, row.group_id))) return NextResponse.json({ ok: true });

  let event: UpWebhookEvent;
  try {
    event = JSON.parse(raw) as UpWebhookEvent;
  } catch {
    return NextResponse.json({ ok: true });
  }
  const eventType = event.data?.attributes?.eventType ?? "";
  if (eventType === "PING") return NextResponse.json({ ok: true });

  const token = decryptHouseholdKey(row.encrypted_token);
  if (!token) return NextResponse.json({ ok: true });
  try {
    await applyUpEvent(admin, row, token, { eventType, transactionId: event.data?.relationships?.transaction?.data?.id ?? null });
  } catch (err) {
    // A 500 makes Up retry later, which is what a failed read wants.
    console.error("[up-bank] webhook event failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Try again" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
