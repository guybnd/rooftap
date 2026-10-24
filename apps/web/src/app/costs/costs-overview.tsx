'use client';

// Costs, redesigned (Guy's spec, Oct 22): one page for a month. On top, what
// was spent out of the goal and what the month should end at; income and what
// should be left when there is income; a chart of the months (picking one sets
// the whole page to it); then the categories, each opening in place to its
// shops, recurring costs and costs added by hand, with what's still to come.
// Every number comes from core costMonth (cost-month.ts), the same function
// Home, the digest and the assistant read. A row's source is an icon only: a
// bank for a connector, a pen for one added by hand. A row moves to another
// category in two steps (Guy, 2026-10-23): right-click (a hold on touch) for
// its menu (core costRowMenu, "Move to" on top), or swipe right for the likely
// categories first. Swipe left hides a shop's payments for the month, or
// archives a cost. Phone twin: apps/mobile/src/features/costs/costs-overview.tsx.

import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, FileText, Landmark, List, MessageSquare, MoreHorizontal, PenLine, Plus, Repeat, Settings, Sparkles, Wallet, type LucideIcon } from 'lucide-react';
import {
  CADENCE_LABEL,
  CATEGORY_COLOR,
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
  monthLongName,
  monthShortName,
  goalStatus,
  moneyFlow,
  type GoalStatusLine,
  signedMoney,
  type CostCategory,
  type CostItem,
  type CostMonth,
  type CostMonthCategory,
  type CostMonthLine,
  type RowMenu,
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
  useRecentSpend,
  DEFAULT_RECENT_SPEND,
  type RecentSpendPrefs,
  type SpendingTransaction,
} from '@homeup/core';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { upBankApi } from '@/lib/up-bank-client';
import { cn } from '@/lib/utils';
import { CategoryGlyph } from './category-glyph';
import { CostInsightsCard, type CostInsightsCardProps } from './cost-insights';
import { ToSortCard } from './to-sort-card';
import { CostsGlance, LatestPage, latestCategory, type GlancePage } from './costs-glance';
import { TransactionSheet } from './money-view';
import { CategoryPickerSheet, type CategoryPick } from './category-picker';
import { CostRowShell, CostRowSheet, type CostRowSheetState } from './cost-row-sheet';
import { commit, success } from '@/lib/haptics';

const LABEL = 'text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground';
const CARD = 'overflow-hidden rounded-3xl border border-border/60 bg-card shadow-[var(--card-shadow)]';
const SHEET =
  'max-h-[88dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-popover px-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-popover-foreground shadow-2xl shadow-black/50 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:pt-4';
/** Months the chart shows: nine back, this one, two ahead. */
const CHART_HEIGHT = 96;

export interface CostsOverviewProps {
  items: CostItem[];
  /** The monthly goal in cents, null when none is set. */
  goalCents: number | null;
  /** Costs settings (module-settings.ts): the More menu's last row and the goal on the total open it. Null when there is nothing to set. */
  onOpenSettings: { label: string; open: () => void } | null;
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
  /** Rendered after the categories (suggestions). */
  footer?: ReactNode;
  /** Wide screens put the summary on the left and the categories on the right. */
  wide?: boolean;
  /** The money-insights module's "Worth a look" card, shown on this month; null when it's off. */
  insights?: Pick<CostInsightsCardProps, 'marks' | 'onMarks' | 'onRemind'> | null;
  /** "Summarise <month>" in the ⋯ menu; false with the Assistant off. */
  canSummarise?: boolean;
  /** Recent spending on the Latest card: the person's windows and whether bills count (set in Costs settings). */
  recentPrefs?: RecentSpendPrefs;
}

// Before the bank payments land: shapes where the total, chart and
// categories go, so no total shows that leaves the bank out.
function Waiting({ wide }: { wide?: boolean }) {
  const block = 'animate-pulse rounded-2xl bg-muted';
  const left = (
    <div className="space-y-5">
      <div className="space-y-3 px-1">
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        <div className="h-10 w-40 animate-pulse rounded-lg bg-muted" />
        <div className="h-2 w-full animate-pulse rounded-full bg-muted" />
      </div>
      <div className={`h-40 ${block}`} />
    </div>
  );
  const right = (
    <div className="space-y-2">
      <p className="px-1 text-sm text-muted-foreground">Reading your bank payments</p>
      <div className={`h-56 ${block}`} />
    </div>
  );
  return wide ? (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-start gap-8" aria-busy="true">
      {left}
      {right}
    </div>
  ) : (
    <div className="space-y-5" aria-busy="true">
      {left}
      {right}
    </div>
  );
}

export function CostsOverview(props: CostsOverviewProps) {
  const { items, goalCents, onOpenSettings, onOpenItem, onAdd, onArchive, onOpenPayments, canArchive, wide } = props;
  const router = useRouter();
  const { scope, setScope, data, ready } = useUpOverview();
  const { months, month, name, setPicked, open, toggle, focus, setFocus, toggleFocus, openCategory: showCategory } = useCostsOverview(items);
  const [shop, setShop] = useState<CostMonthLine | null>(null);
  const [rowSheet, setRowSheet] = useState<CostRowSheetState | null>(null);
  const [pick, setPick] = useState<CategoryPick | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const { reload } = useUpOverview();
  const quickMove = useModules().server('costs.quick-move');
  const choices = useCostCategoryChoices();


  const ask = (question: string) => {
    setMoreOpen(false);
    if (!openAssistantPopup({ ask: question })) router.push(`/assistant/new?kind=quick&ask=${encodeURIComponent(question)}`);
  };
  const onLine = (l: CostMonthLine) => (l.kind === 'shop' ? setShop(l) : l.item ? onOpenItem(l.item) : undefined);

  const deps = { patchItem: props.onPatchItem, api: upBankApi, reload };
  // A move says where the row went, with Undo back to where it was.
  const move = (l: CostMonthLine, inCategory: CostCategory | null, to: CostCategory) => {
    moveCostLineWithUndo(l, inCategory, to, quickMove, deps)
      .then(({ message, undo }) => {
        success();
        toast(message, {
          duration: 5000,
          action: undo ? { label: 'Undo', onClick: () => void undo().catch(() => toast.error("Couldn't move it back.")) } : undefined,
        });
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Couldn't move it."));
  };
  const hide = (l: CostMonthLine) => {
    hideShopMonthWithUndo(l, month.month, name, { api: upBankApi, reload })
      .then((done) => {
        if (!done) return;
        toast(done.message, { duration: 5000, action: { label: 'Undo', onClick: () => void done.undo?.() } });
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Couldn't hide it."));
  };
  const pickFor = (l: CostMonthLine, c: CostMonthCategory) => {
    const current = costLineCategory(l, c.category);
    setPick({ title: `Move ${l.name}`, current, likely: likelyCostCategories(l, current, month, choices), onPick: (to) => move(l, c.category, to) });
  };
  // The glance card: the latest payments and the insights, one page each.
  const { insights: insightList } = useCostInsights(items, { goalCents, marks: props.insights?.marks });
  const insightKeys = props.insights ? insightList.map((i) => i.key) : [];
  const seenInsights = useSeenInsights();
  const lineById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const latest = (data?.recent ?? []).slice(0, 3);
  const recentPrefs = props.recentPrefs ?? DEFAULT_RECENT_SPEND;
  const recent = useRecentSpend(upBankApi, items, recentPrefs);
  const movePayment = (t: SpendingTransaction, to: CostCategory, wholeShop: boolean) => {
    moveBankPayment(upBankApi, t, to, wholeShop)
      .then((message) => {
        success();
        reload();
        toast(message);
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Couldn't move it."));
  };
  const pickPayment = (t: SpendingTransaction) => {
    const current = latestCategory(t, t.costItemId ? lineById.get(t.costItemId) : undefined);
    commit();
    setPick({
      title: `Move ${t.description}`,
      current,
      likely: likelyCostCategories({ sourceCategory: t.category }, current, month, choices),
      scope: { label: `Every payment at ${t.description}`, hint: 'Off moves this payment only' },
      onPick: (to, whole) => movePayment(t, to, whole),
    });
  };
  const glance: GlancePage[] = [];
  if (month.when === 'current' && (latest.length || recent.windows.length)) {
    glance.push({
      key: 'latest',
      label: 'Latest',
      node: (
        <LatestPage
          recent={recent}
          latest={latest}
          lineById={lineById}
          onOpen={() => onOpenPayments?.()}
          onMove={quickMove ? pickPayment : null}
          onSettings={onOpenSettings?.open ?? null}
          skipBills={recentPrefs.skipBills}
        />
      ),
    });
  }
  if (props.insights && month.when === 'current' && insightKeys.length) {
    glance.push({
      key: 'insights',
      label: 'Worth a look',
      dot: hasUnseenInsights(insightKeys, seenInsights),
      node: <CostInsightsCard bare items={items} goalCents={goalCents} onOpenItem={onOpenItem} onOpenCategory={(c) => openCategory(c)} {...props.insights} />,
    });
  }
  const glanceStart = glance.findIndex((p) => p.dot);

  const canHide = (l: CostMonthLine) => canHideCostLine(l, quickMove);
  const lineMenu = (l: CostMonthLine, c: CostMonthCategory): RowMenu =>
    costRowMenu({
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
    });
  const lineSheet = (l: CostMonthLine, c: CostMonthCategory) => {
    commit();
    setRowSheet({
      category: costLineCategory(l, c.category),
      amount: costLineAmountLabel(l),
      meta: [costCategoryLabel(costLineCategory(l, c.category)), lineMeta(l, name)].filter(Boolean).join(' · '),
      menu: lineMenu(l, c),
    });
  };
  const categoryMenu = (c: CostMonthCategory) =>
    setRowSheet({ category: c.category, amount: formatMoney(c.paidCents), meta: name, menu: costCategoryMenu({ category: c.category, monthName: name, onAsk: ask, onAdd }) });
  const rowProps = (c: CostMonthCategory) => ({
    onMenu: () => categoryMenu(c),
    onLine,
    onLineSheet: (l: CostMonthLine) => lineSheet(l, c),
    lineMenu: (l: CostMonthLine) => lineMenu(l, c),
    onLineMove: (l: CostMonthLine) => (costMoveKind(l, quickMove) ? () => pickFor(l, c) : undefined),
    onLineAway: (l: CostMonthLine) =>
      canHide(l)
        ? { label: 'Hide', kind: 'hide' as const, run: () => hide(l) }
        : canArchive && l.item && l.kind !== 'shop'
          ? { label: l.item.archived ? 'Bring back' : 'Archive', kind: 'archive' as const, run: () => onArchive(l.item!, !l.item!.archived) }
          : null,
  });
  // An insight's "Show the category": this month, that category open, scrolled to.
  const openCategory = (category: CostCategory | null) => {
    const id = showCategory(category);
    requestAnimationFrame(() => document.getElementById(`cost-cat-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const summary = (
    <div className="space-y-5">
      <Hero month={month} goalCents={goalCents} onEditGoal={onOpenSettings?.open ?? null} focus={focus} onFocus={toggleFocus} />
      <MonthChart months={months} picked={month.month} goalCents={goalCents} onPick={setPicked} focus={focus} onClearFocus={() => setFocus(null)} />
      {glance.length > 0 && (
        <CostsGlance
          key={glance.map((p) => p.key).join('|')}
          pages={glance}
          initial={Math.max(0, glanceStart)}
          onPage={(key) => {
            if (key === 'insights') markInsightsSeen(insightKeys);
          }}
        />
      )}
      {quickMove && month.when === 'current' && (
        <ToSortCard
          month={month}
          monthName={name}
          choices={choices}
          onSort={(l, to) => move(l, null, to)}
          onOther={(l, _guess, then) =>
            setPick({ title: `Where does ${l.name} go?`, current: null, likely: likelyCostCategories(l, null, month, choices), onPick: (to) => { then(); move(l, null, to); } })
          }
        />
      )}
    </div>
  );

  const categories = (
    <div className="space-y-5">
      {month.categories.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">
          {data || items.length ? `Nothing in ${name} yet.` : 'No costs yet. Add your rent, bills and shopping, or connect a bank in Settings.'}
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex justify-between px-1">
            <h2 className={LABEL}>Categories</h2>
            <span className={LABEL}>{month.when === 'past' ? 'Paid' : 'Paid · to come'}</span>
          </div>
          <div className={CARD}>
            {month.categories.filter((c) => !focus || costCategoryKey(c.category) === focus).map((c, n) => (
              <CategoryRow
                key={c.category ?? 'none'}
                c={c}
                divided={n > 0}
                isOpen={!!focus || open.has(c.category ?? 'none')}
                monthName={name}
                onToggle={() => toggle(c.category ?? 'none')}
                {...rowProps(c)}
                onAdd={c.category ? () => onAdd(c.category as CostCategory) : undefined}
              />
            ))}
          </div>
        </div>
      )}

      {month.income ? (
        <div className="space-y-2">
          <h2 className={cn(LABEL, 'px-1')}>Money in · not counted in costs</h2>
          <div className={CARD}>
            <CategoryRow
              c={month.income}
              divided={false}
              isOpen={open.has('income')}
              monthName={name}
              onToggle={() => toggle('income')}
              {...rowProps(month.income)}
              onAdd={() => onAdd('income')}
              income
            />
          </div>
        </div>
      ) : null}

      {props.footer}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-1">
        {scope ? (
          <div role="radiogroup" aria-label="Whose costs" className="flex flex-1 items-center gap-4">
            {SCOPES.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={scope === o.value}
                onClick={() => setScope(o.value)}
                className={cn(
                  'h-9 border-b-2 text-[15px] transition-colors',
                  scope === o.value ? 'border-foreground font-semibold text-foreground' : 'border-transparent font-medium text-muted-foreground hover:text-foreground',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        ) : (
          <span className={cn(LABEL, 'flex-1')}>Costs</span>
        )}
        <button
          type="button"
          aria-label="Add a cost"
          title="Add a cost"
          onClick={() => onAdd()}
          className="flex h-9 w-9 items-center justify-center rounded-full text-primary transition-colors hover:bg-primary/10"
        >
          <Plus className="h-5 w-5" />
        </button>
        <button
          type="button"
          aria-label="More"
          onClick={() => setMoreOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </div>

      {!ready ? (
        <Waiting wide={wide} />
      ) : wide ? (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-start gap-8">
          <div className="sticky top-4">{summary}</div>
          {categories}
        </div>
      ) : (
        <>
          {summary}
          {categories}
        </>
      )}

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

      <BottomSheet open={moreOpen} onOpenChange={setMoreOpen} overlayClassName="bg-black/40" className={SHEET} handleClassName="sm:hidden" popupProps={{ 'aria-label': 'More' }}>
        <div className="space-y-1 pb-2 pt-1">
          {canArchive && !month.income ? (
            <>
              <h3 className={cn(LABEL, 'px-1')}>{name}</h3>
              <div className="overflow-hidden rounded-2xl bg-muted/40">
                <MenuRow Icon={Wallet} label="Add income" hint="Pay or other money in. It never counts as a cost." onClick={() => { setMoreOpen(false); onAdd('income'); }} />
              </div>
            </>
          ) : null}
          <h3 className={cn(LABEL, 'px-1', canArchive && !month.income && 'pt-3')}>Look closer</h3>
          <div className="overflow-hidden rounded-2xl bg-muted/40">
            {onOpenPayments ? <MenuRow Icon={List} label="All payments" hint="Every payment as a list, to search and move." onClick={() => { setMoreOpen(false); onOpenPayments(); }} /> : null}
            {props.canSummarise ? <MenuRow Icon={Sparkles} label={`Summarise ${name}`} divided={!!onOpenPayments} onClick={() => ask(costsSummaryAsk(name))} /> : null}
            <MenuRow Icon={MessageSquare} label="Ask the assistant" divided={!!onOpenPayments || !!props.canSummarise} onClick={() => ask(`Help me make sense of my costs in ${name}.`)} />
          </div>
          {onOpenSettings ? (
            <div className="mt-3 overflow-hidden rounded-2xl bg-muted/40">
              <MenuRow Icon={Settings} label={onOpenSettings.label} onClick={() => { setMoreOpen(false); onOpenSettings.open(); }} />
            </div>
          ) : null}
        </div>
      </BottomSheet>
    </div>
  );
}

const SCOPES = [
  { value: 'household', label: 'Household' },
  { value: 'mine', label: 'Personal' },
] as const;

const DOT: Record<GoalStatusLine['tone'], string> = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-destructive', neutral: 'bg-muted-foreground' };

function Hero({
  month,
  goalCents,
  onEditGoal,
  focus,
  onFocus,
}: {
  month: CostMonth;
  goalCents: number | null;
  onEditGoal: (() => void) | null;
  focus: string | null;
  onFocus: (key: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const segments = month.categories.filter((c) => c.paidCents > 0);
  const name = monthLongName(month.month);
  const max = Math.max(goalCents ?? 0, month.expectedCents, 1);
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  const status = goalStatus(month, goalCents);
  const flow = moneyFlow(month);
  return (
    <div className="space-y-2">
      <p className={LABEL}>{month.when === 'future' ? `Expected in ${name}` : `Spent in ${name}`}</p>
      <button type="button" aria-label="Change the monthly goal" disabled={!onEditGoal} onClick={onEditGoal ?? undefined} className="flex items-baseline gap-2 text-left">
        <span className="text-5xl font-extrabold tabular-nums tracking-tight text-foreground">
          {formatMoney(month.when === 'future' ? month.expectedCents : month.paidCents)}
        </span>
        <span className="text-lg tabular-nums text-muted-foreground">{goalCents ? `of ${formatMoney(goalCents)}` : 'Set a goal'}</span>
      </button>
      <div className="relative h-3 rounded-full bg-muted" onMouseLeave={() => setHover(null)}>
        {month.toComeCents > 0 ? (
          <div className="absolute inset-y-0 left-0 rounded-full border border-dashed border-foreground/50 bg-foreground/10" style={{ width: pct(month.expectedCents) }} />
        ) : null}
        <div className="absolute inset-y-0 left-0 flex overflow-hidden rounded-full" style={{ width: pct(month.paidCents) }}>
          {segments.map((c) => {
            const key = costCategoryKey(c.category);
            const label = `${costCategoryLabel(c.category)} ${formatMoney(c.paidCents)}`;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={focus === key}
                aria-label={`${label}. Show it on the chart`}
                title={label}
                onMouseEnter={() => setHover(label)}
                onClick={() => onFocus(key)}
                className={cn('h-full transition-opacity', fillOf(c.category), focus && focus !== key && 'opacity-30')}
                style={{ width: `${(c.paidCents / Math.max(month.paidCents, 1)) * 100}%` }}
              />
            );
          })}
        </div>
        {goalCents ? <div className="pointer-events-none absolute -inset-y-1 w-0.5 rounded bg-foreground" style={{ left: pct(goalCents) }} /> : null}
      </div>
      <div className="space-y-1 pt-0.5 text-sm tabular-nums">
        {status.map((l, i) => (
          <p key={i} className="flex items-center gap-2">
            <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', DOT[l.tone])} />
            {i === 0 && hover ? (
              <span className="font-semibold text-foreground">{hover}</span>
            ) : (
              <span>
                <span className="font-semibold text-foreground">{l.lead}</span>
                {l.detail ? <span className="text-muted-foreground"> {l.detail}</span> : null}
              </span>
            )}
          </p>
        ))}
      </div>
      {flow ? (
        <div className="flex gap-2 pt-1">
          <Stat label={flow.incomeLabel} value={formatMoney(flow.income)} hint={flow.incomeHint} />
          <Stat label={flow.leftLabel} value={signedMoney(flow.left)} hint={flow.leftHint} tone={flow.left < 0 ? 'danger' : 'success'} />
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'success' | 'danger' }) {
  return (
    <div className="flex-1 rounded-2xl bg-muted/40 px-3 py-2">
      <p className={LABEL}>{label}</p>
      <p className={cn('text-base font-semibold tabular-nums', tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-destructive' : 'text-foreground')}>{value}</p>
      {hint ? <p className="text-xs tabular-nums text-muted-foreground">{hint}</p> : null}
    </div>
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
  const [hover, setHover] = useState<string | null>(null);
  const ranks = useMemo(() => lineRanks(months, focus), [months, focus]);
  const bars = months.map((m) => monthBar(m, focus, ranks));
  const max = Math.max(focus ? 0 : goalCents ?? 0, ...bars.map((b) => b.paid + b.toCome), 1);
  const h = (v: number) => Math.round((v / max) * CHART_HEIGHT);
  const focusLabel = focus ? costCategoryLabel(focus === 'none' ? null : (focus as CostCategory)) : null;
  return (
    <div role="group" aria-label="Costs by month" className="space-y-1">
      <div className="flex min-h-5 items-center justify-between gap-2 text-xs tabular-nums">
        <span className="truncate font-semibold text-foreground">{hover ?? ''}</span>
        {focusLabel ? (
          <button type="button" onClick={onClearFocus} className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-muted-foreground hover:text-foreground">
            {focusLabel} only · Show all
          </button>
        ) : null}
      </div>
      <div className="relative flex items-end gap-1" style={{ height: CHART_HEIGHT }} onMouseLeave={() => setHover(null)}>
        {goalCents && !focus ? <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-muted-foreground/50" style={{ bottom: h(goalCents) }} /> : null}
        {months.map((m, i) => {
          const on = m.month === picked;
          const bar = bars[i];
          const name = monthShortName(m.month);
          return (
            <button
              key={m.month}
              type="button"
              aria-pressed={on}
              aria-label={`${monthLongName(m.month)}, ${formatMoney(bar.paid + bar.toCome)}`}
              onClick={() => onPick(m.month)}
              onMouseEnter={() => setHover(`${name} · ${formatMoney(bar.paid)}${bar.toCome ? ` paid · ~${formatMoney(bar.toCome)} to come` : ''}`)}
              className={cn('group flex h-full flex-1 flex-col justify-end transition-opacity', on ? 'opacity-100' : 'opacity-45 hover:opacity-80')}
            >
              {bar.toCome > 0 ? (
                <span
                  className={cn('block rounded-t-[4px] border border-b-0 border-dashed', on ? 'border-foreground/70' : 'border-muted-foreground/60')}
                  style={{ height: Math.max(2, h(bar.toCome)) }}
                  onMouseEnter={() => setHover(`${name} · ~${formatMoney(bar.toCome)} still to come`)}
                />
              ) : null}
              <span className={cn('flex flex-col-reverse overflow-hidden', bar.toCome > 0 ? 'rounded-b-[3px]' : 'rounded-[4px]')}>
                {bar.segments.map((seg) => (
                  <span
                    key={seg.key}
                    className={cn('block', fillOf(seg.category), focus && SHADES[seg.shade % SHADES.length], focus && 'border-t border-background/40')}
                    style={{ height: Math.max(1, h(seg.cents)) }}
                    onMouseEnter={(e) => {
                      e.stopPropagation();
                      setHover(`${name} · ${seg.label} ${formatMoney(seg.cents)}`);
                    }}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex gap-1">
        {months.map((m) => (
          <span key={m.month} className={cn('flex-1 text-center text-[10px]', m.month === picked ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
            {monthShortName(m.month)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Shades for a category's lines, so neighbours in a bar stand apart. */
const SHADES = ['opacity-100', 'opacity-70', 'opacity-50', 'opacity-85', 'opacity-60', 'opacity-40'];

function fillOf(category: CostCategory | null): string {
  return category ? CATEGORY_COLOR[category].fill : 'bg-muted-foreground/60';
}

function CategoryRow({
  c,
  divided,
  isOpen,
  monthName: name,
  onToggle,
  onMenu,
  onLine,
  onLineSheet,
  lineMenu,
  onLineMove,
  onLineAway,
  onAdd,
  income,
}: {
  c: CostMonthCategory;
  divided: boolean;
  isOpen: boolean;
  monthName: string;
  onToggle: () => void;
  onMenu: () => void;
  onLine: (l: CostMonthLine) => void;
  /** A hold on touch: the row's menu as a sheet. */
  onLineSheet: (l: CostMonthLine) => void;
  /** Right-click: the row's menu at the pointer. */
  lineMenu: (l: CostMonthLine) => RowMenu;
  /** Swipe right, when the row can move. */
  onLineMove: (l: CostMonthLine) => (() => void) | undefined;
  /** Swipe left: hide a shop's payments, or archive a cost. */
  onLineAway: (l: CostMonthLine) => { label: string; kind: 'hide' | 'archive'; run: () => void } | null;
  onAdd?: () => void;
  income?: boolean;
}) {
  const payments = c.lines.filter((l) => l.kind === 'shop').reduce((s, l) => s + l.count, 0);
  const shops = c.lines.filter((l) => l.kind === 'shop').length;
  const due = c.lines.filter((l) => l.kind === 'recurring' && l.toComeCents > 0 && l.paidCents === 0);
  const costs = c.lines.filter((l) => l.kind !== 'usual').length;
  const meta = [
    payments ? `${payments} payment${payments === 1 ? '' : 's'}${shops > 1 ? ` · ${shops} shops` : ''}` : null,
    due.length === 1 && due[0].date ? `Due ${costDayLabel(due[0].date)}` : due.length > 1 ? `${due.length} due` : null,
    !payments && !due.length ? `${costs} cost${costs === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div id={`cost-cat-${c.category ?? 'none'}`} className={cn('scroll-mt-4', divided && 'border-t border-border/60')}>
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={onToggle}
        onContextMenu={menuHandler(onMenu)}
        className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-muted/30"
      >
        {c.category ? <CategoryGlyph category={c.category} /> : <span className="size-7 shrink-0 rounded-[9px] border border-dashed border-muted-foreground/60" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{costCategoryLabel(c.category)}</span>
          {meta ? <span className="block truncate text-xs tabular-nums text-muted-foreground">{meta}</span> : null}
        </span>
        <span className="text-right">
          <span className={cn('block text-sm font-semibold tabular-nums', income ? 'text-success' : 'text-foreground')}>
            {income ? '+' : ''}
            {formatMoney(c.paidCents)}
          </span>
          {c.toComeCents > 0 ? <span className="block text-xs tabular-nums text-muted-foreground">~{formatMoney(c.toComeCents)} to come</span> : null}
        </span>
        {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>
      {isOpen ? (
        <div className="pb-1">
          {c.lines.map((l, i) => {
            const away = onLineAway(l);
            return l.kind === 'usual' ? (
              <div key={l.key} className="pl-14 pr-4">
                <LineBody l={l} divided={i > 0} monthName={name} />
              </div>
            ) : (
              <CostRowShell
                key={l.key}
                label={l.name}
                className="pl-14 pr-4 hover:bg-muted/30"
                onOpen={() => onLine(l)}
                menu={() => lineMenu(l)}
                onSheet={() => onLineSheet(l)}
                onMove={onLineMove(l)}
                away={away}
                onAway={away?.run}
              >
                <LineBody l={l} divided={i > 0} monthName={name} />
              </CostRowShell>
            );
          })}
          {onAdd ? (
            <button type="button" onClick={onAdd} className="ml-14 mr-4 flex min-h-11 w-[calc(100%-4.5rem)] items-center gap-2 border-t border-border/60 text-left text-sm text-muted-foreground hover:text-foreground">
              <Plus className="h-3.5 w-3.5" />
              {income ? 'Add income' : 'Add a cost'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function LineBody({ l, divided, monthName: name }: { l: CostMonthLine; divided: boolean; monthName: string }) {
  const ghost = l.kind === 'usual' || l.kind === 'target' || (l.paidCents === 0 && l.toComeCents > 0);
  const meta = lineMeta(l, name);
  const SourceIcon = l.source === 'up' ? Landmark : l.source === 'csv' ? FileText : l.source === 'manual' ? PenLine : null;
  const sourceLabel = l.source === 'up' ? 'From your bank' : l.source === 'csv' ? 'From a file' : l.source === 'manual' ? 'Added by hand' : undefined;
  const recurring = l.kind === 'recurring' || (!!l.item && l.kind === 'cost' && l.item.cadence !== 'one_off');
  return (
    <div className={cn('flex min-h-[52px] w-full items-center gap-3 py-2 text-left', divided && 'border-t border-border/60')}>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={cn('min-w-0 truncate text-sm font-medium', ghost ? 'italic text-muted-foreground' : 'text-foreground')}>{l.name}</span>
          {recurring ? <Repeat aria-label="Recurring" className="h-3 w-3 shrink-0 text-muted-foreground" /> : null}
          {SourceIcon ? <SourceIcon aria-label={sourceLabel} className="h-3 w-3 shrink-0 text-muted-foreground" /> : null}
        </span>
        {meta ? (
          <span
            className={cn(
              'block truncate text-xs tabular-nums',
              l.kind === 'recurring' && l.toComeCents > 0 && !l.paidCents ? 'text-warning' : l.kind === 'recurring' && l.paidCents > 0 ? 'text-success' : 'text-muted-foreground',
            )}
          >
            {meta}
          </span>
        ) : null}
      </span>
      <span className="text-right">
        <span className={cn('block text-sm tabular-nums', ghost ? 'italic text-muted-foreground' : 'text-foreground')}>
          {l.paidCents > 0 ? formatMoney(l.paidCents) : l.toComeCents > 0 ? `~${formatMoney(l.toComeCents)}` : l.item ? formatMoney(l.item.amount) : ''}
          {l.item && l.kind !== 'shop' && l.item.cadence !== 'one_off' && l.paidCents === 0 ? CADENCE_LABEL[l.item.cadence] : ''}
        </span>
        {l.paidCents > 0 && l.toComeCents > 0 ? <span className="block text-xs tabular-nums text-muted-foreground">~{formatMoney(l.toComeCents)} to come</span> : null}
      </span>
      {l.kind === 'shop' ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
    </div>
  );
}

/** A shop's payments in the month, newest first; a click opens the payment's sheet. */
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
      <BottomSheet open={!!line && !openId} onOpenChange={(o) => { if (!o) onClose(); }} overlayClassName="bg-black/40" className={SHEET} handleClassName="sm:hidden" popupProps={{ 'aria-label': line?.name ?? 'Payments' }}>
        <div className="space-y-2 pb-2 pt-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="min-w-0 flex-1 truncate text-lg font-semibold text-foreground">{line?.name}</p>
            <p className="text-lg font-semibold tabular-nums text-foreground">{line ? formatMoney(line.paidCents) : ''}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            {monthLongName(month)} · {line?.count ?? 0} payment{line?.count === 1 ? '' : 's'}
          </p>
          {onMove ? (
            <button type="button" onClick={onMove} className="min-h-10 text-sm font-medium text-primary">
              Move the shop to another category
            </button>
          ) : line?.item ? (
            <button type="button" onClick={() => { const it = line.item!; onClose(); onOpenItem(it); }} className="min-h-10 text-sm font-medium text-primary">
              Change its category
            </button>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {!rows ? (
            <p className="py-2 text-sm text-muted-foreground">Reading payments…</p>
          ) : (
            <div className="rounded-2xl bg-muted/30 px-3">
              {rows.map((r, i) => (
                <button key={r.id} type="button" onClick={() => setOpenId(r.id)} className={cn('flex min-h-12 w-full items-center gap-3 py-2 text-left', i > 0 && 'border-t border-border/60')}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-foreground">{bankDayLabel(r.occurredAt, now)}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[r.accountName, r.pending ? 'pending' : null, r.mine ? null : nameOf(r.userId)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className={cn('text-sm tabular-nums', r.amountCents > 0 ? 'text-success' : 'text-foreground')}>
                    {r.amountCents > 0 ? '+' : ''}
                    {formatMoney(Math.abs(r.amountCents))}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
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

/** What "Summarise <month>" asks the assistant. */
function MenuRow({ Icon, label, hint, value, divided, onClick }: { Icon: LucideIcon; label: string; hint?: string; value?: string; divided?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn('flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/60', divided && 'border-t border-border/60')}>
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block text-base text-foreground">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      {value ? <span className="text-sm tabular-nums text-muted-foreground">{value}</span> : null}
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </button>
  );
}

/** Right-click, or a long press on touch, opens the row's menu instead of the browser's. */
function menuHandler(open: () => void) {
  return (e: MouseEvent) => {
    e.preventDefault();
    open();
  };
}
