// HOUP-88: native port of apps/web/src/app/setup/budget-summary.tsx. One card
// (H4): three inset totals, then spend per room as hairline rows, value first
// with the estimate in muted type (H6). No figure here is a lede, so nothing
// is set at display size, and money stays neutral: coral is for controls and
// green for state (H2). "To buy" is the estimate of what is still needed,
// which is also what a per-status split used to repeat.
import { View } from 'react-native';
import { Card, PulseTile, Text, cn } from '@homeup/ui';
import { formatMoney, type SetupItem } from '@homeup/core';

interface BudgetSummaryProps {
  items: SetupItem[];
}

// Setup prices are whole dollars; formatMoney takes minor units.
const money = (n: number) => formatMoney(Math.round(n * 100));

export function BudgetSummary({ items }: BudgetSummaryProps) {
  const totalEstimated = items.reduce((sum, item) => sum + (item.est_price || 0), 0);
  const totalSpent = items.filter((i) => i.status === 'installed').reduce((sum, i) => sum + (i.actual_price || 0), 0);
  const remainingEstimated = items.filter((i) => i.status === 'needed').reduce((sum, i) => sum + (i.est_price || 0), 0);

  const byRoom = items.reduce((acc, item) => {
    const room = item.room || 'Other';
    if (!acc[room]) acc[room] = { estimated: 0, spent: 0 };
    acc[room].estimated += item.est_price || 0;
    if (item.status === 'installed') acc[room].spent += item.actual_price || 0;
    return acc;
  }, {} as Record<string, { estimated: number; spent: number }>);
  const rooms = Object.entries(byRoom).sort(([a], [b]) => a.localeCompare(b));

  return (
    <Card className="gap-3 rounded-3xl px-4 py-4">
      <View className="flex-row gap-2">
        <PulseTile label="Estimated" value={money(totalEstimated)} className="flex-1" />
        <PulseTile label="Spent" value={money(totalSpent)} className="flex-1" />
        <PulseTile label="To buy" value={money(remainingEstimated)} className="flex-1" />
      </View>

      {rooms.length > 0 && (
        <View>
          <View className="flex-row items-center justify-between px-1 py-1">
            <Text className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">By room</Text>
            <Text className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Spent of est</Text>
          </View>
          {rooms.map(([room, { estimated, spent }], i) => (
            <View
              key={room}
              className={cn('flex-row items-center justify-between gap-3 px-1 py-2', i > 0 && 'border-t border-border/60')}
            >
              <Text numberOfLines={1} className="min-w-0 shrink text-body text-foreground">
                {room}
              </Text>
              <Text className="shrink-0" style={{ fontVariant: ['tabular-nums'] }}>
                <Text className="text-body font-medium text-foreground">{money(spent)}</Text>
                <Text className="text-caption text-muted-foreground"> of {money(estimated)}</Text>
              </Text>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}
