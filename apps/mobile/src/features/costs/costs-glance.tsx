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
import { costCategoryFromUp, formatMoney, recentDayLabel, recentVerdictText, timeAgo, type CostCategory, type CostItem, type RecentSpendState, type SpendingTransaction } from '@homeup/core';
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

const VERDICT_TONE = { under: 'text-success', usual: 'text-muted-foreground', over: 'text-warning' } as const;

/**
 * The Latest page with recent spending on top (Guy, 2026-10-24): a box per
 * window (today, 3 days, 7 days by default), each against a usual stretch.
 * Tapping a box opens it: the last two weeks as bars with the window lit,
 * and that stretch's payments in a list that scrolls. Tapping it again goes
 * back to the last few payments. Web twin: costs-glance.tsx RecentStrip.
 */
export function LatestPage({
  recent,
  latest,
  lineById,
  onOpen,
  onHold,
  onSettings,
  skipBills,
}: {
  recent: RecentSpendState;
  latest: readonly SpendingTransaction[];
  lineById: ReadonlyMap<string, CostItem>;
  onOpen: () => void;
  onHold?: ((t: SpendingTransaction) => void) | null;
  onSettings: () => void;
  skipBills: boolean;
}) {
  const { windows, open, toggle, bars, payments, error } = recent;
  return (
    <View>
      {windows.length ? (
        <View className="flex-row border-b border-border/60" accessibilityRole="tablist">
          {windows.map((w, n) => {
            const verdict = recentVerdictText(w);
            const on = open === w.days;
            return (
              <Pressable
                key={w.days}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${w.label}, ${formatMoney(w.cents)}${verdict ? `, ${verdict}` : ''}`}
                onPress={() => {
                  haptics.select();
                  toggle(w.days);
                }}
                className={cn('flex-1 gap-0.5 px-3 py-2.5', n > 0 && 'border-l border-border/60', on && 'bg-muted/50')}
              >
                <Text className={cn(LABEL, on && 'text-foreground')}>{w.label}</Text>
                <Text className="text-lg font-semibold text-foreground" style={TABULAR}>
                  {formatMoney(w.cents)}
                </Text>
                {verdict ? (
                  <Text numberOfLines={1} className={cn('text-[11px]', VERDICT_TONE[w.verdict!])} style={TABULAR}>
                    {verdict}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {open != null && bars ? (
        <View>
          <RecentBars bars={bars} usualCents={windows.find((w) => w.days === open)?.usualCents ?? null} days={open} />
          {payments ? (
            payments.length ? (
              <ScrollView style={{ maxHeight: 312 }} nestedScrollEnabled className="border-t border-border/60">
                <LatestRows payments={payments} lineById={lineById} onOpen={onOpen} onHold={onHold} />
              </ScrollView>
            ) : (
              <Text className="border-t border-border/60 px-4 py-4 text-sm text-muted-foreground">Nothing went out.</Text>
            )
          ) : (
            <Text className="border-t border-border/60 px-4 py-4 text-sm text-muted-foreground">{error ?? 'Reading payments'}</Text>
          )}
          <View className="flex-row items-center justify-between border-t border-border/60 px-4 py-2.5">
            <Text className="text-xs text-muted-foreground" style={TABULAR}>
              {[payments ? `${payments.length} ${payments.length === 1 ? 'payment' : 'payments'}` : null, skipBills ? 'Bills left out' : null].filter(Boolean).join(' · ')}
            </Text>
            <Pressable accessibilityRole="button" onPress={onSettings} hitSlop={8}>
              <Text className="text-xs font-medium text-primary">Change</Text>
            </Pressable>
          </View>
        </View>
      ) : latest.length ? (
        <LatestRows payments={latest} lineById={lineById} onOpen={onOpen} onHold={onHold} />
      ) : null}
    </View>
  );
}

const BARS_HEIGHT = 72;

/** A bar per day, the open window's days lit, a dashed line at a usual day. */
function RecentBars({ bars, usualCents, days }: { bars: readonly { day: string; cents: number; lit: boolean }[]; usualCents: number | null; days: number }) {
  const usualDay = usualCents != null ? usualCents / days : null;
  const top = Math.max(1, ...bars.map((b) => b.cents), usualDay ?? 0);
  const total = bars.filter((b) => b.lit).reduce((s, b) => s + b.cents, 0);
  return (
    <View className="gap-1 px-4 pb-2 pt-3" accessible accessibilityLabel={`${formatMoney(total)} over the last ${days === 1 ? 'day' : `${days} days`}, a bar per day`}>
      <View style={{ height: BARS_HEIGHT }} className="flex-row items-end gap-[3px]">
        {bars.map((b) => (
          <View
            key={b.day}
            className={cn('flex-1 rounded-[3px]', b.lit ? 'bg-foreground' : 'bg-muted')}
            style={{ height: Math.max(2, Math.round((b.cents / top) * BARS_HEIGHT)) }}
          />
        ))}
        {usualDay ? (
          <View
            pointerEvents="none"
            className="absolute left-0 right-0 border-t border-dashed border-muted-foreground/70"
            style={{ bottom: Math.round((usualDay / top) * BARS_HEIGHT) }}
          />
        ) : null}
      </View>
      <View className="flex-row justify-between">
        <Text className="text-[10px] text-muted-foreground">{recentDayLabel(bars[0]?.day)}</Text>
        {usualDay ? <Text className="text-[10px] text-muted-foreground">Dashed line: a usual day</Text> : null}
        <Text className="text-[10px] text-muted-foreground">Today</Text>
      </View>
    </View>
  );
}
