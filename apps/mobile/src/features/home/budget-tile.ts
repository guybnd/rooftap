// HOUP-214: single source of truth for the Costs & Budget tile's meter +
// tone chip. Previously `apps/mobile/src/app/(tabs)/home/index.tsx` gated the meter
// and the chip with two separately-typed "budgetCents != null &&
// budgetCents > 0" checks that happened to agree — correct today, but a
// future edit to one without the other would silently desync them. Mirrors
// apps/web's CostsTile (apps/web/src/app/home/section-tiles.tsx) thresholds.
const BUDGET_YELLOW_PCT = 80;
const BUDGET_RED_PCT = 100;

export interface BudgetTile {
  meter?: { value: number; total: number };
  chip?: { text: string; className: string };
  /** HOUP-223: the meter's fill class, derived from the same tone as `chip` — kept alongside it (not on `chip`) so existing `chip` equality checks are unaffected. */
  barClassName?: string;
}

/** Derives the Costs & Budget tile's meter + tone chip from the same inputs — the two can never disagree. */
export function deriveBudgetTile(budgetCents: number | null, monthlyTotalCents: number): BudgetTile {
  const hasBudget = budgetCents != null && budgetCents > 0;
  if (!hasBudget) return {};

  const pct = (monthlyTotalCents / budgetCents) * 100;
  const [chip, barClassName] =
    pct > BUDGET_RED_PCT
      ? [{ text: 'Over budget', className: 'text-destructive' }, 'bg-destructive']
      : pct >= BUDGET_YELLOW_PCT
        ? [{ text: 'Close to budget', className: 'text-warning' }, 'bg-warning']
        : [{ text: 'Under budget', className: 'text-success' }, 'bg-success'];

  return { meter: { value: monthlyTotalCents, total: budgetCents }, chip, barClassName };
}

/**
 * HOUP-222: tone for the hero's togglable `budgetPulse` pulse tile — ported
 * from web's budgetPulse module (apps/web/src/app/home/hero-modules.tsx:
 * `overBudget = spend >= budgetCents * RED_PCT / 100`, `>=` not `>`, unlike
 * this file's own `deriveBudgetTile` chip above). Kept separate rather than
 * reusing that chip's stricter `>` so the pulse tile matches its web
 * counterpart exactly; both already read the same underlying spend/budget
 * numbers so they can't visually disagree on which side of a threshold
 * they're on, just the RED boundary's edge case (spend === budget * 100%).
 */
export function deriveBudgetPulseTone(budgetCents: number, spendCents: number): 'success' | 'warning' | 'danger' {
  if (spendCents >= (budgetCents * BUDGET_RED_PCT) / 100) return 'danger';
  if (spendCents >= (budgetCents * BUDGET_YELLOW_PCT) / 100) return 'warning';
  return 'success';
}
