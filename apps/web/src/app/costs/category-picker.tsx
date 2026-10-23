'use client';

// Moving a Costs row or a payment to another category (Guy, 2026-10-23: it
// took nine taps; now a swipe or right-click and a tap). CategoryGrid is the
// "Move to" part of a row's touch sheet; CategoryPickerSheet is what a swipe
// right opens: the likely categories first (core likelyCostCategories), then
// all of them, and for a single payment a switch for whether its shop's other
// payments follow. Phone twin: apps/mobile/src/features/costs/category-picker.tsx.

import { useState } from 'react';
import { Check } from 'lucide-react';
import { CATEGORY_META, type CostCategory } from '@homeup/core';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Switch } from '@/components/ui/switch';
import { tick } from '@/lib/haptics';
import { cn } from '@/lib/utils';
import { CategoryGlyph } from './category-glyph';

export const SHEET =
  'max-h-[88dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-popover px-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-popover-foreground shadow-2xl shadow-black/50 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:pt-4';
const LABEL = 'text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground';

/** Every category as a cell, the current one ringed and checked. */
export function CategoryGrid({ choices, current, onPick }: { choices: readonly CostCategory[]; current: CostCategory | null; onPick: (c: CostCategory) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {choices.map((c) => {
        const on = c === current;
        return (
          <button
            key={c}
            type="button"
            aria-pressed={on}
            aria-label={`Move to ${CATEGORY_META[c].label}`}
            onClick={() => onPick(c)}
            className={cn(
              'flex min-h-11 items-center gap-2 rounded-xl border px-2 text-left transition-colors',
              on ? 'border-primary bg-primary/10' : 'border-transparent bg-muted/60 hover:bg-muted',
            )}
          >
            <CategoryGlyph category={c} />
            <span className="min-w-0 flex-1 truncate text-xs text-foreground">{CATEGORY_META[c].label}</span>
            {on ? <Check className="h-3 w-3 shrink-0 text-primary" /> : null}
          </button>
        );
      })}
    </div>
  );
}

export interface CategoryPick {
  title: string;
  current: CostCategory | null;
  likely: CostCategory[];
  /** For one payment: whether its shop's other payments move with it. */
  scope?: { label: string; hint: string } | null;
  onPick: (category: CostCategory, wholeShop: boolean) => void;
}

export function CategoryPickerSheet({ pick, choices, onClose }: { pick: CategoryPick | null; choices: readonly CostCategory[]; onClose: () => void }) {
  const [wholeShop, setWholeShop] = useState(false);
  const close = () => {
    setWholeShop(false);
    onClose();
  };
  const choose = (c: CostCategory) => {
    if (!pick) return;
    tick();
    close();
    if (c !== pick.current) pick.onPick(c, wholeShop);
  };
  return (
    <BottomSheet open={!!pick} onOpenChange={(o) => { if (!o) close(); }} overlayClassName="bg-black/40" className={SHEET} handleClassName="sm:hidden" popupProps={{ 'aria-label': pick?.title ?? 'Move' }}>
      {pick ? (
        <div className="space-y-3 pb-2 pt-1">
          <p className="truncate text-lg font-semibold text-foreground">{pick.title}</p>
          {pick.likely.length ? (
            <>
              <p className={LABEL}>Likely</p>
              <div className="flex flex-wrap gap-2">
                {pick.likely.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => choose(c)}
                    className="flex min-h-11 items-center gap-2 rounded-2xl border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    <CategoryGlyph category={c} />
                    {CATEGORY_META[c].label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
          <p className={LABEL}>All categories</p>
          <CategoryGrid choices={choices} current={pick.current} onPick={choose} />
          {pick.scope ? (
            <div className="flex min-h-12 items-center gap-3 border-t border-border/60 pt-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-foreground">{pick.scope.label}</div>
                <div className="text-xs text-muted-foreground">{pick.scope.hint}</div>
              </div>
              <Switch checked={wholeShop} onChange={setWholeShop} label={pick.scope.label} />
            </div>
          ) : null}
        </div>
      ) : null}
    </BottomSheet>
  );
}
