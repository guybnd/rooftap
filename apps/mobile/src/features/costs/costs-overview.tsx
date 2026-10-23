// Costs, redesigned (Guy's spec, Oct 22): one page for a month. On top, what
// was spent out of the goal and what the month should end at; income and what
// should be left when there is income; a chart of the months (picking one sets
// the whole page to it); then the categories, each opening in place to its
// shops, recurring costs and costs added by hand, with what's still to come.
// Every number comes from core costMonth (cost-month.ts), the same function
// Home, the digest and the assistant read. A row's source is an icon only: a
// bank for a connector, a pen for one added by hand. A row moves to another
// category in two taps (Guy, 2026-10-23): hold it for its menu (core
// costRowMenu, "Move to" on top), or swipe right for the likely categories
// first. Swipe left hides a shop's payments for the month, or archives a cost.
// Web twin: apps/web/src/app/costs/costs-overview.tsx.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Archive, ArrowRight, ChevronDown, ChevronRight, EyeOff, FileText, Landmark, MessageSquare, MoreHorizontal, PenLine, Plus, Repeat, Sparkles, Target, Wallet, List, type LucideIcon } from 'lucide-react-native';
import { BottomSheet, SegmentedControl, SwipeActions, Switch, Text, cn, haptics, toast } from '@homeup/ui';
import {
  CADENCE_LABEL,
  bankDayLabel,
  costCategoryLabel,
  formatMoney,
  openAssistantPopup,
  useCostsOverview,
  useUpOverview,
  useShopPayments,
  moveBankPayment,
  costsSummaryAsk,
  costCategoryKey,
  costDayLabel,
  lineMeta,
  lineRanks,
  monthBar,
  monthLastDayLabel,
  monthLongName,
  monthShortName,
  moneyFlow,
  signedMoney,
  type CostCategory,
  type CostItem,
  type CostMonth,
  type CostMonthCategory,
  type CostMonthLine,
  type MoneySummaryPrefs,
  canHideCostLine,
  costCategoryMenu,
  costLineAmountLabel,
  costLineCategory,
  costMoveKind,
  costRowMenu,
  hideShopMonthWithUndo,
  likelyCostCategories,
  moveCostLineWithUndo,
  useCostCategoryChoices,
  useCostInsights,
  useModules,
  useSeenInsights,
  hasUnseenInsights,
  markInsightsSeen,
  type SpendingTransaction,
} from '@homeup/core';
import { CategoryPickerSheet, type CategoryPick } from './category-picker';
import { CostRowSheet, type CostRowSheetState } from './cost-row-sheet';
import { CATEGORY_BAR_FILL, CategoryChip } from './cost-card';
import { TransactionSheet } from './money-view';
import { upBankApi } from './up-bank-api';
import { CostInsightsCard, type CostInsightsCardProps } from './cost-insights';
import { CostsGlance, LatestRows, latestCategory, type GlancePage } from './costs-glance';
import { ToSortCard } from './to-sort-card';
import { useOpenRoute } from '@/lib/tab-routes';

const TABULAR = { fontVariant: ['tabular-nums' as const] };
const LABEL = 'text-micro-label uppercase text-muted-foreground';
const CARD = 'overflow-hidden rounded-3xl border border-border/60 bg-card';
/** Months the chart shows: nine back, this one, two ahead. */
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
  /** Saves a change to a cost line (a move to another category). */
  onPatchItem: (item: CostItem, patch: Partial<CostItem>) => void;
  /** Rendered between the categories and the end of the page (suggestions). */
  footer?: React.ReactNode;
  /** The money-insights module's "Worth a look" card, shown on this month; null when it's off. */
  insights?: Pick<CostInsightsCardProps, 'marks' | 'onMarks' | 'onRemind'> | null;
  /** Assistant summaries: "Summarise <month>" in the ⋯ menu, and the weekly and monthly switches when the server keeps them. Null with the Assistant off. */
  summaries?: { prefs: MoneySummaryPrefs; onChange: ((next: MoneySummaryPrefs) => void) | null } | null;
}

// Before the bank payments land: shapes where the total, chart and
// categories go, so no total shows that leaves the bank out.
function Waiting() {
  return (
    <View className="gap-5" accessibilityLabel="Reading your bank payments">
      <View className="gap-3 px-1">
        <View className="h-3 w-24 rounded bg-muted" />
        <View className="h-10 w-40 rounded-lg bg-muted" />
        <View className="h-2 w-full rounded-full bg-muted" />
      </View>
      <View className="h-40 rounded-2xl bg-muted" />
      <Text className="px-1 text-sm text-muted-foreground">Reading your bank payments</Text>
      <View className="h-56 rounded-2xl bg-muted" />
    </View>
  );
}

export function CostsOverview(props: CostsOverviewProps) {
  const { items, goalCents, onEditGoal, onOpenItem, onAdd, onArchive, onOpenPayments, canArchive } = props;
  const { scope, setScope, data, ready, status } = useUpOverview();
  // Someone sharing Up who never set the weekly switch gets the bank's weekly digest.
  const upWeekly = !!status?.connection && status.connection.shareMode !== 'none' && status.connection.weeklyDigest !== false;
  const { months, month, name, setPicked, open, toggle, focus, setFocus, toggleFocus, openCategory: showCategory } = useCostsOverview(items);
  const [shop, setShop] = React.useState<CostMonthLine | null>(null);
  const [rowSheet, setRowSheet] = React.useState<CostRowSheetState | null>(null);
  const [pick, setPick] = React.useState<CategoryPick | null>(null);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const { reload } = useUpOverview();
  const quickMove = useModules().server('costs.quick-move');
  const choices = useCostCategoryChoices();


  // An insight's "Show the category": this month, with that category open.
  const openCategory = (category: CostCategory | null) => {
    showCategory(category);
  };

  const openRoute = useOpenRoute();
  const ask = (question: string) => {
    if (!openAssistantPopup({ ask: question })) openRoute(`/assistant/new?kind=quick&ask=${encodeURIComponent(question)}`);
  };

  const deps = { patchItem: props.onPatchItem, api: upBankApi, reload };
  // A move says where the row went, with Undo back to where it was.
  const move = (l: CostMonthLine, inCategory: CostCategory | null, to: CostCategory) => {
    moveCostLineWithUndo(l, inCategory, to, quickMove, deps)
      .then(({ message, undo }) => {
        haptics.success();
        toast.message(message, {
          duration: 5000,
          action: undo ? { label: 'Undo', onPress: () => void undo().catch(() => toast.error("Couldn't move it back.")) } : undefined,
        });
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Couldn't move it."));
  };
  const hide = (l: CostMonthLine) => {
    haptics.remove();
    hideShopMonthWithUndo(l, month.month, name, { api: upBankApi, reload })
      .then((done) => {
        if (!done) return;
        toast.message(done.message, { duration: 5000, action: { label: 'Undo', onPress: () => void done.undo?.() } });
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Couldn't hide it."));
  };
  const pickFor = (l: CostMonthLine, c: CostMonthCategory) => {
    const current = costLineCategory(l, c.category);
    haptics.select();
    setPick({ title: `Move ${l.name}`, current, likely: likelyCostCategories(l, current, month, choices), onPick: (to) => move(l, c.category, to) });
  };
  // The glance card: the latest payments and the insights, one page each.
  const { insights: insightList } = useCostInsights(items, { goalCents, marks: props.insights?.marks });
  const insightKeys = props.insights ? insightList.map((i) => i.key) : [];
  const seenInsights = useSeenInsights();
  const lineById = React.useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const latest = (data?.recent ?? []).slice(0, 3);
  const movePayment = (t: SpendingTransaction, to: CostCategory, wholeShop: boolean) => {
    moveBankPayment(upBankApi, t, to, wholeShop)
      .then((message) => {
        haptics.success();
        reload();
        toast.message(message);
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Couldn't move it."));
  };
  const pickPayment = (t: SpendingTransaction) => {
    const current = latestCategory(t, t.costItemId ? lineById.get(t.costItemId) : undefined);
    haptics.commit();
    setPick({
      title: `Move ${t.description}`,
      current,
      likely: likelyCostCategories({ sourceCategory: t.category }, current, month, choices),
      scope: { label: `Every payment at ${t.description}`, hint: 'Off moves this payment only' },
      onPick: (to, whole) => movePayment(t, to, whole),
    });
  };
  const glance: GlancePage[] = [];
  if (month.when === 'current' && latest.length) {
    glance.push({ key: 'latest', label: 'Latest', node: <LatestRows payments={latest} lineById={lineById} onOpen={() => onOpenPayments?.()} onHold={quickMove ? pickPayment : null} /> });
  }
  if (props.insights && month.when === 'current' && insightKeys.length) {
    glance.push({
      key: 'insights',
      label: 'Worth a look',
      dot: hasUnseenInsights(insightKeys, seenInsights),
      node: <CostInsightsCard bare items={items} goalCents={goalCents} onOpenItem={onOpenItem} onOpenCategory={openCategory} {...props.insights} />,
    });
  }
  const glanceStart = glance.findIndex((p) => p.dot);

  const canHide = (l: CostMonthLine) => canHideCostLine(l, quickMove);
  const lineMenu = (l: CostMonthLine, c: CostMonthCategory) => {
    haptics.commit();
    setRowSheet({
      category: costLineCategory(l, c.category),
      amount: costLineAmountLabel(l),
      meta: [costCategoryLabel(costLineCategory(l, c.category)), lineMeta(l, name)].filter(Boolean).join(' · '),
      menu: costRowMenu({
        line: l,
        category: c.category,
        choices,
        monthName: name,
        quickMove,
        onMove: (to) => move(l, c.category, to),
        onPayments: l.kind === 'shop' && l.vendor ? () => setShop(l) : null,
        onEdit: onOpenItem,
        onAsk: ask,
        onArchive: canArchive ? onArchive : null,
        onHide: canHide(l) ? () => hide(l) : null,
      }),
    });
  };
  const categoryMenu = (c: CostMonthCategory) => {
    haptics.commit();
    setRowSheet({ category: c.category, amount: formatMoney(c.paidCents), meta: name, menu: costCategoryMenu({ category: c.category, monthName: name, onAsk: ask, onAdd }) });
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

      {!ready ? (
        <Waiting />
      ) : (
        <>
        <Hero month={month} goalCents={goalCents} onEditGoal={onEditGoal} focus={focus} onFocus={(k) => { haptics.select(); toggleFocus(k); }} />

        <MonthChart months={months} picked={month.month} goalCents={goalCents} onPick={(k) => { haptics.select(); setPicked(k); }} focus={focus} onClearFocus={() => setFocus(null)} />

        {glance.length ? (
          <CostsGlance
            key={glance.map((p) => p.key).join('|')}
            pages={glance}
            initial={Math.max(0, glanceStart)}
            onPage={(key) => {
              if (key === 'insights') markInsightsSeen(insightKeys);
            }}
          />
        ) : null}

        {quickMove && month.when === 'current' ? (
          <ToSortCard
            month={month}
            monthName={name}
            choices={choices}
            onSort={(l, to) => move(l, null, to)}
            onOther={(l, _guess, then) => {
              haptics.select();
              setPick({ title: `Where does ${l.name} go?`, current: null, likely: likelyCostCategories(l, null, month, choices), onPick: (to) => { then(); move(l, null, to); } });
            }}
          />
        ) : null}

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
              {month.categories.filter((c) => !focus || costCategoryKey(c.category) === focus).map((c, n) => (
                <CategoryRow
                  key={c.category ?? 'none'}
                  c={c}
                  divided={n > 0}
                  isOpen={!!focus || open.has(c.category ?? 'none')}
                  monthName={name}
                  onToggle={() => toggle(c.category ?? 'none')}
                  onLongPress={() => categoryMenu(c)}
                  onLine={(l) => (l.kind === 'shop' ? setShop(l) : l.item ? onOpenItem(l.item) : undefined)}
                  onLineLong={(l) => lineMenu(l, c)}
                  onLineMove={(l) => pickFor(l, c)}
                  onLineAway={(l) => (canHide(l) ? hide(l) : canArchive && l.item && l.kind !== 'shop' ? onArchive(l.item, !l.item.archived) : undefined)}
                  canMove={(l) => !!costMoveKind(l, quickMove)}
                  awayOf={(l) => (canHide(l) ? 'hide' : canArchive && l.item && l.kind !== 'shop' ? 'archive' : null)}
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
                onLongPress={() => categoryMenu(month.income!)}
                onLine={(l) => (l.kind === 'shop' ? setShop(l) : l.item ? onOpenItem(l.item) : undefined)}
                onLineLong={(l) => lineMenu(l, month.income!)}
                onLineMove={(l) => pickFor(l, month.income!)}
                onLineAway={(l) => (canHide(l) ? hide(l) : undefined)}
                canMove={(l) => !!costMoveKind(l, quickMove)}
                awayOf={(l) => (canHide(l) ? 'hide' : null)}
                onAdd={() => onAdd('income')}
                income
              />
            </View>
          </View>
        ) : null}
        </>
      )}

      {props.footer}

      <ShopSheet
        line={shop}
        month={month.month}
        items={items}
        nameOf={props.nameOf}
        onClose={() => setShop(null)}
        onOpenItem={onOpenItem}
        onSetAmount={props.onSetAmount}
        onMove={
          shop && costMoveKind(shop, quickMove)
            ? () => {
                const l = shop;
                const c = month.categories.find((x) => x.lines.some((y) => y.key === l.key)) ?? month.income;
                setShop(null);
                if (c) setTimeout(() => pickFor(l, c), 0);
              }
            : null
        }
      />

      <CostRowSheet state={rowSheet} choices={choices} onClose={() => setRowSheet(null)} />
      <CategoryPickerSheet pick={pick} choices={choices} onClose={() => setPick(null)} />

      <BottomSheet open={moreOpen} onOpenChange={setMoreOpen} className="pb-3">
        <View className="gap-1 px-4 pb-2">
          <Text className={cn(LABEL, 'px-1 pt-1')}>{name}</Text>
          <View className="rounded-2xl bg-muted/40">
            <MenuRow Icon={Target} label="Monthly goal" value={goalCents ? formatMoney(goalCents) : 'Not set'} onPress={() => { setMoreOpen(false); onEditGoal(); }} />
            {canArchive && !month.income ? <MenuRow Icon={Wallet} label="Add income" hint="Pay or other money in. It never counts as a cost." divided onPress={() => { setMoreOpen(false); onAdd('income'); }} /> : null}
          </View>
          <Text className={cn(LABEL, 'px-1 pt-3')}>Look closer</Text>
          <View className="rounded-2xl bg-muted/40">
            {onOpenPayments ? <MenuRow Icon={List} label="All payments" hint="Every payment as a list, to search and move." onPress={() => { setMoreOpen(false); onOpenPayments(); }} /> : null}
            {props.summaries ? (
              <MenuRow Icon={Sparkles} label={`Summarise ${name}`} divided={!!onOpenPayments} onPress={() => { setMoreOpen(false); ask(costsSummaryAsk(name)); }} />
            ) : null}
            <MenuRow Icon={MessageSquare} label="Ask the assistant" divided={!!onOpenPayments || !!props.summaries} onPress={() => { setMoreOpen(false); ask(`Help me make sense of my costs in ${name}.`); }} />
          </View>
          {props.summaries?.onChange ? (
            <>
              <Text className={cn(LABEL, 'px-1 pt-3')}>Summaries in the Household chat</Text>
              <View className="rounded-2xl bg-muted/40 px-3">
                <SwitchRow
                  label="Weekly"
                  hint="Sunday morning: the week, what is worth a look and the bills ahead."
                  checked={props.summaries.prefs.weekly ?? upWeekly}
                  onChange={(on) => props.summaries!.onChange!({ ...props.summaries!.prefs, weekly: on })}
                />
                <SwitchRow
                  label="Monthly"
                  hint="On the 1st: last month against the goal and the month before."
                  checked={!!props.summaries.prefs.monthly}
                  onChange={(on) => props.summaries!.onChange!({ ...props.summaries!.prefs, monthly: on })}
                />
              </View>
            </>
          ) : null}
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
  const name = monthLongName(month.month);
  const max = Math.max(goalCents ?? 0, month.expectedCents, 1);
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%` as const;
  const vsGoal = goalCents ? goalCents - month.expectedCents : null;
  const end = month.month === undefined ? '' : monthLastDayLabel(month.month);
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
            const key = costCategoryKey(c.category);
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
          <Stat label={flow.leftLabel} value={signedMoney(flow.left)} hint={flow.leftHint} tone={flow.left < 0 ? 'danger' : 'success'} />
        </View>
      ) : null}
    </View>
  );
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
  const ranks = React.useMemo(() => lineRanks(months, focus), [months, focus]);
  const bars = months.map((m) => monthBar(m, focus, ranks));
  const max = Math.max(focus ? 0 : goalCents ?? 0, ...bars.map((b) => b.paid + b.toCome), 1);
  const h = (v: number) => Math.round((v / max) * CHART_HEIGHT);
  const pickedBar = bars[months.findIndex((m) => m.month === picked)];
  const focusLabel = focus ? costCategoryLabel(focus === 'none' ? null : (focus as CostCategory)) : null;
  return (
    <View accessibilityLabel="Costs by month" className="gap-1">
      {focusLabel ? (
        <View className="flex-row items-center justify-between gap-2">
          <Text className="text-caption font-semibold text-foreground" style={TABULAR}>
            {focusLabel} in {monthLongName(picked)}: {formatMoney(pickedBar?.paid ?? 0)}
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
              accessibilityLabel={`${monthLongName(m.month)}, ${formatMoney(bar.paid + bar.toCome)}`}
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
                  <View key={seg.key} className={cn(fillOf(seg.category), focus && SHADES[seg.shade % SHADES.length], focus && 'border-t border-background/40')} style={{ height: Math.max(1, h(seg.cents)) }} />
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>
      <View className="flex-row gap-1">
        {months.map((m) => (
          <Text key={m.month} className={cn('flex-1 text-center text-[10px]', m.month === picked ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
            {monthShortName(m.month)}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** Shades for a category's lines, so neighbours in a bar stand apart. */
const SHADES = ['opacity-100', 'opacity-70', 'opacity-50', 'opacity-85', 'opacity-60', 'opacity-40'];

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
  onLineMove,
  onLineAway,
  canMove,
  awayOf,
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
  /** Swipe right: pick a category. */
  onLineMove: (l: CostMonthLine) => void;
  /** Swipe left: hide a shop's payments, or archive a cost. */
  onLineAway: (l: CostMonthLine) => void;
  canMove: (l: CostMonthLine) => boolean;
  awayOf: (l: CostMonthLine) => 'hide' | 'archive' | null;
  onAdd?: () => void;
  income?: boolean;
}) {
  const payments = c.lines.filter((l) => l.kind === 'shop').reduce((s, l) => s + l.count, 0);
  const shops = c.lines.filter((l) => l.kind === 'shop').length;
  const due = c.lines.filter((l) => l.kind === 'recurring' && l.toComeCents > 0 && l.paidCents === 0);
  const meta = [
    payments ? `${payments} payment${payments === 1 ? '' : 's'}${shops > 1 ? ` · ${shops} shops` : ''}` : null,
    due.length === 1 && due[0].date ? `Due ${costDayLabel(due[0].date)}` : due.length > 1 ? `${due.length} due` : null,
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
        <View className="pb-1">
          {c.lines.map((l, i) => (
            <LineRow
              key={l.key}
              l={l}
              divided={i > 0}
              monthName={name}
              onPress={() => onLine(l)}
              onLongPress={() => onLineLong(l)}
              onMove={canMove(l) ? () => onLineMove(l) : undefined}
              away={awayOf(l)}
              onAway={() => onLineAway(l)}
            />
          ))}
          {onAdd ? (
            <Pressable accessibilityRole="button" onPress={onAdd} className="ml-14 mr-4 min-h-11 flex-row items-center gap-2 border-t border-border/60">
              <Plus size={14} className="text-muted-foreground" />
              <Text className="text-sm text-muted-foreground">{income ? 'Add income' : 'Add a cost'}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function LineRow({
  l,
  divided,
  monthName: name,
  onPress,
  onLongPress,
  onMove,
  away,
  onAway,
}: {
  l: CostMonthLine;
  divided: boolean;
  monthName: string;
  onPress: () => void;
  onLongPress: () => void;
  onMove?: () => void;
  away: 'hide' | 'archive' | null;
  onAway: () => void;
}) {
  const ghost = l.kind === 'usual' || l.kind === 'target' || (l.paidCents === 0 && l.toComeCents > 0);
  const meta = lineMeta(l, name);
  const SourceIcon = l.source === 'up' ? Landmark : l.source === 'csv' ? FileText : l.source === 'manual' ? PenLine : null;
  const pressable = l.kind !== 'usual';
  const row = (
    <Pressable
      accessibilityRole={pressable ? 'button' : undefined}
      accessibilityHint={pressable ? 'Hold for more. Swipe right to move it.' : undefined}
      accessibilityActions={pressable ? [{ name: 'longpress', label: 'More' }, ...(onMove ? [{ name: 'activate-move', label: 'Move to another category' }] : [])] : undefined}
      onAccessibilityAction={(e) => (e.nativeEvent.actionName === 'longpress' ? onLongPress() : e.nativeEvent.actionName === 'activate-move' ? onMove?.() : undefined)}
      disabled={!pressable}
      onPress={onPress}
      className="bg-card pl-14 pr-4"
    >
      <View className={cn('min-h-[52px] flex-row items-center gap-3 py-2', divided && 'border-t border-border/60')}>
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
      </View>
    </Pressable>
  );
  if (!pressable) return row;
  return (
    <SwipeActions
      onLongPress={onLongPress}
      onSwipeRight={onMove}
      right={onMove ? { bg: 'bg-muted', activeBg: 'bg-muted-foreground/30', icon: <ArrowRight size={16} className="text-foreground" />, label: 'Move' } : undefined}
      onSwipeLeft={away ? onAway : undefined}
      left={
        away === 'hide'
          ? { bg: 'bg-muted', activeBg: 'bg-muted-foreground/30', icon: <EyeOff size={16} className="text-foreground" />, label: 'Hide' }
          : away === 'archive'
            ? { bg: 'bg-muted', activeBg: 'bg-muted-foreground/30', icon: <Archive size={16} className="text-foreground" />, label: l.item?.archived ? 'Bring back' : 'Archive' }
            : undefined
      }
    >
      {row}
    </SwipeActions>
  );
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
  onMove,
}: {
  line: CostMonthLine | null;
  month: string;
  items: CostItem[];
  nameOf: (userId: string) => string;
  onClose: () => void;
  onOpenItem: (item: CostItem) => void;
  onSetAmount: (item: CostItem, cents: number) => void;
  /** Opens the category picker for the whole shop; null when it can't move. */
  onMove: (() => void) | null;
}) {
  const { rows, error, openId, setOpenId, apply, madeCost, refresh, open: t } = useShopPayments(upBankApi, line, month);
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
            {monthLongName(month)} · {line?.count ?? 0} payment{line?.count === 1 ? '' : 's'}
          </Text>
          {onMove ? (
            <Pressable accessibilityRole="button" onPress={onMove} className="min-h-10 justify-center">
              <Text className="text-sm font-medium text-primary">Move the shop to another category</Text>
            </Pressable>
          ) : line?.item ? (
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
        onMadeCost={madeCost}
        onOpenItem={(item) => {
          setOpenId(null);
          onClose();
          onOpenItem(item);
        }}
        onSetAmount={onSetAmount}
        onShopMoved={refresh}
      />
    </>
  );
}

function SwitchRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <View className="min-h-12 flex-row items-center gap-3 px-1 py-2">
      <View className="min-w-0 flex-1">
        <Text className="text-body font-medium text-foreground">{label}</Text>
        <Text className="text-caption text-muted-foreground">{hint}</Text>
      </View>
      <Switch checked={checked} onChange={onChange} label={`${label} summary`} />
    </View>
  );
}

/** What "Summarise <month>" asks the assistant. */
function MenuRow({ Icon, label, hint, value, divided, onPress }: { Icon: LucideIcon; label: string; hint?: string; value?: string; divided?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} className={cn('min-h-12 flex-row items-center gap-3 px-3 py-2', divided && 'border-t border-border/60')}>
      <Icon size={16} className="text-muted-foreground" />
      <View className="min-w-0 flex-1">
        <Text className="text-body text-foreground">{label}</Text>
        {hint ? <Text className="text-caption text-muted-foreground">{hint}</Text> : null}
      </View>
      {value ? <Text className="text-sm text-muted-foreground" style={TABULAR}>{value}</Text> : null}
      <ChevronRight size={14} className="text-muted-foreground" />
    </Pressable>
  );
}
