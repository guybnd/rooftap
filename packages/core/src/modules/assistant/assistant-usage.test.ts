import { describe, expect, it } from 'vitest';
import { budgetPercent, formatTokens, shiftUsageMonth, summarizeUsage, usageMonthLabel, type UsageRecord } from './assistant-usage';

const row = (extra: Partial<UsageRecord>): UsageRecord => ({
  user_id: 'u1',
  feature: 'chat',
  model: 'gemini-2.5-flash',
  key_source: 'server',
  turns: 1,
  input_tokens: 100,
  output_tokens: 50,
  cost_micros: 1000,
  ...extra,
});

describe('summarizeUsage', () => {
  it('totals and breaks down by person, feature and model', () => {
    const s = summarizeUsage(
      [
        row({}),
        row({ feature: 'quick', model: 'gemini-2.5-flash-lite', cost_micros: 200, turns: 3 }),
        row({ user_id: 'u2', cost_micros: 5000 }),
        row({ user_id: null, feature: 'routine', cost_micros: 0 }),
      ],
      { u1: 'Ana', u2: 'Ben' }
    );
    expect(s.costMicros).toBe(6200);
    expect(s.turns).toBe(6);
    expect(s.tokens).toBe(600);
    expect(s.byPerson.map((p) => [p.label, p.costMicros])).toEqual([
      ['Ben', 5000],
      ['Ana', 1200],
      ['Household', 0],
    ]);
    expect(s.byFeature.map((f) => f.label)).toEqual(['Chats', 'Quick asks', 'Routines']);
    expect(s.byModel[0]).toMatchObject({ key: 'gemini-2.5-flash', costMicros: 6000, turns: 3 });
  });
});

describe('helpers', () => {
  it('works out budget share', () => {
    expect(budgetPercent(500_000, 100)).toBe(50);
    expect(budgetPercent(5_000_000, 100)).toBe(100);
    expect(budgetPercent(1, null)).toBeNull();
    expect(budgetPercent(0, 0)).toBe(0);
  });

  it('formats tokens and months', () => {
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(1234)).toBe('1.2k');
    expect(formatTokens(34_000)).toBe('34k');
    expect(formatTokens(1_500_000)).toBe('1.5M');
    expect(usageMonthLabel('2026-10-01')).toBe('October 2026');
    expect(shiftUsageMonth('2026-01-01', -1)).toBe('2025-12-01');
    expect(shiftUsageMonth('2026-12-01', 1)).toBe('2027-01-01');
  });
});
