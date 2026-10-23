import { describe, expect, it, vi } from 'vitest';
import { costMoveKind, costPaymentMenu, costRowMenu, likelyCostCategories, moveCostLine } from './cost-row-actions';
import type { CostMonthLine } from './cost-month';
import type { BankTransactionView } from './up-bank';
import type { CostCategory, CostItem } from '../../types';

const choices: CostCategory[] = ['rent', 'internet', 'grocery_estimate', 'outing', 'transport', 'other'];

function item(over: Partial<CostItem> = {}): CostItem {
  return {
    id: 'i',
    group_id: 'g',
    name: 'Line',
    category: 'other',
    amount: 1_000,
    cadence: 'one_off',
    is_estimate: false,
    start_date: null,
    end_date: null,
    discount_end_date: null,
    provider: null,
    assigned_to: null,
    linked_section: null,
    notes: null,
    sort_order: 0,
    created_by: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    deleted: false,
    ...over,
  };
}

function line(over: Partial<CostMonthLine>): CostMonthLine {
  return { kind: 'shop', key: 'k', name: 'Coles', paidCents: 1_000, toComeCents: 0, count: 1, date: null, source: 'up', vendor: 'Coles', ...over };
}

describe('likelyCostCategories', () => {
  it("offers the bank's guess first, then where most payments went, never the current one", () => {
    const month = {
      categories: [
        { category: 'transport' as const, paidCents: 0, toComeCents: 0, lines: [line({ count: 2 })] },
        { category: 'outing' as const, paidCents: 0, toComeCents: 0, lines: [line({ count: 9 })] },
        { category: null, paidCents: 0, toComeCents: 0, lines: [line({ count: 20 })] },
      ],
    };
    expect(likelyCostCategories({ sourceCategory: 'groceries' }, 'outing', month, choices)).toEqual(['grocery_estimate', 'transport', 'rent']);
    expect(likelyCostCategories({}, null, null, choices, 2)).toEqual(['rent', 'internet']);
  });
});

describe('costMoveKind', () => {
  it('moves a shop through the server, and its line alone on an older server', () => {
    expect(costMoveKind(line({}), true)).toBe('shop');
    expect(costMoveKind(line({}), false)).toBeNull();
    expect(costMoveKind(line({ item: item({ bank_source: 'up' }) }), false)).toBe('line');
    expect(costMoveKind(line({ kind: 'usual' }), true)).toBeNull();
    expect(costMoveKind(line({ kind: 'cost', item: item() }), false)).toBe('line');
  });
});

describe('moveCostLine', () => {
  it("patches a cost's line, and asks the server to move a shop", async () => {
    const deps = { patchItem: vi.fn(), api: { changeShop: vi.fn(async () => ({ costItemId: null, ids: [] })) }, reload: vi.fn() };
    const own = item({ category: 'other' });
    await moveCostLine(line({ kind: 'cost', item: own }), 'rent', true, deps);
    expect(deps.patchItem).toHaveBeenCalledWith(own, { category: 'rent' });
    expect(deps.api.changeShop).not.toHaveBeenCalled();
    await moveCostLine(line({}), 'outing', true, deps);
    expect(deps.api.changeShop).toHaveBeenCalledWith({ vendor: 'Coles', category: 'outing' });
    expect(deps.reload).toHaveBeenCalledTimes(1);
  });
});

describe('costRowMenu', () => {
  it('gives a shop its payments, Move to with the current one checked, and Hide', () => {
    const onMove = vi.fn();
    const menu = costRowMenu({ line: line({}), category: 'grocery_estimate', choices, monthName: 'October', quickMove: true, onMove, onPayments: () => {}, onHide: () => {} });
    expect(menu.actions.filter(Boolean).map((a) => a && a.id)).toEqual(['payments', 'move', 'hide']);
    const move = menu.actions.find((a) => a && a.id === 'move');
    const options = (move && move.options) || [];
    expect(options.find((o) => o.checked)?.id).toBe('grocery_estimate');
    options.find((o) => o.id === 'grocery_estimate')!.run();
    options.find((o) => o.id === 'rent')!.run();
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith('rent');
  });

  it('gives a cost added by hand Edit and Archive, and no Move for usual spend', () => {
    const cost = costRowMenu({ line: line({ kind: 'cost', item: item() }), category: 'other', choices, monthName: 'October', quickMove: false, onMove: () => {}, onEdit: () => {}, onArchive: () => {} });
    expect(cost.actions.filter(Boolean).map((a) => a && a.id)).toEqual(['move', 'edit', 'archive']);
    const usual = costRowMenu({ line: line({ kind: 'usual' }), category: 'outing', choices, monthName: 'October', quickMove: true, onMove: () => {} });
    expect(usual.actions.filter(Boolean)).toEqual([]);
  });
});

describe('costPaymentMenu', () => {
  it("lets the payer move a spend, never someone else's", () => {
    const t = { description: 'Coles', amountCents: -1_000, isTransfer: false, mine: true, hidden: false } as BankTransactionView;
    const ids = (m: ReturnType<typeof costPaymentMenu>) => m.actions.filter(Boolean).map((a) => a && a.id);
    expect(ids(costPaymentMenu({ t, category: null, choices, quickMove: true, onMove: () => {}, onOpen: () => {}, onHide: () => {} }))).toEqual(['open', 'move', 'hide']);
    expect(ids(costPaymentMenu({ t: { ...t, mine: false }, category: null, choices, quickMove: true, onMove: () => {}, onOpen: () => {} }))).toEqual(['open']);
  });
});
