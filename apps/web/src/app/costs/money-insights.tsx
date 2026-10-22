'use client';

// Up Bank connector: the money section on Costs > Plan (Guy's pick A,
// "Stacked"), in place of the old Up card. With joint payments filed as cost
// lines the card's totals repeated the lines, so this shows what the lines
// can't: where the month should end (forecast), nudges worth a look, and the
// latest payments. Three sibling cards, one border level each (H4); status
// hues only in the words and figures that carry them (H2). Shown once this
// person has Up connected (UpOverviewProvider, core up-overview.ts); the
// numbers come from core money-insights.ts.
// Native twin: apps/mobile/src/features/costs/money-insights.tsx.

import { useMemo } from 'react';
import {
  billsDue,
  formatMoney,
  monthForecast,
  monthStartOf,
  moneyNudgeCopy,
  moneyNudges,
  timeAgo,
  useBankActuals,
  useUpOverview,
  type CostItem,
  type MoneyNudge,
} from '@homeup/core';
import { cn } from '@/lib/utils';

const AUD = { currency: 'AUD' };

const LABEL = 'text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground';
const CARD = 'rounded-3xl border border-border/60 bg-card px-4 shadow-[var(--card-shadow)]';

export function MoneyInsights({
  items,
  allItems,
  budgetCents,
  currentUserId,
  nameOf,
  onOpenItem,
  onOpenMoney,
  onSetAmount,
}: {
  /** The lines that count this month (targets left out). */
  items: CostItem[];
  /** Every line, to name the line a payment went to. */
  allItems: CostItem[];
  budgetCents: number;
  currentUserId: string | null;
  nameOf: (userId: string) => string;
  onOpenItem: (item: CostItem) => void;
  onOpenMoney: () => void;
  onSetAmount: (item: CostItem, cents: number) => void;
}) {
  const { status, data, error, month, scope } = useUpOverview();
  const bank = useBankActuals();
  const now = useMemo(() => new Date(), []);
  const byId = useMemo(() => new Map(allItems.map((i) => [i.id, i])), [allItems]);
  const links = useMemo(() => data?.links ?? [], [data]);
  const nudges = useMemo(
    () => (data ? moneyNudges({ items, links, bank, accounts: scope === 'mine' ? [] : data.accounts, now }) : []),
    [data, items, links, bank, scope, now],
  );
  if (!status?.allowed || !status.connection) return null;
  if (!data) return <p className="px-1 text-sm text-muted-foreground">{error ?? 'Reading your Up payments…'}</p>;

  // The forecast is about this month; the Money view may have stepped back.
  const thisMonth = month === monthStartOf(now);
  const forecast = thisMonth ? monthForecast(items, bank, data.spentCents, now) : null;
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const toCome = thisMonth ? billsDue(items, links, now, monthEnd.getDate() - now.getDate()) : [];
  // A personal view isn't measured against the household's budget.
  const showBudget = budgetCents > 0 && scope !== 'mine';
  const overBy = forecast && showBudget ? forecast.forecastCents - budgetCents : 0;
  const share = forecast && forecast.forecastCents > 0 ? Math.min(1, forecast.spentCents / forecast.forecastCents) : 0;
  const monthName = now.toLocaleString('default', { month: 'short' });

  return (
    <div className="space-y-4">
      {forecast && (
        <div className={cn(CARD, 'space-y-2 py-3')}>
          <h2 className={LABEL}>{scope === 'mine' ? 'Mine this month' : 'This month'}</h2>
          <p className="text-sm text-foreground">
            On track for <span className="font-semibold tabular-nums">{formatMoney(forecast.forecastCents, AUD)}</span> by{' '}
            {monthEnd.getDate()} {monthName}
            {showBudget && (
              <span className={cn('tabular-nums', overBy > 0 ? 'text-warning' : 'text-success')}>
                {' · '}
                {overBy > 0 ? `${formatMoney(overBy, AUD)} over budget` : `${formatMoney(-overBy, AUD)} under budget`}
              </span>
            )}
          </p>
          <div className="h-[3px] overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(share * 100)}%` }} />
          </div>
          <p className="text-xs tabular-nums text-muted-foreground">
            {formatMoney(forecast.spentCents, AUD)} spent
            {forecast.toComeCents > 0 ? ` · ${formatMoney(forecast.toComeCents, AUD)} still to come` : ''}
            {toCome.length > 0 ? `: ${toCome.slice(0, 3).map((b) => b.item.name).join(', ')}` : ''}
          </p>
        </div>
      )}

      {nudges.length > 0 && (
        <section className="space-y-2">
          <h2 className={cn(LABEL, 'px-1')}>Heads up</h2>
          <div className={cn(CARD, 'divide-y divide-border/60')}>
            {nudges.map((n) => (
              <NudgeRow key={n.key} nudge={n} now={now} onOpenItem={onOpenItem} onSetAmount={onSetAmount} />
            ))}
          </div>
        </section>
      )}

      {data.recent.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-baseline justify-between px-1">
            <h2 className={LABEL}>Latest</h2>
            <button type="button" onClick={onOpenMoney} className="min-h-10 px-1 text-sm font-semibold text-primary hover:text-primary/80">
              All in Money
            </button>
          </div>
          <div className={cn(CARD, 'divide-y divide-border/60')}>
            {data.recent.slice(0, 5).map((t) => {
              const line = t.costItemId ? byId.get(t.costItemId) ?? null : null;
              const meta = [
                t.pending ? 'Pending' : null,
                timeAgo(t.occurredAt),
                line ? line.name : t.categoryLabel,
                t.userId !== currentUserId ? nameOf(t.userId) : null,
              ].filter(Boolean);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => (line ? onOpenItem(line) : onOpenMoney())}
                  className="flex min-h-[52px] w-full items-center gap-3 py-2 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{t.description}</p>
                    <p className="truncate text-xs text-muted-foreground">{meta.join(' · ')}</p>
                  </div>
                  <span className={cn('text-sm tabular-nums', t.amountCents > 0 ? 'text-success' : 'text-foreground')}>
                    {t.amountCents > 0 ? '+' : ''}
                    {formatMoney(Math.abs(t.amountCents), AUD)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function NudgeRow({
  nudge,
  now,
  onOpenItem,
  onSetAmount,
}: {
  nudge: MoneyNudge;
  now: Date;
  onOpenItem: (item: CostItem) => void;
  onSetAmount: (item: CostItem, cents: number) => void;
}) {
  const copy = moneyNudgeCopy(nudge, now);
  const item = 'item' in nudge ? nudge.item : null;
  return (
    <div className="flex min-h-[56px] items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{copy.title}</p>
        <p className="truncate text-xs tabular-nums text-muted-foreground">{copy.detail}</p>
      </div>
      {nudge.kind === 'differs' ? (
        <button
          type="button"
          onClick={() => onSetAmount(nudge.item, nudge.paidCents)}
          className="min-h-10 shrink-0 px-1 text-sm font-semibold text-primary hover:text-primary/80"
        >
          Update
        </button>
      ) : copy.figure ? (
        <span
          className={cn(
            'shrink-0 text-sm tabular-nums',
            copy.figure.tone === 'warning' ? 'text-warning' : copy.figure.tone === 'success' ? 'text-success' : 'text-muted-foreground',
          )}
        >
          {copy.figure.text}
        </span>
      ) : item ? (
        <button type="button" onClick={() => onOpenItem(item)} className="min-h-10 shrink-0 px-1 text-sm font-semibold text-primary hover:text-primary/80">
          Open
        </button>
      ) : null}
    </div>
  );
}
