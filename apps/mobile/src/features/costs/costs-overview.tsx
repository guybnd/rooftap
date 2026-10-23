// Costs, redesigned (Guy's spec, Oct 22): one page for a month. On top, what
// was spent out of the goal and what the month should end at; income and what
// should be left when there is income; a chart of the months (picking one sets
// the whole page to it); then the categories, each opening in place to its
// shops, recurring costs and costs added by hand, with what's still to come.
// Every number comes from core costMonth (cost-month.ts), the same function
// Home, the digest and the assistant read. A row's source is an icon only: a
// bank for a connector, a pen for one added by hand. A long press offers
// Edit, Ask the assistant and Archive. Web twin: apps/web/src/app/costs/costs-overview.tsx.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { ChevronDown, ChevronRight, FileText, Landmark, MoreHorizontal, PenLine, Plus, Repeat } from 'lucide-react-native';
import { BottomSheet, SegmentedControl, Text, cn, haptics } from '@homeup/ui';
import {
  CADENCE_LABEL,
  CATEGORY_META,
  bankDayLabel,
  costCategoryLabel,
  formatMoney,
  monthKeys,
  openAssistantPopup,
  useCostMonths,
  useUpOverview,
  type BankTransactionPatch,
  type BankTransactionView,
  type CostCategory,
  type CostItem,
  type CostMonth,
  type CostMonthCategory,
  type CostMonthLine,
} from '@homeup/core';
import { CATEGORY_BAR_FILL, CategoryChip } from './cost-card';
import { TransactionSheet } from './money-view';
import { upBankApi } from './up-bank-api';
import { useOpenRoute } from '@/lib/tab-routes';

const TABULAR = { fontVariant: ['tabular-nums' as const] };
const LABEL = 'text-micro-label uppercase text-muted-foreground';
const CARD = 'overflow-hidden rounded-3xl border border-border/60 bg-card';
/** Months the chart shows: nine back, this one, two ahead. */
const CHART_BACK = 9;
const CHART_MONTHS = 12;
const CHART_HEIGHT = 84;

export interface CostsOverviewProps {
  items: CostItem[];
  /** The monthly goal in cents, null when none is set. */
  goalCents: number | null;
  onEditGoal: () => void;
  onOpenItem: (item: CostItem) => void;
  onAdd: (category?: CostCategory) => void;
  onArchive: (item: CostItem, archived: boolean) => void;
  /** The ⋯ menu: every payment, as a plain list. Null when no payments come in. */
  onOpenPayments: (() => void) | null;
  /** Archive is offered (the server has 'costs.redesign'). */
  canArchive: boolean;
  nameOf: (userId: string) => string;
  onSetAmount: (item: CostItem, cents: number) => void;
  /** Rendered between the categories and the end of the page (suggestions). */
  footer?: React.ReactNode;
}

export function CostsOverview(props: CostsOverviewProps) {
  const { items, goalCents, onEditGoal, onOpenItem, onAdd, onArchive, onOpenPayments, canArchive } = props;
  const { scope, setScope, data } = useUpOverview();
  const now = React.useMemo(() => new Date(), []);
  const keys = React.useMemo(() => monthKeys(now, -CHART_BACK, CHART_MONTHS), [now]);
  const months = useCostMonths(items, keys);
  const [picked, setPicked] = React.useState(keys[CHART_BACK]);
  const month = months.find((m) => m.month === picked) ?? months[CHART_BACK];
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const [shop, setShop] = React.useState<CostMonthLine | null>(null);
  const [menu, setMenu] = React.useState<{ line?: CostMonthLine; category?: CostMonthCategory } | null>(null);
  const [moreOpen, setMoreOpen] = React.useState(false);
  // A colour picked on the spend bar: the chart shows only that category.
  const [focus, setFocus] = React.useState<string | null>(null);
  const name = monthName(month.month);

  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openRoute = useOpenRoute();
  const ask = (question: string) => {
    setMenu(null);
    if (!openAssistantPopup({ ask: question })) openRoute(`/assistant/new?kind=quick&ask=${encodeURIComponent(question)}`);
  };

  return (
    <View className="gap-4">
      <View className="flex-row items-center gap-2">
        {scope ? (
          <SegmentedControl
            accessibilityLabel="Whose costs"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'household', label: 'Household' },
              { value: 'mine', label: 'Personal' },
            ]}
            size="sm"
            className="flex-1"
          />
        ) : (
          <Text className={cn(LABEL, 'flex-1')}>Costs</Text>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a cost"
          onPress={() => onAdd()}
          className="h-9 w-9 items-center justify-center rounded-full bg-primary"
        >
          <Plus size={16} className="text-primary-foreground" />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="More"
          onPress={() => setMoreOpen(true)}
          className="h-9 w-9 items-center justify-center rounded-full border border-border"
        >
          <MoreHorizontal size={16} className="text-foreground" />
        </Pressable>
      </View>

      <Hero month={month} goalCents={goalCents} onEditGoal={onEditGoal} focus={focus} onFocus={(k) => { haptics.select(); setFocus((cur) => (cur === k ? null : k)); }} />

      <MonthChart months={months} picked={month.month} goalCents={goalCents} onPick={(k) => { haptics.select(); setPicked(k); }} focus={focus} onClearFocus={() => setFocus(null)} />

      {month.categories.length === 0 ? (
        <Text className="px-1 text-sm text-muted-foreground">
          {data || items.length ? `Nothing in ${name} yet.` : 'No costs yet. Add your rent, bills and shopping, or connect a bank in Settings.'}
        </Text>
      ) : (
        <View className="gap-2">
          <View className="flex-row justify-between px-1">
            <Text className={LABEL}>Categories</Text>
            <Text className={LABEL}>{month.when === 'past' ? 'Paid' : 'Paid · to come'}</Text>
          </View>
          <View className={CARD}>
            {month.categories.map((c, n) => (
              <CategoryRow
                key={c.category ?? 'none'}
                c={c}
                divided={n > 0}
                isOpen={open.has(c.category ?? 'none')}
                monthName={name}
                onToggle={() => toggle(c.category ?? 'none')}
                onLongPress={() => setMenu({ category: c })}
                onLine={(l) => (l.kind === 'shop' ? setShop(l) : l.item ? onOpenItem(l.item) : undefined)}
                onLineLong={(l) => setMenu({ line: l, category: c })}
                onAdd={c.category ? () => onAdd(c.category as CostCategory) : undefined}
              />
            ))}
          </View>
        </View>
      )}

      {month.income ? (
        <View className="gap-2">
          <Text className={cn(LABEL, 'px-1')}>Money in · not counted in costs</Text>
          <View className={CARD}>
            <CategoryRow
              c={month.income}
              divided={false}
              isOpen={open.has('income')}
              monthName={name}
              onToggle={() => toggle('income')}
              onLongPress={() => setMenu({ category: month.income! })}
              onLine={(l) => (l.kind === 'shop' ? setShop(l) : l.item ? onOpenItem(l.item) : undefined)}
              onLineLong={(l) => setMenu({ line: l, category: month.income! })}
              onAdd={() => onAdd('income')}
              income
            />
          </View>
        </View>
      ) : null}

      {props.footer}

      <ShopSheet line={shop} month={month.month} items={items} nameOf={props.nameOf} onClose={() => setShop(null)} onOpenItem={onOpenItem} onSetAmount={props.onSetAmount} />

      <BottomSheet open={!!menu} onOpenChange={(o) => { if (!o) setMenu(null); }} className="pb-3">
        <View className="gap-1 px-4 pb-2">
          <Text className="pb-2 font-heading text-title font-semibold text-foreground" numberOfLines={1}>
            {menu?.line ? menu.line.name : costCategoryLabel(menu?.category?.category ?? null)}
          </Text>
          {menu?.line?.item ? (
            <MenuRow label="Edit" onPress={() => { const it = menu.line!.item!; setMenu(null); onOpenItem(it); }} />
          ) : null}
          <MenuRow
            label="Ask the assistant"
            onPress={() =>
              ask(
                menu?.line
                  ? `Help me make sense of ${menu.line.name} in my ${name} costs.`
                  : `Help me make sense of my ${costCategoryLabel(menu?.category?.category ?? null)} costs in ${name}.`,
              )
            }
          />
          {canArchive && menu?.line?.item && menu.line.kind !== 'shop' ? (
            <MenuRow
              label={menu.line.item.archived ? 'Bring back' : 'Archive'}
              hint={menu.line.item.archived ? undefined : 'Stays so bank payments still find it, but leaves every total.'}
              onPress={() => { const it = menu.line!.item!; setMenu(null); onArchive(it, !it.archived); }}
            />
          ) : null}
        </View>
      </BottomSheet>

      <BottomSheet open={moreOpen} onOpenChange={setMoreOpen} className="pb-3">
        <View className="gap-1 px-4 pb-2">
          {onOpenPayments ? <MenuRow label="All payments" hint="Every payment as a list, to search and fix categories." onPress={() => { setMoreOpen(false); onOpenPayments(); }} /> : null}
          <MenuRow label="Ask the assistant" onPress={() => { setMoreOpen(false); ask(`Help me make sense of my costs in ${name}.`); }} />
          <MenuRow label={goalCents ? 'Change the monthly goal' : 'Set a monthly goal'} onPress={() => { setMoreOpen(false); onEditGoal(); }} />
          {canArchive && !month.income ? <MenuRow label="Add income" hint="Pay or other money in. It never counts as a cost." onPress={() => { setMoreOpen(false); onAdd('income'); }} /> : null}
        </View>
      </BottomSheet>
    </View>
  );
}

function Hero({
  month,
  goalCents,
  onEditGoal,
  focus,
  onFocus,
}: {
  month: CostMonth;
  goalCents: number | null;
  onEditGoal: () => void;
  focus: string | null;
  onFocus: (key: string) => void;
}) {
  const segments = month.categories.filter((c) => c.paidCents > 0);
  const name = monthName(month.month);
  const max = Math.max(goalCents ?? 0, month.expectedCents, 1);
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%` as const;
  const vsGoal = goalCents ? goalCents - month.expectedCents : null;
  const end = month.month === undefined ? '' : lastDayLabel(month.month);
  const flow = moneyFlow(month);
  return (
    <View className="gap-2">
      <Text className={LABEL}>{month.when === 'future' ? `Expected in ${name}` : `Spent in ${name}`}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Change the monthly goal" onPress={onEditGoal} className="flex-row items-baseline gap-2">
        <Text className="text-hero-section text-foreground" style={TABULAR}>
          {formatMoney(month.when === 'future' ? month.expectedCents : month.paidCents)}
        </Text>
        <Text className="text-title text-muted-foreground" style={TABULAR}>
          {goalCents ? `of ${formatMoney(goalCents)}` : 'Set a goal'}
        </Text>
      </Pressable>
      <View className="h-3 rounded-full bg-muted">
        {month.toComeCents > 0 ? (
          <View className="absolute bottom-0 left-0 top-0 rounded-full border border-dashed border-foreground/50 bg-foreground/10" style={{ width: pct(month.expectedCents) }} />
        ) : null}
        <View className="absolute bottom-0 left-0 top-0 flex-row overflow-hidden rounded-full" style={{ width: pct(month.paidCents) }}>
          {segments.map((c) => {
            const key = catKey(c.category);
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityState={{ selected: focus === key }}
                accessibilityLabel={`${costCategoryLabel(c.category)} ${formatMoney(c.paidCents)}. Show it on the chart`}
                hitSlop={{ top: 12, bottom: 12 }}
                onPress={() => onFocus(key)}
                className={cn('h-full', fillOf(c.category), focus && focus !== key && 'opacity-30')}
                style={{ width: `${(c.paidCents / Math.max(month.paidCents, 1)) * 100}%` }}
              />
            );
          })}
        </View>
        {goalCents ? <View pointerEvents="none" className="absolute -bottom-1 -top-1 w-0.5 rounded bg-foreground" style={{ left: pct(goalCents) }} /> : null}
      </View>
      <View className="flex-row justify-between gap-2">
        <Text className="text-caption text-muted-foreground" style={TABULAR}>
          {month.when === 'current'
            ? `Expected by ${end} `
            : month.when === 'future'
              ? 'Forecast'
              : 'Finished month'}
          {month.when === 'current' ? <Text className="text-caption font-semibold text-foreground">{formatMoney(month.expectedCents)}</Text> : null}
        </Text>
        {vsGoal != null ? (
          <Text className={cn('text-caption', vsGoal < 0 ? 'text-destructive' : 'text-success')} style={TABULAR}>
            {vsGoal < 0 ? `${formatMoney(-vsGoal)} over goal` : `${formatMoney(vsGoal)} under goal`}
          </Text>
        ) : null}
      </View>
      {flow ? (
        <View className="flex-row gap-2 pt-1">
          <Stat label={flow.incomeLabel} value={formatMoney(flow.income)} hint={flow.incomeHint} />
          <Stat label={flow.leftLabel} value={signed(flow.left)} hint={flow.leftHint} tone={flow.left < 0 ? 'danger' : 'success'} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * The income and "in vs out" tiles: what actually came in and went out, with
 * the month-end estimate as the subtitle. A future month has no actuals, so
 * it shows the estimate itself.
 */
function moneyFlow(month: CostMonth): { incomeLabel: string; income: number; incomeHint?: string; leftLabel: string; left: number; leftHint?: string } | null {
  const expected = month.incomeExpectedCents;
  if (expected == null) return null;
  if (month.when === 'future') {
    return { incomeLabel: 'Expected income', income: expected, leftLabel: 'Expected left', left: expected - month.expectedCents };
  }
  const left = month.incomeCents - month.paidCents;
  if (month.when === 'past') return { incomeLabel: 'Income', income: month.incomeCents, leftLabel: 'Left over', left };
  return {
    incomeLabel: 'Income so far',
    income: month.incomeCents,
    incomeHint: expected > month.incomeCents ? `About ${formatMoney(expected)} expected` : undefined,
    leftLabel: 'In vs out so far',
    left,
    leftHint: `About ${signed(expected - month.expectedCents)} by month end`,
  };
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'success' | 'danger' }) {
  return (
    <View className="flex-1 rounded-2xl bg-muted/40 px-3 py-2">
      <Text className={LABEL}>{label}</Text>
      <Text className={cn('text-body font-semibold', tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-destructive' : 'text-foreground')} style={TABULAR}>
        {value}
      </Text>
      {hint ? <Text className="text-caption text-muted-foreground" style={TABULAR}>{hint}</Text> : null}
    </View>
  );
}

function MonthChart({
  months,
  picked,
  goalCents,
  onPick,
  focus,
  onClearFocus,
}: {
  months: CostMonth[];
  picked: string;
  goalCents: number | null;
  onPick: (key: string) => void;
  focus: string | null;
  onClearFocus: () => void;
}) {
  const bars = months.map((m) => monthBar(m, focus));
  const max = Math.max(focus ? 0 : goalCents ?? 0, ...bars.map((b) => b.paid + b.toCome), 1);
  const h = (v: number) => Math.round((v / max) * CHART_HEIGHT);
  const pickedBar = bars[months.findIndex((m) => m.month === picked)];
  const focusLabel = focus ? costCategoryLabel(focus === 'none' ? null : (focus as CostCategory)) : null;
  return (
    <View accessibilityLabel="Costs by month" className="gap-1">
      {focusLabel ? (
        <View className="flex-row items-center justify-between gap-2">
          <Text className="text-caption font-semibold text-foreground" style={TABULAR}>
            {focusLabel} in {monthName(picked)}: {formatMoney(pickedBar?.paid ?? 0)}
          </Text>
          <Pressable accessibilityRole="button" onPress={onClearFocus} hitSlop={8} className="rounded-full bg-muted px-2.5 py-0.5">
            <Text className="text-caption text-muted-foreground">Show all</Text>
          </Pressable>
        </View>
      ) : null}
      <View className="flex-row items-end gap-1" style={{ height: CHART_HEIGHT }}>
        {goalCents && !focus ? <View className="absolute left-0 right-0 border-t border-dashed border-muted-foreground/50" style={{ bottom: h(goalCents) }} /> : null}
        {months.map((m, i) => {
          const on = m.month === picked;
          const bar = bars[i];
          return (
            <Pressable
              key={m.month}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${monthName(m.month)}, ${formatMoney(bar.paid + bar.toCome)}`}
              onPress={() => onPick(m.month)}
              className={cn('h-full flex-1 justify-end', !on && 'opacity-45')}
            >
              {bar.toCome > 0 ? (
                <View
                  className={cn('rounded-t-[4px] border border-b-0 border-dashed', on ? 'border-foreground/70' : 'border-muted-foreground/60')}
                  style={{ height: Math.max(2, h(bar.toCome)) }}
                />
              ) : null}
              <View className={cn('flex-col-reverse overflow-hidden', bar.toCome > 0 ? 'rounded-b-[3px]' : 'rounded-[4px]')}>
                {bar.segments.map((seg) => (
                  <View key={seg.key} className={fillOf(seg.category)} style={{ height: Math.max(1, h(seg.cents)) }} />
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>
      <View className="flex-row gap-1">
        {months.map((m) => (
          <Text key={m.month} className={cn('flex-1 text-center text-[10px]', m.month === picked ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
            {shortMonth(m.month)}
          </Text>
        ))}
      </View>
    </View>
  );
}

const CATEGORY_ORDER = Object.keys(CATEGORY_META) as CostCategory[];

/** A month's chart bar: paid split by category (in a fixed order, so colours line up month to month) and what's to come. */
function monthBar(m: CostMonth, focus: string | null): { paid: number; toCome: number; segments: { key: string; category: CostCategory | null; cents: number }[] } {
  const cats = m.categories.filter((c) => !focus || catKey(c.category) === focus);
  const rank = (c: CostCategory | null) => (c ? CATEGORY_ORDER.indexOf(c) : CATEGORY_ORDER.length);
  const segments = cats
    .filter((c) => c.paidCents > 0)
    .sort((a, b) => rank(a.category) - rank(b.category))
    .map((c) => ({ key: catKey(c.category), category: c.category, cents: c.paidCents }));
  return {
    paid: segments.reduce((s, x) => s + x.cents, 0),
    toCome: focus ? cats.reduce((s, c) => s + c.toComeCents, 0) : m.toComeCents,
    segments,
  };
}

function catKey(category: CostCategory | null): string {
  return category ?? 'none';
}

function fillOf(category: CostCategory | null): string {
  return category ? CATEGORY_BAR_FILL[category] : 'bg-muted-foreground/60';
}

function CategoryRow({
  c,
  divided,
  isOpen,
  monthName: name,
  onToggle,
  onLongPress,
  onLine,
  onLineLong,
  onAdd,
  income,
}: {
  c: CostMonthCategory;
  divided: boolean;
  isOpen: boolean;
  monthName: string;
  onToggle: () => void;
  onLongPress: () => void;
  onLine: (l: CostMonthLine) => void;
  onLineLong: (l: CostMonthLine) => void;
  onAdd?: () => void;
  income?: boolean;
}) {
  const payments = c.lines.filter((l) => l.kind === 'shop').reduce((s, l) => s + l.count, 0);
  const shops = c.lines.filter((l) => l.kind === 'shop').length;
  const due = c.lines.filter((l) => l.kind === 'recurring' && l.toComeCents > 0 && l.paidCents === 0);
  const meta = [
    payments ? `${payments} payment${payments === 1 ? '' : 's'}${shops > 1 ? ` · ${shops} shops` : ''}` : null,
    due.length === 1 && due[0].date ? `Due ${dayLabel(due[0].date)}` : due.length > 1 ? `${due.length} due` : null,
    !payments && !due.length ? `${c.lines.filter((l) => l.kind !== 'usual').length} cost${c.lines.length === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <View className={cn(divided && 'border-t border-border/60')}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        onPress={onToggle}
        onLongPress={onLongPress}
        className="min-h-14 flex-row items-center gap-3 px-4 py-2"
      >
        {c.category ? <CategoryChip category={c.category} /> : <View className="h-7 w-7 rounded-[9px] border border-dashed border-muted-foreground/60" />}
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-sm font-medium text-foreground">
            {costCategoryLabel(c.category)}
          </Text>
          {meta ? (
            <Text numberOfLines={1} className="text-xs text-muted-foreground" style={TABULAR}>
              {meta}
            </Text>
          ) : null}
        </View>
        <View className="items-end">
          <Text className={cn('text-sm font-semibold', income ? 'text-success' : 'text-foreground')} style={TABULAR}>
            {income ? '+' : ''}
            {formatMoney(c.paidCents)}
          </Text>
          {c.toComeCents > 0 ? (
            <Text className="text-xs text-muted-foreground" style={TABULAR}>
              ~{formatMoney(c.toComeCents)} to come
            </Text>
          ) : null}
        </View>
        {isOpen ? <ChevronDown size={16} className="text-muted-foreground" /> : <ChevronRight size={16} className="text-muted-foreground" />}
      </Pressable>
      {isOpen ? (
        <View className="bg-muted/20 pb-1 pl-14 pr-4">
          {c.lines.map((l, i) => (
            <LineRow key={l.key} l={l} divided={i > 0} monthName={name} onPress={() => onLine(l)} onLongPress={() => onLineLong(l)} />
          ))}
          {onAdd ? (
            <Pressable accessibilityRole="button" onPress={onAdd} className="min-h-11 flex-row items-center gap-2 border-t border-border/60">
              <Plus size={14} className="text-muted-foreground" />
              <Text className="text-sm text-muted-foreground">{income ? 'Add income' : 'Add a cost'}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function LineRow({ l, divided, monthName: name, onPress, onLongPress }: { l: CostMonthLine; divided: boolean; monthName: string; onPress: () => void; onLongPress: () => void }) {
  const ghost = l.kind === 'usual' || l.kind === 'target' || (l.paidCents === 0 && l.toComeCents > 0);
  const meta = lineMeta(l, name);
  const SourceIcon = l.source === 'up' ? Landmark : l.source === 'csv' ? FileText : l.source === 'manual' ? PenLine : null;
  const pressable = l.kind !== 'usual';
  return (
    <Pressable
      accessibilityRole={pressable ? 'button' : undefined}
      disabled={!pressable}
      onPress={onPress}
      onLongPress={onLongPress}
      className={cn('min-h-[52px] flex-row items-center gap-3 py-2', divided && 'border-t border-border/60')}
    >
      <View className="min-w-0 flex-1 gap-0.5">
        <View className="flex-row items-center gap-1.5">
          <Text numberOfLines={1} className={cn('min-w-0 shrink text-sm font-medium', ghost ? 'italic text-muted-foreground' : 'text-foreground')}>
            {l.name}
          </Text>
          {l.kind === 'recurring' || (l.item && l.kind === 'cost' && l.item.cadence !== 'one_off') ? (
            <Repeat size={11} className="text-muted-foreground" />
          ) : null}
          {SourceIcon ? <SourceIcon size={11} className="text-muted-foreground" /> : null}
        </View>
        {meta ? (
          <Text numberOfLines={1} className={cn('text-xs', l.kind === 'recurring' && l.toComeCents > 0 && !l.paidCents ? 'text-warning' : l.kind === 'recurring' && l.paidCents > 0 ? 'text-success' : 'text-muted-foreground')} style={TABULAR}>
            {meta}
          </Text>
        ) : null}
      </View>
      <View className="items-end">
        <Text className={cn('text-sm', ghost ? 'italic text-muted-foreground' : 'text-foreground')} style={TABULAR}>
          {l.paidCents > 0 ? formatMoney(l.paidCents) : l.toComeCents > 0 ? `~${formatMoney(l.toComeCents)}` : l.item ? formatMoney(l.item.amount) : ''}
          {l.item && l.kind !== 'shop' && l.item.cadence !== 'one_off' && l.paidCents === 0 ? CADENCE_LABEL[l.item.cadence] : ''}
        </Text>
        {l.paidCents > 0 && l.toComeCents > 0 ? (
          <Text className="text-xs text-muted-foreground" style={TABULAR}>~{formatMoney(l.toComeCents)} to come</Text>
        ) : null}
      </View>
      {l.kind === 'shop' ? <ChevronRight size={14} className="text-muted-foreground" /> : null}
    </Pressable>
  );
}

/** A line's second row: "5 payments · last Tue", "Paid Oct 1", "Due Oct 28", "Usual for the rest of October". */
function lineMeta(l: CostMonthLine, name: string): string | null {
  const now = new Date();
  if (l.kind === 'usual') return `Usual for the rest of ${name}`;
  if (l.kind === 'target') return 'A plan the payments replaced, not counted';
  if (l.kind === 'shop') return `${l.count} payment${l.count === 1 ? '' : 's'}${l.date ? ` · last ${bankDayLabel(l.date, now)}` : ''}`;
  if (l.kind === 'recurring') {
    if (l.paidCents > 0) return `Paid ${l.date ? dayLabel(l.date) : ''}`.trim();
    return l.date ? `Due ${dayLabel(l.date)}` : 'Due';
  }
  if (l.item?.archived) return 'Archived';
  return l.date ? dayLabel(l.date) : null;
}

/** A shop's payments in the month, newest first; a tap opens the payment's sheet. */
function ShopSheet({
  line,
  month,
  items,
  nameOf,
  onClose,
  onOpenItem,
  onSetAmount,
}: {
  line: CostMonthLine | null;
  month: string;
  items: CostItem[];
  nameOf: (userId: string) => string;
  onClose: () => void;
  onOpenItem: (item: CostItem) => void;
  onSetAmount: (item: CostItem, cents: number) => void;
}) {
  const { scope, reload } = useUpOverview();
  const [rows, setRows] = React.useState<BankTransactionView[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!line) return;
    setRows(null);
    setError(null);
    let live = true;
    upBankApi
      .transactions({ month: `${month}-01`, scope: scope ?? undefined })
      .then((page) => {
        if (!live) return;
        const key = squash(line.vendor ?? line.name);
        setRows(page.transactions.filter((t) => !t.isTransfer && !t.hidden && squash(t.description.replace(/[\\\s]+$/, '')) === key));
      })
      .catch((err) => live && setError(err instanceof Error ? err.message : "Couldn't read the payments."));
    return () => {
      live = false;
    };
  }, [line, month, scope]);

  const apply = async (id: string, patch: BankTransactionPatch) => {
    try {
      const saved = await upBankApi.updateTransaction(id, patch);
      setRows((cur) => (cur ?? []).map((r) => (r.id === id ? saved : r)));
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    }
  };
  const t = rows?.find((r) => r.id === openId) ?? null;
  const now = new Date();

  return (
    <>
      <BottomSheet open={!!line && !openId} onOpenChange={(o) => { if (!o) onClose(); }} className="max-h-[80%] pb-3">
        <View className="gap-2 px-4 pb-2">
          <View className="flex-row items-baseline justify-between gap-2">
            <Text numberOfLines={1} className="min-w-0 flex-1 font-heading text-title font-semibold text-foreground">
              {line?.name}
            </Text>
            <Text className="text-title font-semibold text-foreground" style={TABULAR}>
              {line ? formatMoney(line.paidCents) : ''}
            </Text>
          </View>
          <Text className="text-caption text-muted-foreground">
            {monthName(month)} · {line?.count ?? 0} payment{line?.count === 1 ? '' : 's'}
          </Text>
          {line?.item ? (
            <Pressable accessibilityRole="button" onPress={() => { const it = line.item!; onClose(); onOpenItem(it); }} className="min-h-10 justify-center">
              <Text className="text-sm font-medium text-primary">Change its category</Text>
            </Pressable>
          ) : null}
          {error ? <Text className="text-xs text-destructive">{error}</Text> : null}
          {!rows ? (
            <Text className="py-2 text-sm text-muted-foreground">Reading payments…</Text>
          ) : (
            <View className="rounded-2xl bg-muted/30 px-3">
              {rows.map((r, i) => (
                <Pressable key={r.id} accessibilityRole="button" onPress={() => setOpenId(r.id)} className={cn('min-h-12 flex-row items-center gap-3 py-2', i > 0 && 'border-t border-border/60')}>
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm text-foreground">{bankDayLabel(r.occurredAt, now)}</Text>
                    <Text numberOfLines={1} className="text-xs text-muted-foreground">
                      {[r.accountName, r.pending ? 'pending' : null, r.mine ? null : nameOf(r.userId)].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Text className={cn('text-sm', r.amountCents > 0 ? 'text-success' : 'text-foreground')} style={TABULAR}>
                    {r.amountCents > 0 ? '+' : ''}
                    {formatMoney(Math.abs(r.amountCents))}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </BottomSheet>
      <TransactionSheet
        t={t}
        items={items}
        owner={t && !t.mine ? nameOf(t.userId) : null}
        onClose={() => setOpenId(null)}
        onPatch={(patch) => {
          if (t) void apply(t.id, patch);
        }}
        onMadeCost={(saved) => {
          setRows((cur) => (cur ?? []).map((r) => (r.id === saved.id ? saved : r)));
          reload();
        }}
        onOpenItem={(item) => {
          setOpenId(null);
          onClose();
          onOpenItem(item);
        }}
        onSetAmount={onSetAmount}
      />
    </>
  );
}

function MenuRow({ label, hint, onPress }: { label: string; hint?: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} className="min-h-12 justify-center rounded-xl px-1 py-2">
      <Text className="text-body font-medium text-foreground">{label}</Text>
      {hint ? <Text className="text-caption text-muted-foreground">{hint}</Text> : null}
    </Pressable>
  );
}

function squash(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toUpperCase();
}

function monthName(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-AU', { month: 'long' });
}

function shortMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-AU', { month: 'short' }).slice(0, 3);
}

function lastDayLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 0).toLocaleDateString('en-AU', { month: 'short', day: 'numeric' });
}

/** "Oct 28" from a YYYY-MM-DD day or an instant. */
function dayLabel(date: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00`) : new Date(date);
  return d.toLocaleDateString('en-AU', { month: 'short', day: 'numeric' });
}

function signed(cents: number): string {
  return `${cents < 0 ? '−' : '+'}${formatMoney(Math.abs(cents))}`;
}
