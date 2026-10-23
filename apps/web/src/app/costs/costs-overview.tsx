'use client';

// Costs, redesigned (Guy's spec, Oct 22): one page for a month. On top, what
// was spent out of the goal and what the month should end at; income and what
// should be left when there is income; a chart of the months (picking one sets
// the whole page to it); then the categories, each opening in place to its
// shops, recurring costs and costs added by hand, with what's still to come.
// Every number comes from core costMonth (cost-month.ts), the same function
// Home, the digest and the assistant read. A row's source is an icon only: a
// bank for a connector, a pen for one added by hand. Right-click (a long press
// on touch) offers Edit, Ask the assistant and Archive. Phone twin:
// apps/mobile/src/features/costs/costs-overview.tsx.

import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight, FileText, Landmark, MoreHorizontal, PenLine, Plus, Repeat } from 'lucide-react';
import {
  CADENCE_LABEL,
  CATEGORY_COLOR,
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
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { upBankApi } from '@/lib/up-bank-client';
import { cn } from '@/lib/utils';
import { CategoryGlyph } from './category-glyph';
import { TransactionSheet } from './money-view';

const LABEL = 'text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground';
const CARD = 'overflow-hidden rounded-3xl border border-border/60 bg-card shadow-[var(--card-shadow)]';
const SHEET =
  'max-h-[88dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-popover px-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-popover-foreground shadow-2xl shadow-black/50 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:pt-4';
/** Months the chart shows: nine back, this one, two ahead. */
const CHART_BACK = 9;
const CHART_MONTHS = 12;
const CHART_HEIGHT = 96;

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
  /** Rendered after the categories (suggestions). */
  footer?: ReactNode;
  /** Wide screens put the summary on the left and the categories on the right. */
  wide?: boolean;
}

export function CostsOverview(props: CostsOverviewProps) {
  const { items, goalCents, onEditGoal, onOpenItem, onAdd, onArchive, onOpenPayments, canArchive, wide } = props;
  const router = useRouter();
  const { scope, setScope, data } = useUpOverview();
  const now = useMemo(() => new Date(), []);
  const keys = useMemo(() => monthKeys(now, -CHART_BACK, CHART_MONTHS), [now]);
  const months = useCostMonths(items, keys);
  const [picked, setPicked] = useState(keys[CHART_BACK]);
  const month = months.find((m) => m.month === picked) ?? months[CHART_BACK];
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [shop, setShop] = useState<CostMonthLine | null>(null);
  const [menu, setMenu] = useState<{ line?: CostMonthLine; category?: CostMonthCategory } | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  // A colour picked on the spend bar: the chart shows only that category.
  const [focus, setFocus] = useState<string | null>(null);
  const name = monthName(month.month);

  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const ask = (question: string) => {
    setMenu(null);
    setMoreOpen(false);
    if (!openAssistantPopup({ ask: question })) router.push(`/assistant/new?kind=quick&ask=${encodeURIComponent(question)}`);
  };
  const onLine = (l: CostMonthLine) => (l.kind === 'shop' ? setShop(l) : l.item ? onOpenItem(l.item) : undefined);

  const summary = (
    <div className="space-y-5">
      <Hero month={month} goalCents={goalCents} onEditGoal={onEditGoal} focus={focus} onFocus={(k) => setFocus((cur) => (cur === k ? null : k))} />
      <MonthChart months={months} picked={month.month} goalCents={goalCents} onPick={setPicked} focus={focus} onClearFocus={() => setFocus(null)} />
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
            {month.categories.map((c, n) => (
              <CategoryRow
                key={c.category ?? 'none'}
                c={c}
                divided={n > 0}
                isOpen={open.has(c.category ?? 'none')}
                monthName={name}
                onToggle={() => toggle(c.category ?? 'none')}
                onMenu={() => setMenu({ category: c })}
                onLine={onLine}
                onLineMenu={(l) => setMenu({ line: l, category: c })}
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
              onMenu={() => setMenu({ category: month.income! })}
              onLine={onLine}
              onLineMenu={(l) => setMenu({ line: l, category: month.income! })}
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
      <div className="flex items-center gap-2">
        {scope ? (
          <SegmentedControl
            ariaLabel="Whose costs"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'household', label: 'Household' },
              { value: 'mine', label: 'Personal' },
            ]}
            size="sm"
            className="max-w-xs flex-1"
          />
        ) : (
          <span className={cn(LABEL, 'flex-1')}>Costs</span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => onAdd()}
          className="flex h-10 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Add cost
        </button>
        <button
          type="button"
          aria-label="More"
          onClick={() => setMoreOpen(true)}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-muted text-foreground transition-colors hover:bg-accent"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>

      {wide ? (
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

      <ShopSheet line={shop} month={month.month} items={items} nameOf={props.nameOf} onClose={() => setShop(null)} onOpenItem={onOpenItem} onSetAmount={props.onSetAmount} />

      <BottomSheet open={!!menu} onOpenChange={(o) => { if (!o) setMenu(null); }} overlayClassName="bg-black/40" className={SHEET} handleClassName="sm:hidden" popupProps={{ 'aria-label': 'Cost menu' }}>
        <div className="space-y-1 pb-2 pt-1">
          <p className="truncate pb-2 text-lg font-semibold text-foreground">
            {menu?.line ? menu.line.name : costCategoryLabel(menu?.category?.category ?? null)}
          </p>
          {menu?.line?.item ? (
            <MenuRow label="Edit" onClick={() => { const it = menu.line!.item!; setMenu(null); onOpenItem(it); }} />
          ) : null}
          <MenuRow
            label="Ask the assistant"
            onClick={() =>
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
              onClick={() => { const it = menu.line!.item!; setMenu(null); onArchive(it, !it.archived); }}
            />
          ) : null}
        </div>
      </BottomSheet>

      <BottomSheet open={moreOpen} onOpenChange={setMoreOpen} overlayClassName="bg-black/40" className={SHEET} handleClassName="sm:hidden" popupProps={{ 'aria-label': 'More' }}>
        <div className="space-y-1 pb-2 pt-1">
          {onOpenPayments ? <MenuRow label="All payments" hint="Every payment as a list, to search and fix categories." onClick={() => { setMoreOpen(false); onOpenPayments(); }} /> : null}
          <MenuRow label="Ask the assistant" onClick={() => ask(`Help me make sense of my costs in ${name}.`)} />
          <MenuRow label={goalCents ? 'Change the monthly goal' : 'Set a monthly goal'} onClick={() => { setMoreOpen(false); onEditGoal(); }} />
          {canArchive && !month.income ? <MenuRow label="Add income" hint="Pay or other money in. It never counts as a cost." onClick={() => { setMoreOpen(false); onAdd('income'); }} /> : null}
        </div>
      </BottomSheet>
    </div>
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
  const [hover, setHover] = useState<string | null>(null);
  const segments = month.categories.filter((c) => c.paidCents > 0);
  const name = monthName(month.month);
  const max = Math.max(goalCents ?? 0, month.expectedCents, 1);
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  const vsGoal = goalCents ? goalCents - month.expectedCents : null;
  const flow = moneyFlow(month);
  return (
    <div className="space-y-2">
      <p className={LABEL}>{month.when === 'future' ? `Expected in ${name}` : `Spent in ${name}`}</p>
      <button type="button" aria-label="Change the monthly goal" onClick={onEditGoal} className="flex items-baseline gap-2 text-left">
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
            const key = catKey(c.category);
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
      <div className="flex justify-between gap-2 text-xs tabular-nums">
        <span className="text-muted-foreground">
          {hover ? (
            <span className="font-semibold text-foreground">{hover}</span>
          ) : month.when === 'current' ? (
            <>
              Expected by {lastDayLabel(month.month)} <span className="font-semibold text-foreground">{formatMoney(month.expectedCents)}</span>
            </>
          ) : month.when === 'future' ? (
            'Forecast'
          ) : (
            'Finished month'
          )}
        </span>
        {vsGoal != null ? (
          <span className={vsGoal < 0 ? 'text-destructive' : 'text-success'}>
            {vsGoal < 0 ? `${formatMoney(-vsGoal)} over goal` : `${formatMoney(vsGoal)} under goal`}
          </span>
        ) : null}
      </div>
      {flow ? (
        <div className="flex gap-2 pt-1">
          <Stat label={flow.incomeLabel} value={formatMoney(flow.income)} hint={flow.incomeHint} />
          <Stat label={flow.leftLabel} value={signed(flow.left)} hint={flow.leftHint} tone={flow.left < 0 ? 'danger' : 'success'} />
        </div>
      ) : null}
    </div>
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
  const bars = months.map((m) => monthBar(m, focus));
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
          const name = shortMonth(m.month);
          return (
            <button
              key={m.month}
              type="button"
              aria-pressed={on}
              aria-label={`${monthName(m.month)}, ${formatMoney(bar.paid + bar.toCome)}`}
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
                    className={cn('block', fillOf(seg.category))}
                    style={{ height: Math.max(1, h(seg.cents)) }}
                    onMouseEnter={(e) => {
                      e.stopPropagation();
                      setHover(`${name} · ${costCategoryLabel(seg.category)} ${formatMoney(seg.cents)}`);
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
            {shortMonth(m.month)}
          </span>
        ))}
      </div>
    </div>
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
  onLineMenu,
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
  onLineMenu: (l: CostMonthLine) => void;
  onAdd?: () => void;
  income?: boolean;
}) {
  const payments = c.lines.filter((l) => l.kind === 'shop').reduce((s, l) => s + l.count, 0);
  const shops = c.lines.filter((l) => l.kind === 'shop').length;
  const due = c.lines.filter((l) => l.kind === 'recurring' && l.toComeCents > 0 && l.paidCents === 0);
  const costs = c.lines.filter((l) => l.kind !== 'usual').length;
  const meta = [
    payments ? `${payments} payment${payments === 1 ? '' : 's'}${shops > 1 ? ` · ${shops} shops` : ''}` : null,
    due.length === 1 && due[0].date ? `Due ${dayLabel(due[0].date)}` : due.length > 1 ? `${due.length} due` : null,
    !payments && !due.length ? `${costs} cost${costs === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className={cn(divided && 'border-t border-border/60')}>
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
        <div className="bg-muted/20 pb-1 pl-14 pr-4">
          {c.lines.map((l, i) => (
            <LineRow key={l.key} l={l} divided={i > 0} monthName={name} onClick={() => onLine(l)} onMenu={() => onLineMenu(l)} />
          ))}
          {onAdd ? (
            <button type="button" onClick={onAdd} className="flex min-h-11 w-full items-center gap-2 border-t border-border/60 text-left text-sm text-muted-foreground hover:text-foreground">
              <Plus className="h-3.5 w-3.5" />
              {income ? 'Add income' : 'Add a cost'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function LineRow({ l, divided, monthName: name, onClick, onMenu }: { l: CostMonthLine; divided: boolean; monthName: string; onClick: () => void; onMenu: () => void }) {
  const ghost = l.kind === 'usual' || l.kind === 'target' || (l.paidCents === 0 && l.toComeCents > 0);
  const meta = lineMeta(l, name);
  const SourceIcon = l.source === 'up' ? Landmark : l.source === 'csv' ? FileText : l.source === 'manual' ? PenLine : null;
  const sourceLabel = l.source === 'up' ? 'From your bank' : l.source === 'csv' ? 'From a file' : l.source === 'manual' ? 'Added by hand' : undefined;
  const pressable = l.kind !== 'usual';
  const recurring = l.kind === 'recurring' || (!!l.item && l.kind === 'cost' && l.item.cadence !== 'one_off');
  return (
    <button
      type="button"
      disabled={!pressable}
      onClick={onClick}
      onContextMenu={pressable ? menuHandler(onMenu) : undefined}
      className={cn('flex min-h-[52px] w-full items-center gap-3 py-2 text-left', divided && 'border-t border-border/60', pressable && 'hover:opacity-80')}
    >
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
    </button>
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

/** A shop's payments in the month, newest first; a click opens the payment's sheet. */
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
  const [rows, setRows] = useState<BankTransactionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
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
      <BottomSheet open={!!line && !openId} onOpenChange={(o) => { if (!o) onClose(); }} overlayClassName="bg-black/40" className={SHEET} handleClassName="sm:hidden" popupProps={{ 'aria-label': line?.name ?? 'Payments' }}>
        <div className="space-y-2 pb-2 pt-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="min-w-0 flex-1 truncate text-lg font-semibold text-foreground">{line?.name}</p>
            <p className="text-lg font-semibold tabular-nums text-foreground">{line ? formatMoney(line.paidCents) : ''}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            {monthName(month)} · {line?.count ?? 0} payment{line?.count === 1 ? '' : 's'}
          </p>
          {line?.item ? (
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

function MenuRow({ label, hint, onClick }: { label: string; hint?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-12 w-full flex-col justify-center rounded-xl px-2 py-2 text-left hover:bg-muted/50">
      <span className="text-base font-medium text-foreground">{label}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
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
