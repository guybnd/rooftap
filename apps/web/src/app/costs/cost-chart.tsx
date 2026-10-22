'use client';

import { useMemo } from 'react';
import type { CostItem, CostCategory } from '@homeup/core';
import { CATEGORY_META, CATEGORY_COLOR, monthlyProjection, formatMoney, recurringByCategory, useBankActuals } from '@homeup/core';
import { ProgressBar } from '@/components/ui/progress-bar';
import { PulseTile } from '@/components/ui/pulse-tile';
import { cn } from '@/lib/utils';

const CATEGORY_ORDER = Object.keys(CATEGORY_META) as CostCategory[];

// FLUX-1578: combined costs dashboard — current-month hero + plan meter, three
// KPI tiles, a pressable 12-month history (recurring/one-off two-tone,
// projected months gray, dashed plan line), and a per-month breakdown that
// follows the pressed column. Replaces the flat run-rate CostChart. The hero
// always stays pinned to the current month (from `monthlyTotal`/`budgetDelta`
// props, computed by the caller) — pressing a column only drives the
// breakdown panel below, never the hero or the KPI tiles.
//
// Bars stack each month by category in the same CATEGORY_COLOR hues as the
// breakdown below, so a category reads the same in the chart and the list.
// One-offs sit on top as one neutral segment (matching the breakdown strip's
// one-off segment and row dots), and projected months render faded.
const ONE_OFF_FILL = 'bg-foreground/45';
const PROJECTED_OPACITY = 'opacity-40';

interface CostDashboardProps {
  items: CostItem[];
  currentMonthStart: Date;
  monthlyTotal: number;
  budget: number | null;
  budgetCents: number;
  budgetDelta: number;
  momDelta: number;
  hasPrevMonthData: boolean;
  prevMonthLabel: string;
  editingBudget: boolean;
  budgetDraft: string;
  onBudgetDraftChange: (value: string) => void;
  onStartEditingBudget: (initialDraft: string) => void;
  onCancelEditingBudget: () => void;
  onSaveBudget: (value: number | null) => void;
  /** Tap-to-filter against the card list below (FLUX-1560) — the breakdown's
      recurring category rows are this dashboard's replacement for the old
      standalone "By category" panel's filter affordance. */
  selectedCategory: CostCategory | null;
  onSelectCategory: (category: CostCategory) => void;
  /** Which month bar is picked (index within the current calendar year,
      0-11); null means "current month". Lifted up to the page (HOUP-277) so
      picking a month here also drives the card list filter below, not just
      this dashboard's own breakdown panel. */
  selectedMonthIdx: number | null;
  onSelectMonth: (idx: number) => void;
}

export function CostDashboard({
  items,
  currentMonthStart,
  monthlyTotal,
  budget,
  budgetCents,
  budgetDelta,
  momDelta,
  hasPrevMonthData,
  prevMonthLabel,
  editingBudget,
  budgetDraft,
  onBudgetDraftChange,
  onStartEditingBudget,
  onCancelEditingBudget,
  onSaveBudget,
  selectedCategory,
  onSelectCategory,
  selectedMonthIdx,
  onSelectMonth,
}: CostDashboardProps) {
  // `currentMonthStart` (from the caller) is always the 1st of the month —
  // it anchors month/year math, but daysLeft needs today's actual day.
  const now = useMemo(() => new Date(), []);
  const year = currentMonthStart.getFullYear();
  const currentIdx = currentMonthStart.getMonth();

  // Lines linked to the bank show what was really paid in finished months.
  const bank = useBankActuals();
  const buckets = useMemo(
    () => monthlyProjection(items, new Date(year, 0, 1), 12, currentMonthStart, bank),
    [items, year, currentMonthStart, bank]
  );

  const selectedIdx = selectedMonthIdx ?? currentIdx;
  const selectedBucket = buckets[selectedIdx];
  const prevBucket = selectedIdx > 0 ? buckets[selectedIdx - 1] : null;

  const max = Math.max(1, budgetCents, ...buckets.map((b) => b.total));
  const ytd = buckets.slice(0, currentIdx + 1).reduce((s, b) => s + b.total, 0);
  const projectedRestOfYear = buckets.slice(currentIdx + 1).reduce((s, b) => s + b.total, 0);

  const daysInMonth = new Date(year, currentMonthStart.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - now.getDate();

  const selectedDelta = prevBucket ? selectedBucket.total - prevBucket.total : null;
  const selectedTag = selectedIdx > currentIdx ? 'Projected' : selectedIdx === currentIdx ? 'In progress' : null;

  // Recurring-only per-category split for the breakdown rows — byCategory
  // stays mixed (recurring + one-off) per decision 1, so subtract each
  // category's named one-offs from its byCategory total to avoid double-
  // counting a one-off's dollars in both its category row and its named row.
  const oneOffByCategory = selectedBucket.oneOffItems.reduce((acc, o) => {
    acc[o.category] = (acc[o.category] ?? 0) + o.amount;
    return acc;
  }, {} as Record<string, number>);
  const recurringCategories = CATEGORY_ORDER.filter((c) => selectedBucket.byCategory[c] > (oneOffByCategory[c] ?? 0));

  return (
    <div className="space-y-4">
      {/* Hero — pinned to the current month, never re-renders from column selection */}
      <div className="space-y-2">
        {/* Hearth v2 (Pulse, H1): the month's total is the page's Hero lede;
            the budget sits beside it as its label and is the way to edit it. */}
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h1 className={cn('text-hero-section', budget && budgetDelta < 0 ? 'text-destructive' : 'text-foreground')}>
            {formatMoney(monthlyTotal)}
          </h1>
          {editingBudget ? (
            <input
              autoFocus
              type="number"
              inputMode="decimal"
              value={budgetDraft}
              onChange={(e) => onBudgetDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSaveBudget(budgetDraft ? Number(budgetDraft) : null);
                if (e.key === 'Escape') onCancelEditingBudget();
              }}
              onBlur={() => onSaveBudget(budgetDraft ? Number(budgetDraft) : null)}
              placeholder="Monthly budget"
              aria-label="Monthly budget"
              className="h-9 w-36 rounded-lg border border-input bg-muted px-2.5 text-right text-base font-medium tabular-nums text-foreground"
            />
          ) : budget ? (
            <button
              onClick={() => onStartEditingBudget(String(budget))}
              className="font-heading text-base font-semibold tabular-nums text-muted-foreground hover:text-foreground transition-colors"
              title="Edit monthly budget"
            >
              of {formatMoney(budgetCents)} planned
            </button>
          ) : (
            <span className="font-heading text-base font-semibold text-muted-foreground">this month</span>
          )}
        </div>
        {budget ? (
          <>
            {/* H3: the lede's own 3px meter, sized to the lede, not the page. */}
            <ProgressBar
              value={monthlyTotal}
              total={budgetCents}
              fillClassName={budgetDelta < 0 ? 'bg-destructive' : 'bg-success'}
              className="h-[3px] max-w-sm"
            />
            <p className="text-xs tabular-nums text-muted-foreground">
              {budgetDelta < 0 ? (
                <span className="text-destructive">{formatMoney(-budgetDelta)} over plan</span>
              ) : (
                <>
                  <span className="text-success">{formatMoney(budgetDelta)} under plan</span> · {daysLeft}d left
                </>
              )}
            </p>
          </>
        ) : (
          <button
            onClick={() => onStartEditingBudget('')}
            className="text-xs font-medium text-primary hover:text-primary/80"
          >
            Set a budget
          </button>
        )}
      </div>

      {/* Pulse tiles. A month-over-month change is not a status (H2): no
          budget is crossed by it, so it stays neutral, sign first. */}
      <div className="grid grid-cols-3 gap-2">
        <PulseTile
          label={hasPrevMonthData ? `vs ${prevMonthLabel}` : 'vs last month'}
          value={
            hasPrevMonthData
              ? momDelta === 0
                ? formatMoney(0)
                : `${momDelta > 0 ? '+' : '−'}${formatMoney(Math.abs(momDelta))}`
              : '–'
          }
        />
        <PulseTile label="Rest of year" value={formatMoney(projectedRestOfYear)} />
        <PulseTile label="Year to date" value={formatMoney(ytd)} />
      </div>

      {/* 12-month chart + the breakdown it drives: one card (H4), the two
          halves split by a hairline instead of two bordered panels. */}
      <div className="rounded-3xl border border-border/60 bg-card shadow-[var(--card-shadow)]">
      <div className="px-4 pt-4 pb-3">
        <div className="relative flex items-end gap-1 h-28">
          {budget && (
            <div
              className="absolute left-0 right-0 border-t border-dashed border-foreground/40 z-10"
              style={{ bottom: `${Math.min((budgetCents / max) * 100, 100)}%` }}
            />
          )}
          {buckets.map((b, i) => (
            <button
              key={i}
              type="button"
              aria-pressed={selectedIdx === i}
              aria-label={`${b.label}: ${formatMoney(b.total)}`}
              onClick={() => onSelectMonth(i)}
              className={`relative flex-1 h-full flex flex-col justify-end rounded-t px-0.5 pt-1 cursor-pointer transition-colors ${
                selectedIdx === i ? 'bg-primary/10 ring-1 ring-primary/40' : 'hover:bg-muted/50'
              }`}
            >
              <div className="rounded-t overflow-hidden flex flex-col justify-end h-full bg-muted/20">
                <div className={ONE_OFF_FILL + (i > currentIdx ? ` ${PROJECTED_OPACITY}` : '')} style={{ height: `${(b.oneOff / max) * 100}%` }} />
                {recurringByCategory(b).reverse().map((s) => (
                  <div
                    key={s.category}
                    className={`cost-chart-segment ${CATEGORY_COLOR[s.category].fill}` + (i > currentIdx ? ` ${PROJECTED_OPACITY}` : '')}
                    style={{ height: `${(s.amount / max) * 100}%` }}
                  />
                ))}
              </div>
            </button>
          ))}
        </div>
        <div className="flex gap-1 mt-1.5">
          {buckets.map((b, i) => (
            <div
              key={i}
              className={`flex-1 text-center text-[10px] transition-colors ${selectedIdx === i ? 'text-foreground font-medium' : 'text-muted-foreground'}`}
            >
              {b.label}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`h-2 w-2 rounded-full ${ONE_OFF_FILL}`} />
            One-offs
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`h-2 w-2 rounded-full ${ONE_OFF_FILL} ${PROJECTED_OPACITY}`} />
            Projected
          </span>
          {budget && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-0 w-2.5 border-t border-dashed border-foreground/40" />
              Plan
            </span>
          )}
        </div>
      </div>

      {/* Breakdown — follows the selected column */}
      <div className="border-t border-border/60 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-foreground">{selectedBucket.label}</span>
          <span className="flex items-center gap-2 text-xs">
            {selectedDelta !== null && selectedDelta !== 0 && (
              <span className="tabular-nums text-muted-foreground">
                {selectedDelta > 0 ? '+' : '−'}{formatMoney(Math.abs(selectedDelta))}
              </span>
            )}
            {selectedTag && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                {selectedTag}
              </span>
            )}
            <span className="tabular-nums font-semibold text-foreground">{formatMoney(selectedBucket.total)}</span>
          </span>
        </div>

        {selectedBucket.total > 0 && (
          <div className="flex h-2 rounded-full overflow-hidden gap-0.5">
            {recurringCategories.map((c) => (
              <div
                key={c}
                className={`cost-chart-segment ${CATEGORY_COLOR[c].fill}`}
                style={{ width: `${((selectedBucket.byCategory[c] - (oneOffByCategory[c] ?? 0)) / selectedBucket.total) * 100}%` }}
              />
            ))}
            {selectedBucket.oneOff > 0 && (
              <div className={ONE_OFF_FILL} style={{ width: `${(selectedBucket.oneOff / selectedBucket.total) * 100}%` }} />
            )}
          </div>
        )}

        <div className="space-y-1">
          {recurringCategories.map((c) => {
            const active = selectedCategory === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => onSelectCategory(c)}
                className={`w-full flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-left transition-colors ${
                  active ? 'bg-primary/10 ring-1 ring-primary/50' : 'hover:bg-muted/60'
                }`}
              >
                <span className={`h-2 w-2 rounded-full flex-shrink-0 ${CATEGORY_COLOR[c].dot}`} />
                <span className="flex-1 text-foreground truncate">{CATEGORY_META[c].label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatMoney(selectedBucket.byCategory[c] - (oneOffByCategory[c] ?? 0))}
                </span>
              </button>
            );
          })}
          {selectedBucket.oneOffItems.length === 0 ? (
            selectedIdx > currentIdx && <p className="text-xs text-muted-foreground pt-1">No one-offs planned yet</p>
          ) : (
            selectedBucket.oneOffItems.map((o, i) => (
              <div key={i} className="flex items-center gap-1.5 px-1.5 py-1 text-xs">
                <span className={`h-2 w-2 rounded-full flex-shrink-0 ${ONE_OFF_FILL}`} />
                <span className="flex-1 text-foreground truncate">{o.name}</span>
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground flex-shrink-0">
                  one-off
                </span>
                <span className="tabular-nums text-muted-foreground">{formatMoney(o.amount)}</span>
              </div>
            ))
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
