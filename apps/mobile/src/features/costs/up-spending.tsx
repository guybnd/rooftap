// Up Bank connector: Up on the Costs screen. Everyday and saver balances and
// this month's spending lead as three small figures (the screen's Hero stays
// the planned total, H1), then any cost line whose latest Up payment differs
// from its amount, with one Update action each, then the biggest categories
// and the latest transactions as hairline-divided rows inside the one card
// (H4). It shows only once this person has connected Up in Settings >
// Connectors. Data comes from core's UpOverviewProvider (up-overview.ts).
// Web twin: apps/web/src/app/costs/up-spending.tsx.
import { Pressable, View } from 'react-native';
import { Card, Text } from '@homeup/ui';
import { bankNudges, formatMoney, timeAgo, useUpOverview, type CostItem } from '@homeup/core';

const AUD = { currency: 'AUD' };
const TABULAR = { fontVariant: ['tabular-nums' as const] };

export function UpSpendingCard({
  nameOf,
  currentUserId,
  items,
  onSetAmount,
}: {
  nameOf: (userId: string) => string;
  currentUserId: string | null;
  items: CostItem[];
  onSetAmount: (item: CostItem, cents: number) => void;
}) {
  const { status, data: spending, error } = useUpOverview();
  if (!status?.allowed || !status.connection) return null;
  const monthName = new Date().toLocaleString('default', { month: 'long' });
  const nudges = spending?.links ? bankNudges(items, spending.links) : [];
  const hasBalances = !!spending?.accounts && spending.accounts.length > 0;

  return (
    <Card size="sm" className="gap-0 rounded-3xl px-4">
      <Text className="text-[10.5px] font-medium uppercase tracking-[1px] text-muted-foreground">Up Bank · {monthName}</Text>

      {!spending ? (
        <Text className="py-2 text-sm text-muted-foreground">{error ?? 'Reading your transactions…'}</Text>
      ) : (
        <>
          {hasBalances ? (
            <View className="flex-row gap-3 pt-2">
              <Figure label="Everyday" cents={spending.everydayCents ?? 0} />
              <Figure label="Savers" cents={spending.saversCents ?? 0} />
              <Figure label="Spent" cents={spending.spentCents} />
            </View>
          ) : (
            <View className="flex-row items-baseline gap-2 pt-1">
              <Text className="text-3xl font-semibold text-foreground" style={TABULAR}>
                {formatMoney(spending.spentCents, AUD)}
              </Text>
              <Text className="text-sm text-muted-foreground">spent</Text>
            </View>
          )}
          <Text className="pt-1 text-xs text-muted-foreground" style={TABULAR}>
            {spending.receivedCents > 0 ? `${formatMoney(spending.receivedCents, AUD)} in this month · ` : ''}
            {status.connection.live ? 'updates live' : `read ${(timeAgo(status.connection.lastSyncedAt) ?? 'just now').toLowerCase()}`}
          </Text>
          {error && <Text className="pt-1 text-xs text-destructive">{error}</Text>}

          {nudges.length > 0 && (
            <View className="mt-2 border-t border-border/60">
              {nudges.map((n, i) => (
                <View key={n.item.id} className={`min-h-[52px] flex-row items-center gap-3 py-2 ${i > 0 ? 'border-t border-border/60' : ''}`}>
                  <View className="h-2 w-2 rounded-full bg-warning" />
                  <View className="min-w-0 flex-1">
                    <Text numberOfLines={1} className="text-sm font-medium text-foreground">
                      {n.item.name} went {n.paidCents > (n.item.amount ?? 0) ? 'up' : 'down'}
                    </Text>
                    <Text numberOfLines={1} className="text-xs text-muted-foreground" style={TABULAR}>
                      Paid {formatMoney(n.paidCents)} {(timeAgo(n.paidAt) ?? '').toLowerCase()}, the line says {formatMoney(n.item.amount ?? 0)}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => onSetAmount(n.item, n.paidCents)}
                    hitSlop={8}
                    className="min-h-11 justify-center px-1"
                  >
                    <Text className="text-sm font-semibold text-primary">Update</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}

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

function Figure({ label, cents }: { label: string; cents: number }) {
  return (
    <View className="min-w-0 flex-1">
      <Text className="text-[10.5px] font-medium uppercase tracking-[1px] text-muted-foreground">{label}</Text>
      <Text numberOfLines={1} className="text-lg font-semibold text-foreground" style={TABULAR}>
        {formatMoney(cents, AUD)}
      </Text>
    </View>
  );
}
