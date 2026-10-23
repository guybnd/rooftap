// What a Costs row can do, the same on both apps (Hearth §13.7 "Row menu").
// Guy (2026-10-23) found moving a cost to another category took nine taps
// over four sheets, and the Costs menus didn't match the other sections. A
// row now moves in two taps: hold (or right-click) and pick in "Move to", or
// swipe right and pick from the likely categories first. Swipe left hides a
// shop's payments, or archives a cost added by hand.
//
// A move means the same thing wherever it starts:
// - a cost added by hand, or a bill: its line takes the category;
// - a shop: every payment there, and its later ones (the server moves the
//   shop's own line, or makes one the way the bank's filing does);
// - one payment: that payment alone (bank_transactions.cost_category).

import { CATEGORY_COLOR, CATEGORY_META } from './costs';
import { costCategoryFromUp, monthRange, type BankTransactionView, type ShopChangeResult, type UpBankApi } from './up-bank';
import { costCategoryLabel, type CostMonth, type CostMonthLine } from './cost-month';
import { formatMoney } from '../../money-format';
import type { RowMenu } from '../../row-actions';
import type { CostCategory, CostItem } from '../../types';

/** The category a payment's own pick would replace: its line's, else the shop's. */
export function costLineCategory(line: CostMonthLine, inCategory: CostCategory | null): CostCategory | null {
  return line.item && line.kind !== 'shop' ? line.item.category : inCategory;
}

/**
 * Two or three categories to offer first when moving: the bank's own guess
 * for the shop, then where most of the month's money went. Never the one it
 * is in now.
 */
export function likelyCostCategories(
  hint: { sourceCategory?: string | null },
  current: CostCategory | null,
  month: Pick<CostMonth, 'categories'> | null,
  choices: readonly CostCategory[],
  max = 3,
): CostCategory[] {
  const out: CostCategory[] = [];
  const add = (c: CostCategory | null | undefined) => {
    if (c && c !== current && c !== 'income' && choices.includes(c) && !out.includes(c)) out.push(c);
  };
  if (hint.sourceCategory) add(costCategoryFromUp(hint.sourceCategory));
  const byCount = [...(month?.categories ?? [])]
    .filter((c) => c.category)
    .sort((a, b) => b.lines.reduce((n, l) => n + l.count, 0) - a.lines.reduce((n, l) => n + l.count, 0));
  for (const c of byCount) add(c.category);
  for (const c of choices) add(c);
  return out.slice(0, max);
}

/** What a move can do for a row; null when it can't move (a usual-spend estimate, or a shop on an older server). */
export type CostMove = 'line' | 'shop' | null;

export function costMoveKind(line: CostMonthLine, quickMove: boolean): CostMove {
  if (line.kind === 'usual') return null;
  if (line.kind === 'shop') return quickMove && line.vendor ? 'shop' : line.item?.bank_source ? 'line' : null;
  return line.item ? 'line' : null;
}

export interface CostMoveDeps {
  patchItem: (item: CostItem, patch: Partial<CostItem>) => void;
  api: Pick<UpBankApi, 'changeShop'>;
  /** Reads the bank overview again, so the page's totals follow. */
  reload: () => void;
}

/** Moves a row to a category. Resolves once the change is saved. */
export async function moveCostLine(line: CostMonthLine, category: CostCategory, quickMove: boolean, deps: CostMoveDeps): Promise<void> {
  const kind = costMoveKind(line, quickMove);
  if (kind === 'line' && line.item) {
    deps.patchItem(line.item, { category });
    return;
  }
  if (kind === 'shop' && line.vendor) {
    // The shop's own line moves at once here; the server moves the rest.
    if (line.item?.bank_source) deps.patchItem(line.item, { category });
    await deps.api.changeShop({ vendor: line.vendor, category });
    deps.reload();
  }
}

/** Hides the viewer's payments at a shop in a month. The result's ids undo it. */
export async function hideShopMonth(line: CostMonthLine, month: string, deps: Pick<CostMoveDeps, 'api' | 'reload'>): Promise<ShopChangeResult | null> {
  const range = monthRange(month);
  if (line.kind !== 'shop' || !line.vendor || !range) return null;
  const done = await deps.api.changeShop({ vendor: line.vendor, from: range.from.toISOString(), to: range.to.toISOString(), hidden: true });
  deps.reload();
  return done;
}

export interface CostRowMenuInput {
  line: CostMonthLine;
  /** The category the row sits in on the page. */
  category: CostCategory | null;
  choices: readonly CostCategory[];
  monthName: string;
  /** The server has 'costs.quick-move'. */
  quickMove: boolean;
  onMove: (category: CostCategory) => void;
  onPayments?: (() => void) | null;
  onEdit?: ((item: CostItem) => void) | null;
  onAsk?: ((question: string) => void) | null;
  onArchive?: ((item: CostItem, archived: boolean) => void) | null;
  onHide?: (() => void) | null;
}

const KIND: Record<CostMonthLine['kind'], string> = {
  shop: 'Shop',
  recurring: 'Bill',
  cost: 'Cost',
  target: 'Plan',
  usual: 'Usual spend',
};

/** The "Move to" choices, each with its category's dot. */
export function costMoveOptions(current: CostCategory | null, choices: readonly CostCategory[], onMove: (c: CostCategory) => void) {
  return choices.map((c) => ({
    id: c,
    label: CATEGORY_META[c].label,
    swatch: CATEGORY_COLOR[c].dot,
    checked: c === current,
    run: () => {
      if (c !== current) onMove(c);
    },
  }));
}

/** A Costs row's menu: open, Move to, edit, ask, then Archive or Hide alone at the end. */
export function costRowMenu(input: CostRowMenuInput): RowMenu {
  const { line, monthName } = input;
  const current = costLineCategory(line, input.category);
  const canMove = costMoveKind(line, input.quickMove) !== null;
  const item = line.item && line.kind !== 'shop' ? line.item : null;
  return {
    title: line.name,
    kind: KIND[line.kind],
    actions: [
      line.kind === 'shop' && input.onPayments && { id: 'payments', label: 'See its payments', group: 'open', icon: 'open', run: input.onPayments },
      canMove && {
        id: 'move',
        label: 'Move to',
        group: 'set',
        icon: 'move',
        value: current ? CATEGORY_META[current].label : undefined,
        options: costMoveOptions(current, input.choices, input.onMove),
      },
      input.onAsk && { id: 'ask', label: 'Ask the assistant', group: 'share', icon: 'comment', run: () => input.onAsk!(`Help me make sense of ${line.name} in my ${monthName} costs.`) },
      (item ?? line.item) && input.onEdit && { id: 'edit', label: line.kind === 'shop' ? 'Edit its cost line' : 'Edit details', group: 'edit', icon: 'edit', run: () => input.onEdit!((item ?? line.item)!) },
      item && input.onArchive && { id: 'archive', label: item.archived ? 'Bring back' : 'Archive', group: 'danger', icon: 'archive', run: () => input.onArchive!(item, !item.archived) },
      line.kind === 'shop' && input.onHide && { id: 'hide', label: 'Hide from spending', group: 'danger', icon: 'hide', run: input.onHide },
    ],
  };
}

/** A payment's menu, in the payment list and a shop's sheet. */
export function costPaymentMenu(input: {
  t: BankTransactionView;
  category: CostCategory | null;
  choices: readonly CostCategory[];
  quickMove: boolean;
  onMove: (category: CostCategory) => void;
  onOpen: () => void;
  onHide?: (() => void) | null;
}): RowMenu {
  const { t } = input;
  const spend = t.amountCents < 0 && !t.isTransfer;
  return {
    title: t.description,
    kind: 'Payment',
    actions: [
      { id: 'open', label: 'Open', group: 'open', icon: 'open', run: input.onOpen },
      spend && t.mine && input.quickMove && {
        id: 'move',
        label: 'Move to',
        group: 'set',
        icon: 'move',
        value: input.category ? CATEGORY_META[input.category].label : undefined,
        options: costMoveOptions(input.category, input.choices, input.onMove),
      },
      t.mine && input.onHide && { id: 'hide', label: t.hidden ? 'Show in spending' : 'Hide from spending', group: 'danger', icon: 'hide', run: input.onHide },
    ],
  };
}

/** A shop row whose month of payments can be hidden: an Up shop, on servers with 'costs.quick-move'. */
export function canHideCostLine(line: CostMonthLine, quickMove: boolean): boolean {
  return quickMove && line.kind === 'shop' && !!line.vendor && line.source === 'up';
}

/** What a toast says after a row action, and how its Undo puts it back (null when it can't). */
export interface CostRowDone {
  message: string;
  undo: (() => Promise<void>) | null;
}

/** Moves a row (moveCostLine) and says where it went, with Undo back to where it was. */
export async function moveCostLineWithUndo(
  line: CostMonthLine,
  inCategory: CostCategory | null,
  to: CostCategory,
  quickMove: boolean,
  deps: CostMoveDeps
): Promise<CostRowDone> {
  const from = costLineCategory(line, inCategory);
  await moveCostLine(line, to, quickMove, deps);
  return {
    message: `Moved ${line.name} to ${CATEGORY_META[to].label}`,
    undo: from ? () => moveCostLine(line, from, quickMove, deps) : null,
  };
}

/** Hides a shop's payments in a month (hideShopMonth), with Undo; null when there was nothing to hide. */
export async function hideShopMonthWithUndo(
  line: CostMonthLine,
  month: string,
  monthName: string,
  deps: Pick<CostMoveDeps, 'api' | 'reload'>
): Promise<CostRowDone | null> {
  const done = await hideShopMonth(line, month, deps);
  if (!done) return null;
  return {
    message: `Hid ${line.name} in ${monthName}`,
    undo: async () => {
      await deps.api.changeShop({ ids: done.ids, hidden: false });
      deps.reload();
    },
  };
}

/** The amount a row's sheet shows: what was paid, else "~" what is to come. */
export function costLineAmountLabel(line: Pick<CostMonthLine, 'paidCents' | 'toComeCents'>): string | undefined {
  if (line.paidCents > 0) return formatMoney(line.paidCents);
  if (line.toComeCents > 0) return `~${formatMoney(line.toComeCents)}`;
  return undefined;
}

/** A category row's menu: ask about it, and add a cost (or income) to it. */
export function costCategoryMenu(input: {
  category: CostCategory | null;
  monthName: string;
  onAsk: (question: string) => void;
  onAdd: (category: CostCategory) => void;
}): RowMenu {
  const label = costCategoryLabel(input.category);
  const category = input.category;
  return {
    title: label,
    kind: 'Category',
    actions: [
      { id: 'ask', label: 'Ask the assistant', group: 'share', icon: 'comment', run: () => input.onAsk(`Help me make sense of my ${label} costs in ${input.monthName}.`) },
      category && { id: 'add', label: category === 'income' ? 'Add income' : 'Add a cost', group: 'edit', icon: 'edit', run: () => input.onAdd(category) },
    ],
  };
}
