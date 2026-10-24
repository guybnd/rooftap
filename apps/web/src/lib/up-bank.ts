import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  UP_API_BASE,
  addBankMatch,
  bankAccountVisible,
  bankLineAmount,
  bankRowJoint,
  costCategoryFromUp,
  normaliseBankMatch,
  vendorPlan,
  bankRowVisible,
  bankScopePeople,
  isBankShareMode,
  isLinkablePayment,
  linkedCostItem,
  upAccountRow,
  upTransactionRow,
  type BankAccountRow,
  type BankScope,
  type BankShareMode,
  type BankSharing,
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
  /** Missing on servers before 20261022130000_bank_share_mode. */
  share_mode?: BankShareMode;
  /** Missing on servers before 20261022140000_bank_auto_costs. */
  auto_costs?: boolean;
  /** Missing on servers before 20261022150000_bank_weekly_digest. */
  weekly_digest?: boolean;
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

/** A connection's sharing, reading the older switch where share_mode isn't there yet. */
export function shareModeOf(row: Pick<UpConnectionRow, "shared" | "share_mode">): BankShareMode {
  return isBankShareMode(row.share_mode) ? row.share_mode : row.shared ? "all" : "none";
}

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
      ? {
          last4: row.last4,
          shared: shareModeOf(row) !== "none",
          shareMode: shareModeOf(row),
          ...(row.auto_costs !== undefined ? { autoCosts: row.auto_costs } : {}),
          ...(row.weekly_digest !== undefined ? { weeklyDigest: row.weekly_digest } : {}),
          live: !!row.webhook_id,
          lastSyncedAt: row.last_synced_at,
        }
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

async function upsertRows(admin: SupabaseClient, rows: Omit<BankTransaction, "id">[]) {
  const now = new Date().toISOString();
  const write = (list: Omit<BankTransaction, "id">[]) =>
    admin
      .from("bank_transactions")
      .upsert(
        list.map((r) => ({ ...r, updated_at: now })),
        { onConflict: "source,user_id,external_id" },
      );
  const res = await write(rows);
  // Code can run a few minutes ahead of its migration on the hosted server;
  // without the account_id column, save the rows without it.
  if (res.error && /account_id/.test(res.error.message)) {
    return write(rows.map(({ account_id: _accountId, ...rest }) => rest));
  }
  return res;
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
  /** Fits joint-account payments only (rules the server made). Missing before 20261022140000_bank_auto_costs. */
  joint_only?: boolean;
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
 * line. Payments linked by hand stay as they are. Then joint payments still
 * without a line are filed for people who turned that on, lines the bank made
 * follow their payments, and each line that keeps its amount in step takes
 * its latest settled payment's amount. Limit it to one person's payments
 * since an instant after a read from Up; leave both out after a rule changes.
 */
export async function applyBankLinks(
  admin: SupabaseClient,
  groupId: string,
  scope: { userId?: string; since?: string } = {},
): Promise<void> {
  let rules = await bankLinkRows(admin, groupId);
  // Joint accounts per person don't depend on who's looking.
  const sharing = await bankSharing(admin, "", groupId);
  if (!(await linkPass(admin, groupId, rules, sharing, scope))) return;
  if (await autoFileJointPayments(admin, groupId, rules, sharing)) {
    rules = await bankLinkRows(admin, groupId);
    await linkPass(admin, groupId, rules, sharing, { since: new Date(Date.now() - AUTO_FILE_DAYS * DAY_MS).toISOString() });
  }
  await refreshBankLines(admin, groupId);
  await keepAmountsInStep(admin, groupId, rules);
}

type LinkRow = Pick<
  BankTransaction,
  "id" | "user_id" | "account_id" | "account_name" | "description" | "raw_text" | "tags" | "amount_cents" | "is_transfer" | "cost_item_id" | "link_kind"
>;

/** Moves payments to the line the rules pick. False when the payments couldn't be read. */
async function linkPass(
  admin: SupabaseClient,
  groupId: string,
  rules: BankLinkRow[],
  sharing: BankSharing,
  scope: { userId?: string; since?: string },
): Promise<boolean> {
  let query = admin
    .from("bank_transactions")
    .select("id, user_id, account_id, account_name, description, raw_text, tags, amount_cents, is_transfer, cost_item_id, link_kind")
    .eq("group_id", groupId)
    .or("link_kind.is.null,link_kind.eq.rule")
    .order("occurred_at", { ascending: false })
    .limit(LINK_BATCH);
  if (scope.userId) query = query.eq("user_id", scope.userId);
  if (scope.since) query = query.gte("occurred_at", scope.since);
  const { data, error } = await query;
  if (error) {
    console.warn("[up-bank] links not applied", error.message);
    return false;
  }

  // Group the changes by target so each line costs one update.
  const moves = new Map<string, string[]>();
  for (const t of (data ?? []) as LinkRow[]) {
    const target = linkedCostItem(t, rules, bankRowJoint(t, sharing));
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
  return true;
}

// ── Filing joint payments as costs ───────────────────────────────────────

const DAY_MS = 86_400_000;
/** How far back filing looks for joint payments without a line. */
const AUTO_FILE_DAYS = 90;
/** Payees shorter than this are filed one payment at a time: as a rule they'd fit too much. */
const AUTO_RULE_MIN = 3;
/** The longest a rule's match may grow when payees join a line (bank_links.match). */
const MATCH_MAX = 1000;

function squashName(text: string | null | undefined): string {
  return (text ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

type FileRow = LinkRow & Pick<BankTransaction, "external_id" | "category" | "occurred_at">;

/**
 * Files payments from joint accounts that no rule fits under a cost line for
 * their payee, for each person who turned it on and shares their joint
 * accounts. A payee with a line of the same name (or provider) joins it;
 * any other gets a new line, marked as the bank's, in the category Up gave
 * its payments. Each gets a rule for joint payments, so later ones follow
 * and a move to another category is remembered. True when anything changed.
 */
async function autoFileJointPayments(
  admin: SupabaseClient,
  groupId: string,
  rules: BankLinkRow[],
  sharing: BankSharing,
): Promise<boolean> {
  const { data: conns } = await admin.from("up_bank_connections").select("*").eq("group_id", groupId);
  const people = ((conns ?? []) as UpConnectionRow[])
    .filter((c) => c.auto_costs === true && shareModeOf(c) !== "none")
    .map((c) => c.user_id);
  if (!people.length) return false;

  const { data, error } = await admin
    .from("bank_transactions")
    .select("id, external_id, user_id, account_id, account_name, description, raw_text, tags, amount_cents, is_transfer, category, occurred_at, cost_item_id, link_kind")
    .eq("group_id", groupId)
    .in("user_id", people)
    .is("cost_item_id", null)
    .eq("hidden", false)
    .eq("is_transfer", false)
    .lt("amount_cents", 0)
    .gte("occurred_at", new Date(Date.now() - AUTO_FILE_DAYS * DAY_MS).toISOString())
    .order("occurred_at", { ascending: false })
    .limit(LINK_BATCH);
  if (error) {
    console.warn("[up-bank] joint payments not filed", error.message);
    return false;
  }
  const rows = ((data ?? []) as FileRow[]).filter((r) => bankRowJoint(r, sharing));
  if (!rows.length) return false;

  // One entry per payee; a joint payment read by two people counts once.
  const payees = new Map<string, { name: string; rows: FileRow[]; seen: Set<string> }>();
  for (const r of rows) {
    const name = normaliseBankMatch(r.description);
    if (!name || name.startsWith("#")) continue;
    const entry = payees.get(squashName(name)) ?? { name, rows: [], seen: new Set<string>() };
    payees.set(squashName(name), entry);
    entry.rows.push(r);
    entry.seen.add(r.external_id);
  }
  if (!payees.size) return false;

  const { data: lines } = await admin.from("cost_items").select("id, name, provider").eq("group_id", groupId).eq("deleted", false);
  const lineFor = new Map<string, string>();
  for (const l of (lines ?? []) as { id: string; name: string; provider: string | null }[]) {
    for (const key of [squashName(l.name), squashName(l.provider)]) if (key && !lineFor.has(key)) lineFor.set(key, l.id);
  }

  const newLines: Record<string, unknown>[] = [];
  const newLineKeys: string[] = [];
  const joined: { lineId: string; key: string }[] = [];
  const now = new Date();
  for (const [key, payee] of payees) {
    const existing = lineFor.get(key);
    if (existing) {
      joined.push({ lineId: existing, key });
      continue;
    }
    const unique = payee.rows.filter((r, i, all) => all.findIndex((o) => o.external_id === r.external_id) === i);
    const plan = vendorPlan(unique, now);
    if (!plan) continue;
    const upCategory = mostCommon(unique.map((r) => r.category).filter((c): c is string => !!c));
    const category = costCategoryFromUp(upCategory);
    newLines.push({
      group_id: groupId,
      // Up's raw text can end in a stray backslash ("LUNE FITZROY\\").
      name: payee.name.replace(/[\\\s]+$/, "").slice(0, 200) || payee.name.slice(0, 200),
      category,
      amount: plan.amountCents,
      cadence: plan.cadence,
      is_estimate: bankLineEstimate(plan.estimate, category),
      start_date: plan.startDate,
      provider: payee.name.slice(0, 200),
      bank_source: "up",
      created_by: unique[0].user_id,
    });
    newLineKeys.push(key);
  }

  if (newLines.length) {
    const made = await insertBankLines(admin, newLines);
    for (const m of made) joined.push({ lineId: m.id, key: squashName(m.provider) });
  }
  if (!joined.length) return false;

  // A rule per payee where the name is long enough; otherwise the payments
  // are filed by hand, one by one.
  const ruleFor = new Map(rules.map((r) => [r.cost_item_id, r]));
  const newRules = new Map<string, Record<string, unknown>>();
  const byHand = new Map<string, string[]>();
  for (const { lineId, key } of joined) {
    const payee = payees.get(key);
    if (!payee) continue;
    if (payee.name.length < AUTO_RULE_MIN) {
      byHand.set(lineId, [...(byHand.get(lineId) ?? []), ...payee.rows.map((r) => r.id)]);
      continue;
    }
    const rule = ruleFor.get(lineId);
    const pending = newRules.get(lineId);
    if (rule) {
      const match = addBankMatch(rule.match, payee.name);
      if (match && match.length <= MATCH_MAX) {
        await admin.from("bank_links").update({ match, updated_at: new Date().toISOString() }).eq("cost_item_id", lineId);
        ruleFor.set(lineId, { ...rule, match });
      }
      // A rule that has the payee already picks these up on the next pass.
    } else if (pending) {
      const match = addBankMatch(pending.match as string, payee.name);
      if (match && match.length <= MATCH_MAX) pending.match = match;
    } else {
      newRules.set(lineId, {
        cost_item_id: lineId,
        group_id: groupId,
        match: payee.name,
        keep_amount: false,
        joint_only: true,
        created_by: payee.rows[0].user_id,
      });
    }
  }
  if (newRules.size) {
    const { error: ruleError } = await admin.from("bank_links").upsert([...newRules.values()], { onConflict: "cost_item_id" });
    if (ruleError) console.warn("[up-bank] rules not saved", ruleError.message);
  }
  for (const [lineId, ids] of byHand) {
    for (let i = 0; i < ids.length; i += 500) {
      await admin.from("bank_transactions").update({ cost_item_id: lineId, link_kind: "manual" }).in("id", ids.slice(i, i + 500));
    }
  }
  return true;
}

/**
 * A grocery line the bank makes is always an estimate. A fixed grocery line
 * is a shopping trip's actual cost, one per household per day
 * (uniq_grocery_actual_cost_line), so a fixed one would clash with a trip or
 * with another shop paid the same day.
 */
function bankLineEstimate(estimate: boolean, category: string): boolean {
  return estimate || category === "grocery_estimate";
}

/**
 * Inserts the bank's new lines. When the batch fails, each goes in on its
 * own, so one bad line doesn't hold back the rest.
 */
async function insertBankLines(admin: SupabaseClient, lines: Record<string, unknown>[]): Promise<{ id: string; provider: string }[]> {
  const { data, error } = await admin.from("cost_items").insert(lines).select("id, provider");
  if (!error) return (data ?? []) as { id: string; provider: string }[];
  const made: { id: string; provider: string }[] = [];
  for (const line of lines) {
    const one = await admin.from("cost_items").insert(line).select("id, provider").single();
    if (one.error) console.warn("[up-bank] cost line not made", line.name, one.error.message);
    else made.push(one.data as { id: string; provider: string });
  }
  return made;
}

function mostCommon(values: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  for (const [v, n] of counts) if (best == null || n > counts.get(best)!) best = v;
  return best;
}

/**
 * Keeps each line the bank made in step with its payments: how often and how
 * much (core vendorPlan). Its name and category stay the household's.
 */
async function refreshBankLines(admin: SupabaseClient, groupId: string): Promise<void> {
  const { data: lines, error } = await admin
    .from("cost_items")
    .select("id, amount, cadence, is_estimate, category, start_date")
    .eq("group_id", groupId)
    .eq("bank_source", "up")
    .eq("deleted", false);
  // Before 20261022140000_bank_auto_costs there's no bank_source column.
  if (error || !lines?.length) return;
  const { data: paid } = await admin
    .from("bank_transactions")
    .select("external_id, cost_item_id, amount_cents, occurred_at, is_transfer")
    .eq("group_id", groupId)
    .not("cost_item_id", "is", null)
    .eq("hidden", false)
    .gte("occurred_at", new Date(Date.now() - 400 * DAY_MS).toISOString())
    .limit(LINK_BATCH);
  const byLine = new Map<string, Map<string, { amount_cents: number; occurred_at: string }>>();
  for (const p of (paid ?? []) as Pick<BankTransaction, "external_id" | "cost_item_id" | "amount_cents" | "occurred_at" | "is_transfer">[]) {
    if (!p.cost_item_id || p.is_transfer) continue;
    const m = byLine.get(p.cost_item_id) ?? new Map();
    byLine.set(p.cost_item_id, m);
    m.set(p.external_id, p);
  }
  const now = new Date();
  for (const line of lines as { id: string; amount: number; cadence: string; is_estimate: boolean; category: string; start_date: string | null }[]) {
    const plan = vendorPlan([...(byLine.get(line.id)?.values() ?? [])], now);
    if (!plan) continue;
    const estimate = bankLineEstimate(plan.estimate, line.category);
    // A one-off sits on its latest payment's day; a regular line keeps its start.
    const startDate = plan.cadence === "one_off" ? plan.startDate : line.start_date;
    if (plan.amountCents === line.amount && plan.cadence === line.cadence && estimate === line.is_estimate && startDate === line.start_date) continue;
    await admin
      .from("cost_items")
      .update({ amount: plan.amountCents, cadence: plan.cadence, is_estimate: estimate, start_date: startDate })
      .eq("id", line.id)
      .eq("group_id", groupId);
  }
}

/**
 * Sets each keep-in-step line's amount from its settled payments: the latest
 * for a fixed line, the rolling average of the latest three for an estimate
 * (a bill that changes, like electricity). Only
 * payments the person who made the link can see count, so nobody's private
 * account sets a shared line.
 */
async function keepAmountsInStep(admin: SupabaseClient, groupId: string, rules: BankLinkRow[]): Promise<void> {
  for (const rule of rules.filter((r) => r.keep_amount && r.created_by)) {
    const sharing = await bankSharing(admin, rule.created_by!, groupId);
    const { data: recent } = await admin
      .from("bank_transactions")
      .select("external_id, user_id, account_id, account_name, amount_cents, is_transfer")
      .eq("cost_item_id", rule.cost_item_id)
      .in("user_id", bankScopePeople(sharing, "all"))
      .eq("status", "SETTLED")
      .eq("hidden", false)
      .order("occurred_at", { ascending: false })
      .limit(20);
    // A joint payment read by two people is one payment, not two of the latest three.
    const seen = new Set<string>();
    const paid = ((recent ?? []) as Pick<BankTransaction, "external_id" | "user_id" | "account_id" | "account_name" | "amount_cents" | "is_transfer">[]).filter((r) => {
      if (!bankRowVisible(r, sharing, "all") || !isLinkablePayment(r) || seen.has(r.external_id)) return false;
      seen.add(r.external_id);
      return true;
    });
    const { data: line } = await admin.from("cost_items").select("is_estimate").eq("id", rule.cost_item_id).maybeSingle();
    const amount = bankLineAmount(
      paid.map((r) => Number(r.amount_cents)),
      (line as { is_estimate?: boolean } | null)?.is_estimate === true,
    );
    if (amount == null) continue;
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

/** Who shares what in the household, for one viewer. */
export async function bankSharing(admin: SupabaseClient, viewerId: string, groupId: string): Promise<BankSharing> {
  const [{ data: conns }, { data: joint }] = await Promise.all([
    admin.from("up_bank_connections").select("*").eq("group_id", groupId),
    admin.from("bank_accounts").select("user_id, external_id, name").eq("group_id", groupId).eq("ownership", "JOINT"),
  ]);
  const modes: Record<string, BankShareMode> = {};
  for (const c of (conns ?? []) as UpConnectionRow[]) modes[c.user_id] = shareModeOf(c);
  const jointBy: Record<string, { ids: string[]; names: string[] }> = {};
  for (const a of (joint ?? []) as { user_id: string; external_id: string; name: string }[]) {
    const entry = (jointBy[a.user_id] ??= { ids: [], names: [] });
    entry.ids.push(a.external_id);
    entry.names.push(a.name);
  }
  return { viewerId, modes, joint: jointBy };
}

/**
 * Accounts a person may see in a scope (core's BankScope): 'household' is
 * what each person shares, 'mine' the viewer's personal (non-joint) accounts, 'all' both.
 */
export async function visibleBankAccounts(
  admin: SupabaseClient,
  userId: string,
  groupId: string,
  scope: BankScope = "all",
): Promise<BankAccountRow[]> {
  const sharing = await bankSharing(admin, userId, groupId);
  const people = bankScopePeople(sharing, scope);
  if (!people.length) return [];
  const { data, error } = await admin
    .from("bank_accounts")
    .select("*")
    .eq("group_id", groupId)
    .in("user_id", people)
    .order("created_at");
  if (error) throw new Error(error.message);
  // The viewer's own copy of a joint account comes first, so it's the one kept.
  return ((data ?? []) as BankAccountRow[])
    .filter((a) => bankAccountVisible(a, sharing, scope))
    .sort((a, b) => Number(b.user_id === userId) - Number(a.user_id === userId));
}

/**
 * Transactions a person may see in a scope between two instants, newest
 * first. `before` and `hidden` narrow it for the Money view's list.
 */
export async function visibleBankTransactions(
  admin: SupabaseClient,
  input: {
    userId: string;
    groupId: string;
    from?: string;
    to?: string;
    limit?: number;
    scope?: BankScope;
    hidden?: boolean;
    /** Filled with how many rows the read returned before the scope filter and the oldest one's time, for paging. */
    read?: { count: number; oldest: string | null };
  },
): Promise<BankTransaction[]> {
  const scope = input.scope ?? "all";
  const sharing = await bankSharing(admin, input.userId, input.groupId);
  const people = bankScopePeople(sharing, scope);
  if (!people.length) return [];
  let query = admin
    .from("bank_transactions")
    .select("*")
    .eq("group_id", input.groupId)
    .in("user_id", people)
    .order("occurred_at", { ascending: false })
    .limit(input.limit ?? 2000);
  if (input.from) query = query.gte("occurred_at", input.from);
  if (input.to) query = query.lt("occurred_at", input.to);
  if (input.hidden !== undefined) query = query.eq("hidden", input.hidden);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  if (input.read) {
    input.read.count = data?.length ?? 0;
    input.read.oldest = data?.length ? (data[data.length - 1].occurred_at as string) : null;
  }
  return ((data ?? []) as BankTransaction[]).filter((r) => bankRowVisible(r, sharing, scope));
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
