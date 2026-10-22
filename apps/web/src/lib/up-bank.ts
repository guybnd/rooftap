import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  UP_API_BASE,
  isLinkablePayment,
  linkedCostItem,
  upAccountRow,
  upTransactionRow,
  type BankAccountRow,
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

async function upAccounts(token: string): Promise<UpAccountResource[]> {
  const accounts: UpAccountResource[] = [];
  let next: string | null = "/accounts?page[size]=100";
  while (next) {
    const page: { data: UpAccountResource[]; links: { next: string | null } } = await upFetch(token, next);
    accounts.push(...page.data);
    next = page.links.next;
  }
  return accounts;
}

/** Saves this person's accounts and balances, and drops accounts Up no longer lists (closed savers). */
async function saveAccounts(admin: SupabaseClient, row: UpConnectionRow, accounts: UpAccountResource[]): Promise<Map<string, string>> {
  const owner = { groupId: row.group_id, userId: row.user_id };
  const rows = accounts.map((a) => ({ ...upAccountRow(a, owner), updated_at: new Date().toISOString() }));
  if (rows.length) {
    const { error } = await admin.from("bank_accounts").upsert(rows, { onConflict: "source,user_id,external_id" });
    if (error) console.warn("[up-bank] accounts not saved", error.message);
  }
  const listed = new Set(rows.map((r) => r.external_id));
  const { data: stored } = await admin.from("bank_accounts").select("id, external_id").eq("user_id", row.user_id).eq("source", "up");
  const gone = (stored ?? []).filter((a) => !listed.has(a.external_id as string)).map((a) => a.id as string);
  if (gone.length) await admin.from("bank_accounts").delete().in("id", gone);
  return new Map(accounts.map((a) => [a.id, a.attributes.displayName]));
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
  const accounts = await saveAccounts(admin, row, await upAccounts(token));

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

  await applyBankLinks(admin, row.group_id, { userId: row.user_id, since });

  await admin
    .from("up_bank_connections")
    .update({ last_synced_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() })
    .eq("user_id", row.user_id);
  return rows.length;
}

// ── Links to cost lines ──────────────────────────────────────────────────

export interface BankLinkRow {
  cost_item_id: string;
  group_id: string;
  match: string;
  keep_amount: boolean;
  created_by: string | null;
  created_at: string;
}

export async function bankLinkRows(admin: SupabaseClient, groupId: string): Promise<BankLinkRow[]> {
  const { data } = await admin.from("bank_links").select("*").eq("group_id", groupId).order("created_at");
  return (data ?? []) as BankLinkRow[];
}

/** Rows read per pass when applying link rules. */
const LINK_BATCH = 5000;

/**
 * Applies the household's link rules to stored payments: every payment a rule
 * fits gets that cost line, and a payment no rule fits any more loses its
 * line. Payments linked by hand stay as they are. Then each line that keeps
 * its amount in step takes its latest settled payment's amount. Limit it to
 * one person's payments since an instant after a read from Up; leave both out
 * after a rule changes.
 */
export async function applyBankLinks(
  admin: SupabaseClient,
  groupId: string,
  scope: { userId?: string; since?: string } = {},
): Promise<void> {
  const rules = await bankLinkRows(admin, groupId);
  let query = admin
    .from("bank_transactions")
    .select("id, description, raw_text, tags, amount_cents, is_transfer, cost_item_id, link_kind")
    .eq("group_id", groupId)
    .or("link_kind.is.null,link_kind.eq.rule")
    .order("occurred_at", { ascending: false })
    .limit(LINK_BATCH);
  if (scope.userId) query = query.eq("user_id", scope.userId);
  if (scope.since) query = query.gte("occurred_at", scope.since);
  const { data, error } = await query;
  if (error) {
    console.warn("[up-bank] links not applied", error.message);
    return;
  }

  // Group the changes by target so each line costs one update.
  const moves = new Map<string, string[]>();
  for (const t of (data ?? []) as Pick<BankTransaction, "id" | "description" | "raw_text" | "tags" | "amount_cents" | "is_transfer" | "cost_item_id" | "link_kind">[]) {
    const target = linkedCostItem(t, rules);
    if ((t.cost_item_id ?? null) === target) continue;
    const key = target ?? "";
    moves.set(key, [...(moves.get(key) ?? []), t.id]);
  }
  for (const [target, ids] of moves) {
    for (let i = 0; i < ids.length; i += 500) {
      await admin
        .from("bank_transactions")
        .update(target ? { cost_item_id: target, link_kind: "rule" } : { cost_item_id: null, link_kind: null })
        .in("id", ids.slice(i, i + 500));
    }
  }

  await keepAmountsInStep(admin, groupId, rules);
}

/**
 * Sets each keep-in-step line's amount to its latest settled payment. Only
 * payments the person who made the link can see count, so nobody's private
 * account sets a shared line.
 */
async function keepAmountsInStep(admin: SupabaseClient, groupId: string, rules: BankLinkRow[]): Promise<void> {
  for (const rule of rules.filter((r) => r.keep_amount && r.created_by)) {
    const people = await visibleUserIds(admin, rule.created_by!, groupId);
    const { data: last } = await admin
      .from("bank_transactions")
      .select("amount_cents, is_transfer")
      .eq("cost_item_id", rule.cost_item_id)
      .in("user_id", people)
      .eq("status", "SETTLED")
      .eq("hidden", false)
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!last || !isLinkablePayment(last as Pick<BankTransaction, "amount_cents" | "is_transfer">)) continue;
    const amount = -Number(last.amount_cents);
    await admin
      .from("cost_items")
      .update({ amount })
      .eq("id", rule.cost_item_id)
      .eq("group_id", groupId)
      .neq("amount", amount);
  }
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
  const [res, accountList] = await Promise.all([
    upFetch<{ data: UpTransactionResource }>(token, `/transactions/${encodeURIComponent(event.transactionId)}`),
    upAccounts(token),
  ]);
  const accounts = await saveAccounts(admin, row, accountList);
  const saved = upTransactionRow(res.data, { groupId: row.group_id, userId: row.user_id }, accounts);
  const { error } = await upsertRows(admin, [saved]);
  if (error) throw new Error(error.message);
  await applyBankLinks(admin, row.group_id, {
    userId: row.user_id,
    since: new Date(Date.parse(saved.occurred_at) - 60_000).toISOString(),
  });
}

// ── Reading ──────────────────────────────────────────────────────────────

/** The person, plus household members who share their bank data. */
export async function visibleUserIds(admin: SupabaseClient, userId: string, groupId: string): Promise<string[]> {
  const { data: sharing } = await admin
    .from("up_bank_connections")
    .select("user_id")
    .eq("group_id", groupId)
    .eq("shared", true);
  return Array.from(new Set([userId, ...(sharing ?? []).map((s) => s.user_id as string)]));
}

/** Accounts this person may see: their own and those of people who share theirs. */
export async function visibleBankAccounts(admin: SupabaseClient, userId: string, groupId: string): Promise<BankAccountRow[]> {
  const people = await visibleUserIds(admin, userId, groupId);
  const { data, error } = await admin
    .from("bank_accounts")
    .select("*")
    .eq("group_id", groupId)
    .in("user_id", people)
    .order("created_at");
  if (error) throw new Error(error.message);
  // The viewer's own copy of a joint account comes first, so it's the one kept.
  return ((data ?? []) as BankAccountRow[]).sort((a, b) => Number(b.user_id === userId) - Number(a.user_id === userId));
}

/**
 * Transactions this person may see between two instants: their own, plus
 * those of household members who share theirs. Newest first.
 */
export async function visibleBankTransactions(
  admin: SupabaseClient,
  input: { userId: string; groupId: string; from: string; to: string; limit?: number },
): Promise<BankTransaction[]> {
  const people = await visibleUserIds(admin, input.userId, input.groupId);
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
