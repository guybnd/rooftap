'use client';

// The Costs glance card (Guy, 2026-10-23): one card under the month with two
// pages, Latest (the last few payments, as on Home's Budget space) and Worth a
// look (the money insights). Swipe or scroll between them, or pick a tab;
// nothing moves on its own. It opens on Worth a look, with a dot on its tab,
// while an insight is new to this device (core seen-insights.ts). With one
// page it is a plain card under that page's label. A latest payment opens All
// payments on click; right-click (or a long press) moves it to another
// category. Phone twin: apps/mobile/src/features/costs/costs-glance.tsx.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { costCategoryFromUp, formatMoney, recentDayLabel, recentVerdictText, timeAgo, type CostCategory, type CostItem, type RecentBar, type RecentSpendState, type SpendingTransaction } from '@homeup/core';
import { tick } from '@/lib/haptics';
import { cn } from '@/lib/utils';
import { CategoryGlyph } from './category-glyph';

const LABEL = 'text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground';
const CARD = 'overflow-hidden rounded-3xl border border-border/60 bg-card shadow-[var(--card-shadow)]';

export interface GlancePage {
  key: string;
  label: string;
  /** Something new on the page: a dot on its tab. */
  dot?: boolean;
  node: ReactNode;
}

export function CostsGlance({ pages, initial, onPage }: { pages: GlancePage[]; initial: number; onPage?: (key: string) => void }) {
  const [page, setPage] = useState(() => Math.max(0, Math.min(initial, pages.length - 1)));
  const scroller = useRef<HTMLDivElement | null>(null);
  const placed = useRef(false);
  const at = Math.min(page, pages.length - 1);
  const shownKey = pages[at]?.key;

  useEffect(() => {
    if (shownKey) onPage?.(shownKey);
  }, [shownKey, onPage]);

  if (!pages.length) return null;
  if (pages.length === 1) {
    return (
      <section className="space-y-2" aria-label={pages[0].label}>
        <h2 className={cn(LABEL, 'px-1')}>{pages[0].label}</h2>
        <div className={CARD}>{pages[0].node}</div>
      </section>
    );
  }

  const go = (n: number) => {
    const el = scroller.current;
    if (el) el.scrollTo({ left: n * el.clientWidth, behavior: 'smooth' });
    if (n !== at) {
      tick();
      setPage(n);
    }
  };

  return (
    <section className="space-y-2" aria-label="At a glance">
      <div role="tablist" className="flex gap-4 px-1">
        {pages.map((p, n) => (
          <button
            key={p.key}
            type="button"
            role="tab"
            aria-selected={n === at}
            aria-label={p.dot ? `${p.label}, new` : p.label}
            onClick={() => go(n)}
            className={cn(LABEL, 'flex min-h-6 items-center gap-1.5 hover:text-foreground', n === at && 'text-foreground')}
          >
            {p.label}
            {p.dot && n !== at ? <span className="size-1.5 rounded-full bg-primary" /> : null}
          </button>
        ))}
      </div>
      <div
        ref={(el) => {
          scroller.current = el;
          if (el && !placed.current) {
            placed.current = true;
            el.scrollLeft = at * el.clientWidth;
          }
        }}
        onScroll={(e) => {
          const el = e.currentTarget;
          const n = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
          if (n !== at && n >= 0 && n < pages.length) setPage(n);
        }}
        className={cn(CARD, 'flex snap-x snap-mandatory items-start overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden')}
      >
        {pages.map((p, n) => (
          <div key={p.key} role="tabpanel" aria-label={p.label} aria-hidden={n !== at} className="w-full shrink-0 snap-start">
            {p.node}
          </div>
        ))}
      </div>
      <div className="flex justify-center gap-1.5" aria-hidden>
        {pages.map((p, n) => (
          <span key={p.key} className={cn('size-1.5 rounded-full', n === at ? 'bg-foreground' : 'bg-muted')} />
        ))}
      </div>
    </section>
  );
}

/** A latest payment's category: its cost line's, else the bank's. */
export function latestCategory(t: SpendingTransaction, line: CostItem | undefined): CostCategory | null {
  return line?.category ?? (t.category ? costCategoryFromUp(t.category) : null);
}

/** The last few payments, as rows. */
export function LatestRows({
  payments,
  lineById,
  onOpen,
  onMove,
}: {
  payments: readonly SpendingTransaction[];
  lineById: ReadonlyMap<string, CostItem>;
  onOpen: () => void;
  onMove?: ((t: SpendingTransaction) => void) | null;
}) {
  return (
    <div>
      {payments.map((t, n) => {
        const line = t.costItemId ? lineById.get(t.costItemId) : undefined;
        const category = latestCategory(t, line);
        const canMove = !!onMove && t.amountCents < 0;
        return (
          <button
            key={t.id}
            type="button"
            title={canMove ? 'Right-click to move it to another category' : undefined}
            onClick={onOpen}
            onContextMenu={
              canMove
                ? (e) => {
                    e.preventDefault();
                    onMove(t);
                  }
                : undefined
            }
            className={cn('flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left hover:bg-muted/40', n > 0 && 'border-t border-border/60')}
          >
            {category ? <CategoryGlyph category={category} /> : <span className="size-7 shrink-0 rounded-[9px] border border-dashed border-muted-foreground/60" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">{t.description}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {[t.pending ? 'Pending' : null, timeAgo(t.occurredAt), line ? line.name : t.categoryLabel].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className={cn('text-sm tabular-nums', t.amountCents > 0 ? 'text-success' : 'text-foreground')}>
              {t.amountCents > 0 ? '+' : ''}
              {formatMoney(Math.abs(t.amountCents))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const VERDICT_TONE = { under: 'text-success', usual: 'text-muted-foreground', over: 'text-warning' } as const;

/**
 * The Latest page with recent spending on top (Guy, 2026-10-24): a box per
 * window (today, 3 days, 7 days by default), each against a usual stretch.
 * Clicking a box opens it: the last two weeks as bars with the window lit,
 * and that stretch's payments in a list that scrolls. Clicking it again goes
 * back to the last few payments. Phone twin: costs-glance.tsx LatestPage.
 */
export function LatestPage({
  recent,
  latest,
  lineById,
  onOpen,
  onMove,
  onSettings,
  skipBills,
}: {
  recent: RecentSpendState;
  latest: readonly SpendingTransaction[];
  lineById: ReadonlyMap<string, CostItem>;
  onOpen: () => void;
  onMove?: ((t: SpendingTransaction) => void) | null;
  onSettings: () => void;
  skipBills: boolean;
}) {
  const { windows, open, toggle, bars, payments, error } = recent;
  return (
    <div>
      {windows.length ? (
        <div role="tablist" aria-label="Recent spending" className="grid border-b border-border/60" style={{ gridTemplateColumns: `repeat(${windows.length}, minmax(0, 1fr))` }}>
          {windows.map((w, n) => {
            const verdict = recentVerdictText(w);
            const on = open === w.days;
            return (
              <button
                key={w.days}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => {
                  tick();
                  toggle(w.days);
                }}
                className={cn('flex min-w-0 flex-col gap-0.5 px-3 py-2.5 text-left hover:bg-muted/40', n > 0 && 'border-l border-border/60', on && 'bg-muted/50')}
              >
                <span className={cn(LABEL, on && 'text-foreground')}>{w.label}</span>
                <span className="text-lg font-semibold tabular-nums text-foreground">{formatMoney(w.cents)}</span>
                {verdict ? <span className={cn('truncate text-[11px] tabular-nums', VERDICT_TONE[w.verdict!])}>{verdict}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
      {open != null && bars ? (
        <div>
          <RecentBars bars={bars} usualCents={windows.find((w) => w.days === open)?.usualCents ?? null} days={open} />
          {payments ? (
            payments.length ? (
              <div className="max-h-[312px] overflow-y-auto border-t border-border/60">
                <LatestRows payments={payments} lineById={lineById} onOpen={onOpen} onMove={onMove} />
              </div>
            ) : (
              <p className="border-t border-border/60 px-4 py-4 text-sm text-muted-foreground">Nothing went out.</p>
            )
          ) : (
            <p className="border-t border-border/60 px-4 py-4 text-sm text-muted-foreground">{error ?? 'Reading payments'}</p>
          )}
          <div className="flex items-center justify-between border-t border-border/60 px-4 py-2.5">
            <span className="text-xs tabular-nums text-muted-foreground">
              {[payments ? `${payments.length} ${payments.length === 1 ? 'payment' : 'payments'}` : null, skipBills ? 'Bills left out' : null].filter(Boolean).join(' · ')}
            </span>
            <button type="button" onClick={onSettings} className="text-xs font-medium text-primary hover:underline">
              Change
            </button>
          </div>
        </div>
      ) : latest.length ? (
        <LatestRows payments={latest} lineById={lineById} onOpen={onOpen} onMove={onMove} />
      ) : null}
    </div>
  );
}

const BARS_HEIGHT = 72;

/** A bar per day, the open window's days lit, a dashed line at a usual day. */
function RecentBars({ bars, usualCents, days }: { bars: readonly RecentBar[]; usualCents: number | null; days: number }) {
  const usualDay = usualCents != null ? usualCents / days : null;
  const top = Math.max(1, ...bars.map((b) => b.cents), usualDay ?? 0);
  const total = bars.filter((b) => b.lit).reduce((s, b) => s + b.cents, 0);
  return (
    <div className="space-y-1 px-4 pb-2 pt-3" role="img" aria-label={`${formatMoney(total)} over the last ${days === 1 ? 'day' : `${days} days`}, a bar per day`}>
      <div className="relative flex items-end gap-[3px]" style={{ height: BARS_HEIGHT }}>
        {bars.map((b) => (
          <span
            key={b.day}
            title={`${recentDayLabel(b.day)}: ${formatMoney(b.cents)}`}
            className={cn('flex-1 rounded-[3px]', b.lit ? 'bg-foreground' : 'bg-muted')}
            style={{ height: Math.max(2, Math.round((b.cents / top) * BARS_HEIGHT)) }}
          />
        ))}
        {usualDay ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-muted-foreground/70"
            style={{ bottom: Math.round((usualDay / top) * BARS_HEIGHT) }}
          />
        ) : null}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{recentDayLabel(bars[0]?.day)}</span>
        {usualDay ? <span>Dashed line: a usual day</span> : null}
        <span>Today</span>
      </div>
    </div>
  );
}
