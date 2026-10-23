'use client';

// The Costs overview's own state, shared by both apps' CostsOverview: the
// chart's months and the one picked, which category rows are open, and the
// colour picked on the spend bar (the chart then shows only that category).

import { useMemo, useState } from 'react';
import type { CostCategory, CostItem } from '../../types';
import { monthKeys } from './cost-month';
import { monthLongName } from './cost-month-view';
import { useCostMonths } from './up-overview';

/** The chart's months: this one plus the nine before it and the two after. */
export const COST_CHART_BACK = 9;
export const COST_CHART_MONTHS = 12;

export function useCostsOverview(items: readonly CostItem[]) {
  const now = useMemo(() => new Date(), []);
  const keys = useMemo(() => monthKeys(now, -COST_CHART_BACK, COST_CHART_MONTHS), [now]);
  const months = useCostMonths(items, keys);
  const [picked, setPicked] = useState(keys[COST_CHART_BACK]);
  const month = months.find((m) => m.month === picked) ?? months[COST_CHART_BACK];
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<string | null>(null);

  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** An insight's "Show the category": this month, with that category open. Returns the row's id. */
  const openCategory = (category: CostCategory | null): string => {
    const id = category ?? 'none';
    setFocus(null);
    setPicked(keys[COST_CHART_BACK]);
    setOpen((cur) => new Set(cur).add(id));
    return id;
  };

  return {
    months,
    month,
    /** The picked month's long name ("October"). */
    name: monthLongName(month.month),
    setPicked,
    open,
    toggle,
    focus,
    setFocus,
    /** Pick a colour on the spend bar, or pick it again to clear it. */
    toggleFocus: (key: string) => setFocus((cur) => (cur === key ? null : key)),
    openCategory,
  };
}
