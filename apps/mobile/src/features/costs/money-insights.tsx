// Up Bank connector: the money section on Costs > Plan (Guy's pick A,
// "Stacked"), in place of the old Up card. With joint payments filed as cost
// lines the card's totals repeated the lines, so this shows what the lines
// can't: where the month should end (forecast), nudges worth a look, and the
// latest payments. Three sibling cards, one border level each (H4); status
// hues only in the words and figures that carry them (H2). Shown once this
// person has Up connected (UpOverviewProvider, core up-overview.ts); the
// numbers come from core money-insights.ts.
// Web twin: apps/web/src/app/costs/money-insights.tsx.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Card, Text, cn } from '@homeup/ui';
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

const AUD = { currency: 'AUD' };
const TABULAR = { fontVariant: ['tabular-nums' as const] };
const LABEL = 'text-[10.5px] font-medium uppercase tracking-[1px] text-muted-foreground';

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
  const now = React.useMemo(() => new Date(), []);
  const byId = React.useMemo(() => new Map(allItems.map((i) => [i.id, i])), [allItems]);
  const links = React.useMemo(() => data?.links ?? [], [data]);
  const nudges = React.useMemo(
    () => (data ? moneyNudges({ items, links, bank, accounts: scope === 'mine' ? [] : data.accounts, now }) : []),
    [data, items, links, bank, scope, now]
  );
  if (!status?.allowed || !status.connection) return null;
  if (!data) return <Text className="px-1 text-sm text-muted-foreground">{error ?? 'Reading your Up payments…'}</Text>;

  // The forecast is about this month; the Money view may have stepped back.
  const thisMonth = month === monthStartOf(now);
  // The household's forecast is the Costs total up top; only a personal view needs its own.
  const forecast = thisMonth && scope === 'mine' ? monthForecast(items, bank, data.spentCents, now) : null;
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const toCome = thisMonth ? billsDue(items, links, now, monthEnd.getDate() - now.getDate()) : [];
  // A personal view isn't measured against the household's budget.
  const showBudget = budgetCents > 0 && scope !== 'mine';
  const overBy = forecast && showBudget ? forecast.forecastCents - budgetCents : 0;
  const share = forecast && forecast.forecastCents > 0 ? Math.min(1, forecast.spentCents / forecast.forecastCents) : 0;
  const monthName = now.toLocaleString('default', { month: 'short' });

  return (
    <View className="gap-4">
      {forecast && (
        <Card size="sm" className="gap-2 rounded-3xl px-4">
          <Text className={LABEL}>{scope === 'mine' ? 'Mine this month' : 'This month'}</Text>
          <Text className="text-sm text-foreground">
            On track for{' '}
            <Text className="font-semibold" style={TABULAR}>
              {formatMoney(forecast.forecastCents, AUD)}
            </Text>{' '}
            by {monthEnd.getDate()} {monthName}
            {showBudget ? (
              <Text className={overBy > 0 ? 'text-warning' : 'text-success'} style={TABULAR}>
                {' · '}
                {overBy > 0 ? `${formatMoney(overBy, AUD)} over budget` : `${formatMoney(-overBy, AUD)} under budget`}
              </Text>
            ) : null}
          </Text>
          <View className="h-[3px] overflow-hidden rounded-full bg-muted">
            <View className="h-full rounded-full bg-primary" style={{ width: `${Math.round(share * 100)}%` }} />
          </View>
          <Text className="text-xs text-muted-foreground" style={TABULAR}>
            {formatMoney(forecast.spentCents, AUD)} spent
            {forecast.toComeCents > 0 ? ` · ${formatMoney(forecast.toComeCents, AUD)} still to come` : ''}
            {toCome.length > 0 ? `: ${toCome.slice(0, 3).map((b) => b.item.name).join(', ')}` : ''}
          </Text>
        </Card>
      )}

      {nudges.length > 0 && (
        <View className="gap-2">
          <Text className={cn(LABEL, 'px-1')}>Heads up</Text>
          <Card size="sm" className="gap-0 rounded-3xl px-4 py-0">
            {nudges.map((n, i) => (
              <NudgeRow key={n.key} nudge={n} first={i === 0} now={now} onOpenItem={onOpenItem} onSetAmount={onSetAmount} />
            ))}
          </Card>
        </View>
      )}

      {data.recent.length > 0 && (
        <View className="gap-2">
          <View className="flex-row items-center justify-between px-1">
            <Text className={LABEL}>Latest</Text>
            <Pressable accessibilityRole="button" onPress={onOpenMoney} hitSlop={8} className="min-h-11 justify-center px-1">
              <Text className="text-sm font-semibold text-primary">All in Money</Text>
            </Pressable>
          </View>
          <Card size="sm" className="gap-0 rounded-3xl px-4 py-0">
            {data.recent.slice(0, 5).map((t, i) => {
              const line = t.costItemId ? byId.get(t.costItemId) ?? null : null;
              const meta = [
                t.pending ? 'Pending' : null,
                timeAgo(t.occurredAt),
                line ? line.name : t.categoryLabel,
                t.userId !== currentUserId ? nameOf(t.userId) : null,
              ].filter(Boolean);
              return (
                <Pressable
                  key={t.id}
                  accessibilityRole="button"
                  onPress={() => (line ? onOpenItem(line) : onOpenMoney())}
                  className={cn('min-h-[52px] flex-row items-center gap-3 py-2', i > 0 && 'border-t border-border/60')}
                >
                  <View className="min-w-0 flex-1">
                    <Text numberOfLines={1} className="text-sm font-medium text-foreground">
                      {t.description}
                    </Text>
                    <Text numberOfLines={1} className="text-xs text-muted-foreground">
                      {meta.join(' · ')}
                    </Text>
                  </View>
                  <Text className={cn('text-sm', t.amountCents > 0 ? 'text-success' : 'text-foreground')} style={TABULAR}>
                    {t.amountCents > 0 ? '+' : ''}
                    {formatMoney(Math.abs(t.amountCents), AUD)}
                  </Text>
                </Pressable>
              );
            })}
          </Card>
        </View>
      )}
    </View>
  );
}

function NudgeRow({
  nudge,
  first,
  now,
  onOpenItem,
  onSetAmount,
}: {
  nudge: MoneyNudge;
  first: boolean;
  now: Date;
  onOpenItem: (item: CostItem) => void;
  onSetAmount: (item: CostItem, cents: number) => void;
}) {
  const copy = moneyNudgeCopy(nudge, now);
  const item = 'item' in nudge ? nudge.item : null;
  return (
    <View className={cn('min-h-[56px] flex-row items-center gap-3 py-2', !first && 'border-t border-border/60')}>
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-sm font-medium text-foreground">
          {copy.title}
        </Text>
        <Text numberOfLines={1} className="text-xs text-muted-foreground" style={TABULAR}>
          {copy.detail}
        </Text>
      </View>
      {nudge.kind === 'differs' ? (
        <Pressable accessibilityRole="button" onPress={() => onSetAmount(nudge.item, nudge.paidCents)} hitSlop={8} className="min-h-11 justify-center px-1">
          <Text className="text-sm font-semibold text-primary">Update</Text>
        </Pressable>
      ) : copy.figure ? (
        <Text
          className={cn(
            'text-sm',
            copy.figure.tone === 'warning' ? 'text-warning' : copy.figure.tone === 'success' ? 'text-success' : 'text-muted-foreground'
          )}
          style={TABULAR}
        >
          {copy.figure.text}
        </Text>
      ) : item ? (
        <Pressable accessibilityRole="button" onPress={() => onOpenItem(item)} hitSlop={8} className="min-h-11 justify-center px-1">
          <Text className="text-sm font-semibold text-primary">Open</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
