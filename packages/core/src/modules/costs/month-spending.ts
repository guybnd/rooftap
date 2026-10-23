// Payment helpers for the Costs and Money views: a payment's category, its
// label and which way it went, plus a cost line's dates inside a month. The
// month itself (totals, ghosts, lines) comes from cost-month.ts costMonth.
// Platform-agnostic: both apps' Costs screens read these.

import { CATEGORY_META, isOneOff, nextOccurrence, parseLocalDateOnly } from './costs';
import { costCategoryFromUp, type SpendingTransaction } from './up-bank';
import type { CostCategory, CostItem } from '../../types';

/**
 * A payment's category: its cost line's, else the closest fit to Up's own
 * category, else null (nothing to go on, so the person picks one).
 */
export function paymentCategory(
  t: Pick<SpendingTransaction, 'category' | 'costItemId'>,
  itemById: ReadonlyMap<string, Pick<CostItem, 'category'>>,
): CostCategory | null {
  const line = t.costItemId ? itemById.get(t.costItemId) : undefined;
  if (line) return line.category;
  return t.category ? costCategoryFromUp(t.category) : null;
}

/** A spending payment's category label, or null for money in and transfers. */
export function paymentCategoryLabel(
  t: Pick<SpendingTransaction, 'amountCents' | 'category' | 'costItemId'> & { isTransfer?: boolean },
  itemById: ReadonlyMap<string, Pick<CostItem, 'category'>>,
): string | null {
  if (t.isTransfer || t.amountCents > 0) return null;
  const c = paymentCategory(t, itemById);
  return c ? CATEGORY_META[c]?.label ?? null : null;
}

/** Which way a payment went, for the Money view's filter. */
export type PaymentDirection = 'all' | 'out' | 'in';

export function paymentGoes(t: { amountCents: number }, direction: PaymentDirection): boolean {
  if (direction === 'out') return t.amountCents < 0;
  if (direction === 'in') return t.amountCents > 0;
  return true;
}

const DAY_MS = 86_400_000;

/** A line's dates inside [start, end]: each occurrence, or one undated entry for a recurring line with no start date. */
export function occurrencesIn(item: CostItem, start: Date, end: Date): (Date | null)[] {
  if (isOneOff(item)) {
    if (!item.start_date) return [];
    const d = parseLocalDateOnly(item.start_date);
    return d >= start && d <= end ? [d] : [];
  }
  if (!item.start_date) return [null];
  const out: Date[] = [];
  let from = start;
  for (let n = 0; n < 6; n++) {
    const d = nextOccurrence(item, from);
    if (!d || d > end) break;
    out.push(d);
    from = new Date(d.getTime() + DAY_MS);
  }
  return out;
}
