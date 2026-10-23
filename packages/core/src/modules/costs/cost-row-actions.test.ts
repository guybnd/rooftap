import { describe, expect, it, vi } from 'vitest';
import {
  canHideCostLine,
  costCategoryMenu,
  costLineAmountLabel,
  costMoveKind,
  costPaymentMenu,
  costRowMenu,
  hideShopMonthWithUndo,
  likelyCostCategories,
  moveCostLine,
  moveCostLineWithUndo,
} from './cost-row-actions';
import { formatMoney } from '../../money-format';
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

describe('canHideCostLine', () => {
  it('hides only a bank shop, and only on a server that can', () => {
    expect(canHideCostLine(line({}), true)).toBe(true);
    expect(canHideCostLine(line({}), false)).toBe(false);
    expect(canHideCostLine(line({ source: undefined }), true)).toBe(false);
    expect(canHideCostLine(line({ kind: 'cost', item: item() }), true)).toBe(false);
  });
});

describe('moveCostLineWithUndo', () => {
  it('says where the row went, and Undo moves it back', async () => {
    const deps = { patchItem: vi.fn(), api: { changeShop: vi.fn(async () => ({ costItemId: null, ids: [] })) }, reload: vi.fn() };
    const own = item({ name: 'Netflix', category: 'other' });
    const done = await moveCostLineWithUndo(line({ kind: 'cost', name: 'Netflix', item: own }), 'other', 'rent', true, deps);
    expect(done.message).toBe('Moved Netflix to Rent');
    await done.undo?.();
    expect(deps.patchItem).toHaveBeenLastCalledWith(own, { category: 'other' });
  });
});

describe('hideShopMonthWithUndo', () => {
  it('hides the month, and Undo shows those payments again', async () => {
    const changeShop = vi.fn(async () => ({ costItemId: null, ids: ['t1', 't2'] }));
    const deps = { api: { changeShop }, reload: vi.fn() };
    const done = await hideShopMonthWithUndo(line({}), '2026-10', 'October', deps);
    expect(done?.message).toBe('Hid Coles in October');
    await done?.undo?.();
    expect(changeShop).toHaveBeenLastCalledWith({ ids: ['t1', 't2'], hidden: false });
    expect(deps.reload).toHaveBeenCalledTimes(2);
    await expect(hideShopMonthWithUndo(line({ kind: 'cost', item: item() }), '2026-10', 'October', deps)).resolves.toBeNull();
  });
});

describe('costLineAmountLabel', () => {
  it('shows what was paid, else what is to come', () => {
    expect(costLineAmountLabel({ paidCents: 1_000, toComeCents: 500 })).toBe(formatMoney(1_000));
    expect(costLineAmountLabel({ paidCents: 0, toComeCents: 500 })).toBe(`~${formatMoney(500)}`);
    expect(costLineAmountLabel({ paidCents: 0, toComeCents: 0 })).toBeUndefined();
  });
});

describe('costCategoryMenu', () => {
  it('asks about the category and adds to it', () => {
    const onAsk = vi.fn();
    const onAdd = vi.fn();
    const menu = costCategoryMenu({ category: 'income', monthName: 'October', onAsk, onAdd });
    const actions = menu.actions.filter((a) => !!a);
    expect(actions.map((a) => a && a.label)).toEqual(['Ask the assistant', 'Add income']);
    actions.forEach((a) => a && 'run' in a && a.run?.());
    expect(onAsk).toHaveBeenCalledWith('Help me make sense of my Income costs in October.');
    expect(onAdd).toHaveBeenCalledWith('income');
    expect(costCategoryMenu({ category: null, monthName: 'October', onAsk, onAdd }).actions.filter(Boolean)).toHaveLength(1);
  });
});
