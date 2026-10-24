'use client';

// The Costs page's money insights (cost-insights.ts) from what the page already
// has: the cost lines, the months costMonth works out, and the bank overview's
// links and accounts for the nudges only a bank can give. Both apps' "Worth a
// look" card reads this, so they show the same list.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { costTargets } from '../costs/costs';
import { monthKeys } from '../costs/cost-month';
import { costInsights, type CostInsightMarks, type CostInsights } from './cost-insights';
import { moneyNudges } from '../costs/money-insights';
import { useBankActuals, useCostMonths, useUpOverview } from '../costs/up-overview';
import type { CostItem } from '../../types';

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

/**
 * What this person hid and the subscriptions they kept
 * (user_settings.money_insight_marks), for Costs and Home's Worth a look.
 * `save` stores the new marks; null (older servers lack the column) keeps
 * them until the screen closes.
 */
export function useInsightMarks(
  saved: CostInsightMarks | null | undefined,
  save: ((marks: CostInsightMarks) => void) | null,
): [CostInsightMarks, (update: (cur: CostInsightMarks) => CostInsightMarks) => void] {
  const [marks, setMarks] = useState<CostInsightMarks>({});
  useEffect(() => {
    if (saved) setMarks(saved);
  }, [saved]);
  const update = useCallback(
    (change: (cur: CostInsightMarks) => CostInsightMarks) => {
      setMarks((cur) => {
        const next = change(cur);
        save?.(next);
        return next;
      });
    },
    [save],
  );
  return [marks, update];
}
