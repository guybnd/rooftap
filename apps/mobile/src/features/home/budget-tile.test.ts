import { describe, expect, it } from 'vitest';
import { deriveBudgetTile, deriveBudgetPulseTone } from './budget-tile';

describe('deriveBudgetTile', () => {
  it('has neither meter nor chip when no budget is set', () => {
    expect(deriveBudgetTile(null, 20_000)).toEqual({});
  });

  it('has neither meter nor chip when the budget is zero', () => {
    expect(deriveBudgetTile(0, 20_000)).toEqual({});
  });

  it('shows the red "Over budget" chip once spend exceeds the budget (HOUP-214 repro: $150 budget, $200 spend)', () => {
    const result = deriveBudgetTile(15_000, 20_000);
    expect(result.chip).toEqual({ text: 'Over budget', className: 'text-destructive' });
    expect(result.meter).toEqual({ value: 20_000, total: 15_000 });
  });

  it('shows the amber "Close to budget" chip between the yellow and red thresholds', () => {
    const result = deriveBudgetTile(15_000, 12_000); // 80% — the yellow boundary itself
    expect(result.chip).toEqual({ text: 'Close to budget', className: 'text-warning' });
  });

  it('shows the amber chip right at the red boundary (100% is "close", not yet "over")', () => {
    const result = deriveBudgetTile(15_000, 15_000);
    expect(result.chip).toEqual({ text: 'Close to budget', className: 'text-warning' });
  });

  it('shows the green "Under budget" chip below the yellow threshold', () => {
    const result = deriveBudgetTile(15_000, 5_000);
    expect(result.chip).toEqual({ text: 'Under budget', className: 'text-success' });
  });

  it('always derives the meter and the chip from the same gate — one is never present without the other', () => {
    for (const [budgetCents, spendCents] of [
      [null, 0],
      [0, 100],
      [15_000, 0],
      [15_000, 15_000],
      [15_000, 30_000],
    ] as const) {
      const result = deriveBudgetTile(budgetCents, spendCents);
      expect(!!result.meter).toBe(!!result.chip);
    }
  });
});

describe('deriveBudgetPulseTone', () => {
  // HOUP-222: mirrors web's budgetPulse module thresholds (`>=` both edges,
  // apps/web/src/app/home/hero-modules.tsx:387-392) — deliberately not the
  // same `>` boundary as deriveBudgetTile's chip above.
  it('is danger once spend reaches the budget', () => {
    expect(deriveBudgetPulseTone(15_000, 15_000)).toBe('danger');
    expect(deriveBudgetPulseTone(15_000, 20_000)).toBe('danger');
  });

  it('is warning at/above the 80% yellow threshold but below 100%', () => {
    expect(deriveBudgetPulseTone(15_000, 12_000)).toBe('warning'); // 80% exactly
    expect(deriveBudgetPulseTone(15_000, 14_000)).toBe('warning');
  });

  it('is success below the yellow threshold', () => {
    expect(deriveBudgetPulseTone(15_000, 5_000)).toBe('success');
  });
});
