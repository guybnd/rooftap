'use client';

// Cost categories a household sees in pickers and filters. Pets and Kids and
// family only apply to some homes, so they stay out of the way until a line
// uses them (one made by hand, or one the bank filed there). The Costs screen
// on each app provides the categories its lines use; pickers ask for their
// choices here, and a bank-made line's editor for the lines it could merge into.

import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';
import { CATEGORY_META } from './costs';
import type { CostCategory, CostItem } from '../../types';

/**
 * Categories hidden until a line uses them. Income is offered from Costs'
 * "Add income", which servers before 20261022170000_cost_redesign can't store.
 */
export const OPTIONAL_COST_CATEGORIES: readonly CostCategory[] = ['pets', 'family', 'income'];

const ALL = Object.keys(CATEGORY_META) as CostCategory[];

/** The categories to offer: every one but the optional ones nobody uses, plus `current`. */
export function costCategoryChoices(used: ReadonlySet<string>, current?: string | null): CostCategory[] {
  return ALL.filter((c) => !OPTIONAL_COST_CATEGORIES.includes(c) || used.has(c) || c === current);
}

interface CostLines {
  used: ReadonlySet<string>;
  items: readonly CostItem[];
}

const Lines = createContext<CostLines>({ used: new Set(), items: [] });

export function CostCategoriesProvider({ items, children }: { items: readonly CostItem[]; children: ReactNode }) {
  const value = useMemo(() => {
    const live = items.filter((i) => !i.deleted);
    return { used: new Set(live.map((i) => i.category)), items: live };
  }, [items]);
  return createElement(Lines.Provider, { value }, children);
}

/** The categories a picker offers, keeping the one already picked. */
export function useCostCategoryChoices(current?: string | null): CostCategory[] {
  const { used } = useContext(Lines);
  return useMemo(() => costCategoryChoices(used, current), [used, current]);
}

/**
 * Lines a bank-made line could merge into: the ones made by hand in a
 * category (say, the water bill set up before the bank was connected).
 */
export function costMergeTargets(items: readonly CostItem[], line: Pick<CostItem, 'id' | 'bank_source'>, category: string): CostItem[] {
  if (!line.bank_source) return [];
  return items.filter((i) => !i.deleted && i.id !== line.id && !i.bank_source && i.category === category);
}

export function useCostMergeTargets(line: Pick<CostItem, 'id' | 'bank_source'> | undefined, category: string): CostItem[] {
  const { items } = useContext(Lines);
  return useMemo(() => (line ? costMergeTargets(items, line, category) : []), [items, line, category]);
}
