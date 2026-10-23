// Money insights on Costs (the money-insights module, Oct 23): a "Worth a
// look" card with the three most pressing, and "See all" opening a sheet
// grouped into Heads up, Save, Reconsider and Going well. Tapping a row in the
// sheet opens its actions: open the cost or category, compare with Scout,
// review the subscriptions (Keep for a year, or a reminder to cancel), or hide
// it. The list comes from core useCostInsights, the same on both apps. Web
// twin: apps/web/src/app/costs/cost-insights.tsx.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import {
  ArrowLeftRight,
  CalendarClock,
  CalendarRange,
  ChevronRight,
  Clock,
  Gauge,
  Layers,
  Repeat,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react-native';
import { BottomSheet, LeadingTile, Text, cn, haptics, toast } from '@homeup/ui';
import {
  COST_INSIGHT_GROUPS,
  formatMoney,
  scoutPrefillHref,
  useCostInsights,
  useModules,
  withInsightMark,
  withoutInsightMark,
  type CostCategory,
  type CostInsight,
  type CostInsightMarks,
  type CostItem,
  type SubscriptionLine,
} from '@homeup/core';
import { useOpenRoute } from '@/lib/tab-routes';

const TABULAR = { fontVariant: ['tabular-nums' as const] };
const LABEL = 'text-micro-label uppercase text-muted-foreground';
const CARD = 'overflow-hidden rounded-3xl border border-border/60 bg-card';
const CHIP = 'min-h-9 justify-center rounded-full border border-border px-3';
/** Rows the card shows before "See all". */
const SHOWN = 3;

const ICON: Record<CostInsight['kind'], LucideIcon> = {
  short: Wallet,
  missing: Clock,
  differs: ArrowLeftRight,
  price: TrendingUp,
  'price-down': TrendingDown,
  new: Repeat,
  ahead: Gauge,
  subscriptions: Repeat,
  overlap: Layers,
  ending: CalendarClock,
  yearly: CalendarRange,
  under: Sparkles,
  goal: Sparkles,
};

const TONE = { warning: 'text-warning', success: 'text-success', muted: 'text-muted-foreground' } as const;

export interface CostInsightsCardProps {
  items: readonly CostItem[];
  goalCents: number | null;
  marks: CostInsightMarks;
  /** Changes this person's marks from the latest ones. */
  onMarks: (update: (cur: CostInsightMarks) => CostInsightMarks) => void;
  onOpenItem: (item: CostItem) => void;
  onOpenCategory: (category: CostCategory | null) => void;
  /** Adds a "Cancel it?" reminder task; null when Tasks is off. */
  onRemind: ((sub: SubscriptionLine) => void) | null;
}

export function CostInsightsCard(props: CostInsightsCardProps) {
  const { items, goalCents, marks, onMarks } = props;
  const { insights, subscriptions } = useCostInsights(items, { goalCents, marks });
  const [sheet, setSheet] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  if (!insights.length) return null;

  const openSheet = (key: string | null) => {
    haptics.select();
    setExpanded(key);
    setSheet(true);
  };
  const hide = (i: CostInsight) => {
    haptics.remove();
    onMarks((cur) => withInsightMark(cur, i.key));
    setExpanded(null);
    toast.message('Hidden', { duration: 5000, action: { label: 'Undo', onPress: () => onMarks((cur) => withoutInsightMark(cur, i.key)) } });
  };

  return (
    <View className="gap-2">
      <Text className={cn(LABEL, 'px-1')}>Worth a look</Text>
      <View className={CARD}>
        {insights.slice(0, SHOWN).map((i, n) => (
          <InsightRow key={i.key} insight={i} divided={n > 0} onPress={() => openSheet(i.key)} />
        ))}
        {insights.length > SHOWN ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => openSheet(null)}
            className="min-h-12 flex-row items-center justify-between border-t border-border/60 px-4"
          >
            <Text className="text-sm font-medium text-primary">See all {insights.length}</Text>
            <ChevronRight size={16} className="text-primary" />
          </Pressable>
        ) : null}
      </View>

      <BottomSheet open={sheet} onOpenChange={setSheet} className="pb-3">
        <View className="gap-1 px-4 pb-2">
          <Text className="font-heading text-title font-semibold text-foreground">Worth a look</Text>
          <Text className="pb-1 text-caption text-muted-foreground">Tap one for what you can do. Hiding one keeps it away until it changes.</Text>
          {COST_INSIGHT_GROUPS.map((g) => {
            const rows = insights.filter((i) => i.group === g.id);
            if (!rows.length) return null;
            return (
              <View key={g.id} className="gap-1 pt-2">
                <Text className={cn(LABEL, 'px-1')}>{g.label}</Text>
                <View className="overflow-hidden rounded-2xl bg-muted/40">
                  {rows.map((i, n) => (
                    <View key={i.key} className={cn(n > 0 && 'border-t border-border/60')}>
                      <InsightRow
                        insight={i}
                        divided={false}
                        expanded={expanded === i.key}
                        onPress={() => {
                          haptics.select();
                          setExpanded((cur) => (cur === i.key ? null : i.key));
                        }}
                      />
                      {expanded === i.key ? (
                        <InsightActions insight={i} subscriptions={subscriptions} onHide={() => hide(i)} onDone={() => setSheet(false)} {...props} />
                      ) : null}
                    </View>
                  ))}
                </View>
              </View>
            );
          })}
        </View>
      </BottomSheet>
    </View>
  );
}

function InsightRow({ insight: i, divided, expanded, onPress }: { insight: CostInsight; divided: boolean; expanded?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={expanded == null ? undefined : { expanded }}
      onPress={onPress}
      className={cn('min-h-[55px] flex-row items-center gap-3 px-4 py-2.5', divided && 'border-t border-border/60')}
    >
      <LeadingTile sectionId="costs" Icon={ICON[i.kind]} size="sm" />
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-medium text-foreground" numberOfLines={1}>{i.title}</Text>
        <Text className="text-caption text-muted-foreground" numberOfLines={1} style={TABULAR}>{i.detail}</Text>
      </View>
      {i.figure ? (
        <Text className={cn('text-caption font-semibold', TONE[i.figure.tone])} style={TABULAR}>{i.figure.text}</Text>
      ) : null}
    </Pressable>
  );
}

function Chip({ label, onPress, muted, pressed }: { label: string; onPress: () => void; muted?: boolean; pressed?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={pressed == null ? undefined : { selected: pressed }}
      onPress={onPress}
      hitSlop={4}
      className={cn(CHIP, pressed && 'border-transparent bg-muted')}
    >
      <Text className={cn('text-caption font-medium', muted || pressed ? 'text-muted-foreground' : 'text-foreground')}>{label}</Text>
    </Pressable>
  );
}

function InsightActions({
  insight: i,
  subscriptions,
  onMarks,
  onHide,
  onDone,
  onOpenItem,
  onOpenCategory,
  onRemind,
}: CostInsightsCardProps & { insight: CostInsight; subscriptions: SubscriptionLine[]; onHide: () => void; onDone: () => void }) {
  const openRoute = useOpenRoute();
  const modules = useModules();
  const compare = modules.feature('insights.compare') && i.compare;

  return (
    <View className="gap-2 px-4 pb-3 pl-[56px]">
      {i.action === 'review' ? (
        <View className="overflow-hidden rounded-xl bg-card">
          {subscriptions.map((s, n) => (
            <View key={s.key} className={cn('gap-1.5 px-3 py-2', n > 0 && 'border-t border-border/60')}>
              <View className="flex-row items-center gap-2">
                <View className="min-w-0 flex-1">
                  <Text className="text-sm text-foreground" numberOfLines={1}>{s.name}</Text>
                  <Text className="text-caption text-muted-foreground" style={TABULAR}>
                    {formatMoney(s.monthlyCents)} a month{s.overlap ? ` · ${s.overlap.toLowerCase()} overlap` : ''}
                  </Text>
                </View>
                <Chip
                  label={s.kept ? 'Kept' : 'Keep'}
                  pressed={s.kept}
                  onPress={() => {
                    haptics.tick();
                    onMarks((cur) => (s.kept ? withoutInsightMark(cur, `keep:${s.key}`) : withInsightMark(cur, `keep:${s.key}`)));
                  }}
                />
              </View>
              {onRemind && s.item && !s.kept ? (
                <View className="flex-row">
                  <Chip label="Remind me to cancel" onPress={() => onRemind(s)} />
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        {i.action === 'open-item' && i.item ? <Chip label={`Open ${i.item.name}`} onPress={() => { onDone(); onOpenItem(i.item!); }} /> : null}
        {i.action === 'open-category' ? <Chip label="Show the category" onPress={() => { onDone(); onOpenCategory(i.category ?? null); }} /> : null}
        {i.action === 'compare' && compare ? <Chip label="Compare with Scout" onPress={() => { onDone(); openRoute(scoutPrefillHref(i.compare!)); }} /> : null}
        {i.action === 'compare' && i.item ? <Chip label={`Open ${i.item.name}`} onPress={() => { onDone(); onOpenItem(i.item!); }} /> : null}
        <Chip label="Hide" muted onPress={onHide} />
      </View>
    </View>
  );
}
