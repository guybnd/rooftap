// CSV bank import (.docs/connectors.md, connector 'csv-bank'): a person
// exports a statement from their bank's website and picks the file in
// Settings > Connectors. The app reads the file on the device with these
// helpers, shows what it found, and sends the payments to /api/bank-import,
// which saves them as bank_transactions with source 'csv'. Banks lay their
// CSVs out differently (a header or none, one amount column or debit and
// credit, day-first or month-first dates), so the columns are worked out from
// the header names when there are any, and from the values when there aren't.

import type { BankShareMode, UpBankCall } from './up-bank';

/** One payment read from a statement. */
export interface CsvTransaction {
  /** YYYY-MM-DD. */
  date: string;
  description: string;
  /** Minor units (cents); money out is negative. */
  amountCents: number;
  /** The account's balance after this payment, when the file has it. */
  balanceCents: number | null;
}

export type CsvDateOrder = 'dmy' | 'mdy' | 'ymd';

/** Which column holds what (0-based), and how to read it. */
export interface CsvMapping {
  /** The first row is a header. */
  header: boolean;
  date: number;
  description: number;
  /** One signed amount column... */
  amount: number | null;
  /** ...or money out and money in in two. */
  debit: number | null;
  credit: number | null;
  balance: number | null;
  dateOrder: CsvDateOrder;
}

export interface CsvReadResult {
  mapping: CsvMapping;
  transactions: CsvTransaction[];
  /** Rows that had no readable date or amount (totals, blank lines). */
  skipped: number;
}

/** The most payments one import may carry. */
export const CSV_IMPORT_MAX_ROWS = 10_000;

/** Splits CSV text into rows of cells: quoted cells, doubled quotes, CRLF, a leading BOM, and ',' ';' or tab between cells. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const delimiter = [',', ';', '\t'].reduce((best, d) => (count(firstLine, d) > count(firstLine, best) ? d : best), ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

function count(text: string, ch: string): number {
  return text.split(ch).length - 1;
}

const DATE_RE = /^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})(?:[ T].*)?$/;

/** A cell's date parts, or null when it isn't a date. */
function dateParts(cell: string): [number, number, number] | null {
  const m = DATE_RE.exec(cell.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** A money cell in cents: "$1,234.50", "-12.00", "(12.00)", "12.00 CR", "12,50" (comma decimal). Null when it isn't money. */
export function parseMoneyCents(cell: string): number | null {
  let s = cell.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (/\sDR$/i.test(s) || /\dDR$/i.test(s)) {
    negative = !negative;
    s = s.slice(0, -2);
  } else if (/\sCR$/i.test(s) || /\dCR$/i.test(s)) s = s.slice(0, -2);
  // A currency code or symbol, and spaces: "AUD 12.00", "-$12.00", "12.00 €".
  s = s.replace(/^[A-Z]{3}(?=[\s\d$€£¥+-])/, '').replace(/([\d\s])[A-Z]{3}$/, '$1').replace(/[$€£¥\s]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  // A comma as the decimal mark: "1.234,50" or "12,50".
  if (/^\d{1,3}(\.\d{3})*,\d{1,2}$/.test(s) || /^\d+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return negative ? -cents : cents;
}

const HEADER_NAMES: Record<'date' | 'description' | 'amount' | 'debit' | 'credit' | 'balance', RegExp> = {
  date: /^(transaction |posted |posting |value |effective )?date$|^date posted$|^when$/i,
  description: /description|narrative|details|payee|merchant|memo|particulars|transaction$|^name$|reference/i,
  amount: /^(transaction )?amount( \(.*\))?$|^value$|^net amount$/i,
  debit: /debit|withdrawal|money out|paid out|^out$/i,
  credit: /credit|deposit|money in|paid in|^in$/i,
  balance: /balance/i,
};

/** Works out which column is which, from the header when there is one and from the values when there isn't. Null when no date, description and amount can be found. */
export function guessCsvMapping(rows: readonly (readonly string[])[]): CsvMapping | null {
  if (!rows.length) return null;
  const width = Math.max(...rows.slice(0, 20).map((r) => r.length));
  const first = rows[0];
  const header = first.every((c) => !dateParts(c)) && first.some((c) => /[a-z]/i.test(c)) && first.filter((c) => parseMoneyCents(c) !== null).length === 0;
  const body = rows.slice(header ? 1 : 0, (header ? 1 : 0) + 200);
  if (!body.length) return null;
  const share = (col: number, test: (c: string) => boolean) => body.filter((r) => test(r[col] ?? '')).length / body.length;

  let date: number | null = null;
  let description: number | null = null;
  let amount: number | null = null;
  let debit: number | null = null;
  let credit: number | null = null;
  let balance: number | null = null;

  if (header) {
    const find = (key: keyof typeof HEADER_NAMES, skip: (number | null)[] = []) => {
      const i = first.findIndex((c, idx) => !skip.includes(idx) && HEADER_NAMES[key].test(c.trim()));
      return i < 0 ? null : i;
    };
    date = find('date');
    if (date === null) date = first.findIndex((c) => /date/i.test(c));
    if (date !== null && date < 0) date = null;
    balance = find('balance');
    amount = find('amount', [balance]);
    if (amount === null) {
      debit = find('debit', [balance]);
      credit = find('credit', [balance, debit]);
    }
    description = find('description', [date, amount, debit, credit, balance]);
  }

  // No header, or a header with names we don't know: read the values.
  const isMoney = (c: string) => c === '' || parseMoneyCents(c) !== null;
  if (date === null) {
    for (let col = 0; col < width && date === null; col++) if (share(col, (c) => !!dateParts(c)) > 0.8) date = col;
  }
  if (amount === null && (debit === null || credit === null)) {
    debit = null;
    credit = null;
    const money: number[] = [];
    for (let col = 0; col < width; col++) {
      if (col === date || col === balance) continue;
      if (share(col, isMoney) > 0.9 && share(col, (c) => c !== '') > 0.3) money.push(col);
    }
    // Two money columns where one is filled on each row: debit and credit, else amount then balance.
    if (money.length >= 2 && body.every((r) => ((r[money[0]] ?? '') === '') !== ((r[money[1]] ?? '') === ''))) {
      debit = money[0];
      credit = money[1];
    } else if (money.length) {
      amount = money[0];
      if (balance === null && money.length >= 2) balance = money[1];
    }
  }
  if (description === null) {
    let best = -1;
    let bestLength = 0;
    for (let col = 0; col < width; col++) {
      if ([date, amount, debit, credit, balance].includes(col)) continue;
      const length = body.reduce((sum, r) => sum + ((r[col] ?? '').match(/[a-z]/gi)?.length ?? 0), 0);
      if (length > bestLength) {
        best = col;
        bestLength = length;
      }
    }
    if (best >= 0) description = best;
  }
  if (date === null || description === null || (amount === null && (debit === null || credit === null))) return null;
  return { header, date, description, amount, debit, credit, balance, dateOrder: guessDateOrder(body.map((r) => r[date!] ?? '')) };
}

/** Day first unless a value proves month first ("12/31/2026"), or year first. */
export function guessDateOrder(cells: readonly string[]): CsvDateOrder {
  let mdy = false;
  for (const c of cells) {
    const p = dateParts(c);
    if (!p) continue;
    if (p[0] > 31) return 'ymd';
    if (p[0] > 12) return 'dmy';
    if (p[1] > 12) mdy = true;
  }
  return mdy ? 'mdy' : 'dmy';
}

/** A date cell as YYYY-MM-DD, or null. */
export function csvDate(cell: string, order: CsvDateOrder): string | null {
  const p = dateParts(cell);
  if (!p) return null;
  let [y, m, d] = order === 'ymd' ? p : order === 'mdy' ? [p[2], p[0], p[1]] : [p[2], p[1], p[0]];
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** The payments in a statement, read with a mapping. Rows with no date or amount are skipped. */
export function csvTransactions(rows: readonly (readonly string[])[], mapping: CsvMapping): CsvReadResult {
  const transactions: CsvTransaction[] = [];
  let skipped = 0;
  for (const r of rows.slice(mapping.header ? 1 : 0)) {
    const date = csvDate(r[mapping.date] ?? '', mapping.dateOrder);
    let amountCents: number | null;
    if (mapping.amount !== null) amountCents = parseMoneyCents(r[mapping.amount] ?? '');
    else {
      const out = parseMoneyCents(r[mapping.debit!] ?? '');
      const inn = parseMoneyCents(r[mapping.credit!] ?? '');
      amountCents = out === null && inn === null ? null : (inn ?? 0) - Math.abs(out ?? 0);
    }
    const description = (r[mapping.description] ?? '').replace(/\s+/g, ' ').trim();
    if (!date || amountCents === null || !description) {
      skipped++;
      continue;
    }
    transactions.push({
      date,
      description: description.slice(0, 500),
      amountCents,
      balanceCents: mapping.balance === null ? null : parseMoneyCents(r[mapping.balance] ?? ''),
    });
  }
  return { mapping, transactions, skipped };
}

/** Reads a statement's text: parse, guess the columns, read the payments. Null when the columns can't be worked out. */
export function readBankCsv(text: string): CsvReadResult | null {
  const rows = parseCsv(text);
  const mapping = guessCsvMapping(rows);
  return mapping ? csvTransactions(rows, mapping) : null;
}

/** Flips every amount's sign, for a bank that shows money out as positive. */
export function flipCsvAmounts(list: readonly CsvTransaction[]): CsvTransaction[] {
  return list.map((t) => ({ ...t, amountCents: -t.amountCents }));
}

/** True when nearly every amount is positive: probably a card statement that lists money out as positive. */
export function csvLooksFlipped(list: readonly CsvTransaction[]): boolean {
  if (list.length < 3) return false;
  return list.filter((t) => t.amountCents > 0).length / list.length > 0.9;
}

/** The first and last date in a list, YYYY-MM-DD. */
export function csvDateSpan(list: readonly CsvTransaction[]): { from: string; to: string } | null {
  if (!list.length) return null;
  let from = list[0].date;
  let to = list[0].date;
  for (const t of list) {
    if (t.date < from) from = t.date;
    if (t.date > to) to = t.date;
  }
  return { from, to };
}

/** A short name for an account from the file's name: "Joint-account_2026.csv" becomes "Joint account 2026". */
export function accountNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (base.charAt(0).toUpperCase() + base.slice(1)).slice(0, 60) || 'Imported account';
}

// ── Ids ──────────────────────────────────────────────────────────────────

/** FNV-1a, 32 bits, as 8 hex digits: platform-agnostic and stable. */
function fnv1a(text: string, seed = 0x811c9dc5): string {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Each payment's id within its account: its date, amount and description,
 * plus how many identical payments came before it in the file. Importing an
 * overlapping statement again finds the same ids, so payments already there
 * are updated instead of added twice.
 */
export function csvTransactionIds(accountId: string, list: readonly CsvTransaction[]): string[] {
  const seen = new Map<string, number>();
  return list.map((t) => {
    const key = `${t.date}|${t.amountCents}|${t.description.toUpperCase().replace(/\s+/g, ' ')}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    const full = `${key}|${n}`;
    return `${accountId}:${fnv1a(full)}${fnv1a(full, 0x01234567)}`;
  });
}

/** An account's id from its name, so importing into the same name adds to the same account. */
export function csvAccountId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `csv-${slug || 'account'}-${fnv1a(name.trim().toLowerCase()).slice(0, 6)}`;
}

// ── API ──────────────────────────────────────────────────────────────────

/** One account a person filled from statements. */
export interface ImportedAccount {
  id: string;
  name: string;
  joint: boolean;
  count: number;
  /** YYYY-MM-DD of the first and last payment, or null when it has none. */
  from: string | null;
  to: string | null;
  updatedAt: string;
}

export interface BankImportStatus {
  accounts: ImportedAccount[];
  /** What this person shares with the household (one choice for every bank connector). */
  shareMode: BankShareMode;
  /** Payments from joint accounts are filed as cost lines. */
  autoCosts: boolean;
  /** Up Bank is connected too, so the sharing choice is also in its panel. */
  upConnected: boolean;
}

export interface BankImportInput {
  accountName: string;
  joint: boolean;
  transactions: CsvTransaction[];
}

export interface BankImportResult {
  status: BankImportStatus;
  added: number;
  /** Payments that were already there from an earlier import. */
  existing: number;
}

export interface BankImportSettings {
  shareMode?: BankShareMode;
  autoCosts?: boolean;
}

/** One client for /api/bank-import; each app passes the same `call` as its Up client. */
export function createBankImportApi(call: UpBankCall) {
  return {
    status: () => call<BankImportStatus>('/api/bank-import'),
    importFile: (input: BankImportInput) => call<BankImportResult>('/api/bank-import', { method: 'POST', body: input }),
    save: (input: BankImportSettings) => call<BankImportStatus>('/api/bank-import', { method: 'PUT', body: input }),
    remove: (accountId: string) =>
      call<BankImportStatus>(`/api/bank-import?account=${encodeURIComponent(accountId)}`, { method: 'DELETE' }),
  };
}

export type BankImportApi = ReturnType<typeof createBankImportApi>;

/** "3 Aug 2026 to 28 Oct 2026" for a statement's span, one date when it is a single day. */
export function csvSpanLabel(span: { from: string | null; to: string | null } | null): string | null {
  if (!span?.from || !span.to) return null;
  const fmt = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return span.from === span.to ? fmt(span.from) : `${fmt(span.from)} to ${fmt(span.to)}`;
}
