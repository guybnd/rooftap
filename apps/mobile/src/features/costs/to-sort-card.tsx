// The "To sort" card on Costs (Guy picked it with the quick moves,
// 2026-10-23): this month's new shops, one at a time. The bank's guess is a
// one-tap "Yes", the likely other categories sit under it, and "Other" opens
// the full picker. Saying where a shop goes files it for good (core
// moveCostLine); Skip hides it on this device until the month is over. The
// dots show how many are left. Web twin: apps/web/src/app/costs/to-sort-card.tsx.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Text, cn, haptics } from '@homeup/ui';
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
import { CategoryChip } from './cost-card';

const LABEL = 'text-micro-label uppercase text-muted-foreground';
const CARD = 'overflow-hidden rounded-3xl border border-border/60 bg-card';
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
  const [done, setDone] = React.useState<string[]>([]);
  const list = costShopsToSort(month, [...skipped, ...done]);
  if (!list.length) return null;
  const { line, guess } = list[0];
  const vendor = line.vendor ?? line.name;
  const finish = () => setDone((cur) => [...cur, squashVendor(vendor)]);
  const sort = (c: CostCategory) => {
    haptics.commit();
    finish();
    onSort(line, c);
  };
  const others = likelyCostCategories(line, guess, month, choices, guess ? 2 : 3);
  const handled = done.length + skipped.length;
  const total = handled + list.length;
  const meta = [formatMoney(line.paidCents), lineMeta(line, monthName)].filter(Boolean).join(' · ');

  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between px-1">
        <Text className={LABEL}>To sort</Text>
        <Text className="text-xs text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
          {list.length === 1 ? '1 new shop' : `${list.length} new shops`}
        </Text>
      </View>
      <View className={cn(CARD, 'gap-3 p-4')}>
        <View className="flex-row items-center gap-3">
          {guess ? <CategoryChip category={guess} /> : <View className="h-7 w-7 rounded-[9px] border border-dashed border-muted-foreground/60" />}
          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} className="text-body font-semibold text-foreground">
              {line.name}
            </Text>
            <Text numberOfLines={1} className="text-xs text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
              {meta}
            </Text>
          </View>
        </View>
        <Text className="text-sm text-muted-foreground">{guess ? `Your bank calls it ${CATEGORY_META[guess].label}. Is that right?` : 'Where does it go?'}</Text>
        {guess ? (
          <Pressable accessibilityRole="button" onPress={() => sort(guess)} className="min-h-11 items-center justify-center rounded-2xl bg-primary px-4">
            <Text className="text-sm font-semibold text-primary-foreground">Yes, {CATEGORY_META[guess].label}</Text>
          </Pressable>
        ) : null}
        <View className="flex-row flex-wrap gap-2">
          {others.map((c) => (
            <Pressable
              key={c}
              accessibilityRole="button"
              accessibilityLabel={`Move to ${CATEGORY_META[c].label}`}
              onPress={() => sort(c)}
              className="min-h-11 flex-row items-center gap-2 rounded-2xl border border-border px-3"
            >
              <CategoryChip category={c} />
              <Text className="text-sm text-foreground">{CATEGORY_META[c].label}</Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Pick a category for ${line.name}`}
            onPress={() => onOther(line, guess, finish)}
            className="min-h-11 justify-center rounded-2xl border border-border px-3"
          >
            <Text className="text-sm text-foreground">Other</Text>
          </Pressable>
        </View>
        <View className="flex-row items-center justify-between">
          <View className="flex-row gap-1.5" accessibilityLabel={`${handled + 1} of ${total}`}>
            {Array.from({ length: Math.min(total, DOTS) }, (_, n) => (
              <View key={n} className={cn('h-1.5 w-1.5 rounded-full', n < Math.min(handled, DOTS - 1) ? 'bg-muted-foreground' : n === Math.min(handled, DOTS - 1) ? 'bg-foreground' : 'bg-muted')} />
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Skip ${line.name} for now`}
            onPress={() => {
              haptics.select();
              skipShop(month.month, vendor);
            }}
            className="min-h-11 justify-center px-2"
          >
            <Text className="text-sm font-medium text-muted-foreground">Skip</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
