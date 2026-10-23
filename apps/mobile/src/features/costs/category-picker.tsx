// Moving a Costs row or a payment to another category (Guy, 2026-10-23: it
// took nine taps; now a swipe and a tap). CategoryGrid is the "Move to" part
// of a row's hold sheet; CategoryPickerSheet is what a swipe right opens: the
// likely categories first (core likelyCostCategories), then all of them, and
// for a single payment a switch for whether its shop's other payments follow.
// Web twin: apps/web/src/app/costs/category-picker.tsx.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { BottomSheet, Switch, Text, cn, haptics } from '@homeup/ui';
import { CATEGORY_META, type CostCategory } from '@homeup/core';
import { CategoryChip } from './cost-card';

const LABEL = 'text-micro-label uppercase text-muted-foreground';

/** Every category as a tappable cell, the current one ringed and checked. */
export function CategoryGrid({ choices, current, onPick }: { choices: readonly CostCategory[]; current: CostCategory | null; onPick: (c: CostCategory) => void }) {
  return (
    <View className="flex-row flex-wrap gap-1.5">
      {choices.map((c) => {
        const on = c === current;
        return (
          <Pressable
            key={c}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`Move to ${CATEGORY_META[c].label}`}
            onPress={() => onPick(c)}
            className={cn('min-h-11 w-[31.8%] flex-row items-center gap-2 rounded-xl border px-2', on ? 'border-primary bg-primary/10' : 'border-transparent bg-muted/60')}
          >
            <CategoryChip category={c} />
            <Text numberOfLines={1} className="min-w-0 flex-1 text-xs text-foreground">
              {CATEGORY_META[c].label}
            </Text>
            {on ? <Check size={12} className="text-primary" /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export interface CategoryPick {
  title: string;
  current: CostCategory | null;
  likely: CostCategory[];
  /** For one payment: whether its shop's other payments move with it. */
  scope?: { label: string; hint: string } | null;
  onPick: (category: CostCategory, wholeShop: boolean) => void;
}

export function CategoryPickerSheet({ pick, choices, onClose }: { pick: CategoryPick | null; choices: readonly CostCategory[]; onClose: () => void }) {
  const [wholeShop, setWholeShop] = React.useState(false);
  const close = () => {
    setWholeShop(false);
    onClose();
  };
  const choose = (c: CostCategory) => {
    if (!pick) return;
    haptics.tick();
    close();
    if (c !== pick.current) pick.onPick(c, wholeShop);
  };
  return (
    <BottomSheet open={!!pick} onOpenChange={(o) => { if (!o) close(); }} className="pb-3">
      {pick ? (
        <View className="gap-3 px-4 pb-2">
          <Text numberOfLines={1} className="font-heading text-title font-semibold text-foreground">
            {pick.title}
          </Text>
          {pick.likely.length ? (
            <>
              <Text className={LABEL}>Likely</Text>
              <View className="flex-row flex-wrap gap-2">
                {pick.likely.map((c) => (
                  <Pressable
                    key={c}
                    accessibilityRole="button"
                    accessibilityLabel={`Move to ${CATEGORY_META[c].label}`}
                    onPress={() => choose(c)}
                    className="min-h-11 flex-row items-center gap-2 rounded-2xl border border-border bg-card px-3"
                  >
                    <CategoryChip category={c} />
                    <Text className="text-sm font-medium text-foreground">{CATEGORY_META[c].label}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
          <Text className={LABEL}>All categories</Text>
          <CategoryGrid choices={choices} current={pick.current} onPick={choose} />
          {pick.scope ? (
            <View className="min-h-12 flex-row items-center gap-3 border-t border-border/60 pt-2">
              <View className="min-w-0 flex-1">
                <Text className="text-sm text-foreground">{pick.scope.label}</Text>
                <Text className="text-xs text-muted-foreground">{pick.scope.hint}</Text>
              </View>
              <Switch checked={wholeShop} onChange={setWholeShop} label={pick.scope.label} />
            </View>
          ) : null}
        </View>
      ) : null}
    </BottomSheet>
  );
}
