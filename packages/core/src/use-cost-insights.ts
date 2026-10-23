'use client';

// The Costs page's money insights (cost-insights.ts) from what the page already
// has: the cost lines, the months costMonth works out, and the bank overview's
// links and accounts for the nudges only a bank can give. Both apps' "Worth a
// look" card reads this, so they show the same list.

import { useMemo } from 'react';
import { costTargets } from './costs';
import { monthKeys } from './cost-month';
import { costInsights, type CostInsightMarks, type CostInsights } from './cost-insights';
import { moneyNudges } from './money-insights';
import { useBankActuals, useCostMonths, useUpOverview } from './up-overview';
import type { CostItem } from './types';

/** The last three finished months and this one. */
const BACK = 3;

export function useCostInsights(items: readonly CostItem[], opts: { goalCents?: number | null; marks?: CostInsightMarks | null }): CostInsights {
  const { data, scope } = useUpOverview();
  const bank = useBankActuals();
  const keys = useMemo(() => monthKeys(new Date(), -BACK, BACK + 1), []);
  const months = useCostMonths(items, keys);
  const { goalCents, marks } = opts;
  return useMemo(() => {
    const now = new Date();
    const targets = costTargets(items);
    const live = items.filter((i) => !i.deleted && !targets.has(i.id));
    // Months before the bank data starts only hold costs added by hand: leave
    // them out of "usual" when there is a bank, or every category looks ahead.
    const since = data?.ledger?.length ? data.actualsSince ?? null : null;
    const shown = months.filter((m) => m.when !== 'past' || !since || m.month >= since);
    const nudges = data?.links
      ? moneyNudges({ items: live, links: data.links, bank, accounts: scope === 'mine' ? [] : data.accounts ?? [], now }, 20)
      : [];
    return costInsights({ items: live, months: shown, nudges, goalCents, marks: marks ?? undefined, now });
  }, [items, months, data, bank, scope, goalCents, marks]);
}
