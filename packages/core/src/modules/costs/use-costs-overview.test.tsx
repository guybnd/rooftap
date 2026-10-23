// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { COST_CHART_BACK, COST_CHART_MONTHS, useCostsOverview } from './use-costs-overview';

describe('useCostsOverview', () => {
  it('starts on this month, and an insight opens its category there', () => {
    const { result } = renderHook(() => useCostsOverview([]));
    expect(result.current.months).toHaveLength(COST_CHART_MONTHS);
    const thisMonth = result.current.months[COST_CHART_BACK].month;
    expect(result.current.month.month).toBe(thisMonth);

    act(() => {
      result.current.setPicked(result.current.months[0].month);
      result.current.toggleFocus('rent');
    });
    expect(result.current.month.month).toBe(result.current.months[0].month);
    expect(result.current.focus).toBe('rent');

    let id = '';
    act(() => {
      id = result.current.openCategory(null);
    });
    expect(id).toBe('none');
    expect(result.current.month.month).toBe(thisMonth);
    expect(result.current.focus).toBeNull();
    expect(result.current.open.has('none')).toBe(true);
  });

  it('toggles a category row and a colour on the spend bar', () => {
    const { result } = renderHook(() => useCostsOverview([]));
    act(() => result.current.toggle('rent'));
    expect(result.current.open.has('rent')).toBe(true);
    act(() => result.current.toggle('rent'));
    expect(result.current.open.has('rent')).toBe(false);
    act(() => result.current.toggleFocus('outing'));
    act(() => result.current.toggleFocus('outing'));
    expect(result.current.focus).toBeNull();
  });
});
