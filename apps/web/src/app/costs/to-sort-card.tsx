'use client';

// The "To sort" card on Costs (Guy picked it with the quick moves,
// 2026-10-23): this month's new shops, one at a time. The bank's guess is a
// one-tap "Yes", the likely other categories sit under it, and "Other" opens
// the full picker. Saying where a shop goes files it for good (core
// moveCostLine); Skip hides it on this device until the month is over. The
// dots show how many are left. Phone twin: apps/mobile/src/features/costs/to-sort-card.tsx.

import { useState } from 'react';
import {
  CATEGORY_META,
  costShopsToSort,
  formatMoney,
  lineMeta,
  likelyCostCategories,
  skipShop,
  squashVendor,
  useSkippedShops,
  type CostCategory,
  type CostMonth,
  type CostMonthLine,
} from '@homeup/core';
import { commit, tick } from '@/lib/haptics';
import { cn } from '@/lib/utils';
import { CategoryGlyph } from './category-glyph';

const LABEL = 'text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground';
const CARD = 'overflow-hidden rounded-3xl border border-border/60 bg-card shadow-[var(--card-shadow)]';
const CHIP = 'flex min-h-11 items-center gap-2 rounded-2xl border border-border px-3 text-sm text-foreground transition-colors hover:bg-muted';
const DOTS = 6;

export function ToSortCard({
  month,
  monthName,
  choices,
  onSort,
  onOther,
}: {
  month: CostMonth;
  monthName: string;
  choices: readonly CostCategory[];
  onSort: (line: CostMonthLine, category: CostCategory) => void;
  onOther: (line: CostMonthLine, guess: CostCategory | null, then: () => void) => void;
}) {
  const skipped = useSkippedShops(month.month);
  // Sorted here: gone at once, before the bank overview reads again.
  const [done, setDone] = useState<string[]>([]);
  const list = costShopsToSort(month, [...skipped, ...done]);
  if (!list.length) return null;
  const { line, guess } = list[0];
  const vendor = line.vendor ?? line.name;
  const finish = () => setDone((cur) => [...cur, squashVendor(vendor)]);
  const sort = (c: CostCategory) => {
    commit();
    finish();
    onSort(line, c);
  };
  const others = likelyCostCategories(line, guess, month, choices, guess ? 2 : 3);
  const handled = done.length + skipped.length;
  const total = handled + list.length;
  const at = Math.min(handled, DOTS - 1);
  const meta = [formatMoney(line.paidCents), lineMeta(line, monthName)].filter(Boolean).join(' · ');

  return (
    <section className="space-y-2" aria-label="To sort">
      <div className="flex items-center justify-between px-1">
        <p className={LABEL}>To sort</p>
        <p className="text-xs tabular-nums text-muted-foreground">{list.length === 1 ? '1 new shop' : `${list.length} new shops`}</p>
      </div>
      <div className={cn(CARD, 'space-y-3 p-4')}>
        <div className="flex items-center gap-3">
          {guess ? <CategoryGlyph category={guess} /> : <span className="size-7 shrink-0 rounded-[9px] border border-dashed border-muted-foreground/60" />}
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-foreground">{line.name}</p>
            <p className="truncate text-xs tabular-nums text-muted-foreground">{meta}</p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{guess ? `Your bank calls it ${CATEGORY_META[guess].label}. Is that right?` : 'Where does it go?'}</p>
        {guess ? (
          <button type="button" onClick={() => sort(guess)} className="flex min-h-11 w-full items-center justify-center rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90">
            Yes, {CATEGORY_META[guess].label}
          </button>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {others.map((c) => (
            <button key={c} type="button" aria-label={`Move to ${CATEGORY_META[c].label}`} onClick={() => sort(c)} className={CHIP}>
              <CategoryGlyph category={c} />
              {CATEGORY_META[c].label}
            </button>
          ))}
          <button type="button" aria-label={`Pick a category for ${line.name}`} onClick={() => onOther(line, guess, finish)} className={CHIP}>
            Other
          </button>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5" aria-label={`${handled + 1} of ${total}`}>
            {Array.from({ length: Math.min(total, DOTS) }, (_, n) => (
              <span key={n} className={cn('size-1.5 rounded-full', n < at ? 'bg-muted-foreground' : n === at ? 'bg-foreground' : 'bg-muted')} />
            ))}
          </div>
          <button
            type="button"
            aria-label={`Skip ${line.name} for now`}
            onClick={() => {
              tick();
              skipShop(month.month, vendor);
            }}
            className="min-h-11 px-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Skip
          </button>
        </div>
      </div>
    </section>
  );
}
