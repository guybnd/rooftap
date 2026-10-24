// Money insights (the "Worth a look" card on Costs, Oct 23): things in the
// household's costs worth a look, worked out from the same months costMonth
// gives the page, so the card can't disagree with the figures under it.
// Everything here works from costs added by hand; a bank connector adds what
// only payments can tell (a bill that hasn't come out, the joint account
// running short, a new repeat payment), read from moneyNudges.
//
// Four groups, in the order the sheet shows them:
// - heads-up: a price went up, a category running ahead of its usual pace,
//   and the bank-only nudges.
// - save: a plan or discount ending soon, and a category's yearly cost at its
//   current pace.
// - reconsider: the subscriptions, with streaming or music services that
//   overlap.
// - going-well: a price that went down, a category under its usual, the
//   month finishing under the goal.
//
// Each person can hide an insight, and decide each subscription: keep it or
// cancel it (user_settings.money_insight_marks). A decided one leaves the
// list until the person's "ask again" time (3 months unless they pick
// another in the Costs menu). A key carries what the insight says, so a
// hidden one comes back when that changes (a new price, a new month).

import { CADENCE_LABEL, monthlyAmount, parseLocalDateOnly } from '../costs/costs';
import { formatMoney } from '../../money-format';
import { costCategoryLabel, costPriceOn, type CostMonth, type CostMonthLine } from '../costs/cost-month';
import { moneyNudgeCopy, relativeDay, type MoneyNudge } from '../costs/money-insights';
import type { CostCadence, CostCategory, CostItem } from '../../types';

const DAY_MS = 86_400_000;

export type CostInsightGroup = 'heads-up' | 'save' | 'reconsider' | 'going-well';

export const COST_INSIGHT_GROUPS: { id: CostInsightGroup; label: string }[] = [
  { id: 'heads-up', label: 'Heads up' },
  { id: 'save', label: 'Save' },
  { id: 'reconsider', label: 'Reconsider' },
  { id: 'going-well', label: 'Going well' },
];

/** What a person can do with an insight, besides hiding it. */
export type CostInsightAction =
  /** Open the cost line. */
  | 'open-item'
  /** Open the category on the page. */
  | 'open-category'
  /** Look for a cheaper plan with Scout. */
  | 'compare'
  /** Open the subscription list. */
  | 'review';

export interface CostInsight {
  /** Stable while the insight says the same thing; hiding stores it. */
  key: string;
  group: CostInsightGroup;
  kind:
    | MoneyNudge['kind']
    | 'price-down'
    | 'subscriptions'
    | 'overlap'
    | 'ending'
    | 'yearly'
    | 'under'
    | 'goal';
  title: string;
  detail: string;
  figure?: { text: string; tone: 'warning' | 'success' | 'muted' };
  action?: CostInsightAction;
  item?: CostItem;
  category?: CostCategory | null;
  /** For 'compare': what Scout looks for and the price to beat (whole units). */
  compare?: { text: string; upTo: string };
}

export interface SubscriptionLine {
  /** `sub:<cost line id or shop>`; keeping it stores `keep:<key>`. */
  key: string;
  name: string;
  item?: CostItem;
  monthlyCents: number;
  /** Kept, and not yet due to be asked again: left out of the counts and overlaps. */
  kept: boolean;
  /** Marked to cancel, and not yet due to be asked again; also left out. */
  cancelling: boolean;
  /** When a kept or cancelling one comes back to decide (ISO), else null. */
  askAgainAt: string | null;
  /** "Streaming" or "Music" when another subscription of the same kind is on. */
  overlap: string | null;
  /** The price before the latest change, when it changed in the last 6 weeks. */
  wasCents: number | null;
}

/**
 * Insight key -> when the person marked it (ISO). `keep:<sub key>` keeps a
 * subscription, `cancel:<sub key>` marks it to cancel. One setting rides
 * along: ASK_AGAIN_MARK holds the months before a decided one comes back.
 */
export type CostInsightMarks = Record<string, string>;

/** The marks key that holds how many months a decided subscription stays decided. */
export const ASK_AGAIN_MARK = 'set:ask-again';
/** The choices for it, in months. */
export const ASK_AGAIN_CHOICES = [1, 3, 6, 12] as const;
export const DEFAULT_ASK_AGAIN_MONTHS = 3;

/** How many months a decided subscription stays decided. */
export function askAgainMonths(marks: CostInsightMarks | null | undefined): number {
  const n = Number(marks?.[ASK_AGAIN_MARK]);
  return (ASK_AGAIN_CHOICES as readonly number[]).includes(n) ? n : DEFAULT_ASK_AGAIN_MONTHS;
}

/** The marks with a new ask-again time. */
export function withAskAgain(marks: CostInsightMarks | null | undefined, months: number): CostInsightMarks {
  return { ...(marks ?? {}), [ASK_AGAIN_MARK]: String(months) };
}

/** "3 months", "1 year". */
export function askAgainLabel(months: number): string {
  if (months === 12) return '1 year';
  return `${months} month${months === 1 ? '' : 's'}`;
}

/** Keep or cancel a subscription; the same choice again clears it. */
export function withSubscriptionDecision(
  marks: CostInsightMarks | null | undefined,
  sub: Pick<SubscriptionLine, 'key'>,
  decision: 'keep' | 'cancel',
  now: Date = new Date(),
): CostInsightMarks {
  const mine = `${decision}:${sub.key}`;
  const other = `${decision === 'keep' ? 'cancel' : 'keep'}:${sub.key}`;
  const had = !!marks?.[mine];
  const next = withoutInsightMark(marks, other);
  return had ? withoutInsightMark(next, mine) : withInsightMark(next, mine, now);
}

export interface CostInsightsInput {
  /** Live cost lines (not deleted). */
  items: readonly CostItem[];
  /** costMonth results, oldest first, ending with the current month. At least the current one. */
  months: readonly CostMonth[];
  /** Nudges only a bank can give (moneyNudges), already worked out. Empty without one. */
  nudges?: readonly MoneyNudge[];
  goalCents?: number | null;
  marks?: CostInsightMarks;
  now?: Date;
}

export interface CostInsights {
  /** Every insight not hidden, most pressing first. */
  insights: CostInsight[];
  /** The subscriptions, biggest first. */
  subscriptions: SubscriptionLine[];
}

const BILLS: ReadonlySet<CostCategory> = new Set(['rent', 'utilities', 'internet', 'insurance', 'subscription', 'income']);
/** Categories whose yearly cost is worth showing: spending people choose. */
const CHOSEN: ReadonlySet<CostCategory> = new Set(['outing', 'purchase', 'transport', 'family', 'pets']);

const OVERLAPS: { label: string; re: RegExp }[] = [
  { label: 'Streaming', re: /netflix|\bstan\b|disney|binge|prime video|amazon prime|paramount|apple tv|\bkayo\b|foxtel|\bhayu\b|britbox|youtube premium|\bhbo\b|\bmax\b/i },
  { label: 'Music', re: /spotify|apple music|youtube music|\btidal\b|deezer/i },
];

const YEARLY: Record<CostCadence, number> = { weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4, yearly: 1, one_off: 0 };

/** Works out the insights. See the file comment. */
export function costInsights(input: CostInsightsInput): CostInsights {
  const now = input.now ?? new Date();
  const marks = input.marks ?? {};
  const current = input.months[input.months.length - 1];
  const past = input.months.slice(0, -1).filter((m) => m.when === 'past');
  const out: (CostInsight & { rank: number })[] = [];
  const push = (rank: number, i: CostInsight) => out.push({ ...i, rank });
  const priced = new Set<string>();

  // ── Bank-only nudges ─────────────────────────────────────────────────────
  const NUDGE_RANK: Partial<Record<MoneyNudge['kind'], number>> = { short: 0, missing: 1, differs: 4, new: 5 };
  for (const n of input.nudges ?? []) {
    if (n.kind === 'ahead') continue; // worked out below from every source
    const copy = moneyNudgeCopy(n, now);
    const item = 'item' in n ? n.item : undefined;
    if (n.kind === 'price') {
      priced.add(n.item.id);
      const up = n.toCents > n.fromCents;
      push(up ? 2 : 40, { key: `price:${n.item.id}:${n.toCents}`, group: up ? 'heads-up' : 'going-well', kind: up ? 'price' : 'price-down', ...copy, action: 'open-item', item });
      continue;
    }
    if (item && n.kind === 'differs') priced.add(item.id);
    push(NUDGE_RANK[n.kind] ?? 6, {
      key: n.kind === 'short' ? `short:${monthKey(now)}` : n.kind === 'missing' ? `missing:${n.item.id}:${dayKey(n.dueOn)}` : n.key + (n.kind === 'differs' ? `:${n.paidCents}` : ''),
      group: 'heads-up',
      kind: n.kind,
      ...copy,
      action: item ? 'open-item' : undefined,
      item,
    });
  }

  // ── Prices changed by hand ──────────────────────────────────────────────
  for (const item of input.items) {
    if (item.archived || item.cadence === 'one_off' || priced.has(item.id) || !item.price_changes?.length) continue;
    const latest = item.price_changes[item.price_changes.length - 1];
    const from = parseLocalDateOnly(latest.from);
    const ago = (now.getTime() - from.getTime()) / DAY_MS;
    if (ago > 42 || ago < -30) continue;
    const before = costPriceOn(item, new Date(from.getTime() - DAY_MS));
    const diff = latest.amount - before;
    if (!before || Math.abs(diff) < 100) continue;
    priced.add(item.id);
    const up = diff > 0;
    push(up ? 2 : 40, {
      key: `price:${item.id}:${latest.amount}`,
      group: up ? 'heads-up' : 'going-well',
      kind: up ? 'price' : 'price-down',
      title: `${item.name} ${ago < 0 ? 'goes' : 'went'} ${up ? 'up' : 'down'}`,
      detail: `${formatMoney(before)} to ${formatMoney(latest.amount)}${CADENCE_LABEL[item.cadence]}, ${ago < 0 ? 'changes' : 'changed'} ${relativeDay(from, now)}`,
      figure: { text: `${up ? '+' : '-'}${formatMoney(Math.abs(diff) * YEARLY[item.cadence])} a year`, tone: up ? 'warning' : 'success' },
      action: 'open-item',
      item,
    });
  }

  // ── Subscriptions ───────────────────────────────────────────────────────
  const subscriptions = subscriptionLines(input, marks, now);
  for (const s of subscriptions) {
    if (s.wasCents == null || (s.item && priced.has(s.item.id))) continue;
    const diff = s.monthlyCents - s.wasCents;
    const up = diff > 0;
    push(up ? 2 : 40, {
      key: `price:${s.key}:${s.monthlyCents}`,
      group: up ? 'heads-up' : 'going-well',
      kind: up ? 'price' : 'price-down',
      title: `${s.name} went ${up ? 'up' : 'down'}`,
      detail: `${formatMoney(s.wasCents)} to ${formatMoney(s.monthlyCents)} a month`,
      figure: { text: `${up ? '+' : '-'}${formatMoney(Math.abs(diff) * 12)} a year`, tone: up ? 'warning' : 'success' },
      action: s.item ? 'open-item' : 'review',
      item: s.item,
    });
  }
  const open = subscriptions.filter((s) => !s.kept && !s.cancelling);
  for (const { label } of OVERLAPS) {
    const same = open.filter((s) => s.overlap === label);
    if (same.length < 2) continue;
    const monthly = same.reduce((sum, s) => sum + s.monthlyCents, 0);
    push(20, {
      key: `overlap:${label}:${same.map((s) => s.key).sort().join(',')}`,
      group: 'reconsider',
      kind: 'overlap',
      title: `${same.length} ${label.toLowerCase()} services`,
      detail: `${listOf(same.map((s) => s.name))}, ${formatMoney(monthly)} a month`,
      figure: { text: `${formatMoney(monthly * 12)} a year`, tone: 'muted' },
      action: 'review',
    });
  }
  if (open.length) {
    const monthly = open.reduce((sum, s) => sum + s.monthlyCents, 0);
    const all = subscriptions.length;
    push(21, {
      key: `subs:${open.map((s) => s.key).sort().join(',')}`,
      group: 'reconsider',
      kind: 'subscriptions',
      title: `${all} subscription${all === 1 ? '' : 's'}`,
      detail: all === 1 ? `${formatMoney(monthly)} a month, keep or cancel` : `${open.length} of ${all} to decide, ${formatMoney(monthly)} a month`,
      figure: { text: `${formatMoney(monthly * 12)} a year`, tone: 'muted' },
      action: 'review',
    });
  }

  // ── Plans and discounts ending ───────────────────────────────────────────
  for (const item of input.items) {
    if (item.archived) continue;
    for (const [field, what] of [['end_date', 'plan'], ['discount_end_date', 'discount']] as const) {
      const at = item[field];
      if (!at) continue;
      const days = Math.round((parseLocalDateOnly(at).getTime() - startOfDay(now).getTime()) / DAY_MS);
      if (days < -3 || days > 30) continue;
      const price = costPriceOn(item, now);
      push(10, {
        key: `ending:${item.id}:${field}:${at}`,
        group: 'save',
        kind: 'ending',
        title: `${item.name} ${what} ${days < 0 ? 'ended' : 'ends'} ${relativeDay(parseLocalDateOnly(at), now)}`,
        detail: what === 'plan' ? 'Look for a better deal before it rolls over' : 'The price may go up after it',
        figure: price ? { text: `${formatMoney(price)}${CADENCE_LABEL[item.cadence]}`, tone: 'muted' } : undefined,
        action: 'compare',
        item,
        compare: { text: `A cheaper ${(item.provider?.trim() || item.name).slice(0, 80)} plan`, upTo: price ? String(Math.round(price / 100)) : '' },
      });
    }
  }

  // ── Categories against their usual ──────────────────────────────────────
  if (current && current.when === 'current' && past.length >= 2) {
    const daysIn = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const share = Math.min(1, now.getDate() / daysIn);
    const usual = new Map<CostCategory, number>();
    const monthsWith = new Map<CostCategory, number>();
    for (const m of past.slice(-3)) {
      for (const c of m.categories) {
        if (!c.category) continue;
        usual.set(c.category, (usual.get(c.category) ?? 0) + c.paidCents);
        if (c.paidCents > 0) monthsWith.set(c.category, (monthsWith.get(c.category) ?? 0) + 1);
      }
    }
    const months = Math.min(3, past.length);
    const paidNow = new Map(current.categories.map((c) => [c.category, c.paidCents]));
    const under: (CostInsight & { rank: number; saved: number })[] = [];
    for (const [category, total] of usual) {
      if (BILLS.has(category)) continue;
      const full = total / months;
      const byNow = Math.round(full * share);
      const paid = paidNow.get(category) ?? 0;
      const label = costCategoryLabel(category);
      if (share >= 0.2 && byNow > 0 && paid > byNow * 1.2 && paid - byNow >= 5000) {
        push(3, {
          key: `ahead:${category}:${monthKey(now)}`,
          group: 'heads-up',
          kind: 'ahead',
          title: `${label} running ahead`,
          detail: `${formatMoney(paid)} so far, usually ${formatMoney(byNow)} by now`,
          figure: { text: `+${Math.round(((paid - byNow) / byNow) * 100)}%`, tone: 'warning' },
          action: 'open-category',
          category,
        });
      } else if (share >= 0.5 && full >= 10000 && paid < byNow * 0.8 && byNow - paid >= 3000) {
        under.push({
          rank: 41,
          saved: byNow - paid,
          key: `under:${category}:${monthKey(now)}`,
          group: 'going-well',
          kind: 'under',
          title: `${label} down ${Math.round(((byNow - paid) / byNow) * 100)}% on usual`,
          detail: `${formatMoney(paid)} so far, usually ${formatMoney(byNow)} by now`,
          figure: { text: `-${formatMoney(byNow - paid)}`, tone: 'success' },
          action: 'open-category',
          category,
        });
      }
    }
    for (const u of under.sort((a, b) => b.saved - a.saved).slice(0, 2)) {
      const { saved: _saved, ...rest } = u;
      out.push(rest);
    }

    // The chosen category that costs the most over a year at its pace: a
    // steady one, with money in every month, so one big purchase isn't a pace.
    let top: { category: CostCategory; monthly: number } | null = null;
    for (const [category, total] of usual) {
      const monthly = total / months;
      if (CHOSEN.has(category) && monthsWith.get(category) === months && monthly >= 15000 && (!top || monthly > top.monthly)) top = { category, monthly };
    }
    if (top) {
      push(12, {
        key: `yearly:${top.category}:${monthKey(now)}`,
        group: 'save',
        kind: 'yearly',
        title: `${costCategoryLabel(top.category)} costs about ${formatMoney(roundTo(top.monthly * 12, 1000))} a year`,
        detail: `At the pace of the last ${months} months, ${formatMoney(Math.round(top.monthly))} a month`,
        action: 'open-category',
        category: top.category,
      });
    }

    // Finishing under the goal, in the last ten days of the month.
    const goal = input.goalCents ?? 0;
    if (goal > 0 && daysIn - now.getDate() <= 10 && current.expectedCents > 0 && current.expectedCents < goal) {
      push(42, {
        key: `goal:${monthKey(now)}`,
        group: 'going-well',
        kind: 'goal',
        title: `On track to finish under the goal`,
        detail: `${formatMoney(current.expectedCents)} expected of ${formatMoney(goal)}`,
        figure: { text: `-${formatMoney(goal - current.expectedCents)}`, tone: 'success' },
      });
    }
  }

  const insights = out
    .filter((i) => !marks[i.key])
    .sort((a, b) => a.rank - b.rank)
    .map(({ rank: _rank, ...i }) => i);
  return { insights, subscriptions };
}

/** The household's subscriptions from the months, biggest first. */
function subscriptionLines(input: CostInsightsInput, marks: CostInsightMarks, now: Date): SubscriptionLine[] {
  const months = askAgainMonths(marks);
  const recent = input.months.slice(-3);
  const seen = new Map<string, { name: string; item?: CostItem; byMonth: Map<string, CostMonthLine> }>();
  for (const m of recent) {
    const c = m.categories.find((x) => x.category === 'subscription');
    for (const line of c?.lines ?? []) {
      if (line.kind === 'usual' || line.kind === 'target') continue;
      const id = line.item && line.item.cadence !== 'one_off' ? line.item.id : line.vendor ? squash(line.vendor) : line.item?.id ?? line.key;
      const entry = seen.get(id) ?? { name: line.name, item: line.item, byMonth: new Map<string, CostMonthLine>() };
      entry.byMonth.set(m.month, line);
      seen.set(id, entry);
    }
  }
  // Recurring subscriptions added by hand that this window misses (a yearly one).
  for (const item of input.items) {
    if (item.category !== 'subscription' || item.archived || item.cadence === 'one_off' || seen.has(item.id)) continue;
    if (item.end_date && parseLocalDateOnly(item.end_date) < startOfDay(now)) continue;
    seen.set(item.id, { name: item.name, item, byMonth: new Map() });
  }

  const out: SubscriptionLine[] = [];
  for (const [id, entry] of seen) {
    const recurring = entry.item && entry.item.cadence !== 'one_off' ? entry.item : undefined;
    const amounts = recent.map((m) => entry.byMonth.get(m.month)).map((l) => (l ? l.paidCents + l.toComeCents : 0));
    let monthlyCents: number;
    let wasCents: number | null = null;
    if (recurring) {
      monthlyCents = Math.round(monthlyAmount({ amount: costPriceOn(recurring, now), cadence: recurring.cadence }));
    } else {
      // A shop the bank paid: a subscription when it took money in two of the last three months.
      const paid = amounts.filter((a) => a > 0);
      if (paid.length < 2) continue;
      const counts = recent.map((m) => entry.byMonth.get(m.month)?.count ?? 0);
      const last = amounts.length - 1 - [...amounts].reverse().findIndex((a) => a > 0);
      monthlyCents = amounts[last];
      const prev = amounts.slice(0, last).reverse().find((a) => a > 0);
      const single = counts[last] <= 1 && counts.slice(0, last).every((n) => n <= 1);
      if (single && prev && Math.abs(monthlyCents - prev) >= 100 && Math.abs(monthlyCents - prev) >= prev * 0.02) wasCents = prev;
    }
    if (monthlyCents <= 0) continue;
    const key = `sub:${id}`;
    const until = (at: string | undefined) => (at ? addMonths(new Date(at), months) : null);
    const keepUntil = until(marks[`keep:${key}`]);
    const cancelUntil = until(marks[`cancel:${key}`]);
    const kept = !!keepUntil && now < keepUntil;
    const cancelling = !kept && !!cancelUntil && now < cancelUntil;
    out.push({
      key,
      name: entry.name,
      item: entry.item,
      monthlyCents,
      kept,
      cancelling,
      askAgainAt: kept ? keepUntil!.toISOString() : cancelling ? cancelUntil!.toISOString() : null,
      overlap: null,
      wasCents,
    });
  }
  const open = out.filter((s) => !s.kept && !s.cancelling);
  for (const { label, re } of OVERLAPS) {
    const same = open.filter((s) => re.test(s.name));
    if (same.length >= 2) for (const s of same) s.overlap = label;
  }
  return out.sort((a, b) => b.monthlyCents - a.monthlyCents || a.name.localeCompare(b.name));
}

/** The marks with one more, dropping ones older than 13 months. */
export function withInsightMark(marks: CostInsightMarks | null | undefined, key: string, now: Date = new Date()): CostInsightMarks {
  const keepFrom = now.getTime() - 400 * DAY_MS;
  const next: CostInsightMarks = {};
  for (const [k, at] of Object.entries(marks ?? {})) if (k !== key && (k.startsWith('set:') || new Date(at).getTime() >= keepFrom)) next[k] = at;
  next[key] = now.toISOString();
  return next;
}

/** The marks without one (an Undo). */
export function withoutInsightMark(marks: CostInsightMarks | null | undefined, key: string): CostInsightMarks {
  const next = { ...(marks ?? {}) };
  delete next[key];
  return next;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The line under a subscription in the review list: its cost, or what was decided and when it comes back. */
export function subscriptionNote(s: SubscriptionLine): string {
  if ((s.kept || s.cancelling) && s.askAgainAt) {
    const at = new Date(s.askAgainAt);
    return `${s.kept ? 'Kept' : 'To cancel'}, asks again ${MONTHS[at.getMonth()]} ${at.getFullYear()}`;
  }
  return `${formatMoney(s.monthlyCents)} a month${s.overlap ? `, ${s.overlap.toLowerCase()} overlap` : ''}`;
}

function addMonths(d: Date, months: number): Date {
  const out = new Date(d);
  out.setMonth(out.getMonth() + months);
  return out;
}

function listOf(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? '';
}

function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function dayKey(d: Date): string {
  return `${monthKey(d)}-${String(d.getDate()).padStart(2, '0')}`;
}

function roundTo(n: number, step: number): number {
  return Math.round(n / step) * step;
}
