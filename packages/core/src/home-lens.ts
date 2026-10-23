// Hearth v2: Home is one dashboard. Its Spaces include Budget and Bills
// cards, and tapping a Budget, Bills or Groceries shortcut filters Home down
// to that Space (expanded) instead of opening the full page; tapping it again
// brings the whole dashboard back. These are the Spaces' pure derivations, so
// web and native show the same numbers.
import type { CostCategory, CostItem } from './types';
import {
  CATEGORY_META,
  daysBetweenDates,
  isOneOff,
  monthlyAmount,
  nextOccurrence,
  parseLocalDateOnly,
  totalForPeriod,
} from './modules/costs/costs';
import { isBill, type MonthTotals } from './modules/costs/money-insights';

/** The shortcuts that open a lens. Setup and countdown keep their plain behaviour. Shopper's (HOUP-434) shows its watched items. */
export type HomeLensKey = 'budgetPulse' | 'billsDue' | 'shoppingList' | 'shopperWatch';

/** The section each shortcut filters Home to: its glow hue and full page. */
export const HOME_LENS_META: Record<HomeLensKey, { sectionId: string; href: string }> = {
  budgetPulse: { sectionId: 'costs', href: '/costs' },
  billsDue: { sectionId: 'costs', href: '/costs' },
  shoppingList: { sectionId: 'groceries', href: '/groceries' },
  shopperWatch: { sectionId: 'shopper', href: '/shopper' },
};

/** Rows and bars a Space shows on the dashboard; filtered to it, it shows them all. */
export const SPACE_COLLAPSED_ROWS = 3;

export function isHomeLensKey(key: string): key is HomeLensKey {
  return key in HOME_LENS_META;
}

function midnight(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// ── Budget ────────────────────────────────────────────────────────────────

/** How many categories get their own bar before the rest fold into Other. */
export const BUDGET_LENS_MAX_CATEGORIES = 5;

/** How far ahead an ending discount is worth a warning. */
export const LENS_WINDOW_DAYS = 30;

export interface BudgetLensCategory {
  /** A cost category, or 'rest' for the folded remainder. */
  key: CostCategory | 'rest';
  label: string;
  cents: number;
  /** Share of the month's recurring spend, 0..1. */
  share: number;
}

export interface EndingDiscount {
  id: string;
  label: string;
  days: number;
}

export interface BudgetLens {
  budgetCents: number | null;
  /** Where the month ends with the bank's data, else recurring spend per month (the shortcut's own figure). */
  spentCents: number;
  /** Paid so far this month, from the bank; null without it. */
  paidCents: number | null;
  /** Budget minus spend; negative when over. Null with no budget. */
  leftCents: number | null;
  /** Spend as a share of the budget, rounded percent. Null with no budget. */
  committedPct: number | null;
  categories: BudgetLensCategory[];
  /** Discounts ending in the next LENS_WINDOW_DAYS, soonest first. */
  endingDiscounts: EndingDiscount[];
}

export function endingDiscounts(items: CostItem[], now: Date, windowDays = LENS_WINDOW_DAYS): EndingDiscount[] {
  const from = midnight(now);
  const out: EndingDiscount[] = [];
  for (const item of items) {
    if (!item.discount_end_date) continue;
    const days = daysBetweenDates(from, parseLocalDateOnly(item.discount_end_date));
    if (days >= 0 && days <= windowDays) out.push({ id: item.id, label: item.provider || item.name, days });
  }
  return out.sort((a, b) => a.days - b.days);
}

export function buildBudgetLens(items: CostItem[], budgetCents: number | null, now: Date, month?: MonthTotals | null): BudgetLens {
  const recurring = items.filter((c) => !isOneOff(c));
  // With the bank's month the figure is where the month ends; without, the regular plan.
  const spentCents = month ? month.totalCents : Math.round(totalForPeriod(recurring, 'monthly'));
  const byCategory = new Map<CostCategory, number>();
  if (month) {
    for (const [category, cents] of Object.entries(month.byCategory)) byCategory.set(category as CostCategory, cents ?? 0);
  } else {
    for (const item of recurring) {
      byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + monthlyAmount(item));
    }
  }
  const ranked = [...byCategory.entries()].filter(([, cents]) => cents > 0).sort((a, b) => b[1] - a[1]);
  const share = (cents: number) => (spentCents > 0 ? cents / spentCents : 0);
  const categories: BudgetLensCategory[] = [];
  // Room for every category, or the top ones plus one folded "Other" bar.
  const ownBars = ranked.length <= BUDGET_LENS_MAX_CATEGORIES ? ranked.length : BUDGET_LENS_MAX_CATEGORIES - 1;
  for (const [category, cents] of ranked.slice(0, ownBars)) {
    categories.push({ key: category, label: CATEGORY_META[category].label, cents: Math.round(cents), share: share(cents) });
  }
  const restCents = ranked.slice(ownBars).reduce((sum, [, cents]) => sum + cents, 0);
  if (restCents > 0) categories.push({ key: 'rest', label: 'Everything else', cents: Math.round(restCents), share: share(restCents) });
  return {
    budgetCents,
    spentCents,
    paidCents: month ? month.paidCents : null,
    leftCents: budgetCents != null ? budgetCents - spentCents : null,
    committedPct: budgetCents != null && budgetCents > 0 ? Math.round((spentCents / budgetCents) * 100) : null,
    categories,
    endingDiscounts: endingDiscounts(items, now),
  };
}

// ── Bills ─────────────────────────────────────────────────────────────────

export interface BillsLensRow {
  key: string;
  costId: string;
  name: string;
  provider: string | null;
  days: number;
  /** The bill's own amount; null on a discount-ending row. */
  cents: number | null;
  discountEnding: boolean;
}

export interface BillsLens {
  rows: BillsLensRow[];
  /** Sum of the bills due in the window (discount rows add nothing). */
  totalCents: number;
  /** How many bills fall due in the window. */
  dueCount: number;
}

export function buildBillsLens(items: CostItem[], now: Date, windowDays = LENS_WINDOW_DAYS): BillsLens {
  const from = midnight(now);
  const rows: BillsLensRow[] = [];
  for (const item of items) {
    // Groceries and other spending estimates recur but have no due date.
    if (!isOneOff(item) && !isBill(item)) continue;
    const provider = item.provider && item.provider !== item.name ? item.provider : null;
    const occurrence = nextOccurrence(item, from);
    if (occurrence) {
      const days = daysBetweenDates(from, occurrence);
      if (days <= windowDays) {
        rows.push({ key: `${item.id}-due`, costId: item.id, name: item.name, provider, days, cents: item.amount, discountEnding: false });
      }
    }
  }
  for (const d of endingDiscounts(items, now, windowDays)) {
    const item = items.find((c) => c.id === d.id)!;
    rows.push({
      key: `${item.id}-discount`,
      costId: item.id,
      name: item.name,
      provider: item.provider && item.provider !== item.name ? item.provider : null,
      days: d.days,
      cents: null,
      discountEnding: true,
    });
  }
  rows.sort((a, b) => a.days - b.days || a.name.localeCompare(b.name));
  const due = rows.filter((r) => !r.discountEnding);
  return { rows, totalCents: due.reduce((sum, r) => sum + (r.cents ?? 0), 0), dueCount: due.length };
}
