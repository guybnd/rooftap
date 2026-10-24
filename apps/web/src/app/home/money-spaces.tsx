'use client';

// Hearth v2: the Budget and Bills Spaces. Home is one dashboard, so these
// sit in Spaces with Groceries whether or not their shortcut is on. Tapping
// a shortcut filters Home down to its Space, shown `expanded` (every bar and
// row, not just the first few). The native twins are apps/mobile
// features/home/money-spaces.tsx.
//
// Budget is the Costs hero in small (Guy, 2026-10-24): what is paid so far
// out of the goal, with the same status lines (core goalStatus: under goal so
// far, then where the month is heading), and the Costs glance card (Latest
// with recent spending, and Worth a look). Expanded adds the category bars
// from core home-lens.ts. Category hues key those bars only (a chart series,
// as on the Costs page); bill rows lead with a neutral glyph chip (H2).

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Receipt, Wallet } from 'lucide-react';
import type { CostInsightMarks, CostItem, Group } from '@homeup/core';
import {
  CATEGORY_COLOR,
  SPACE_COLLAPSED_ROWS,
  buildBillsLens,
  buildBudgetLens,
  costItems$,
  daysUntilLabel,
  formatMoney,
  goalStatus,
  goalTone,
  monthLongName,
  readRecentSpendPrefs,
  saveUserSettings,
  useCurrentCostMonth,
  useInsightMarks,
  useModules,
  useMonthTotals,
  useStoreHelpers,
} from '@homeup/core';
import { ProgressBar } from '@/components/ui/progress-bar';
import { CostModal } from '@/app/costs/cost-modal';
import { CategoryGlyph } from '@/app/costs/category-glyph';
import { CostsGlanceCard } from '@/app/costs/costs-glance';
import { GoalStatusLines } from '@/app/costs/goal-status';
import { useDataCache } from '@/lib/data-cache';
import { createClient } from '@/lib/supabase/client';
import { HubTile, TileHeader, stopNav } from './hub-shared';

const TONE_FILL = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-destructive', neutral: 'bg-foreground/45' } as const;

export function BudgetSpace({
  group,
  currentUserId,
  costItems,
  budgetCents,
  expanded,
  now,
}: {
  group: Group;
  currentUserId: string | null;
  costItems: CostItem[];
  budgetCents: number | null;
  expanded: boolean;
  now: Date;
}) {
  const router = useRouter();
  const modules = useModules();
  const { userSettings, refresh } = useDataCache();
  const { writeRow } = useStoreHelpers(costItems$(group.id), currentUserId);
  const [modalOpen, setModalOpen] = useState(false);
  const month = useCurrentCostMonth(costItems);
  const lens = buildBudgetLens(costItems, budgetCents, now, useMonthTotals(costItems));
  const status = goalStatus(month, budgetCents, now);
  const tone = goalTone(month, budgetCents, now);
  const discount = lens.endingDiscounts[0];
  const bars = expanded ? lens.categories : [];
  const openCosts = () => router.push('/costs');

  // Worth a look keeps the marks Costs keeps (user_settings.money_insight_marks).
  const insightsOn = modules.isEnabled('money-insights');
  const saveMarks = useCallback(
    (marks: CostInsightMarks) => {
      void saveUserSettings(createClient(), { money_insight_marks: marks }).then((ok) => {
        if (ok) void refresh();
      });
    },
    [refresh],
  );
  const [marks, onMarks] = useInsightMarks(userSettings?.money_insight_marks, modules.server('costs.insight-marks') ? saveMarks : null);

  return (
    <HubTile href="/costs" ariaLabel="Budget">
      <TileHeader sectionId="costs" Icon={Wallet} title="Budget" />
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="tabular-nums">
            <span className="font-heading text-2xl font-bold tracking-tight text-foreground">{formatMoney(month.paidCents)}</span>{' '}
            <span className="text-xs text-muted-foreground">
              {budgetCents != null ? `of ${formatMoney(budgetCents)}` : `spent in ${monthLongName(month.month)}`}
            </span>
          </p>
          {budgetCents != null ? (
            // Solid: paid so far. Faint: what is still to come this month.
            <ProgressBar value={month.paidCents} expected={month.expectedCents} total={budgetCents} fillClassName={TONE_FILL[tone]} className="h-[3px]" />
          ) : (
            <p className="text-xs text-muted-foreground">Set a monthly budget in Costs to track spend against it.</p>
          )}
          <GoalStatusLines lines={status} />
          {discount && (
            <p className="text-xs text-warning">
              {discount.label} discount ends {daysUntilLabel(discount.days)}.
            </p>
          )}
        </div>
        {bars.length > 0 && (
          <ul className="flex flex-col gap-3" aria-label="By category">
            {bars.map((c) => (
              <li key={c.key} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate text-foreground">{c.label}</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatMoney(c.cents)}</span>
                </div>
                <ProgressBar
                  value={c.cents}
                  total={lens.spentCents}
                  fillClassName={c.key === 'rest' ? 'bg-foreground/45' : CATEGORY_COLOR[c.key].fill}
                  className="h-[3px]"
                />
              </li>
            ))}
          </ul>
        )}
        <div className="-mx-4 cursor-auto" {...stopNav} onKeyDown={(e) => e.stopPropagation()}>
          <CostsGlanceCard
            bare
            items={costItems}
            goalCents={budgetCents}
            current
            recentPrefs={readRecentSpendPrefs(userSettings?.costs_recent_spend)}
            insights={insightsOn ? { marks, onMarks, onRemind: null } : null}
            onOpenPayments={openCosts}
            onOpenItem={openCosts}
            onOpenCategory={openCosts}
          />
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setModalOpen(true);
          }}
          className="inline-flex min-h-9 w-fit items-center gap-1.5 rounded-full bg-muted px-3.5 text-xs font-medium text-foreground hover:bg-muted/70"
        >
          <Plus className="h-3.5 w-3.5" /> Add cost
        </button>
      </div>
      <div {...stopNav}>
        <CostModal
          key={modalOpen ? 'open' : 'closed'}
          isOpen={modalOpen}
          groupId={group.id}
          onClose={() => setModalOpen(false)}
          onSave={(saved) => {
            writeRow(saved);
            setModalOpen(false);
          }}
        />
      </div>
    </HubTile>
  );
}

export function BillsSpace({ costItems, expanded, now }: { costItems: CostItem[]; expanded: boolean; now: Date }) {
  const lens = buildBillsLens(costItems, now);
  const rows = expanded ? lens.rows : lens.rows.slice(0, SPACE_COLLAPSED_ROWS);
  const byId = new Map(costItems.map((c) => [c.id, c]));
  const hidden = lens.rows.length - rows.length;

  return (
    <HubTile href="/costs" ariaLabel="Bills">
      <TileHeader
        sectionId="costs"
        Icon={Receipt}
        title="Bills"
        right={<span className="text-xs text-muted-foreground">Next 30 days</span>}
      />
      {lens.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No bills due in the next 30 days.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {lens.dueCount > 0 && (
            <p className="tabular-nums">
              <span className="font-heading text-2xl font-bold tracking-tight text-foreground">{formatMoney(lens.totalCents)}</span>{' '}
              <span className="text-xs text-muted-foreground">
                due across {lens.dueCount} {lens.dueCount === 1 ? 'bill' : 'bills'}
              </span>
            </p>
          )}
          <ul className="flex flex-col divide-y divide-border">
            {rows.map((row) => {
              const cost = byId.get(row.costId);
              return (
                <li key={row.key} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  {cost && <CategoryGlyph category={cost.category} />}
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium text-foreground">{row.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      <span className={row.discountEnding ? 'text-warning' : undefined}>
                        {row.discountEnding ? `Discount ends ${daysUntilLabel(row.days)}` : daysUntilLabel(row.days)}
                      </span>
                      {row.provider && <> · {row.provider}</>}
                    </span>
                  </div>
                  {row.cents != null && (
                    <span className="shrink-0 font-mono text-sm tabular-nums text-foreground">{formatMoney(row.cents)}</span>
                  )}
                </li>
              );
            })}
          </ul>
          {hidden > 0 && <p className="text-xs text-muted-foreground tabular-nums">+{hidden} more</p>}
        </div>
      )}
    </HubTile>
  );
}
