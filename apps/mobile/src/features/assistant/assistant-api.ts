// HOUP-443: native calls to /api/assistant, through core's shared client so
// request shapes match web. Same authed pattern as features/shopper/shopper-api.ts:
// the server origin plus the Supabase session as `Authorization: Bearer`.
// Web twin: apps/web/src/lib/assistant-client.ts.
import { assistantError, createAssistantApi, setAssistantUnread } from '@homeup/core';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { getStoredServer } from '@/lib/server-config';

// Bounded waits, so a screen never sits on its skeleton: waking from a
// notification, supabase-js first refreshes an expired token (retried for
// up to 30s offline), and a fetch on a network that is still coming back
// can hang with no answer at all. Past these, the call fails and the
// screen offers Try again.
const SESSION_WAIT_MS = 10_000;
const READ_WAIT_MS = 20_000;
/** A chat turn runs the model and its tools, so it gets longer. */
const SEND_WAIT_MS = 120_000;

function within<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const TOO_SLOW = "Rooftap didn't answer in time. Check your connection and try again.";

async function signedIn() {
  const server = await getStoredServer();
  if (!server) throw new Error('No server configured.');
  const {
    data: { session },
  } = await within(getCurrentSupabaseClient().auth.getSession(), SESSION_WAIT_MS, 'Still signing you in. Check your connection and try again.');
  return { origin: server.origin, token: session?.access_token ?? null };
}

/**
 * HOUP-509: a chat reply read as it is written. React Native's fetch hands
 * over the body only once it has all arrived, so this uses XHR, whose
 * progress events carry the text received so far.
 */
async function streamChat(path: string, body: unknown, onChunk: (text: string) => void) {
  const { origin, token } = await signedIn();
  return new Promise<{ status: number; contentType: string | null; text: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let seen = 0;
    const take = () => {
      const text = xhr.responseText ?? '';
      if (text.length > seen) {
        const chunk = text.slice(seen);
        seen = text.length;
        onChunk(chunk);
      }
    };
    xhr.open('POST', `${origin}${path}`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept', 'text/event-stream');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.timeout = SEND_WAIT_MS;
    // Set before send: React Native only reports text as it arrives when someone is listening.
    xhr.onprogress = take;
    xhr.onload = () => {
      take();
      resolve({ status: xhr.status, contentType: xhr.getResponseHeader('content-type'), text: xhr.responseText ?? '' });
    };
    xhr.ontimeout = () => reject(new Error(TOO_SLOW));
    xhr.onerror = () => reject(new Error("Couldn't reach Rooftap. Check your connection and try again."));
    xhr.send(JSON.stringify(body));
  });
}

export const assistantApi = createAssistantApi(async (path, init) => {
  const { origin, token } = await signedIn();
  const method = init?.method ?? 'GET';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), method === 'POST' && path === '/api/assistant/chat' ? SEND_WAIT_MS : READ_WAIT_MS);
  let res: Response;
  let body: unknown;
  try {
    res = await fetch(`${origin}${path}`, {
      method,
      headers: {
        ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    body = await res.json().catch(() => ({}));
  } catch (err) {
    if (controller.signal.aborted) throw new Error(TOO_SLOW);
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (controller.signal.aborted) throw new Error(TOO_SLOW);
  if (!res.ok) throw assistantError(res.status, body);
  return body as never;
}, streamChat);

/** Re-reads how many conversations hold news for this person (the + dot). */
export function refreshAssistantUnread(): Promise<void> {
  return assistantApi
    .status()
    .then((s) => setAssistantUnread(s.unread ?? 0))
    .catch(() => {});
}
