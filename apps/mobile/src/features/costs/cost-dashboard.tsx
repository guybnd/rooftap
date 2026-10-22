// HOUP-217: native port of apps/web/src/app/costs/cost-chart.tsx's CostDashboard
// — the chart + breakdown sections only. The hero/KPI-tile/budget-edit half of
// that web component is NOT ported here: apps/mobile/src/app/(tabs)/costs/index.tsx
// already owns those separately (HOUP-174), computed from the same
// `monthlyProjection` buckets this component receives as a prop.
//
// Bars render as plain RN `View`s with flex height ratios (web's `<div>`
// height-ratio approach, no chart library). The dashed budget-plan line is an
// absolutely-positioned bordered `View` — no `react-native-svg` needed.
//
// Category dot/bar colors use a local static `CATEGORY_BAR_FILL` map instead
// of reading `CATEGORY_COLOR` from `@homeup/core` dynamically: NativeWind
// statically extracts className strings at build time and can't resolve a
// runtime `CATEGORY_COLOR[c].fill` lookup into an external module. The hue
// family mirrors `CATEGORY_COLOR` exactly (blue/yellow/cyan/violet/pink/lime/
// orange/fuchsia/sky/slate) so a category reads the same color on both
// platforms. Hues key the chart series only; rows lead with a neutral glyph
// chip (cost-card.tsx `CategoryChip`, H2).
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Text, Card, Pill, cn, haptics } from '@homeup/ui';
import { CATEGORY_META, formatMoney, recurringByCategory, type CostCategory, type MonthBucket } from '@homeup/core';

const CATEGORY_ORDER = Object.keys(CATEGORY_META) as CostCategory[];

// Bars stack each month by category in the same CATEGORY_BAR_FILL hues as the
// breakdown below, so a category reads the same in the chart and the list.
// One-offs sit on top as one neutral segment (matching the breakdown strip's
// one-off segment and row dots), and projected months render faded.
const ONE_OFF_FILL = 'bg-foreground/45';
const PROJECTED_OPACITY = 'opacity-40';

const CATEGORY_BAR_FILL: Record<CostCategory, string> = {
  rent: 'bg-blue-300',
  utilities: 'bg-amber-200',
  internet: 'bg-cyan-300',
  insurance: 'bg-violet-300',
  subscription: 'bg-pink-300',
  grocery_estimate: 'bg-lime-200',
  moving: 'bg-orange-300',
  purchase: 'bg-fuchsia-300',
  outing: 'bg-sky-200',
  other: 'bg-slate-400',
};

const CHART_HEIGHT = 112;

interface CostDashboardProps {
  buckets: MonthBucket[];
  currentMonthIdx: number;
  budgetCents: number;
  selectedCategory: CostCategory | null;
  onSelectCategory: (category: CostCategory) => void;
  /** Which month bar is picked (index within the current calendar year,
      0-11); null means "current month". Lifted up to the screen (HOUP-277)
      so picking a month here also drives the card list filter, not just this
      dashboard's own breakdown panel. */
  selectedMonthIdx: number | null;
  onSelectMonth: (idx: number) => void;
}

export function CostDashboard({
  buckets,
  currentMonthIdx,
  budgetCents,
  selectedCategory,
  onSelectCategory,
  selectedMonthIdx,
  onSelectMonth,
}: CostDashboardProps) {
  const selectedIdx = selectedMonthIdx ?? currentMonthIdx;
  const selectedBucket = buckets[selectedIdx];
  const prevBucket = selectedIdx > 0 ? buckets[selectedIdx - 1] : null;

  const max = Math.max(1, budgetCents, ...buckets.map((b) => b.total));
  const selectedDelta = prevBucket ? selectedBucket.total - prevBucket.total : null;
  const selectedTag =
    selectedIdx > currentMonthIdx ? 'Projected' : selectedIdx === currentMonthIdx ? 'In progress' : null;

  // Recurring-only per-category split — byCategory stays mixed (recurring +
  // one-off), so subtract each category's named one-offs to avoid
  // double-counting a one-off's dollars in both its category row and its
  // named row below (mirrors cost-chart.tsx's oneOffByCategory).
  const oneOffByCategory = selectedBucket.oneOffItems.reduce<Record<string, number>>((acc, o) => {
    acc[o.category] = (acc[o.category] ?? 0) + o.amount;
    return acc;
  }, {});
  const recurringCategories = CATEGORY_ORDER.filter(
    (c) => selectedBucket.byCategory[c] > (oneOffByCategory[c] ?? 0)
  );

  const toggleColumn = (i: number) => {
    haptics.select();
    onSelectMonth(i);
  };

  // One card (H4): the chart and the breakdown it drives, split by a hairline
  // instead of two bordered panels (mirrors web's cost-chart.tsx).
  return (
    <Card className="rounded-3xl gap-0">
      <View className="gap-2 px-4 pb-4">
        <View className="relative flex-row items-end gap-1" style={{ height: CHART_HEIGHT }}>
          {budgetCents > 0 && (
            <View
              pointerEvents="none"
              className="absolute left-0 right-0 z-10 border-t border-dashed border-foreground/40"
              style={{ bottom: `${Math.min((budgetCents / max) * 100, 100)}%` }}
            />
          )}
          {buckets.map((b, i) => {
            const isSelected = selectedIdx === i;
            return (
              <Pressable
                key={i}
                onPress={() => toggleColumn(i)}
                accessibilityRole="button"
                accessibilityLabel={`${b.label}: ${formatMoney(b.total)}`}
                accessibilityState={{ selected: isSelected }}
                className={cn(
                  'h-full flex-1 justify-end rounded-t px-0.5 pt-1 active:opacity-90',
                  isSelected && 'bg-primary/10'
                )}
              >
                <View className="h-full justify-end overflow-hidden rounded-t bg-muted/20">
                  <View
                    className={cn(ONE_OFF_FILL, i > currentMonthIdx && PROJECTED_OPACITY)}
                    style={{ height: `${(b.oneOff / max) * 100}%` }}
                  />
                  {recurringByCategory(b)
                    .reverse()
                    .map((s) => (
                      <View
                        key={s.category}
                        className={cn(CATEGORY_BAR_FILL[s.category], i > currentMonthIdx && PROJECTED_OPACITY)}
                        style={{ height: `${(s.amount / max) * 100}%` }}
                      />
                    ))}
                </View>
              </Pressable>
            );
          })}
        </View>

        <View className="flex-row gap-1">
          {buckets.map((b, i) => (
            <Text
              key={i}
              className={cn(
                'flex-1 text-center text-[10px]',
                selectedIdx === i ? 'font-medium text-foreground' : 'text-muted-foreground'
              )}
            >
              {b.label}
            </Text>
          ))}
        </View>

        <View className="flex-row flex-wrap gap-x-3 gap-y-1.5">
          <View className="flex-row items-center gap-1.5">
            <View className={cn('h-2 w-2 rounded-full', ONE_OFF_FILL)} />
            <Text className="text-xs text-muted-foreground">One-offs</Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <View className={cn('h-2 w-2 rounded-full', ONE_OFF_FILL, PROJECTED_OPACITY)} />
            <Text className="text-xs text-muted-foreground">Projected</Text>
          </View>
          {budgetCents > 0 && (
            <View className="flex-row items-center gap-1.5">
              <View className="h-0 w-2.5 border-t border-dashed border-foreground/40" />
              <Text className="text-xs text-muted-foreground">Plan</Text>
            </View>
          )}
        </View>
      </View>

      <View className="gap-3 border-t border-border/60 px-4 pt-4">
        <View className="flex-row items-center justify-between gap-2">
          <Text className="text-sm font-semibold text-foreground">{selectedBucket.label}</Text>
          <View className="flex-row items-center gap-2">
            {selectedDelta !== null && selectedDelta !== 0 && (
              // H2: a month-over-month change crosses no budget, so it is
              // not a status; it reads neutral.
              <Text className="text-xs text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                {selectedDelta > 0 ? '+' : '−'}
                {formatMoney(Math.abs(selectedDelta))}
              </Text>
            )}
            {selectedTag && (
              <Pill variant="muted" size="sm">
                {selectedTag}
              </Pill>
            )}
            <Text className="text-xs font-semibold text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
              {formatMoney(selectedBucket.total)}
            </Text>
          </View>
        </View>

        {selectedBucket.total > 0 && (
          <View className="h-2 flex-row gap-0.5 overflow-hidden rounded-full">
            {recurringCategories.map((c) => (
              <View
                key={c}
                className={CATEGORY_BAR_FILL[c]}
                style={{
                  width: `${((selectedBucket.byCategory[c] - (oneOffByCategory[c] ?? 0)) / selectedBucket.total) * 100}%`,
                }}
              />
            ))}
            {selectedBucket.oneOff > 0 && (
              <View
                className={ONE_OFF_FILL}
                style={{ width: `${(selectedBucket.oneOff / selectedBucket.total) * 100}%` }}
              />
            )}
          </View>
        )}

        <View className="gap-1">
          {recurringCategories.map((c) => {
            const active = selectedCategory === c;
            return (
              <Pressable
                key={c}
                onPress={() => {
                  haptics.select();
                  onSelectCategory(c);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                className={cn(
                  'flex-row items-center gap-1.5 rounded-md px-1.5 py-1 active:opacity-90',
                  active && 'bg-primary/10'
                )}
              >
                <View className={cn('h-2 w-2 rounded-full', CATEGORY_BAR_FILL[c])} />
                <Text className="flex-1 text-xs text-foreground" numberOfLines={1}>
                  {CATEGORY_META[c].label}
                </Text>
                <Text className="text-xs text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                  {formatMoney(selectedBucket.byCategory[c] - (oneOffByCategory[c] ?? 0))}
                </Text>
              </Pressable>
            );
          })}
          {selectedBucket.oneOffItems.length === 0 ? (
            selectedIdx > currentMonthIdx && (
              <Text className="pt-1 text-xs text-muted-foreground">No one-offs planned yet</Text>
            )
          ) : (
            <>
              <Text className="pt-1 text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                One-offs
              </Text>
              {selectedBucket.oneOffItems.map((o, i) => {
                const category = o.category as CostCategory;
                return (
                  <Pressable
                    key={i}
                    onPress={() => {
                      haptics.select();
                      onSelectCategory(category);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: selectedCategory === category }}
                    className={cn(
                      'flex-row items-center gap-1.5 rounded-md py-1 pl-3 pr-1.5 active:opacity-90',
                      selectedCategory === category && 'bg-primary/10'
                    )}
                  >
                    <View className={cn('h-2 w-2 rounded-full', ONE_OFF_FILL)} />
                    <Text className="flex-1 text-xs text-foreground" numberOfLines={1}>
                      {o.name}
                    </Text>
                    <Pill variant="muted" size="sm">
                      one-off
                    </Pill>
                    <Text className="text-xs text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                      {formatMoney(o.amount)}
                    </Text>
                  </Pressable>
                );
              })}
            </>
          )}
        </View>
      </View>
    </Card>
  );
}
