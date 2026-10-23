// Up Bank connector: a person's Up transactions, read into Rooftap.
//
// Up gives each customer a personal access token for its API
// (developer.up.com.au). Up's acceptable use policy allows it for personal
// use only, and forbids giving the token to anyone else. So each person
// connects their own account, the server keeps the token encrypted, and on
// the hosted server only the operator's own household may connect (the
// server answers `allowed: false` to everyone else). Self-hosted servers
// belong to the household that runs them, so everyone there may connect.
//
// Read only: Rooftap never moves money or changes anything at Up.
// Transactions stay private to the person who connected them unless they
// share them with the household.
//
// Pure: the shapes the apps and /api/up-bank share, mapping Up's JSON to a
// stored row, and the spending summary both apps and the assistant read.

import type { CostCadence, CostCategory, CostItem } from './types';
import type { LedgerRow } from './cost-month';

export const UP_API_BASE = 'https://api.up.com.au/api/v1';

/** Up personal access tokens start with this. */
const UP_TOKEN_PREFIX = 'up:yeah:';

/**
 * What a person shares with the household: nothing, only joint accounts
 * (such as a 2Up account), or every account.
 */
export type BankShareMode = 'none' | 'joint' | 'all';

/**
 * Whose bank data a view shows. 'household': what each person shares.
 * 'mine': the viewer's personal accounts (their joint ones count as household). 'all': both,
 * for matching payments to cost lines and for the assistant.
 */
export type BankScope = 'household' | 'mine' | 'all';

export interface UpBankConnection {
  last4: string;
  /** The household can see some of this person's spending (shareMode isn't 'none'). */
  shared: boolean;
  /** Missing from servers before 'connectors.up-bank-sharing'. */
  shareMode?: BankShareMode;
  /** Payments from this person's joint accounts are filed as cost lines. Missing before 'connectors.up-bank-auto'. */
  autoCosts?: boolean;
  /** The Sunday money note in the Assistant's Household chat. Missing before 'connectors.up-bank-digest'. */
  weeklyDigest?: boolean;
  /** Up pushes new transactions to this server as they happen. */
  live: boolean;
  lastSyncedAt: string | null;
}

export interface UpBankStatus {
  /** This person may connect Up on this server. */
  allowed: boolean;
  /** The server can encrypt a token (HOUSEHOLD_KEYS_SECRET is set). */
  canStore: boolean;
  connection: UpBankConnection | null;
}

export interface UpBankSaveInput {
  token?: string;
  shared?: boolean;
  shareMode?: BankShareMode;
  autoCosts?: boolean;
  weeklyDigest?: boolean;
}

export interface UpBankSyncResult {
  status: UpBankStatus;
  /** Transactions added or updated. */
  saved: number;
}

/** A `bank_transactions` row. Amounts in cents; money out is negative. */
export interface BankTransaction {
  id: string;
  group_id: string;
  user_id: string;
  source: 'up';
  external_id: string;
  /** The bank's id for the account. Missing on rows read before it was kept. */
  account_id?: string | null;
  account_name: string | null;
  description: string;
  message: string | null;
  amount_cents: number;
  currency: string;
  category: string | null;
  parent_category: string | null;
  status: 'HELD' | 'SETTLED';
  is_transfer: boolean;
  occurred_at: string;
  settled_at: string | null;
  /** The person's own Up tags. Missing on rows read before tags were kept. */
  tags?: string[];
  /** The bank's own text for the payment, when it differs from the description. */
  raw_text?: string | null;
  /** The cost line this payment counts toward. */
  cost_item_id?: string | null;
  /** How it got that line: a link rule, or picked by hand. */
  link_kind?: 'rule' | 'manual' | null;
  /** Left out of every spending total. */
  hidden?: boolean;
  note?: string | null;
}

/** A `bank_accounts` row: one Up account and its balance at the last read. */
export interface BankAccountRow {
  user_id: string;
  group_id: string;
  source: 'up';
  external_id: string;
  name: string;
  account_type: 'SAVER' | 'TRANSACTIONAL' | 'HOME_LOAN';
  ownership: 'INDIVIDUAL' | 'JOINT';
  balance_cents: number;
  currency: string;
}

export interface BankAccountSummary {
  id: string;
  name: string;
  type: BankAccountRow['account_type'];
  joint: boolean;
  balanceCents: number;
  /** Who connected it. A joint account connected by two people shows once. */
  userId: string;
}

/**
 * A cost line's link to bank payments. `match` is a payee's name (any
 * payment whose description contains it, ignoring case) or `#tag` for an Up
 * tag. With `keepAmount` the server sets the line's amount to each new
 * settled payment's.
 */
export interface BankLinkRule {
  match: string;
  keepAmount: boolean;
}

/** What a viewer can see of a cost line's linked payments. */
export interface CostBankLink extends BankLinkRule {
  costItemId: string;
  /** Linked payments the viewer can see, in the last 120 days. */
  count: number;
  lastPaidAt: string | null;
  /** The latest settled payment, positive cents. */
  lastAmountCents: number | null;
  /** The settled payment before that, positive cents (a price change). Missing from older servers. */
  prevAmountCents?: number | null;
}

export interface UpOverview extends UpSpending {
  accounts: BankAccountSummary[];
  /** Everyday (transactional) accounts together, cents. */
  everydayCents: number;
  /** Savers together, cents. */
  saversCents: number;
  links: CostBankLink[];
  /** Whose spending and accounts this is. Missing before 'connectors.up-bank-sharing'. */
  scope?: Exclude<BankScope, 'all'>;
  /** What each cost line was really paid, by month, this year. Missing before 'connectors.up-bank-auto'. */
  actuals?: CostActual[];
  /** The first whole month the bank data covers, YYYY-MM: earlier months keep their plan. */
  actualsSince?: string | null;
  /** Payments per shop and month over the last 13 months, for costMonth. Missing before the costs redesign. */
  ledger?: LedgerRow[];
}

/** What one cost line was really paid in one month, from the bank. */
export interface CostActual {
  costItemId: string;
  /** YYYY-MM, local time. */
  month: string;
  cents: number;
}

/**
 * The YYYY-MM month of an instant on a device `tzOffset` minutes behind UTC
 * (Date#getTimezoneOffset: -600 in Sydney), so the server files a payment in
 * the month the person saw it in.
 */
export function monthKeyAt(iso: string, tzOffset: number): string {
  const d = new Date(Date.parse(iso) - tzOffset * 60_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Each cost line's real spend per month: money out filed under it, hidden
 * payments and transfers left out, a joint payment counted once. Months are
 * the device's (tzOffset as in monthKeyAt).
 */
export function costActuals(rows: readonly BankTransaction[], tzOffset = 0): CostActual[] {
  const seen = new Set<string>();
  const sums = new Map<string, CostActual>();
  for (const r of rows) {
    if (!r.cost_item_id || r.hidden || r.is_transfer || r.amount_cents >= 0 || seen.has(r.external_id)) continue;
    seen.add(r.external_id);
    const month = monthKeyAt(r.occurred_at, tzOffset);
    const key = `${r.cost_item_id}|${month}`;
    const cur = sums.get(key) ?? { costItemId: r.cost_item_id, month, cents: 0 };
    cur.cents += -r.amount_cents;
    sums.set(key, cur);
  }
  return Array.from(sums.values());
}

/**
 * Payments per shop and month for costMonth (core cost-month.ts): money out
 * and money in, one Up transaction counted once (a joint account read by two
 * people arrives twice), hidden payments left out. Months are the viewer's
 * (tzOffset as in monthKeyAt).
 *
 * `rows` are the accounts in view. A transfer between two of them shows up
 * on both sides and is left out. A transfer in from an account outside the
 * view (a person's own account paying into the joint one) is money in, like
 * a deposit from another bank; one out to such an account is left out.
 */
export function ledgerRows(rows: readonly BankTransaction[], tzOffset = 0): LedgerRow[] {
  const seen = new Set<string>();
  const out = new Map<string, LedgerRow>();
  const transfersIn = transfersFromOutside(rows);
  for (const r of rows) {
    if ((r.is_transfer && !transfersIn.has(r.external_id)) || r.hidden || seen.has(r.external_id)) continue;
    seen.add(r.external_id);
    const month = monthKeyAt(r.occurred_at, tzOffset);
    // Up's raw text can end in a stray backslash ("LUNE FITZROY\\").
    const vendor = r.description.replace(/[\\\s]+$/, '').trim() || r.description;
    const costItemId = r.cost_item_id ?? null;
    const key = `${month}|${costItemId ?? ''}|${squash(vendor)}|${costItemId ? '' : (r.category ?? '')}`;
    const cur = out.get(key) ?? { month, vendor, costItemId, sourceCategory: r.category ?? null, outCents: 0, inCents: 0, count: 0, lastAt: r.occurred_at, source: r.source };
    if (r.amount_cents < 0) {
      cur.outCents += -r.amount_cents;
      cur.count += 1;
    } else cur.inCents += r.amount_cents;
    if (r.occurred_at > cur.lastAt) cur.lastAt = r.occurred_at;
    out.set(key, cur);
  }
  return Array.from(out.values());
}

/** How far apart the two sides of one transfer may be stamped. */
const TRANSFER_PAIR_MS = 15 * 60_000;

/** Incoming transfers with no matching outgoing transfer among `rows`: money that came from an account outside them. */
function transfersFromOutside(rows: readonly BankTransaction[]): Set<string> {
  const outs = rows.filter((r) => r.is_transfer && r.amount_cents < 0).map((r) => ({ cents: -r.amount_cents, at: Date.parse(r.occurred_at), used: false }));
  const found = new Set<string>();
  for (const r of rows) {
    if (!r.is_transfer || r.amount_cents <= 0 || found.has(r.external_id)) continue;
    const at = Date.parse(r.occurred_at);
    const pair = outs.find((o) => !o.used && o.cents === r.amount_cents && Math.abs(o.at - at) <= TRANSFER_PAIR_MS);
    if (pair) pair.used = true;
    else found.add(r.external_id);
  }
  return found;
}

/** The first whole month after the oldest row (device months, as in monthKeyAt): the months the bank data fully covers start there. */
export function actualsSinceOf(rows: readonly Pick<BankTransaction, 'occurred_at'>[], tzOffset = 0): string | null {
  let oldest: string | null = null;
  for (const r of rows) if (!oldest || r.occurred_at < oldest) oldest = r.occurred_at;
  if (!oldest) return null;
  const d = new Date(Date.parse(oldest) - tzOffset * 60_000);
  // Data that starts on the 1st or 2nd covers its month well enough.
  const next = d.getUTCDate() <= 2 ? d : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** One payee or tag to link a cost line to, from the viewer's recent payments. */
export interface BankPayee {
  /** What a link rule stores: the payee's description, or `#tag`. */
  match: string;
  label: string;
  count: number;
  lastAmountCents: number;
  lastPaidAt: string;
  categoryLabel: string | null;
  /** Up files it under a category that fits the cost line's. */
  suggested: boolean;
}

export interface CostBankDetail {
  rule: BankLinkRule | null;
  payments: SpendingTransaction[];
  /** The line's amount on the server after the rules ran, so an open editor can take a kept-in-step amount. */
  amountCents?: number;
  /** Whether the line is an estimate, which keeps in step with an average. */
  estimate?: boolean;
}

export interface SpendingCategory {
  id: string;
  label: string;
  cents: number;
}

export interface SpendingTransaction {
  id: string;
  description: string;
  amountCents: number;
  category: string | null;
  categoryLabel: string | null;
  pending: boolean;
  occurredAt: string;
  /** Who connected the account it came from. */
  userId: string;
  /** The cost line it counts toward. */
  costItemId?: string | null;
}

export interface UpSpending {
  /** First day of the month shown, YYYY-MM-DD. */
  month: string;
  /** Money out this month, as a positive number of cents. Transfers between own accounts don't count. */
  spentCents: number;
  /** Money in this month (pay, refunds), positive cents. Transfers don't count. */
  receivedCents: number;
  categories: SpendingCategory[];
  recent: SpendingTransaction[];
  /** People whose spending is included. */
  people: string[];
}

/** Whether a pasted string looks like an Up personal access token. */
export function upTokenLooksValid(raw: string | null | undefined): boolean {
  const token = (raw ?? '').trim();
  return token.startsWith(UP_TOKEN_PREFIX) && token.length > UP_TOKEN_PREFIX.length + 20 && !/\s/.test(token);
}

export function upTokenLast4(token: string): string {
  return token.trim().slice(-4);
}

/** "restaurants-and-cafes" reads "Restaurants and cafes"; "tv-and-music" reads "TV and music". */
export function upCategoryLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  const words = id.split('-').map((w) => (w === 'tv' ? 'TV' : w));
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ── Up's JSON (only the fields Rooftap reads) ────────────────────────────

interface Rel {
  data: { id: string } | null;
}

export interface UpTransactionResource {
  id: string;
  attributes: {
    status: 'HELD' | 'SETTLED';
    description: string;
    message: string | null;
    rawText?: string | null;
    amount: { currencyCode: string; valueInBaseUnits: number };
    settledAt: string | null;
    createdAt: string;
  };
  relationships: {
    account: Rel;
    transferAccount?: Rel;
    category?: Rel;
    parentCategory?: Rel;
    tags?: { data: { id: string }[] };
  };
}

export interface UpAccountResource {
  id: string;
  attributes: {
    displayName: string;
    accountType?: string;
    ownershipType?: string;
    balance?: { currencyCode: string; valueInBaseUnits: number };
  };
}

/** Maps one Up account to the row stored for this person. */
export function upAccountRow(a: UpAccountResource, owner: { groupId: string; userId: string }): BankAccountRow {
  const type = a.attributes.accountType;
  return {
    user_id: owner.userId,
    group_id: owner.groupId,
    source: 'up',
    external_id: a.id,
    name: a.attributes.displayName,
    account_type: type === 'SAVER' || type === 'HOME_LOAN' ? type : 'TRANSACTIONAL',
    ownership: a.attributes.ownershipType === 'JOINT' ? 'JOINT' : 'INDIVIDUAL',
    balance_cents: a.attributes.balance?.valueInBaseUnits ?? 0,
    currency: a.attributes.balance?.currencyCode ?? 'AUD',
  };
}

/** Maps one Up transaction to the row stored for this person, minus the row's own id. */
export function upTransactionRow(
  t: UpTransactionResource,
  owner: { groupId: string; userId: string },
  accountNames: ReadonlyMap<string, string>,
): Omit<BankTransaction, 'id'> {
  const a = t.attributes;
  const accountId = t.relationships.account.data?.id ?? null;
  return {
    group_id: owner.groupId,
    user_id: owner.userId,
    source: 'up',
    external_id: t.id,
    account_id: accountId,
    account_name: accountId ? accountNames.get(accountId) ?? null : null,
    description: a.description.trim() || 'Transaction',
    message: a.message?.trim() || null,
    raw_text: a.rawText?.trim() && a.rawText.trim() !== a.description.trim() ? a.rawText.trim() : null,
    tags: (t.relationships.tags?.data ?? []).map((tag) => tag.id),
    amount_cents: a.amount.valueInBaseUnits,
    currency: a.amount.currencyCode,
    category: t.relationships.category?.data?.id ?? null,
    parent_category: t.relationships.parentCategory?.data?.id ?? null,
    status: a.status === 'HELD' ? 'HELD' : 'SETTLED',
    is_transfer: !!t.relationships.transferAccount?.data,
    occurred_at: a.createdAt,
    settled_at: a.settledAt,
  };
}

/** YYYY-MM-01 for the month a date falls in, in local time. */
export function monthStartOf(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

/** The month `delta` months from a YYYY-MM-01 month. */
export function shiftMonth(month: string, delta: number): string {
  const range = monthRange(month);
  if (!range) return month;
  return monthStartOf(new Date(range.from.getFullYear(), range.from.getMonth() + delta, 1));
}

/** "October", or "October 2025" outside the current year. */
export function monthLabel(month: string, now: Date = new Date()): string {
  const range = monthRange(month);
  if (!range) return month;
  const name = range.from.toLocaleString('default', { month: 'long' });
  return range.from.getFullYear() === now.getFullYear() ? name : `${name} ${range.from.getFullYear()}`;
}

/** The [start, end) instants of a YYYY-MM-01 month, in the caller's local time. */
export function monthRange(month: string): { from: Date; to: Date } | null {
  const match = /^(\d{4})-(\d{2})(?:-01)?$/.exec(month);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]) - 1;
  if (m < 0 || m > 11) return null;
  return { from: new Date(y, m, 1), to: new Date(y, m + 1, 1) };
}

/**
 * The month's spending from the rows a person may see. A joint account
 * connected by two people arrives twice, once per person, so rows are
 * counted once per Up transaction id. Transfers between a person's own
 * accounts (round ups, savers, Cover) are left out of every total.
 */
export function summariseSpending(
  rows: readonly BankTransaction[],
  month: string,
  opts: { recent?: number } = {},
): UpSpending {
  const seen = new Set<string>();
  const unique = rows
    .slice()
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .filter((r) => {
      if (seen.has(r.external_id)) return false;
      seen.add(r.external_id);
      return true;
    });

  let spent = 0;
  let received = 0;
  const byCategory = new Map<string, number>();
  const people = new Set<string>();
  for (const r of unique) {
    people.add(r.user_id);
    if (r.is_transfer || r.hidden) continue;
    if (r.amount_cents < 0) {
      spent += -r.amount_cents;
      const key = r.category ?? r.parent_category ?? 'uncategorised';
      byCategory.set(key, (byCategory.get(key) ?? 0) + -r.amount_cents);
    } else {
      received += r.amount_cents;
    }
  }

  const categories = Array.from(byCategory, ([id, cents]) => ({
    id,
    label: id === 'uncategorised' ? 'Uncategorised' : upCategoryLabel(id) ?? id,
    cents,
  })).sort((a, b) => b.cents - a.cents);

  const recent = unique
    .filter((r) => !r.is_transfer && !r.hidden)
    .slice(0, opts.recent ?? 8)
    .map((r) => ({
      id: r.id,
      description: r.description,
      amountCents: r.amount_cents,
      category: r.category,
      categoryLabel: upCategoryLabel(r.category),
      pending: r.status === 'HELD',
      occurredAt: r.occurred_at,
      userId: r.user_id,
      costItemId: r.cost_item_id ?? null,
    }));

  return { month, spentCents: spent, receivedCents: received, categories, recent, people: Array.from(people) };
}



// ── Sharing ──────────────────────────────────────────────────────────────

export function isBankShareMode(v: unknown): v is BankShareMode {
  return v === 'none' || v === 'joint' || v === 'all';
}

/** Who shares what in a household, as the server reads it for one viewer. */
export interface BankSharing {
  viewerId: string;
  modes: Readonly<Record<string, BankShareMode>>;
  /** Each person's joint accounts, by the bank's id and by name (older rows only have the name). */
  joint: Readonly<Record<string, { ids: readonly string[]; names: readonly string[] }>>;
}

function shares(s: BankSharing, userId: string, isJoint: boolean): boolean {
  const mode = s.modes[userId] ?? 'none';
  return mode === 'all' || (mode === 'joint' && isJoint);
}

function inScope(s: BankSharing, userId: string, isJoint: boolean, scope: BankScope): boolean {
  // Mine is the viewer's personal money: their own accounts, joint ones left
  // to Household, so the two views never count a payment twice.
  if (scope === 'mine') return userId === s.viewerId && !isJoint;
  if (scope === 'household') return shares(s, userId, isJoint);
  return userId === s.viewerId || shares(s, userId, isJoint);
}

export function bankAccountVisible(
  a: Pick<BankAccountRow, 'user_id' | 'ownership'>,
  s: BankSharing,
  scope: BankScope,
): boolean {
  return inScope(s, a.user_id, a.ownership === 'JOINT', scope);
}

/** Whether a payment is from one of its person's joint accounts. */
export function bankRowJoint(r: Pick<BankTransaction, 'user_id' | 'account_id' | 'account_name'>, s: Pick<BankSharing, 'joint'>): boolean {
  const joint = s.joint[r.user_id];
  return !!joint && (r.account_id ? joint.ids.includes(r.account_id) : !!r.account_name && joint.names.includes(r.account_name));
}

export function bankRowVisible(
  r: Pick<BankTransaction, 'user_id' | 'account_id' | 'account_name'>,
  s: BankSharing,
  scope: BankScope,
): boolean {
  return inScope(s, r.user_id, bankRowJoint(r, s), scope);
}

/** People whose rows a scope can include, to narrow the database read. */
export function bankScopePeople(s: BankSharing, scope: BankScope): string[] {
  if (scope === 'mine') return [s.viewerId];
  const sharing = Object.entries(s.modes).filter(([, m]) => m !== 'none').map(([u]) => u);
  return Array.from(new Set(scope === 'all' ? [s.viewerId, ...sharing] : sharing));
}

// ── Linking payments to cost lines ───────────────────────────────────────

/** Up's categories that fit a cost line's category, for suggesting payees. */
export const UP_COST_CATEGORY: Readonly<Record<string, CostCategory>> = {
  'rent-and-mortgage': 'rent',
  utilities: 'utilities',
  internet: 'internet',
  'mobile-phone': 'internet',
  'home-insurance-and-rates': 'insurance',
  'car-insurance-and-maintenance': 'insurance',
  'tv-and-music': 'subscription',
  'games-and-software': 'subscription',
  'news-magazines-and-books': 'subscription',
  groceries: 'grocery_estimate',
};

function squash(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toUpperCase();
}

/** Tidies what a person types or picks into the form a rule stores. */
export function normaliseBankMatch(raw: string): string | null {
  const text = raw.trim().replace(/\s+/g, ' ');
  if (text.startsWith('#')) {
    const tag = text.slice(1).trim();
    return tag ? `#${tag}` : null;
  }
  return text.length >= 2 ? text : null;
}

/** Joins the payees a merged line's rule keeps: any of them fits. */
export const BANK_MATCH_OR = ' | ';

/** A rule's match, one payee or tag per entry (a merged line can hold several). */
export function bankMatchParts(match: string): string[] {
  return match
    .split('|')
    .map((m) => normaliseBankMatch(m))
    .filter((m): m is string => !!m);
}

/** A match with one more payee in it, or null when it already has that one. */
export function addBankMatch(match: string | null | undefined, extra: string): string | null {
  const parts = match ? bankMatchParts(match) : [];
  const add = bankMatchParts(extra).filter((m) => !parts.some((p) => squash(p) === squash(m)));
  return add.length ? [...parts, ...add].join(BANK_MATCH_OR) : null;
}

/** Whether a payment fits a link rule's match: a payee name inside its description, or `#tag`. */
export function bankMatchFits(match: string, row: Pick<BankTransaction, 'description' | 'raw_text' | 'tags'>): boolean {
  if (match.includes('|')) return bankMatchParts(match).some((m) => bankMatchFits(m, row));
  if (match.startsWith('#')) {
    const tag = match.slice(1).toLowerCase();
    return (row.tags ?? []).some((t) => t.toLowerCase() === tag);
  }
  const needle = squash(match);
  if (!needle) return false;
  return squash(row.description).includes(needle) || (!!row.raw_text && squash(row.raw_text).includes(needle));
}

/** Money out that isn't a move between own accounts: the payments a cost line can link to. */
export function isLinkablePayment(row: Pick<BankTransaction, 'amount_cents' | 'is_transfer'>): boolean {
  return row.amount_cents < 0 && !row.is_transfer;
}

/**
 * The cost line a payment belongs to under a household's link rules: the
 * first rule (oldest first) that fits. Payments linked by hand keep their
 * line.
 */
export function linkedCostItem(
  row: Pick<BankTransaction, 'description' | 'raw_text' | 'tags' | 'amount_cents' | 'is_transfer' | 'cost_item_id' | 'link_kind'>,
  rules: readonly { cost_item_id: string; match: string; joint_only?: boolean }[],
  /** The payment is from a joint account: rules the bank made for joint spending only fit those. */
  joint = false,
): string | null {
  if (row.link_kind === 'manual') return row.cost_item_id ?? null;
  if (!isLinkablePayment(row)) return null;
  return rules.find((r) => (!r.joint_only || joint) && bankMatchFits(r.match, row))?.cost_item_id ?? null;
}

/** Joint accounts arrive once per person who connected them; keep the first copy. */
function uniqueByExternal<T extends { external_id: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(r.external_id)) return false;
    seen.add(r.external_id);
    return true;
  });
}

export function summariseAccounts(rows: readonly BankAccountRow[]): {
  accounts: BankAccountSummary[];
  everydayCents: number;
  saversCents: number;
} {
  const accounts = uniqueByExternal(rows)
    .filter((a) => a.account_type !== 'HOME_LOAN')
    .map((a) => ({
      id: a.external_id,
      name: a.name,
      type: a.account_type,
      joint: a.ownership === 'JOINT',
      balanceCents: a.balance_cents,
      userId: a.user_id,
    }))
    .sort((a, b) => (a.type === b.type ? b.balanceCents - a.balanceCents : a.type === 'TRANSACTIONAL' ? -1 : 1));
  let everydayCents = 0;
  let saversCents = 0;
  for (const a of accounts) {
    if (a.type === 'SAVER') saversCents += a.balanceCents;
    else everydayCents += a.balanceCents;
  }
  return { accounts, everydayCents, saversCents };
}

function toSpendingTransaction(r: BankTransaction): SpendingTransaction {
  return {
    id: r.id,
    description: r.description,
    amountCents: r.amount_cents,
    category: r.category,
    categoryLabel: upCategoryLabel(r.category),
    pending: r.status === 'HELD',
    occurredAt: r.occurred_at,
    userId: r.user_id,
  };
}

/** The payments a viewer can see that are linked to one cost line, newest first. */
export function linkedPayments(rows: readonly BankTransaction[], costItemId: string, limit = 6): SpendingTransaction[] {
  return uniqueByExternal(
    rows.slice().sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
  )
    .filter((r) => r.cost_item_id === costItemId && !r.hidden)
    .slice(0, limit)
    .map(toSpendingTransaction);
}

/** Each linked cost line's latest payment, from the rows a viewer can see. */
export function costBankLinks(
  rows: readonly BankTransaction[],
  rules: readonly { cost_item_id: string; match: string; keep_amount: boolean }[],
): CostBankLink[] {
  const sorted = uniqueByExternal(rows.slice().sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)));
  return rules.map((rule) => {
    const mine = sorted.filter((r) => r.cost_item_id === rule.cost_item_id && !r.hidden);
    const last = mine[0] ?? null;
    const settled = mine.filter((r) => r.status === 'SETTLED');
    const lastSettled = settled[0] ?? null;
    return {
      costItemId: rule.cost_item_id,
      match: rule.match,
      keepAmount: rule.keep_amount,
      count: mine.length,
      lastPaidAt: last?.occurred_at ?? null,
      lastAmountCents: lastSettled ? -lastSettled.amount_cents : null,
      prevAmountCents: settled[1] ? -settled[1].amount_cents : null,
    };
  });
}

/**
 * Payees and tags a viewer could link a cost line to, from their recent
 * payments. Ones Up files under a category that fits the line come first,
 * then the most frequent.
 */
export function bankPayees(
  rows: readonly BankTransaction[],
  opts: { category?: CostCategory | null; query?: string; limit?: number } = {},
): BankPayee[] {
  const byMatch = new Map<string, BankPayee>();
  const query = squash(opts.query ?? '');
  const sorted = uniqueByExternal(rows.slice().sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)));
  for (const r of sorted) {
    if (!isLinkablePayment(r) || r.hidden) continue;
    const suggested = !!opts.category && !!r.category && UP_COST_CATEGORY[r.category] === opts.category;
    const keys: { match: string; label: string }[] = [{ match: r.description, label: r.description }];
    for (const tag of r.tags ?? []) keys.push({ match: `#${tag}`, label: `Tag: ${tag}` });
    for (const k of keys) {
      if (query && !squash(k.label).includes(query) && !squash(k.match).includes(query)) continue;
      const id = k.match.toUpperCase();
      const seen = byMatch.get(id);
      if (seen) {
        seen.count += 1;
        seen.suggested ||= suggested;
      } else {
        byMatch.set(id, {
          match: k.match,
          label: k.label,
          count: 1,
          lastAmountCents: -r.amount_cents,
          lastPaidAt: r.occurred_at,
          categoryLabel: k.match.startsWith('#') ? null : upCategoryLabel(r.category),
          suggested,
        });
      }
    }
  }
  return Array.from(byMatch.values())
    .sort((a, b) => Number(b.suggested) - Number(a.suggested) || b.count - a.count || b.lastPaidAt.localeCompare(a.lastPaidAt))
    .slice(0, opts.limit ?? 30);
}

export interface CostBankNudge {
  item: CostItem;
  paidCents: number;
  paidAt: string;
}

/**
 * Recurring cost lines whose latest linked payment differs from the line's
 * amount. Lines that keep their amount in step are left out: the server
 * already moved them.
 */
export function bankNudges(items: readonly CostItem[], links: readonly CostBankLink[]): CostBankNudge[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: CostBankNudge[] = [];
  for (const link of links) {
    const item = byId.get(link.costItemId);
    if (!item || item.cadence === 'one_off' || link.keepAmount) continue;
    if (link.lastAmountCents == null || !link.lastPaidAt) continue;
    if (link.lastAmountCents === (item.amount ?? 0)) continue;
    out.push({ item, paidCents: link.lastAmountCents, paidAt: link.lastPaidAt });
  }
  return out;
}


/** One transaction in the Money view. */
export interface BankTransactionView extends SpendingTransaction {
  accountName: string | null;
  message: string | null;
  tags: string[];
  note: string | null;
  hidden: boolean;
  costItemId: string | null;
  /** 'manual' when picked by hand, 'rule' when a link rule filed it. */
  linkKind: 'rule' | 'manual' | null;
  isTransfer: boolean;
  /** The viewer connected the account it came from, so they may change it. */
  mine: boolean;
}

export interface BankTransactionPage {
  transactions: BankTransactionView[];
  /** Pass as `before` for the next, older page; null at the end. */
  next: string | null;
}

/** What a person may change on one of their own transactions. */
export interface BankTransactionPatch {
  hidden?: boolean;
  note?: string | null;
  /** A cost line picked by hand, or null to leave it to the link rules. */
  costItemId?: string | null;
}

/** Maps a stored row to what the Money view shows. */
export function bankTransactionView(r: BankTransaction, viewerId: string): BankTransactionView {
  return {
    ...toSpendingTransaction(r),
    accountName: r.account_name,
    message: r.message,
    tags: r.tags ?? [],
    note: r.note ?? null,
    hidden: !!r.hidden,
    costItemId: r.cost_item_id ?? null,
    linkKind: r.link_kind ?? null,
    isTransfer: r.is_transfer,
    mine: r.user_id === viewerId,
  };
}

/** A day heading for the Money list: Today, Yesterday, or "3 Oct". */
export function bankDayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const label = d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  return d.getFullYear() === now.getFullYear() ? label : `${label} ${d.getFullYear()}`;
}

/** Groups a newest-first list by day, keeping the order. */
export function groupByDay<T extends { occurredAt: string }>(rows: readonly T[], now: Date = new Date()): { label: string; rows: T[] }[] {
  const groups: { label: string; rows: T[] }[] = [];
  for (const r of rows) {
    const label = bankDayLabel(r.occurredAt, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(r);
    else groups.push({ label, rows: [r] });
  }
  return groups;
}


/** One source of money into the joint accounts in a month. */
export interface MoneyInSource {
  label: string;
  cents: number;
  count: number;
}

/**
 * Money that came into the joint accounts, transfers included (a partner's
 * pay landing in the joint account is a transfer), by who or what sent it,
 * biggest first. Hidden rows stay out.
 */
export function moneyIn(
  rows: readonly Pick<BankTransactionView, 'description' | 'amountCents' | 'accountName' | 'hidden'>[],
  jointAccountNames: readonly string[],
): { totalCents: number; sources: MoneyInSource[] } {
  const joint = new Set(jointAccountNames);
  const by = new Map<string, MoneyInSource>();
  let totalCents = 0;
  for (const r of rows) {
    if (r.amountCents <= 0 || r.hidden || !r.accountName || !joint.has(r.accountName)) continue;
    const label = r.description.trim() || 'Unnamed';
    const key = label.toUpperCase();
    const entry = by.get(key) ?? { label, cents: 0, count: 0 };
    entry.cents += r.amountCents;
    entry.count += 1;
    by.set(key, entry);
    totalCents += r.amountCents;
  }
  return { totalCents, sources: [...by.values()].sort((a, b) => b.cents - a.cents) };
}

/**
 * The Money view's search and category filter. The query matches the payee,
 * message, note, category or an Up tag ("#rent" or "rent"), ignoring case.
 */
export function filterBankTransactions<T extends BankTransactionView>(
  rows: readonly T[],
  opts: { query?: string; category?: string | null },
): T[] {
  const q = (opts.query ?? '').trim().toLowerCase().replace(/^#/, '');
  return rows.filter((r) => {
    // Category ids are the spending summary's: Up's, or 'uncategorised'.
    if (opts.category && (r.category ?? 'uncategorised') !== opts.category) return false;
    if (!q) return true;
    const hay = [r.description, r.message, r.note, r.categoryLabel, ...r.tags].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });
}

// ── Making a cost line from a payment ────────────────────────────────────

/**
 * How often a payee is paid, from the times of its payments: weekly,
 * fortnightly, monthly, quarterly or yearly when the gaps between them sit
 * near one of those, else a one-off.
 */
export function guessCadence(times: readonly string[]): CostCadence {
  const sorted = times.map((t) => Date.parse(t)).filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length < 2) return 'one_off';
  const gaps = sorted.slice(1).map((t, i) => (t - sorted[i]) / 86_400_000);
  const median = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  const near = (days: number, slack: number) => Math.abs(median - days) <= slack;
  if (near(7, 1.5)) return 'weekly';
  if (near(14, 2)) return 'fortnightly';
  if (near(30.4, 4)) return 'monthly';
  if (near(91, 10)) return 'quarterly';
  if (near(365, 20)) return 'yearly';
  return 'one_off';
}

/** Everyday Up categories that fit a cost line's, beyond the bills in UP_COST_CATEGORY. */
const UP_EVERYDAY_CATEGORY: Readonly<Record<string, CostCategory>> = {
  'restaurants-and-cafes': 'outing',
  takeaway: 'outing',
  'pubs-and-bars': 'outing',
  booze: 'outing',
  'events-and-gigs': 'outing',
  'holidays-and-travel': 'outing',
  'clothing-and-accessories': 'purchase',
  'homeware-and-appliances': 'purchase',
  technology: 'purchase',
  'home-maintenance-and-improvements': 'purchase',
  'gifts-and-charity': 'purchase',
  hobbies: 'purchase',
  fuel: 'transport',
  'public-transport': 'transport',
  'taxis-and-share-cars': 'transport',
  parking: 'transport',
  'toll-roads': 'transport',
  'car-repayments': 'transport',
  cycling: 'transport',
  'health-and-medical': 'health',
  'fitness-and-wellbeing': 'health',
  'hair-and-beauty': 'health',
  pets: 'pets',
  family: 'family',
  'education-and-student-loans': 'family',
};

/** A cost line's category from Up's, Other when nothing fits (or Up has none). */
export function costCategoryFromUp(upCategory: string | null | undefined): CostCategory {
  if (!upCategory) return 'other';
  return UP_COST_CATEGORY[upCategory] ?? UP_EVERYDAY_CATEGORY[upCategory] ?? 'other';
}

/** A vendor's line, from its payments: how often, how much, and whether that's a guess. */
export interface VendorPlan {
  cadence: CostCadence;
  amountCents: number;
  estimate: boolean;
  /** YYYY-MM-DD: the first payment's day for a regular line, the latest payment's for a one-off (it lands in that month). */
  startDate: string;
}

const DAY_MS = 86_400_000;

/** Days between payments for each cadence a vendor line can keep, with the slack each gap may take. */
const REGULAR_GAPS: readonly { cadence: Exclude<CostCadence, 'one_off'>; days: number; slack: number; min: number }[] = [
  { cadence: 'weekly', days: 7, slack: 1.5, min: 3 },
  { cadence: 'fortnightly', days: 14, slack: 2, min: 3 },
  { cadence: 'monthly', days: 30.4, slack: 4, min: 2 },
  { cadence: 'quarterly', days: 91, slack: 10, min: 2 },
  { cadence: 'yearly', days: 365, slack: 20, min: 2 },
];

/**
 * The cadence of payments that come out on a schedule: every gap fits one
 * cadence, the amounts stay within 15% (or $3) of their middle value, and
 * the latest payment isn't overdue by more than half a cycle. Weekly and
 * fortnightly need three payments, so two dinners a week apart don't make
 * a weekly line. Null when the payments aren't that regular.
 */
function regularCadence(out: readonly { amount_cents: number; occurred_at: string }[], now: Date): Exclude<CostCadence, 'one_off'> | null {
  const times = out.map((p) => Date.parse(p.occurred_at)).sort((a, b) => a - b);
  const gaps = times.slice(1).map((t, i) => (t - times[i]) / DAY_MS);
  const amounts = out.map((p) => Math.abs(p.amount_cents)).sort((a, b) => a - b);
  const middle = amounts[Math.floor(amounts.length / 2)];
  if (amounts.some((a) => Math.abs(a - middle) > Math.max(middle * 0.15, 300))) return null;
  const sinceLast = (now.getTime() - times[times.length - 1]) / DAY_MS;
  for (const g of REGULAR_GAPS) {
    if (out.length < g.min) continue;
    if (gaps.every((gap) => Math.abs(gap - g.days) <= g.slack) && sinceLast <= g.days * 1.5 + g.slack) return g.cadence;
  }
  return null;
}

/**
 * The plan for a vendor's cost line from its real payments (any order).
 * Payments that come out on a schedule at about the same amount
 * (regularCadence) keep that cadence: the latest amount, or the average of
 * the latest three when amounts vary a little. Anything else (one payment, a
 * shop, a cafe, a few purchases) is a one-off at the latest payment: the
 * bank's payments show what it really took each month, and nothing is
 * planned ahead for it.
 */
export function vendorPlan(payments: readonly { amount_cents: number; occurred_at: string }[], now: Date = new Date()): VendorPlan | null {
  const out = payments
    .filter((p) => p.amount_cents < 0)
    .slice()
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  if (!out.length) return null;
  const amounts = out.map((p) => p.amount_cents);
  const cadence = out.length > 1 ? regularCadence(out, now) : null;
  if (cadence) {
    const estimate = bankAmountsVary(amounts);
    return { cadence, amountCents: bankLineAmount(amounts, estimate) ?? 0, estimate, startDate: localDay(out[out.length - 1].occurred_at) };
  }
  return { cadence: 'one_off', amountCents: Math.abs(amounts[0]), estimate: false, startDate: localDay(out[0].occurred_at) };
}

function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface MakeCostInput {
  /** The line's name; the payee's when left out. */
  name?: string;
  /** Also link the payee's future payments to the new line. */
  linkPayee?: boolean;
}

/** What "Make it a cost" would create, for the sheet to show before saving. */
export interface MakeCostPreview {
  name: string;
  amountCents: number;
  category: CostCategory;
  cadence: CostCadence;
  /** Payments to the same payee the viewer can see in the last year. */
  seen: number;
  /** The amounts vary (a bill like electricity), so the line is an estimate: the average of the latest payments. */
  estimate: boolean;
}

/** How many of the latest payments an estimate line averages. */
export const BANK_AVERAGE_OF = 3;

/**
 * Whether a payee's amounts vary enough to make its line an estimate: one of
 * the latest payments sits more than 5% from their average.
 */
export function bankAmountsVary(amountsCents: readonly number[]): boolean {
  const recent = amountsCents.slice(0, BANK_AVERAGE_OF).map((a) => Math.abs(a));
  if (recent.length < 2) return false;
  const mean = recent.reduce((s, a) => s + a, 0) / recent.length;
  return recent.some((a) => Math.abs(a - mean) > mean * 0.05);
}

/**
 * The amount a linked cost line carries, from its payments newest first: the
 * latest for a fixed line, and for an estimate (a bill that changes, like
 * electricity) the rolling average of the latest three, or of the one or two
 * there are.
 */
export function bankLineAmount(amountsCents: readonly number[], estimate: boolean): number | null {
  const recent = amountsCents.slice(0, estimate ? BANK_AVERAGE_OF : 1).map((a) => Math.abs(a));
  if (!recent.length) return null;
  return Math.round(recent.reduce((s, a) => s + a, 0) / recent.length);
}

// ── Client ───────────────────────────────────────────────────────────────

export type UpBankCall = <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>;

/** One client for /api/up-bank; each app passes its own `call` (as createAssistantApi). */
export function createUpBankApi(call: UpBankCall) {
  return {
    status: () => call<UpBankStatus>('/api/up-bank'),
    save: (input: UpBankSaveInput) => call<UpBankStatus>('/api/up-bank', { method: 'PUT', body: input }),
    sync: () => call<UpBankSyncResult>('/api/up-bank', { method: 'POST' }),
    disconnect: () => call<{ ok: true }>('/api/up-bank', { method: 'DELETE' }),
    /** The month runs in the device's local time, so its edges travel as instants. */
    spending: (month: string) => {
      const range = monthRange(month);
      if (!range) return Promise.reject(new Error('Not a month.'));
      const q = new URLSearchParams({ month, from: range.from.toISOString(), to: range.to.toISOString() });
      return call<UpSpending>(`/api/up-bank/spending?${q.toString()}`);
    },
    /** Spending plus balances and cost-line links (servers with 'connectors.up-bank-links'). */
    overview: (month: string, scope?: Exclude<BankScope, 'all'>) => {
      const range = monthRange(month);
      if (!range) return Promise.reject(new Error('Not a month.'));
      const q = new URLSearchParams({
        month,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        tz: String(new Date().getTimezoneOffset()),
      });
      if (scope) q.set('scope', scope);
      return call<UpOverview>(`/api/up-bank/overview?${q.toString()}`);
    },
    payees: (input: { category?: CostCategory | null; query?: string }) => {
      const q = new URLSearchParams();
      if (input.category) q.set('category', input.category);
      if (input.query) q.set('q', input.query);
      return call<BankPayee[]>(`/api/up-bank/payees?${q.toString()}`);
    },
    costLink: (costItemId: string) => call<CostBankDetail>(`/api/up-bank/links/${encodeURIComponent(costItemId)}`),
    setCostLink: (costItemId: string, rule: BankLinkRule) =>
      call<CostBankDetail>(`/api/up-bank/links/${encodeURIComponent(costItemId)}`, { method: 'PUT', body: rule }),
    transactions: (
      input: { before?: string | null; hidden?: boolean; scope?: Exclude<BankScope, 'all'>; month?: string } = {},
    ) => {
      const q = new URLSearchParams();
      if (input.scope) q.set('scope', input.scope);
      const range = input.month ? monthRange(input.month) : null;
      if (range) {
        q.set('from', range.from.toISOString());
        q.set('to', range.to.toISOString());
      }
      if (input.before) q.set('before', input.before);
      if (input.hidden) q.set('hidden', '1');
      return call<BankTransactionPage>(`/api/up-bank/transactions?${q.toString()}`);
    },
    costPreview: (id: string) => call<MakeCostPreview>(`/api/up-bank/transactions/${encodeURIComponent(id)}/cost`),
    makeCost: (id: string, input: MakeCostInput) =>
      call<{ costItemId: string; transaction: BankTransactionView }>(`/api/up-bank/transactions/${encodeURIComponent(id)}/cost`, {
        method: 'POST',
        body: input,
      }),
    updateTransaction: (id: string, patch: BankTransactionPatch) =>
      call<BankTransactionView>(`/api/up-bank/transactions/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
    removeCostLink: (costItemId: string) =>
      call<CostBankDetail>(`/api/up-bank/links/${encodeURIComponent(costItemId)}`, { method: 'DELETE' }),
    /** Folds a cost line into another: payees, payments and all. */
    mergeCostLine: (costItemId: string, into: string) =>
      call<{ into: string }>(`/api/up-bank/links/${encodeURIComponent(costItemId)}/merge`, { method: 'POST', body: { into } }),
  };
}

export type UpBankApi = ReturnType<typeof createUpBankApi>;
