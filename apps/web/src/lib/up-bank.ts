import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  UP_API_BASE,
  upTransactionRow,
  type BankTransaction,
  type UpAccountResource,
  type UpBankStatus,
  type UpTransactionResource,
} from "@homeup/core";
import { billingMode, householdTier } from "@/lib/billing";
import { canStoreHouseholdKeys, decryptHouseholdKey } from "@/lib/ai/household-keys";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";
import { resolveGroupId } from "@/lib/pat";

// Up Bank connector: talking to Up's API for one person (packages/core
// up-bank.ts has the shapes and the why). Up allows its API for personal use
// only, so on the hosted server (ROOFTAP_BILLING=on) only the operator's own
// household (billing exempt) may connect. Self-hosted servers belong to the
// household that runs them, so everyone there may.

export interface UpConnectionRow {
  user_id: string;
  group_id: string;
  encrypted_token: string;
  last4: string;
  shared: boolean;
  hook_id: string;
  webhook_id: string | null;
  encrypted_webhook_secret: string | null;
  last_synced_at: string | null;
}

/** How far back the first sync reads. */
const FIRST_SYNC_DAYS = 90;
/** Later syncs re-read this many days, so held transactions that settle or drop out are caught. */
const RESYNC_DAYS = 7;
/** Pages of 100 per sync at most. */
const MAX_PAGES = 20;
/** A sync started this soon after the last one does nothing. */
const SYNC_COOLDOWN_MS = 60_000;

export async function upBankAllowed(admin: SupabaseClient, groupId: string): Promise<boolean> {
  if (billingMode() !== "on") return true;
  return (await householdTier(admin, groupId)) === "exempt";
}

export const UP_NOT_ALLOWED =
  "Up allows its API for personal use only, so Up Bank works on self-hosted Rooftap servers.";

export async function upConnectionRow(admin: SupabaseClient, userId: string): Promise<UpConnectionRow | null> {
  const { data } = await admin.from("up_bank_connections").select("*").eq("user_id", userId).maybeSingle();
  return (data as UpConnectionRow | null) ?? null;
}

export async function upBankStatus(admin: SupabaseClient, userId: string, groupId: string): Promise<UpBankStatus> {
  const [allowed, row] = await Promise.all([upBankAllowed(admin, groupId), upConnectionRow(admin, userId)]);
  return {
    allowed,
    canStore: canStoreHouseholdKeys(),
    connection: row
      ? { last4: row.last4, shared: row.shared, live: !!row.webhook_id, lastSyncedAt: row.last_synced_at }
      : null,
  };
}

// ── Up's API ─────────────────────────────────────────────────────────────

export class UpApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function upFetch<T>(token: string, pathOrUrl: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const url = pathOrUrl.startsWith("https://") ? pathOrUrl : `${UP_API_BASE}${pathOrUrl}`;
  // Only Up's own API ever gets the token, whatever a `next` link says.
  if (!url.startsWith(`${UP_API_BASE}/`)) throw new UpApiError("Unexpected Up address.", 502);
  let res: Response;
  try {
    res = await fetch(url, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new UpApiError("Couldn't reach Up. Try again in a minute.", 502);
  }
  if (res.status === 401) throw new UpApiError("Up didn't accept that token. Make a new one at api.up.com.au.", 401);
  if (res.status === 429) throw new UpApiError("Up is limiting requests right now. Try again in a minute.", 429);
  if (!res.ok) throw new UpApiError(`Up answered with an error (${res.status}).`, 502);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Throws an UpApiError when Up refuses the token. */
export async function checkUpToken(token: string): Promise<void> {
  await upFetch(token, "/util/ping");
}

async function upAccountNames(token: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  let next: string | null = "/accounts?page[size]=100";
  while (next) {
    const page: { data: UpAccountResource[]; links: { next: string | null } } = await upFetch(token, next);
    for (const a of page.data) names.set(a.id, a.attributes.displayName);
    next = page.links.next;
  }
  return names;
}

function upsertRows(admin: SupabaseClient, rows: Omit<BankTransaction, "id">[]) {
  const now = new Date().toISOString();
  return admin
    .from("bank_transactions")
    .upsert(
      rows.map((r) => ({ ...r, updated_at: now })),
      { onConflict: "source,user_id,external_id" },
    );
}

/**
 * Reads this person's recent transactions from Up into `bank_transactions`.
 * The first sync reads 90 days; later ones re-read the last week, and drop
 * held transactions in that window that Up no longer lists. Returns how many
 * rows were saved, or null when the last sync was under a minute ago.
 */
export async function syncUp(admin: SupabaseClient, row: UpConnectionRow, opts: { force?: boolean } = {}): Promise<number | null> {
  const now = Date.now();
  if (!opts.force && row.last_synced_at && now - Date.parse(row.last_synced_at) < SYNC_COOLDOWN_MS) return null;
  const token = decryptHouseholdKey(row.encrypted_token);
  if (!token) throw new UpApiError("The saved token can't be read on this server. Connect Up again.", 409);

  const sinceMs = row.last_synced_at
    ? Date.parse(row.last_synced_at) - RESYNC_DAYS * 86_400_000
    : now - FIRST_SYNC_DAYS * 86_400_000;
  const since = new Date(sinceMs).toISOString();
  const accounts = await upAccountNames(token);

  const rows: Omit<BankTransaction, "id">[] = [];
  let next: string | null = `/transactions?page[size]=100&filter[since]=${encodeURIComponent(since)}`;
  for (let page = 0; next && page < MAX_PAGES; page++) {
    const body: { data: UpTransactionResource[]; links: { next: string | null } } = await upFetch(token, next);
    for (const t of body.data) rows.push(upTransactionRow(t, { groupId: row.group_id, userId: row.user_id }, accounts));
    next = body.links.next;
  }

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await upsertRows(admin, rows.slice(i, i + 500));
    if (error) throw new UpApiError(`Transactions couldn't be saved: ${error.message}`, 500);
  }

  // Held transactions Up dropped (a hold released) leave no trace in a list,
  // so they go when they're missing from a complete read of the window.
  if (!next) {
    const listed = new Set(rows.map((r) => r.external_id));
    const { data: held } = await admin
      .from("bank_transactions")
      .select("id, external_id")
      .eq("user_id", row.user_id)
      .eq("source", "up")
      .eq("status", "HELD")
      .gte("occurred_at", since);
    const gone = (held ?? []).filter((h) => !listed.has(h.external_id as string)).map((h) => h.id as string);
    if (gone.length) await admin.from("bank_transactions").delete().in("id", gone);
  }

  await admin
    .from("up_bank_connections")
    .update({ last_synced_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() })
    .eq("user_id", row.user_id);
  return rows.length;
}

// ── Webhooks ─────────────────────────────────────────────────────────────

/**
 * The address Up should push to, or null when this server can't be reached
 * from the internet (plain http, localhost, a .local name or a bare private
 * IP). Without one, transactions arrive when someone opens Costs.
 */
export function upWebhookUrl(origin: string, hookId: string): string | null {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  const host = url.hostname;
  if (url.protocol !== "https:") return null;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) return null;
  if (/^(10|127)\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^\[/.test(host)) return null;
  return `${url.origin}/api/up-bank/webhook/${hookId}`;
}

export async function createUpWebhook(token: string, url: string): Promise<{ id: string; secretKey: string }> {
  const res = await upFetch<{ data: { id: string; attributes: { secretKey: string } } }>(token, "/webhooks", {
    method: "POST",
    body: { data: { attributes: { url, description: "Rooftap" } } },
  });
  return { id: res.data.id, secretKey: res.data.attributes.secretKey };
}

/** Best effort: a webhook Up can't find is already gone. */
export async function deleteUpWebhook(token: string, id: string): Promise<void> {
  try {
    await upFetch(token, `/webhooks/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch (err) {
    console.warn("[up-bank] webhook delete failed", err instanceof Error ? err.message : err);
  }
}

/** Up signs each delivery with an HMAC-SHA256 of the raw body, hex, in X-Up-Authenticity-Signature. */
export function upSignatureValid(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.trim().toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Saves or removes the one transaction a webhook event names. */
export async function applyUpEvent(
  admin: SupabaseClient,
  row: UpConnectionRow,
  token: string,
  event: { eventType: string; transactionId: string | null },
): Promise<void> {
  if (!event.transactionId) return;
  if (event.eventType === "TRANSACTION_DELETED") {
    await admin
      .from("bank_transactions")
      .delete()
      .eq("user_id", row.user_id)
      .eq("source", "up")
      .eq("external_id", event.transactionId);
    return;
  }
  if (event.eventType !== "TRANSACTION_CREATED" && event.eventType !== "TRANSACTION_SETTLED") return;
  const [res, accounts] = await Promise.all([
    upFetch<{ data: UpTransactionResource }>(token, `/transactions/${encodeURIComponent(event.transactionId)}`),
    upAccountNames(token),
  ]);
  const { error } = await upsertRows(admin, [
    upTransactionRow(res.data, { groupId: row.group_id, userId: row.user_id }, accounts),
  ]);
  if (error) throw new Error(error.message);
}

// ── Reading ──────────────────────────────────────────────────────────────

/**
 * Transactions this person may see between two instants: their own, plus
 * those of household members who share theirs. Newest first.
 */
export async function visibleBankTransactions(
  admin: SupabaseClient,
  input: { userId: string; groupId: string; from: string; to: string; limit?: number },
): Promise<BankTransaction[]> {
  const { data: sharing } = await admin
    .from("up_bank_connections")
    .select("user_id")
    .eq("group_id", input.groupId)
    .eq("shared", true);
  const people = Array.from(new Set([input.userId, ...(sharing ?? []).map((s) => s.user_id as string)]));
  const { data, error } = await admin
    .from("bank_transactions")
    .select("*")
    .eq("group_id", input.groupId)
    .in("user_id", people)
    .gte("occurred_at", input.from)
    .lt("occurred_at", input.to)
    .order("occurred_at", { ascending: false })
    .limit(input.limit ?? 2000);
  if (error) throw new Error(error.message);
  return (data ?? []) as BankTransaction[];
}

// ── Route front half ─────────────────────────────────────────────────────

export type UpRequest = { error: NextResponse } | { admin: SupabaseClient; userId: string; groupId: string };

/** A signed-in user (cookie or Bearer) in a household. */
export async function upRequest(): Promise<UpRequest> {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const admin = createAdminClient();
  const groupId = await resolveGroupId(admin, user.id);
  if (!groupId) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  return { admin, userId: user.id, groupId };
}

export function upErrorResponse(err: unknown) {
  if (err instanceof UpApiError) {
    return NextResponse.json({ error: err.message }, { status: err.status === 401 ? 400 : err.status });
  }
  return NextResponse.json({ error: err instanceof Error ? err.message : "Something went wrong." }, { status: 500 });
}
