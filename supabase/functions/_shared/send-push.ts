// FLUX-128: shared Web Push send path for all notify-* Edge Functions.
//
// Uses npm:web-push (Node lib) under Deno's Node-compat. This is the path flagged
// as the main deploy-time risk in grooming — if the deployed Edge runtime rejects
// npm:web-push, switch to the JWK-based @negrel/webpush fallback documented in
// supabase/functions/README.md. The base64url VAPID keys here match the keys the
// client and Next app use, so no key reformatting is needed.
import webpush from "npm:web-push@3.6.7";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.111.0";

// Configure VAPID only when both keys are present. Doing this at module load with
// `!` non-null assertions would throw on a missing secret and turn the whole
// function into an opaque 500; instead we log and let sends fail gracefully,
// consistent with the migration's "no-op until configured" posture.
const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
if (vapidPublic && vapidPrivate) {
  // A malformed key (e.g. a placeholder copied from .env.example) throws here.
  // Catch it so Expo pushes, which don't use VAPID, still go out.
  try {
    webpush.setVapidDetails(
      Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com",
      vapidPublic,
      vapidPrivate,
    );
  } catch (err) {
    console.error("Invalid VAPID configuration; web push sends will fail:", err);
  }
} else {
  console.error(
    "VAPID keys not configured (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY); push sends will fail until they are set.",
  );
}

/**
 * Caller authorization for the notify-* functions.
 *
 * `verify_jwt` (the Edge platform default) only proves the bearer is *some*
 * project-signed JWT — and the public anon key shipped to every browser satisfies
 * that. Without this check, anyone could POST an attacker-controlled body and push
 * arbitrary content to any subscribed user. We additionally require the bearer to
 * equal a shared secret that only the cron job and DB triggers (via pg_net) hold.
 *
 * The expected value is `PUSH_NOTIFY_SECRET` when set, falling back to
 * `SUPABASE_SERVICE_ROLE_KEY`. The explicit secret exists because the runtime-injected
 * `SUPABASE_SERVICE_ROLE_KEY` can be the new `sb_secret_…` key format, which is not a
 * JWT and so can't be sent through a `verify_jwt`-protected gateway — `PUSH_NOTIFY_SECRET`
 * lets us pin the bearer to a value that both passes the gateway and matches here (set it
 * to the legacy service_role JWT). It must equal the Vault `service_role_key` the triggers
 * send. Returns a 401 Response to short-circuit on failure, or null for a trusted caller.
 */
export function requireServiceRole(req: Request): Response | null {
  const expected = Deno.env.get("PUSH_NOTIFY_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!expected || token !== expected) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export interface PushRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  // tag dedupes one logical notification across a user's devices.
  tag: string;
}

/** Service-role admin client (bypasses RLS — callers must scope queries explicitly). */
export function createAdmin(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/** Build the deep-link a notification opens. Matches the /tasks?focus=<id> route (FLUX-116). */
export function taskUrl(taskId: string): string {
  return `/tasks?focus=${taskId}`;
}

/** Fetch all push subscriptions for a set of user IDs. */
export async function fetchSubscriptionsForUsers(
  admin: SupabaseClient,
  userIds: string[],
): Promise<PushRow[]> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const { data, error } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", ids);
  if (error) throw error;
  return (data ?? []) as PushRow[];
}

/** Delete subscription rows whose endpoints are gone (web-push 404/410). */
export async function pruneEndpoints(admin: SupabaseClient, endpoints: string[]): Promise<void> {
  if (endpoints.length === 0) return;
  await admin.from("push_subscriptions").delete().in("endpoint", endpoints);
}

// HOUP-154: native (Expo push) send path, alongside the web-push path above.
// device_push_tokens is a sibling table to push_subscriptions (see its
// migration) — Expo push tokens are opaque strings with no keypair.

export interface DeviceTokenRow {
  id: string;
  user_id: string;
  expo_push_token: string;
}

/** Fetch all Expo device push tokens for a set of user IDs. */
export async function fetchDeviceTokensForUsers(
  admin: SupabaseClient,
  userIds: string[],
): Promise<DeviceTokenRow[]> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const { data, error } = await admin
    .from("device_push_tokens")
    .select("id, user_id, expo_push_token")
    .in("user_id", ids);
  if (error) throw error;
  return (data ?? []) as DeviceTokenRow[];
}

/** Delete device token rows Expo reported as DeviceNotRegistered. */
export async function pruneDeviceTokens(admin: SupabaseClient, tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await admin.from("device_push_tokens").delete().in("expo_push_token", tokens);
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_PUSH_CHUNK_SIZE = 100;

interface ExpoPushTicket {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

/**
 * Send one payload to a set of Expo push tokens, chunked at Expo's 100-message
 * limit. Returns tokens Expo reported DeviceNotRegistered for, so the caller
 * can prune them. Scope note: only the immediate ticket `details.error` is
 * handled here — the separate deferred-receipts round-trip
 * (exp.host/--/api/v2/push/getReceipts) is out of scope for MVP.
 */
export async function sendExpoPush(
  tokens: DeviceTokenRow[],
  payload: PushPayload,
): Promise<{ sent: number; staleTokens: string[] }> {
  if (tokens.length === 0) return { sent: 0, staleTokens: [] };
  let sent = 0;
  const staleTokens: string[] = [];

  for (let i = 0; i < tokens.length; i += EXPO_PUSH_CHUNK_SIZE) {
    const chunk = tokens.slice(i, i + EXPO_PUSH_CHUNK_SIZE);
    const messages = chunk.map((t) => ({
      to: t.expo_push_token,
      title: payload.title,
      body: payload.body,
      data: { url: payload.url },
    }));
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(messages),
      });
      const json = await res.json().catch(() => null);
      const tickets: ExpoPushTicket[] = json?.data ?? [];
      tickets.forEach((ticket, idx) => {
        if (ticket.status === "ok") {
          sent++;
        } else if (ticket.details?.error === "DeviceNotRegistered") {
          staleTokens.push(chunk[idx].expo_push_token);
        } else {
          console.error("Expo push send failed", ticket);
        }
      });
    } catch (err) {
      console.error("Expo push request failed", err);
    }
  }

  return { sent, staleTokens };
}

type SendResult = "ok" | "stale" | "error";

/** Send one payload to one subscription; "stale" means the endpoint should be pruned. */
export async function sendWebPush(sub: PushRow, payload: PushPayload): Promise<SendResult> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
    );
    return "ok";
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return "stale";
    console.error("web-push send failed", status, err);
    return "error";
  }
}

/**
 * Fan a single payload out to every web-push subscription AND native device
 * token belonging to `userIds`, pruning stale/unregistered entries
 * afterwards. Returns combined counts for logging.
 */
export async function sendToUsers(
  admin: SupabaseClient,
  userIds: string[],
  payload: PushPayload,
): Promise<{ sent: number; pruned: number }> {
  const [subs, deviceTokens] = await Promise.all([
    fetchSubscriptionsForUsers(admin, userIds),
    fetchDeviceTokensForUsers(admin, userIds),
  ]);

  const stale: string[] = [];
  let sent = 0;
  for (const sub of subs) {
    const result = await sendWebPush(sub, payload);
    if (result === "ok") sent++;
    else if (result === "stale") stale.push(sub.endpoint);
  }

  const { sent: nativeSent, staleTokens } = await sendExpoPush(deviceTokens, payload);
  sent += nativeSent;

  await Promise.all([pruneEndpoints(admin, stale), pruneDeviceTokens(admin, staleTokens)]);
  return { sent, pruned: stale.length + staleTokens.length };
}
