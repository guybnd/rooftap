'use client';

// Up Bank connector: costs by month (Guy's pick A, "one month list"). With Up
// connected this is the Plan view's list: the month picked in the chart, as
// one list. Payments sit on their day under their category (the cost line's,
// else the closest fit to Up's, else "Pick a category"); lines the household
// made by hand sit on their date; ghosts (estimates, bills the bank pays that
// haven't come out yet, and the rest of a category's usual everyday spend)
// are faded dashed rows that shrink or drop off as payments land. Every row
// carries a date. Categories (the default) open into their rows; Payments is
// one list by day with category chips, ghosts in "Still to come" on top. A
// month ahead is a forecast: the lines that repeat, each category's usual
// everyday spend (the last three months, the latest counting most) and the
// one-offs planned for it. The cost lines themselves wait behind "All cost
// lines" (CostLinesGate). Numbers come from core month-spending.ts. A tap on
// a payment opens the Money view's sheet (category, cost line, Edit line).
// Native twin: apps/mobile/src/features/costs/month-detail.tsx.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  CATEGORY_COLOR,
  CATEGORY_META,
  bankDayLabel,
  formatMoney,
  monthBook,
  monthOutlook,
  paymentCategory,
  useBankActuals,
  useUpConnected,
  useUpOverview,
  type BankTransactionPatch,
  type BankTransactionView,
  type CostCategory,
  type CostItem,
  type MonthEntry,
} from '@homeup/core';
import { upBankApi } from '@/lib/up-bank-client';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { cn } from '@/lib/utils';
import { TransactionSheet } from './money-view';
import { CategoryGlyph } from './category-glyph';

const AUD = { currency: 'AUD' };
const LABEL = 'text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground';
const CARD = 'rounded-3xl border border-border/60 bg-card shadow-[var(--card-shadow)]';
const FORECAST_CARD = 'rounded-3xl border border-dashed border-border';
/** Rows a category shows before "Show all". */
const FIRST_ROWS = 4;

type Mode = 'categories' | 'payments';
type Entry = MonthEntry<BankTransactionView>;

function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function useMonthList(): boolean {
  const connected = useUpConnected();
  const { linking } = useUpOverview();
  return connected && linking;
}

/** With Up connected the month list is the page; the cost lines wait behind a button. */
export function CostLinesGate({ count, children }: { count: number; children: ReactNode }) {
  const monthList = useMonthList();
  const [open, setOpen] = useState(false);
  if (!monthList || count === 0) return <>{children}</>;
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-12 w-full items-center justify-center rounded-2xl border border-border text-sm font-semibold text-foreground hover:bg-muted/40"
      >
        {open ? 'Hide cost lines' : `All cost lines (${count})`}
      </button>
      {open && children}
    </>
  );
}

export function MonthDetail(props: MonthDetailProps) {
  if (!useMonthList()) return null;
  return <MonthDetailBody {...props} />;
}

interface MonthDetailProps {
  /** The first of the month picked in the chart. */
  month: Date;
  /** Every cost line, to find a payment's line. */
  items: CostItem[];
  /** The lines that count (targets left out). */
  planItems: CostItem[];
  nameOf: (userId: string) => string;
  onOpenItem: (item: CostItem) => void;
  onSetAmount: (item: CostItem, cents: number) => void;
}

function MonthDetailBody({ month, items, planItems, nameOf, onOpenItem, onSetAmount }: MonthDetailProps) {
  const { status, data, reload, scope } = useUpOverview();
  const bank = useBankActuals();
  const now = useMemo(() => new Date(), []);
  const key = monthKeyOf(month);
  const ahead = key > monthKeyOf(now);
  const name = month.toLocaleString('en-AU', { month: 'long' });

  const [mode, setMode] = useState<Mode>('categories');
  const [rows, setRows] = useState<BankTransactionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [whole, setWhole] = useState<Set<string>>(new Set());
  const [chip, setChip] = useState<CostCategory | 'none' | null>(null);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const load = useCallback(async () => {
    if (ahead) return;
    try {
      // A month comes back whole.
      const page = await upBankApi.transactions({ month: `${key}-01`, scope: scope ?? undefined });
      setRows(page.transactions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read the month's payments.");
    }
  }, [ahead, key, scope]);

  useEffect(() => {
    setRows(null);
    setChip(null);
    setClosed(new Set());
    setWhole(new Set());
    void load();
  }, [load, status?.connection?.lastSyncedAt]);

  const apply = async (id: string, patch: BankTransactionPatch) => {
    try {
      const saved = await upBankApi.updateTransaction(id, patch);
      setRows((cur) => (cur ?? []).map((r) => (r.id === id ? saved : r)));
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    }
  };

  const book = useMemo(
    () => (rows ? monthBook({ rows, items: planItems, itemById, links: data?.links ?? [], bank, month: key, now }) : null),
    [rows, planItems, itemById, data, bank, key, now],
  );
  const outlook = useMemo(() => (ahead ? monthOutlook(planItems, bank, key, now) : null), [ahead, planItems, bank, key, now]);
  const open = rows?.find((r) => r.id === openId) ?? null;

  if (outlook) return <MonthAhead name={name} outlook={outlook} onOpenItem={onOpenItem} />;

  const toggle = (set: (fn: (cur: Set<string>) => Set<string>) => void, id: string) =>
    set((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const entryRow = (e: Entry, withChip: boolean) => (
    <EntryRow
      key={e.key}
      e={e}
      name={name}
      now={now}
      chip={withChip ? <CategoryTag e={e} itemById={itemById} /> : null}
      nameOf={nameOf}
      itemById={itemById}
      onOpenPayment={(id) => setOpenId(id)}
      onOpenItem={onOpenItem}
    />
  );

  const all = book?.categories.flatMap((c) => c.entries.map((e) => ({ e, category: c.category }))) ?? [];
  const counted = all.filter(({ e }) => e.kind === 'payment' || e.kind === 'line');
  const ghosts = all.filter(({ e }) => e.kind === 'expected' || e.kind === 'usual');
  const shown = counted.filter(({ category }) => chip === null || (category ?? 'none') === chip);
  const days: { label: string; rows: Entry[] }[] = [];
  for (const { e } of [...shown].sort((a, b) => (b.e.date?.getTime() ?? 0) - (a.e.date?.getTime() ?? 0))) {
    const label = e.date ? bankDayLabel(e.date.toISOString(), now) : 'No date';
    const last = days[days.length - 1];
    if (last && last.label === label) last.rows.push(e);
    else days.push({ label, rows: [e] });
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className={cn(LABEL, 'tabular-nums')}>
          {name}
          {book ? ` · ${formatMoney(book.spentCents, AUD)} spent` : ''}
          {book && book.expectedCents > 0 ? ` · about ${formatMoney(book.expectedCents, AUD)} to come` : ''}
        </h2>
        <SegmentedControl
          ariaLabel={`How ${name} reads`}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'categories', label: 'Categories' },
            { value: 'payments', label: 'Payments' },
          ]}
          size="sm"
        />
      </div>

      {error && <p className="px-1 text-xs text-destructive">{error}</p>}
      {!book ? (
        <p className="px-1 text-sm text-muted-foreground">Reading {name}&apos;s payments…</p>
      ) : book.categories.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">Nothing in {name}.</p>
      ) : mode === 'categories' ? (
        <div className={cn(CARD, 'divide-y divide-border/60')}>
          {book.categories.map((c) => {
            const id = c.category ?? 'none';
            const isOpen = !closed.has(id);
            const dated = c.entries.filter((e) => e.kind === 'payment' || e.kind === 'line');
            const extra = c.entries.filter((e) => e.kind !== 'payment' && e.kind !== 'line');
            const visible = whole.has(id) ? dated : dated.slice(0, FIRST_ROWS);
            const payments = c.entries.filter((e) => e.kind === 'payment').length;
            return (
              <div key={id}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => toggle(setClosed, id)}
                  className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-muted/40"
                >
                  {c.category ? (
                    <CategoryGlyph category={c.category} />
                  ) : (
                    <span className="size-7 shrink-0 rounded-[9px] border border-dashed border-muted-foreground/60" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {c.category ? CATEGORY_META[c.category].label : 'No category yet'}
                    </span>
                    <span className="block truncate text-xs tabular-nums text-muted-foreground">
                      {[
                        payments ? `${payments} payment${payments === 1 ? '' : 's'}` : null,
                        dated.length > payments ? `${dated.length - payments} added by you` : null,
                        c.expectedCents > 0 ? `about ${formatMoney(c.expectedCents, AUD)} to come` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-foreground">{formatMoney(c.spentCents, AUD)}</span>
                  <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', !isOpen && '-rotate-90')} />
                </button>
                {isOpen && (
                  <div className="space-y-1 pb-2 pl-14 pr-4">
                    {visible.map((e) => entryRow(e, false))}
                    {dated.length > visible.length && (
                      <button
                        type="button"
                        onClick={() => toggle(setWhole, id)}
                        className="flex min-h-10 items-center text-sm font-semibold text-primary hover:text-primary/80"
                      >
                        All {dated.length}
                      </button>
                    )}
                    {extra.map((e) => entryRow(e, false))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <>
          {ghosts.length > 0 && (
            <div className="space-y-2">
              <h3 className={cn(LABEL, 'px-1')}>Still to come in {name}</h3>
              <div className={cn(FORECAST_CARD, 'px-4 py-1')}>{ghosts.map(({ e }) => entryRow(e, true))}</div>
            </div>
          )}
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
            <Chip active={chip === null} onClick={() => setChip(null)} label={`All ${counted.length}`} />
            {book.categories.map((c) => {
              const id = c.category ?? 'none';
              const n = c.entries.filter((e) => e.kind === 'payment' || e.kind === 'line').length;
              if (!n) return null;
              return (
                <Chip
                  key={id}
                  active={chip === id}
                  onClick={() => setChip((cur) => (cur === id ? null : id))}
                  label={`${c.category ? CATEGORY_META[c.category].label : 'No category'} ${n}`}
                />
              );
            })}
          </div>
          {days.length > 0 && (
            <div className={CARD}>
              {days.map((g) => (
                <div key={g.label}>
                  <p className="px-4 pb-1 pt-3 text-xs text-muted-foreground">
                    {g.label} · <span className="tabular-nums">{formatMoney(g.rows.reduce((s, e) => s + e.cents, 0), AUD)}</span>
                  </p>
                  <div className="divide-y divide-border/60 px-4">{g.rows.map((e) => entryRow(e, true))}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <TransactionSheet
        t={open}
        items={items}
        owner={open && !open.mine ? nameOf(open.userId) : null}
        onClose={() => setOpenId(null)}
        onPatch={(patch) => open && apply(open.id, patch)}
        onMadeCost={(saved) => {
          setRows((cur) => (cur ?? []).map((r) => (r.id === saved.id ? saved : r)));
          reload();
        }}
        onOpenItem={(item) => {
          setOpenId(null);
          onOpenItem(item);
        }}
        onSetAmount={onSetAmount}
      />
    </section>
  );
}

/** A row's date and what it is: "Yesterday", "15 Oct · added by you", "Expected 28 Oct". */
function entryMeta(e: Entry, name: string, now: Date, nameOf: (userId: string) => string, itemById: ReadonlyMap<string, CostItem>): string {
  const day = e.date ? bankDayLabel(e.date.toISOString(), now) : null;
  if (e.kind === 'payment') {
    const t = e.payment;
    const line = t.costItemId ? itemById.get(t.costItemId) : undefined;
    return [
      day,
      t.pending ? 'pending' : null,
      line && line.name.toUpperCase() !== t.description.toUpperCase() ? `line ${line.name}` : null,
      t.mine ? null : nameOf(t.userId),
    ]
      .filter(Boolean)
      .join(' · ');
  }
  if (e.kind === 'line') return [day ?? 'No date', 'added by you'].join(' · ');
  if (e.kind === 'usual') return 'Estimate, shrinks as you spend';
  if (e.item.bank_source || !e.item.is_estimate) return day ? `Expected ${day}, gone once it is paid` : `Rest of ${name}, gone once it is paid`;
  return day ? `Estimate · ${day}` : 'Estimate';
}

function EntryRow({
  e,
  name,
  now,
  chip,
  nameOf,
  itemById,
  onOpenPayment,
  onOpenItem,
}: {
  e: Entry;
  name: string;
  now: Date;
  chip: ReactNode;
  nameOf: (userId: string) => string;
  itemById: ReadonlyMap<string, CostItem>;
  onOpenPayment: (id: string) => void;
  onOpenItem: (item: CostItem) => void;
}) {
  const ghost = e.kind === 'expected' || e.kind === 'usual';
  const title =
    e.kind === 'payment'
      ? e.payment.description
      : e.kind === 'usual'
        ? `Usual ${CATEGORY_META[e.category].label.toLowerCase()} for the rest of ${name}`
        : e.item.name;
  const onClick =
    e.kind === 'payment' ? () => onOpenPayment(e.payment.id) : e.kind === 'usual' ? undefined : () => onOpenItem(e.item);
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-sm font-medium text-foreground', ghost && 'italic')}>{title}</span>
        {chip && <span className="mt-0.5 block">{chip}</span>}
        <span className="block truncate text-xs text-muted-foreground">{entryMeta(e, name, now, nameOf, itemById)}</span>
      </span>
      <span className={cn('text-sm tabular-nums', ghost ? 'italic text-muted-foreground' : 'text-foreground')}>
        {ghost ? '~' : ''}
        {formatMoney(e.cents, AUD)}
      </span>
    </>
  );
  const cls = cn(
    'flex min-h-[52px] w-full items-center gap-3 py-2 text-left',
    ghost && 'my-1 rounded-xl border border-dashed border-border px-3 opacity-70',
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(cls, 'hover:bg-muted/30')}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function CategoryTag({ e, itemById }: { e: Entry; itemById: ReadonlyMap<string, CostItem> }) {
  const category: CostCategory | null =
    e.kind === 'usual' ? e.category : e.kind === 'payment' ? paymentCategory(e.payment, itemById) : e.item.category;
  if (!category) {
    return (
      <span className="inline-flex min-h-6 items-center rounded-lg border border-dashed border-muted-foreground/60 px-2 text-[11px] font-medium text-foreground">
        Pick a category
      </span>
    );
  }
  return (
    <span className={cn('inline-flex min-h-6 items-center rounded-lg px-2 text-[11px] font-medium', CATEGORY_COLOR[category].tile)}>
      {CATEGORY_META[category].label}
    </span>
  );
}

function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'min-h-9 shrink-0 rounded-full px-3 text-xs tabular-nums',
        active ? 'bg-foreground text-background' : 'bg-muted/60 text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

function MonthAhead({
  name,
  outlook,
  onOpenItem,
}: {
  name: string;
  outlook: ReturnType<typeof monthOutlook>;
  onOpenItem: (item: CostItem) => void;
}) {
  const [allBills, setAllBills] = useState(false);
  const bills = allBills ? outlook.bills : outlook.bills.slice(0, 5);
  const hidden = outlook.bills.length - bills.length;
  return (
    <section className="space-y-3">
      <h2 className={cn(LABEL, 'px-1')}>
        {name} forecast · about {formatMoney(outlook.totalCents, AUD)}
      </h2>
      {outlook.bills.length > 0 && (
        <div className="space-y-2">
          <h3 className={cn(LABEL, 'px-1')}>Lines that repeat · {formatMoney(outlook.billsCents, AUD)}</h3>
          <div className={cn(FORECAST_CARD, 'divide-y divide-border/60 px-4')}>
            {bills.map((b) => (
              <button key={b.item.id} type="button" onClick={() => onOpenItem(b.item)} className="flex min-h-[52px] w-full items-center gap-3 py-2 text-left">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{b.item.name}</span>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {b.item.is_estimate ? '~' : ''}
                  {formatMoney(b.cents, AUD)}
                </span>
              </button>
            ))}
            {hidden > 0 && (
              <button type="button" onClick={() => setAllBills(true)} className="flex min-h-12 w-full items-center text-sm font-semibold text-primary hover:text-primary/80">
                {hidden} more
              </button>
            )}
          </div>
        </div>
      )}
      {outlook.everyday.length > 0 && (
        <div className="space-y-2">
          <h3 className={cn(LABEL, 'px-1')}>Everyday spending · about {formatMoney(outlook.everydayCents, AUD)}</h3>
          <div className={cn(FORECAST_CARD, 'divide-y divide-border/60 px-4')}>
            {outlook.everyday.map((e, n) => (
              <div key={e.category} className="flex min-h-[52px] items-center gap-3 py-2">
                <CategoryGlyph category={e.category} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{CATEGORY_META[e.category].label}</span>
                  {n === 0 && <span className="block text-xs text-muted-foreground">Last 3 months, recent ones count more</span>}
                </span>
                <span className="text-sm tabular-nums text-muted-foreground">~{formatMoney(e.cents, AUD)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {outlook.planned.length > 0 && (
        <div className="space-y-2">
          <h3 className={cn(LABEL, 'px-1')}>Planned by you</h3>
          <div className={cn(CARD, 'divide-y divide-border/60 px-4')}>
            {outlook.planned.map((i) => (
              <button key={i.id} type="button" onClick={() => onOpenItem(i)} className="flex min-h-[52px] w-full items-center gap-3 py-2 text-left">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{i.name}</span>
                <span className="text-sm tabular-nums text-foreground">{formatMoney(i.amount, AUD)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
