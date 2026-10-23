// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CostItem } from '../../types';
import type { BankTransactionView, CostBankDetail, UpBankApi } from './up-bank';
import {
  costsSummaryAsk,
  moveBankPayment,
  useMoneyTransactions,
  usePaidFromUp,
  useShopPayments,
  useTransactionSheet,
} from './use-money-view';

function tx(overrides: Partial<BankTransactionView> = {}): BankTransactionView {
  return {
    id: 't1',
    description: 'Woolworths',
    amountCents: -4200,
    category: 'groceries',
    categoryLabel: 'Groceries',
    pending: false,
    occurredAt: '2026-10-20T01:00:00.000Z',
    userId: 'u1',
    accountName: 'Spending',
    message: null,
    tags: [],
    note: null,
    hidden: false,
    costItemId: null,
    costCategory: null,
    linkKind: null,
    isTransfer: false,
    mine: true,
    ...overrides,
  };
}

function fakeApi(overrides: Partial<Record<keyof UpBankApi, unknown>> = {}) {
  return {
    transactions: vi.fn(async () => ({ transactions: [] as BankTransactionView[], next: null })),
    updateTransaction: vi.fn(async (id: string, patch: Partial<BankTransactionView>) => tx({ id, ...patch })),
    changeShop: vi.fn(async () => ({ costItemId: null, ids: [] })),
    costPreview: vi.fn(),
    makeCost: vi.fn(),
    setCostLink: vi.fn(),
    removeCostLink: vi.fn(),
    costLink: vi.fn(),
    mergeCostLine: vi.fn(),
    ...overrides,
  } as unknown as UpBankApi & Record<string, ReturnType<typeof vi.fn>>;
}

const line = { id: 'c1', name: 'Groceries', deleted: false } as CostItem;

describe('costsSummaryAsk', () => {
  it('names the month', () => {
    expect(costsSummaryAsk('October')).toMatch(/^Summarise our costs for October:/);
  });
});

describe('moveBankPayment', () => {
  it('moves one payment, or the whole shop', async () => {
    const api = fakeApi();
    await expect(moveBankPayment(api, tx(), 'grocery_estimate', false)).resolves.toBe('Moved the payment to Groceries');
    expect(api.updateTransaction).toHaveBeenCalledWith('t1', { costCategory: 'grocery_estimate' });
    await expect(moveBankPayment(api, tx(), 'grocery_estimate', true)).resolves.toBe('Moved Woolworths to Groceries');
    expect(api.changeShop).toHaveBeenCalledWith({ vendor: 'Woolworths', category: 'grocery_estimate' });
  });
});

describe('useMoneyTransactions', () => {
  it('reads the month, saves a change, and narrows by direction', async () => {
    const rows = [tx(), tx({ id: 't2', description: 'Pay', amountCents: 300000 })];
    const api = fakeApi({ transactions: vi.fn(async () => ({ transactions: rows, next: null })) });
    const notify = vi.fn();
    const { result } = renderHook(() => useMoneyTransactions(api, [line], notify));
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(result.current.shown).toHaveLength(2);

    act(() => result.current.setDirection('in'));
    expect(result.current.shown?.map((r) => r.id)).toEqual(['t2']);

    // Hiding a payment takes it off the spending list.
    await act(() => result.current.apply('t1', { hidden: true }));
    expect(api.updateTransaction).toHaveBeenCalledWith('t1', { hidden: true });
    expect(result.current.rows?.map((r) => r.id)).toEqual(['t2']);

    await act(() => result.current.moveTo(rows[1], 'income', true));
    expect(api.changeShop).toHaveBeenCalledWith({ vendor: 'Pay', category: 'income' });
    expect(notify).toHaveBeenCalledWith('Moved Pay to Income');
  });

  it('says when the read fails', async () => {
    const api = fakeApi({ transactions: vi.fn(async () => Promise.reject(new Error('offline'))) });
    const { result } = renderHook(() => useMoneyTransactions(api, [], vi.fn()));
    await waitFor(() => expect(result.current.error).toBe('offline'));
    expect(result.current.shown).toBeNull();
  });
});

describe('useTransactionSheet', () => {
  const base = { items: [line], quickMove: true, onPatch: vi.fn(), onMadeCost: vi.fn(), notify: vi.fn() };

  it('makes a cost with the typed name, or the suggested one', async () => {
    const made = tx({ costItemId: 'c9' });
    const api = fakeApi({
      costPreview: vi.fn(async () => ({ name: 'Netflix', seen: 3, cadence: 'monthly' })),
      makeCost: vi.fn(async () => ({ transaction: made })),
    });
    const onMadeCost = vi.fn();
    const t = tx({ description: 'NETFLIX.COM' });
    const { result } = renderHook(() => useTransactionSheet(api, { ...base, t, onMadeCost }));
    await act(() => result.current.startMaking());
    expect(result.current.costName).toBe('Netflix');
    expect(result.current.linkPayee).toBe(true);
    act(() => result.current.setCostName('  '));
    await act(() => result.current.saveCost());
    expect(api.makeCost).toHaveBeenCalledWith('t1', { name: 'Netflix', linkPayee: true });
    expect(onMadeCost).toHaveBeenCalledWith(made);
    expect(result.current.making).toBeNull();
  });

  it('moves one payment through onPatch, and only spending can move', async () => {
    const onPatch = vi.fn();
    const api = fakeApi();
    const { result, rerender } = renderHook(({ t }) => useTransactionSheet(api, { ...base, t, onPatch }), { initialProps: { t: tx() } });
    expect(result.current.canMove).toBe(true);
    await act(() => result.current.moveTo('outing'));
    expect(onPatch).toHaveBeenCalledWith({ costCategory: 'outing' });
    expect(api.changeShop).not.toHaveBeenCalled();

    rerender({ t: tx({ id: 't2', isTransfer: true }) });
    expect(result.current.canMove).toBe(false);
  });

  it('starts fresh for another payment', () => {
    const { result, rerender } = renderHook(({ t }) => useTransactionSheet(fakeApi(), { ...base, t }), { initialProps: { t: tx() } });
    act(() => {
      result.current.setNote('half was mine');
      result.current.setWholeShop(true);
    });
    rerender({ t: tx({ id: 't2' }) });
    expect(result.current.note).toBeNull();
    expect(result.current.wholeShop).toBe(false);
  });

  it('finds the line the payment counts toward', () => {
    const { result } = renderHook(() => useTransactionSheet(fakeApi(), { ...base, t: tx({ costItemId: 'c1' }) }));
    expect(result.current.line).toBe(line);
    expect(result.current.paid).toBe(4200);
  });
});

describe('useShopPayments', () => {
  it("keeps the shop's own payments, without transfers or hidden ones", async () => {
    const api = fakeApi({
      transactions: vi.fn(async () => ({
        transactions: [
          tx({ id: 'a', description: 'WOOLWORTHS' }),
          tx({ id: 'b', description: 'Coles' }),
          tx({ id: 'c', hidden: true }),
          tx({ id: 'd', isTransfer: true }),
        ],
        next: null,
      })),
    });
    const shop = { name: 'Woolworths', vendor: 'Woolworths' };
    const { result } = renderHook(() => useShopPayments(api, shop, '2026-10'));
    await waitFor(() => expect(result.current.rows?.map((r) => r.id)).toEqual(['a']));
    expect(api.transactions).toHaveBeenCalledWith({ month: '2026-10-01', scope: undefined });
  });

  it('reads nothing with no shop open', () => {
    const api = fakeApi();
    renderHook(() => useShopPayments(api, null, '2026-10'));
    expect(api.transactions).not.toHaveBeenCalled();
  });
});

describe('usePaidFromUp', () => {
  const detail: CostBankDetail = {
    rule: { match: 'NETFLIX', keepAmount: true },
    payments: [
      { ...tx({ id: 'p1', amountCents: 2299 }) },
      { ...tx({ id: 'p2', amountCents: 2099 }) },
      { ...tx({ id: 'p3', amountCents: 1999 }) },
    ],
  };

  it('reads the link and keeps the amount in step', async () => {
    const onAmount = vi.fn();
    const api = fakeApi({ costLink: vi.fn(async () => detail) });
    const { result, rerender } = renderHook(({ estimate }) => usePaidFromUp(api, { show: true, costItemId: 'c1', amountCents: 2299, estimate, onAmount }), {
      initialProps: { estimate: false },
    });
    await waitFor(() => expect(result.current.rule?.match).toBe('NETFLIX'));
    expect(onAmount).not.toHaveBeenCalled();
    // An estimate carries the average of the latest three.
    rerender({ estimate: true });
    expect(onAmount).toHaveBeenCalledWith(2132);
  });

  it('takes the amount the server set after a change', async () => {
    const onAmount = vi.fn();
    const api = fakeApi({ costLink: vi.fn(async () => ({ rule: null, payments: [] })) });
    const { result } = renderHook(() => usePaidFromUp(api, { show: true, costItemId: 'c1', amountCents: 1000, estimate: false, onAmount }));
    await act(() => result.current.change(async () => ({ ...detail, amountCents: 2299 })));
    expect(onAmount).toHaveBeenCalledWith(2299);
    expect(result.current.picking).toBe(false);
  });

  it('stays quiet when hidden, and says when a merge fails', async () => {
    const api = fakeApi({ mergeCostLine: vi.fn(async () => Promise.reject(new Error('nope'))) });
    const onMerged = vi.fn();
    const { result } = renderHook(() => usePaidFromUp(api, { show: false, costItemId: 'c1', amountCents: 0, estimate: false, onAmount: vi.fn(), onMerged }));
    expect(api.costLink).not.toHaveBeenCalled();
    await act(() => result.current.merge(line));
    expect(result.current.error).toBe('nope');
    expect(onMerged).not.toHaveBeenCalled();
  });
});
