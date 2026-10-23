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
  budgetPulseTone,
  SPACE_COLLAPSED_ROWS,
  buildBillsLens,
  buildBudgetLens,
  costItems$,
  daysUntilLabel,
  formatMoney,
  timeAgo,
  useMonthTotals,
  useUpOverview,
  useStoreHelpers,
  type BudgetLens,
} from '@homeup/core';
import { ProgressBar } from '@/components/ui/progress-bar';
import { CostModal } from '@/app/costs/cost-modal';
import { CategoryGlyph } from '@/app/costs/category-glyph';
import { HubTile, TileHeader, stopNav } from './hub-shared';

const TONE_FILL = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-destructive' } as const;

function budgetTone(lens: BudgetLens): string {
  if (lens.budgetCents == null) return 'bg-foreground/45';
  return TONE_FILL[budgetPulseTone(lens.budgetCents, lens.spentCents)];
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
  const month = useMonthTotals(costItems);
  const { data: bankData } = useUpOverview();
  const lens = buildBudgetLens(costItems, budgetCents, now, month);
  // The latest payments, so Home shows the money moving.
  const latest = month ? (bankData?.recent ?? []).slice(0, expanded ? 5 : 3) : [];
  const lineById = new Map(costItems.map((c) => [c.id, c]));
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
              <span className="text-xs text-muted-foreground">{month ? 'this month' : '/ month'}</span>
            </p>
          )}
          {lens.budgetCents != null ? (
            // Solid: paid so far. Faint: what is still to come this month.
            <ProgressBar value={lens.paidCents ?? lens.spentCents} expected={lens.spentCents} total={lens.budgetCents} fillClassName={budgetTone(lens)} className="h-[3px]" />
          ) : (
            <p className="text-xs text-muted-foreground">Set a monthly budget in Costs to track spend against it.</p>
          )}
          {(lens.paidCents != null || lens.committedPct != null || discount) && (
            <p className="text-xs text-muted-foreground">
              {lens.paidCents != null ? (
                <span className="tabular-nums">
                  {formatMoney(lens.paidCents)} paid · {formatMoney(Math.max(0, lens.spentCents - lens.paidCents))} to come.{' '}
                </span>
              ) : (
                lens.committedPct != null && <span className="tabular-nums">{lens.committedPct}% committed. </span>
              )}
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
        {latest.length > 0 && (
          <ul className="divide-y divide-border/60" aria-label="Latest payments">
            {latest.map((t) => {
              const line = t.costItemId ? lineById.get(t.costItemId) : undefined;
              return (
                <li key={t.id} className="flex min-h-10 items-center gap-3 py-1.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-foreground">{t.description}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[t.pending ? 'Pending' : null, timeAgo(t.occurredAt), line ? line.name : t.categoryLabel].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <span className={`text-xs tabular-nums ${t.amountCents > 0 ? 'text-success' : 'text-foreground'}`}>
                    {t.amountCents > 0 ? '+' : ''}
                    {formatMoney(Math.abs(t.amountCents))}
                  </span>
                </li>
              );
            })}
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
