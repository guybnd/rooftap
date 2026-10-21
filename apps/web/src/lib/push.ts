import type { SupabaseClient } from "@supabase/supabase-js";

// Push from the web server: the Node twin of supabase/functions/_shared/
// send-push.ts, for notifications that start in an API route rather than a
// DB trigger (the assistant answering after you left, a Shopper Scout run
// finishing). Same tables, same payload shape, same pruning, so a
// notification looks the same whichever side sent it.
//
// Native pushes go through Expo and need no keys. Browser pushes need
// NEXT_PUBLIC_VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY on this server (the
// Supabase secrets the Edge Functions use are separate); without them the
// browser leg is skipped and native still goes out.

export interface PushPayload {
  title: string;
  body: string;
  /** In-app path the notification opens, e.g. `/assistant/<id>`. */
  url: string;
  /** Dedupes one logical notification across a person's devices. */
  tag: string;
}

export interface PushResult {
  sent: number;
  pruned: number;
}

interface WebSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface DeviceTokenRow {
  expo_push_token: string;
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_CHUNK = 100;

type WebPushSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };
type WebPushSend = (sub: WebPushSubscription, payload: string) => Promise<unknown>;

export interface PushDeps {
  fetchImpl?: typeof fetch;
  /** Override for tests; defaults to web-push configured from env. */
  webPush?: WebPushSend | null;
}

let webPushSender: Promise<WebPushSend | null> | null = null;

// web-push loads only when a browser subscription exists, and once.
function defaultWebPush(): Promise<WebPushSend | null> {
  webPushSender ??= (async () => {
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) return null;
    const { default: webpush } = await import("web-push");
    try {
      webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", publicKey, privateKey);
    } catch (err) {
      console.error("Invalid VAPID configuration; browser pushes are off:", err);
      return null;
    }
    return (sub, payload) => webpush.sendNotification(sub, payload);
  })();
  return webPushSender;
}

async function sendExpo(
  tokens: string[],
  payload: PushPayload,
  fetchImpl: typeof fetch,
): Promise<{ sent: number; stale: string[] }> {
  let sent = 0;
  const stale: string[] = [];
  for (let i = 0; i < tokens.length; i += EXPO_CHUNK) {
    const chunk = tokens.slice(i, i + EXPO_CHUNK);
    try {
      const res = await fetchImpl(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(
          chunk.map((to) => ({ to, title: payload.title, body: payload.body, data: { url: payload.url } })),
        ),
      });
      const json = (await res.json().catch(() => null)) as {
        data?: { status: string; details?: { error?: string } }[];
      } | null;
      (json?.data ?? []).forEach((ticket, idx) => {
        if (ticket.status === "ok") sent++;
        else if (ticket.details?.error === "DeviceNotRegistered") stale.push(chunk[idx]);
        else console.error("Expo push send failed", ticket);
      });
    } catch (err) {
      console.error("Expo push request failed", err);
    }
  }
  return { sent, stale };
}

/**
 * Send one payload to every browser subscription and native device of
 * `userIds`, pruning the ones that are gone. Never throws: a push is a
 * side effect, so a failure is logged and counted as not sent.
 */
export async function sendPushToUsers(
  admin: SupabaseClient,
  userIds: string[],
  payload: PushPayload,
  deps: PushDeps = {},
): Promise<PushResult> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return { sent: 0, pruned: 0 };
  try {
    const [subs, devices] = await Promise.all([
      admin.from("push_subscriptions").select("endpoint, p256dh, auth").in("user_id", ids),
      admin.from("device_push_tokens").select("expo_push_token").in("user_id", ids),
    ]);
    const webRows = (subs.data ?? []) as WebSubscriptionRow[];
    const tokens = ((devices.data ?? []) as DeviceTokenRow[]).map((d) => d.expo_push_token);

    const staleEndpoints: string[] = [];
    let sent = 0;
    if (webRows.length > 0) {
      const send = deps.webPush !== undefined ? deps.webPush : await defaultWebPush();
      if (send) {
        const body = JSON.stringify(payload);
        await Promise.all(
          webRows.map(async (row) => {
            try {
              await send({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, body);
              sent++;
            } catch (err) {
              const status = (err as { statusCode?: number }).statusCode;
              if (status === 404 || status === 410) staleEndpoints.push(row.endpoint);
              else console.error("web-push send failed", status, err);
            }
          }),
        );
      }
    }

    const expo = tokens.length > 0 ? await sendExpo(tokens, payload, deps.fetchImpl ?? fetch) : { sent: 0, stale: [] };
    sent += expo.sent;

    await Promise.all([
      staleEndpoints.length > 0
        ? admin.from("push_subscriptions").delete().in("endpoint", staleEndpoints)
        : null,
      expo.stale.length > 0
        ? admin.from("device_push_tokens").delete().in("expo_push_token", expo.stale)
        : null,
    ]);
    return { sent, pruned: staleEndpoints.length + expo.stale.length };
  } catch (err) {
    console.error("sendPushToUsers failed", err);
    return { sent: 0, pruned: 0 };
  }
}
