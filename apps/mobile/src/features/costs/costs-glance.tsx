// The Costs glance card (Guy, 2026-10-23): one card under the month with two
// pages, Latest (the last few payments, as on Home's Budget space) and Worth a
// look (the money insights). Swipe between them or tap a tab; nothing moves on
// its own. It opens on Worth a look, with a dot on its tab, while an insight
// is new to this device (core seen-insights.ts). With one page it is a plain
// card under that page's label. A latest payment opens All payments on tap;
// a hold moves it to another category. Rows don't swipe here, so a swipe
// always turns the page. Web twin: apps/web/src/app/costs/costs-glance.tsx.
import * as React from 'react';
import { Pressable, ScrollView, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Text, cn, haptics } from '@homeup/ui';
import { costCategoryFromUp, formatMoney, timeAgo, type CostCategory, type CostItem, type SpendingTransaction } from '@homeup/core';
import { CategoryChip } from './cost-card';

const LABEL = 'text-micro-label uppercase text-muted-foreground';
const CARD = 'overflow-hidden rounded-3xl border border-border/60 bg-card';
const TABULAR = { fontVariant: ['tabular-nums' as const] };

export interface GlancePage {
  key: string;
  label: string;
  /** Something new on the page: a dot on its tab. */
  dot?: boolean;
  node: React.ReactNode;
}

export function CostsGlance({ pages, initial, onPage }: { pages: GlancePage[]; initial: number; onPage?: (key: string) => void }) {
  const [width, setWidth] = React.useState(0);
  const [page, setPage] = React.useState(() => Math.max(0, Math.min(initial, pages.length - 1)));
  const scroller = React.useRef<ScrollView>(null);
  const at = Math.min(page, pages.length - 1);
  const shown = pages[at];

  if (!pages.length) return null;
  if (pages.length === 1) {
    return (
      <View className="gap-2">
        <Text className={cn(LABEL, 'px-1')}>{pages[0].label}</Text>
        <View className={CARD}>{pages[0].node}</View>
      </View>
    );
  }

  const turnTo = (n: number) => {
    if (n === at) return;
    haptics.select();
    setPage(n);
    onPage?.(pages[n].key);
  };
  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w === width) return;
    if (!width) onPage?.(shown.key);
    setWidth(w);
  };
  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!width) return;
    turnTo(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  return (
    <View className="gap-2">
      <View className="flex-row gap-4 px-1" accessibilityRole="tablist">
        {pages.map((p, n) => (
          <Pressable
            key={p.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: n === at }}
            accessibilityLabel={p.dot ? `${p.label}, new` : p.label}
            onPress={() => {
              turnTo(n);
              scroller.current?.scrollTo({ x: n * width, animated: true });
            }}
            hitSlop={8}
            className="flex-row items-center gap-1.5"
          >
            <Text className={cn(LABEL, n === at && 'text-foreground')}>{p.label}</Text>
            {p.dot && n !== at ? <View className="h-1.5 w-1.5 rounded-full bg-primary" /> : null}
          </Pressable>
        ))}
      </View>
      <View className={CARD} onLayout={onLayout}>
        {width ? (
          <ScrollView
            ref={scroller}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            contentOffset={{ x: at * width, y: 0 }}
            onMomentumScrollEnd={onScrollEnd}
          >
            {pages.map((p) => (
              <View key={p.key} style={{ width }}>
                {p.node}
              </View>
            ))}
          </ScrollView>
        ) : null}
      </View>
      <View className="flex-row justify-center gap-1.5" importantForAccessibility="no-hide-descendants">
        {pages.map((p, n) => (
          <View key={p.key} className={cn('h-1.5 w-1.5 rounded-full', n === at ? 'bg-foreground' : 'bg-muted')} />
        ))}
      </View>
    </View>
  );
}

/** A latest payment's category: its cost line's, else the bank's. */
export function latestCategory(t: SpendingTransaction, line: CostItem | undefined): CostCategory | null {
  return line?.category ?? (t.category ? costCategoryFromUp(t.category) : null);
}

/** The last few payments, as rows. */
export function LatestRows({
  payments,
  lineById,
  onOpen,
  onHold,
}: {
  payments: readonly SpendingTransaction[];
  lineById: ReadonlyMap<string, CostItem>;
  onOpen: () => void;
  onHold?: ((t: SpendingTransaction) => void) | null;
}) {
  return (
    <View>
      {payments.map((t, n) => {
        const line = t.costItemId ? lineById.get(t.costItemId) : undefined;
        const category = latestCategory(t, line);
        return (
          <Pressable
            key={t.id}
            accessibilityRole="button"
            accessibilityHint={onHold ? 'Hold to move it to another category' : undefined}
            onPress={onOpen}
            onLongPress={onHold && t.amountCents < 0 ? () => onHold(t) : undefined}
            className={cn('min-h-[52px] flex-row items-center gap-3 px-4 py-2', n > 0 && 'border-t border-border/60')}
          >
            {category ? <CategoryChip category={category} /> : <View className="h-7 w-7 rounded-[9px] border border-dashed border-muted-foreground/60" />}
            <View className="min-w-0 flex-1">
              <Text numberOfLines={1} className="text-sm font-medium text-foreground">
                {t.description}
              </Text>
              <Text numberOfLines={1} className="text-xs text-muted-foreground">
                {[t.pending ? 'Pending' : null, timeAgo(t.occurredAt), line ? line.name : t.categoryLabel].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Text className={cn('text-sm', t.amountCents > 0 ? 'text-success' : 'text-foreground')} style={TABULAR}>
              {t.amountCents > 0 ? '+' : ''}
              {formatMoney(Math.abs(t.amountCents))}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
