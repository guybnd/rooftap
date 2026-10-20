'use client';

// Hearth v2: the Budget and Bills Spaces. Home is one dashboard, so these
// sit in Spaces with Groceries whether or not their shortcut is on. Tapping
// a shortcut filters Home down to its Space, shown `expanded` (every bar and
// row, not just the first few). The numbers come from core home-lens.ts, so
// the native twins (apps/mobile features/home/money-spaces.tsx) agree.
//
// Category hues key the budget's bars only (a chart series, as on the Costs
// page); bill rows lead with a neutral glyph chip (H2).

import { useState } from 'react';
import { Plus, Receipt, Wallet } from 'lucide-react';
import type { CostItem, Group } from '@homeup/core';
import {
  CATEGORY_COLOR,
  SPACE_COLLAPSED_ROWS,
  buildBillsLens,
  buildBudgetLens,
  costItems$,
  daysUntilLabel,
  formatMoney,
  useStoreHelpers,
  type BudgetLens,
} from '@homeup/core';
import { ProgressBar } from '@/components/ui/progress-bar';
import { CostModal } from '@/app/costs/cost-modal';
import { CategoryGlyph } from '@/app/costs/category-glyph';
import { HUB, HubTile, TileHeader, stopNav } from './hub-shared';

function budgetTone(lens: BudgetLens): string {
  if (lens.budgetCents == null) return 'bg-foreground/45';
  if (lens.spentCents >= (lens.budgetCents * HUB.BUDGET_RED_PCT) / 100) return 'bg-destructive';
  if (lens.spentCents >= (lens.budgetCents * HUB.BUDGET_YELLOW_PCT) / 100) return 'bg-warning';
  return 'bg-success';
}

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
  const { writeRow } = useStoreHelpers(costItems$(group.id), currentUserId);
  const [modalOpen, setModalOpen] = useState(false);
  const lens = buildBudgetLens(costItems, budgetCents, now);
  const over = lens.leftCents != null && lens.leftCents < 0;
  const discount = lens.endingDiscounts[0];
  const bars = expanded ? lens.categories : lens.categories.slice(0, SPACE_COLLAPSED_ROWS);

  return (
    <HubTile href="/costs" ariaLabel="Budget">
      <TileHeader sectionId="costs" Icon={Wallet} title="Budget" />
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          {lens.budgetCents != null && lens.leftCents != null ? (
            <p className="tabular-nums">
              <span className={`font-heading text-2xl font-bold tracking-tight ${over ? 'text-destructive' : 'text-foreground'}`}>
                {formatMoney(Math.abs(lens.leftCents))}
              </span>{' '}
              <span className="text-xs text-muted-foreground">
                {over ? 'over' : 'left of'} {formatMoney(lens.budgetCents)}
              </span>
            </p>
          ) : (
            <p className="tabular-nums">
              <span className="font-heading text-2xl font-bold tracking-tight text-foreground">{formatMoney(lens.spentCents)}</span>{' '}
              <span className="text-xs text-muted-foreground">/ month</span>
            </p>
          )}
          {lens.budgetCents != null ? (
            <ProgressBar value={lens.spentCents} total={lens.budgetCents} fillClassName={budgetTone(lens)} className="h-[3px]" />
          ) : (
            <p className="text-xs text-muted-foreground">Set a monthly budget in Costs to track spend against it.</p>
          )}
          {(lens.committedPct != null || discount) && (
            <p className="text-xs text-muted-foreground">
              {lens.committedPct != null && <span className="tabular-nums">{lens.committedPct}% committed. </span>}
              {discount && (
                <span className="text-warning">
                  {discount.label} discount ends {daysUntilLabel(discount.days)}.
                </span>
              )}
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
