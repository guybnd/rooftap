// Up Bank connector: this month's spending on the Costs screen. It leads with
// one Display number (H1), lists the biggest categories and the latest
// transactions as hairline-divided rows inside the one card (H4), and reads
// new transactions from Up each time Costs opens (the server skips that when
// it read Up under a minute ago). It shows only once this person has
// connected Up in Settings > Connectors.
// Web twin: apps/web/src/app/costs/up-spending.tsx.
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Card, Text } from '@homeup/ui';
import { formatMoney, monthStartOf, timeAgo, type UpBankStatus, type UpSpending } from '@homeup/core';
import { upBankApi } from './up-bank-api';

const AUD = { currency: 'AUD' };
const TABULAR = { fontVariant: ['tabular-nums' as const] };

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
        const first = await upBankApi.spending(month);
        if (live) setSpending(first);
        const synced = await upBankApi.sync().catch((err: unknown) => {
          if (live) setError(err instanceof Error ? err.message : "Couldn't reach Up.");
          return null;
        });
        if (synced && live) {
          setStatus(synced.status);
          if (synced.saved > 0) {
            const next = await upBankApi.spending(month);
            if (live) setSpending(next);
          }
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
    <Card size="sm" className="gap-0 rounded-3xl px-4">
      <Text className="text-[10.5px] font-medium uppercase tracking-[1px] text-muted-foreground">Up Bank · {monthName}</Text>

      {!spending ? (
        <Text className="py-2 text-sm text-muted-foreground">{error ?? 'Reading your transactions…'}</Text>
      ) : (
        <>
          <View className="flex-row items-baseline gap-2 pt-1">
            <Text className="text-3xl font-semibold text-foreground" style={TABULAR}>
              {formatMoney(spending.spentCents, AUD)}
            </Text>
            <Text className="text-sm text-muted-foreground">spent</Text>
          </View>
          <Text className="text-xs text-muted-foreground" style={TABULAR}>
            {spending.receivedCents > 0 ? `${formatMoney(spending.receivedCents, AUD)} in · ` : ''}
            {status.connection.live ? 'updates live' : `read ${(timeAgo(status.connection.lastSyncedAt) ?? 'just now').toLowerCase()}`}
          </Text>
          {error && <Text className="pt-1 text-xs text-destructive">{error}</Text>}

          {spending.categories.length > 0 && (
            <View className="mt-2 border-t border-border/60">
              {spending.categories.slice(0, 4).map((c, i) => (
                <View key={c.id} className={`min-h-10 flex-row items-center gap-3 py-1.5 ${i > 0 ? 'border-t border-border/60' : ''}`}>
                  <Text numberOfLines={1} className="min-w-0 flex-1 text-sm text-foreground">
                    {c.label}
                  </Text>
                  <Text className="text-sm text-muted-foreground" style={TABULAR}>
                    {formatMoney(c.cents, AUD)}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {spending.recent.length > 0 ? (
            <>
              <Text className="pt-3 text-[10.5px] font-medium uppercase tracking-[1px] text-muted-foreground">Latest</Text>
              {spending.recent.map((t, i) => {
                const meta = [
                  t.pending ? 'Pending' : null,
                  t.categoryLabel,
                  timeAgo(t.occurredAt),
                  t.userId !== currentUserId ? nameOf(t.userId) : null,
                ].filter(Boolean);
                return (
                  <View key={t.id} className={`min-h-[52px] flex-row items-center gap-3 py-2 ${i > 0 ? 'border-t border-border/60' : ''}`}>
                    <View className="min-w-0 flex-1">
                      <Text numberOfLines={1} className="text-sm font-medium text-foreground">
                        {t.description}
                      </Text>
                      <Text numberOfLines={1} className="text-xs text-muted-foreground">
                        {meta.join(' · ')}
                      </Text>
                    </View>
                    <Text className={t.amountCents > 0 ? 'text-sm text-success' : 'text-sm text-foreground'} style={TABULAR}>
                      {t.amountCents > 0 ? '+' : ''}
                      {formatMoney(Math.abs(t.amountCents), AUD)}
                    </Text>
                  </View>
                );
              })}
            </>
          ) : (
            <Text className="py-2 text-sm text-muted-foreground">No Up transactions this month yet.</Text>
          )}
        </>
      )}
    </Card>
  );
}
