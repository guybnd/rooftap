'use client';

// Up Bank connector: Up on the Costs dashboard. Everyday and saver balances
// and this month's spending lead as three small figures (the page's Hero stays
// the planned total, H1), then any cost line whose latest Up payment differs
// from its amount, with one Update action each (controls live with what they
// control), then the biggest categories and the latest transactions as
// hairline-divided rows inside the one card (H4). It shows only once this
// person has connected Up in Settings > Connectors. Data comes from
// UpOverviewProvider (core up-overview.ts).
// Native twin: apps/mobile/src/features/costs/up-spending.tsx.

import { ProgressBar } from '@/components/ui/progress-bar';
import { cn } from '@/lib/utils';
import { bankNudges, formatMoney, timeAgo, useUpOverview, type CostItem } from '@homeup/core';

const AUD = { currency: 'AUD' };

export function UpSpendingCard({
  nameOf,
  currentUserId,
  items,
  budgetCents,
  onSetAmount,
}: {
  nameOf: (userId: string) => string;
  currentUserId: string | null;
  items: CostItem[];
  /** The household's monthly budget (0 when none is set): spending is measured against it. */
  budgetCents: number;
  onSetAmount: (item: CostItem, cents: number) => void;
}) {
  const { status, data: spending, error, month, scope } = useUpOverview();
  if (!status?.allowed || !status.connection) return null;
  const monthName = new Date(`${month}T00:00:00`).toLocaleString('default', { month: 'long' });
  const title = ['Up Bank', scope === 'mine' ? 'Mine' : scope === 'household' ? 'Household' : null, monthName].filter(Boolean).join(' · ');
  // A personal view isn't measured against the household's budget.
  const showBudget = budgetCents > 0 && scope !== 'mine' && !!spending;
  const over = !!spending && spending.spentCents > budgetCents;
  const nudges = spending?.links ? bankNudges(items, spending.links) : [];
  const hasBalances = !!spending?.accounts && spending.accounts.length > 0;

  return (
    <div className="rounded-3xl border border-border/60 bg-card px-4 py-3 shadow-[var(--card-shadow)]">
      <h2 className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{title}</h2>

      {!spending ? (
        <p className="py-2 text-sm text-muted-foreground">{error ?? 'Reading your transactions…'}</p>
      ) : (
        <>
          {hasBalances ? (
            <div className="grid grid-cols-3 gap-3 pt-2">
              <Figure label="Everyday" cents={spending.everydayCents ?? 0} />
              <Figure label="Savers" cents={spending.saversCents ?? 0} />
              <Figure label="Spent" cents={spending.spentCents} />
            </div>
          ) : (
            <div className="flex items-baseline gap-2 pt-1">
              <span className="text-3xl font-semibold tabular-nums text-foreground">{formatMoney(spending.spentCents, AUD)}</span>
              <span className="text-sm text-muted-foreground">spent</span>
            </div>
          )}
          {showBudget && (
            <div className="flex items-center gap-2 pt-2">
              <ProgressBar value={spending.spentCents} total={budgetCents} fillClassName={over ? 'bg-destructive' : 'bg-success'} className="w-[52px]" />
              <span className={cn('text-xs tabular-nums', over ? 'text-destructive' : 'text-muted-foreground')}>
                Spent {formatMoney(spending.spentCents, AUD)} of {formatMoney(budgetCents, AUD)}
              </span>
            </div>
          )}
          <p className="pt-1 text-xs tabular-nums text-muted-foreground">
            {spending.receivedCents > 0 ? `${formatMoney(spending.receivedCents, AUD)} in · ` : ''}
            {status.connection.live ? 'updates live' : `read ${(timeAgo(status.connection.lastSyncedAt) ?? 'just now').toLowerCase()}`}
          </p>
          {error && <p className="pt-1 text-xs text-destructive">{error}</p>}

          {nudges.length > 0 && (
            <div className="mt-2 divide-y divide-border/60 border-t border-border/60">
              {nudges.map((n) => (
                <div key={n.item.id} className="flex min-h-[52px] items-center gap-3 py-2">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-warning" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {n.item.name} went {n.paidCents > (n.item.amount ?? 0) ? 'up' : 'down'}
                    </p>
                    <p className="truncate text-xs tabular-nums text-muted-foreground">
                      Paid {formatMoney(n.paidCents)} {(timeAgo(n.paidAt) ?? '').toLowerCase()}, the line says {formatMoney(n.item.amount ?? 0)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSetAmount(n.item, n.paidCents)}
                    className="min-h-10 shrink-0 px-1 text-sm font-semibold text-primary hover:text-primary/80"
                  >
                    Update
                  </button>
                </div>
              ))}
            </div>
          )}

          {spending.categories.length > 0 && (
            <div className="mt-2 divide-y divide-border/60 border-t border-border/60">
              {spending.categories.slice(0, 4).map((c) => (
                <div key={c.id} className="flex min-h-10 items-center gap-3 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate text-foreground">{c.label}</span>
                  <span className="tabular-nums text-muted-foreground">{formatMoney(c.cents, AUD)}</span>
                </div>
              ))}
            </div>
          )}

          {spending.recent.length > 0 ? (
            <>
              <h3 className="pt-3 text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Latest</h3>
              <div className="divide-y divide-border/60">
                {spending.recent.map((t) => {
                  const meta = [
                    t.pending ? 'Pending' : null,
                    t.categoryLabel,
                    timeAgo(t.occurredAt),
                    t.userId !== currentUserId ? nameOf(t.userId) : null,
                  ].filter(Boolean);
                  return (
                    <div key={t.id} className="flex min-h-[52px] items-center gap-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{t.description}</p>
                        <p className="truncate text-xs text-muted-foreground">{meta.join(' · ')}</p>
                      </div>
                      <span className={t.amountCents > 0 ? 'text-sm tabular-nums text-success' : 'text-sm tabular-nums text-foreground'}>
                        {t.amountCents > 0 ? '+' : ''}
                        {formatMoney(Math.abs(t.amountCents), AUD)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="py-2 text-sm text-muted-foreground">No Up transactions this month yet.</p>
          )}
        </>
      )}
    </div>
  );
}

function Figure({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <p className="truncate text-lg font-semibold tabular-nums text-foreground">{formatMoney(cents, AUD)}</p>
    </div>
  );
}
