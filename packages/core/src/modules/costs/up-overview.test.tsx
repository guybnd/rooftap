// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CostItem } from '../../types';
import { clearUpOverviewCache, UpOverviewProvider, useCurrentCostMonth, useOpeningCostMonth } from './up-overview';
import type { LedgerRow } from './cost-month';
import { monthStartOf, type UpBankApi } from './up-bank';

const now = new Date();
const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const rent = { id: 'rent', name: 'Rent', category: 'rent', amount: 400_000, cadence: 'monthly', date: `${monthKey}-01`, deleted: false } as unknown as CostItem;
const shop: LedgerRow = { month: monthKey, vendor: 'Coles', costItemId: null, sourceCategory: 'groceries', outCents: 300_000, inCents: 0, count: 3, lastAt: now.toISOString(), source: 'up' };

function fakeApi(connected = true) {
  let answer: (v: unknown) => void = () => {};
  const overview = new Promise((resolve) => (answer = resolve));
  const api = {
    status: vi.fn(async () => ({ allowed: true, connection: connected ? { shareMode: 'household' } : null })),
    overview: vi.fn(() => overview),
    spending: vi.fn(),
    sync: vi.fn(async () => ({ status: { allowed: true, connection: { shareMode: 'household' } }, saved: 0 })),
  } as unknown as UpBankApi;
  const land = () => answer({ month: monthStartOf(now), spentCents: 300_000, ledger: [shop], links: [], actualsSince: null });
  return { api, land };
}

afterEach(() => clearUpOverviewCache());

describe('this month before and after the bank payments land', () => {
  it('Home gets no total until the bank read is in, then the same one Costs shows', async () => {
    const { api, land } = fakeApi();
    const wrapper = ({ children }: { children: ReactNode }) => createElement(UpOverviewProvider, { api, enabled: true, linking: true, sharing: true, children });
    const { result } = renderHook(() => ({ home: useCurrentCostMonth([rent]), widget: useOpeningCostMonth([rent], true) }), { wrapper });
    expect(result.current.home).toBeNull();
    await waitFor(() => expect(api.overview).toHaveBeenCalled());
    expect(result.current.widget).toBeNull();
    await act(async () => land());
    await waitFor(() => expect(result.current.home).not.toBeNull());
    expect(result.current.home!.paidCents).toBe(700_000);
    // The widget reads the same month outside the provider.
    expect(result.current.widget!.paidCents).toBe(result.current.home!.paidCents);
  });

  it('the widget follows the opening read from outside a provider', async () => {
    const { api, land } = fakeApi();
    const widget = renderHook(() => useOpeningCostMonth([rent], true));
    expect(widget.result.current).toBeNull();
    const wrapper = ({ children }: { children: ReactNode }) => createElement(UpOverviewProvider, { api, enabled: true, linking: true, sharing: true, children });
    renderHook(() => useCurrentCostMonth([rent]), { wrapper });
    await waitFor(() => expect(api.overview).toHaveBeenCalled());
    await act(async () => land());
    await waitFor(() => expect(widget.result.current?.paidCents).toBe(700_000));
  });

  it('without a bank, or with it off, the widget counts the costs added by hand', async () => {
    expect(renderHook(() => useOpeningCostMonth([rent], false)).result.current?.paidCents).toBe(400_000);
    const { api } = fakeApi(false);
    const widget = renderHook(() => useOpeningCostMonth([rent], true));
    const wrapper = ({ children }: { children: ReactNode }) => createElement(UpOverviewProvider, { api, enabled: true, linking: true, sharing: true, children });
    renderHook(() => useCurrentCostMonth([rent]), { wrapper });
    await waitFor(() => expect(widget.result.current?.paidCents).toBe(400_000));
  });
});
