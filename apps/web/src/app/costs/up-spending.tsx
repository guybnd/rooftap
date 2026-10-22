'use client';

// Up Bank connector: this month's spending on the Costs dashboard. It leads
// with one Display number (H1), lists the biggest categories and the latest
// transactions as hairline-divided rows inside the one card (H4), and reads
// new transactions from Up each time Costs opens (the server skips that when
// it read Up under a minute ago). It shows only once this person has
// connected Up in Settings > Connectors.
// Native twin: apps/mobile/src/features/costs/up-spending.tsx.

import { useEffect, useState } from 'react';
import { formatMoney, monthStartOf, timeAgo, type UpBankStatus, type UpSpending } from '@homeup/core';
import { upBankApi } from '@/lib/up-bank-client';

const AUD = { currency: 'AUD' };

export function UpSpendingCard({ nameOf, currentUserId }: { nameOf: (userId: string) => string; currentUserId: string | null }) {
  const [status, setStatus] = useState<UpBankStatus | null>(null);
  const [spending, setSpending] = useState<UpSpending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const month = monthStartOf(new Date());

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const s = await upBankApi.status();
        if (!live) return;
        setStatus(s);
        if (!s.allowed || !s.connection) return;
        // Show what's stored straight away, then again once Up has been read.
        setSpending(await upBankApi.spending(month));
        const synced = await upBankApi.sync().catch((err: unknown) => {
          if (live) setError(err instanceof Error ? err.message : "Couldn't reach Up.");
          return null;
        });
        if (synced && live) {
          setStatus(synced.status);
          if (synced.saved > 0) setSpending(await upBankApi.spending(month));
        }
      } catch (err) {
        if (live) setError(err instanceof Error ? err.message : "Couldn't load Up spending.");
      }
    })();
    return () => {
      live = false;
    };
  }, [month]);

  if (!status?.allowed || !status.connection) return null;
  const monthName = new Date().toLocaleString('default', { month: 'long' });

  return (
    <div className="rounded-3xl border border-border/60 bg-card px-4 py-3 shadow-[var(--card-shadow)]">
      <h2 className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Up Bank · {monthName}</h2>

      {!spending ? (
        <p className="py-2 text-sm text-muted-foreground">{error ?? 'Reading your transactions…'}</p>
      ) : (
        <>
          <div className="flex items-baseline gap-2 pt-1">
            <span className="text-3xl font-semibold tabular-nums text-foreground">{formatMoney(spending.spentCents, AUD)}</span>
            <span className="text-sm text-muted-foreground">spent</span>
          </div>
          <p className="text-xs tabular-nums text-muted-foreground">
            {spending.receivedCents > 0 ? `${formatMoney(spending.receivedCents, AUD)} in · ` : ''}
            {status.connection.live ? 'updates live' : `read ${(timeAgo(status.connection.lastSyncedAt) ?? 'just now').toLowerCase()}`}
          </p>
          {error && <p className="pt-1 text-xs text-destructive">{error}</p>}

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
