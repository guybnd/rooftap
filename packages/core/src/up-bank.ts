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

export const UP_API_BASE = 'https://api.up.com.au/api/v1';

/** Up personal access tokens start with this. */
const UP_TOKEN_PREFIX = 'up:yeah:';

export interface UpBankConnection {
  last4: string;
  /** The household can see this person's spending. */
  shared: boolean;
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
    amount: { currencyCode: string; valueInBaseUnits: number };
    settledAt: string | null;
    createdAt: string;
  };
  relationships: {
    account: Rel;
    transferAccount?: Rel;
    category?: Rel;
    parentCategory?: Rel;
  };
}

export interface UpAccountResource {
  id: string;
  attributes: { displayName: string };
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
    account_name: accountId ? accountNames.get(accountId) ?? null : null,
    description: a.description.trim() || 'Transaction',
    message: a.message?.trim() || null,
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
    if (r.is_transfer) continue;
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
    .filter((r) => !r.is_transfer)
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
    }));

  return { month, spentCents: spent, receivedCents: received, categories, recent, people: Array.from(people) };
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
  };
}

export type UpBankApi = ReturnType<typeof createUpBankApi>;
