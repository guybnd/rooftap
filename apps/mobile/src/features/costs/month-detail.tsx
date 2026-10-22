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
// lines" on the screen. Numbers come from core month-spending.ts. A tap on a
// payment opens the Money view's sheet (category, cost line, Edit line).
// Web twin: apps/web/src/app/costs/month-detail.tsx.
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { SegmentedControl, Text, cn, useThemeMaterial } from '@homeup/ui';
import {
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
import { upBankApi } from './up-bank-api';
import { TransactionSheet } from './money-view';
import { CategoryChip, categoryTint } from './cost-card';

const AUD = { currency: 'AUD' };
const TABULAR = { fontVariant: ['tabular-nums' as const] };
const LABEL = 'text-[10.5px] font-medium uppercase tracking-[1px] text-muted-foreground';
const CARD = 'overflow-hidden rounded-3xl border border-border/60 bg-card';
const FORECAST_CARD = 'rounded-3xl border border-dashed border-border px-4';
/** Rows a category shows before "All". */
const FIRST_ROWS = 4;

type Mode = 'categories' | 'payments';
type Entry = MonthEntry<BankTransactionView>;

function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export interface MonthDetailProps {
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

export function MonthDetail(props: MonthDetailProps) {
  const connected = useUpConnected();
  const { linking } = useUpOverview();
  if (!connected || !linking) return null;
  return <MonthDetailBody {...props} />;
}

function MonthDetailBody({ month, items, planItems, nameOf, onOpenItem, onSetAmount }: MonthDetailProps) {
  const { status, data, reload, scope } = useUpOverview();
  const bank = useBankActuals();
  const now = React.useMemo(() => new Date(), []);
  const key = monthKeyOf(month);
  const ahead = key > monthKeyOf(now);
  const name = month.toLocaleString('en-AU', { month: 'long' });

  const [mode, setMode] = React.useState<Mode>('categories');
  const [rows, setRows] = React.useState<BankTransactionView[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [closed, setClosed] = React.useState<Set<string>>(new Set());
  const [whole, setWhole] = React.useState<Set<string>>(new Set());
  const [chip, setChip] = React.useState<CostCategory | 'none' | null>(null);
  const itemById = React.useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const load = React.useCallback(async () => {
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

  React.useEffect(() => {
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

  const book = React.useMemo(
    () => (rows ? monthBook({ rows, items: planItems, itemById, links: data?.links ?? [], bank, month: key, now }) : null),
    [rows, planItems, itemById, data, bank, key, now],
  );
  const outlook = React.useMemo(() => (ahead ? monthOutlook(planItems, bank, key, now) : null), [ahead, planItems, bank, key, now]);
  const open = rows?.find((r) => r.id === openId) ?? null;

  if (outlook) return <MonthAhead name={name} outlook={outlook} onOpenItem={onOpenItem} />;

  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) =>
    set((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const entryRow = (e: Entry, withChip: boolean, divided: boolean) => (
    <EntryRow
      key={e.key}
      e={e}
      name={name}
      now={now}
      divided={divided}
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
    <View className="gap-3">
      <View className="gap-2 px-1">
        <Text className={LABEL} style={TABULAR}>
          {name}
          {book ? ` · ${formatMoney(book.spentCents, AUD)} spent` : ''}
          {book && book.expectedCents > 0 ? ` · about ${formatMoney(book.expectedCents, AUD)} to come` : ''}
        </Text>
        <SegmentedControl
          accessibilityLabel={`How ${name} reads`}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'categories', label: 'Categories' },
            { value: 'payments', label: 'Payments' },
          ]}
          size="sm"
        />
      </View>

      {error ? <Text className="px-1 text-xs text-destructive">{error}</Text> : null}
      {!book ? (
        <Text className="px-1 text-sm text-muted-foreground">Reading {name}&apos;s payments…</Text>
      ) : book.categories.length === 0 ? (
        <Text className="px-1 text-sm text-muted-foreground">Nothing in {name}.</Text>
      ) : mode === 'categories' ? (
        <View className={CARD}>
          {book.categories.map((c, n) => {
            const id = c.category ?? 'none';
            const isOpen = !closed.has(id);
            const dated = c.entries.filter((e) => e.kind === 'payment' || e.kind === 'line');
            const extra = c.entries.filter((e) => e.kind !== 'payment' && e.kind !== 'line');
            const visible = whole.has(id) ? dated : dated.slice(0, FIRST_ROWS);
            const payments = c.entries.filter((e) => e.kind === 'payment').length;
            return (
              <View key={id} className={cn(n > 0 && 'border-t border-border/60')}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isOpen }}
                  onPress={() => toggle(setClosed, id)}
                  className="min-h-14 flex-row items-center gap-3 px-4 py-2"
                >
                  {c.category ? <CategoryChip category={c.category} /> : <View className="h-7 w-7 rounded-[9px] border border-dashed border-muted-foreground/60" />}
                  <View className="min-w-0 flex-1">
                    <Text numberOfLines={1} className="text-sm font-medium text-foreground">
                      {c.category ? CATEGORY_META[c.category].label : 'No category yet'}
                    </Text>
                    <Text numberOfLines={1} className="text-xs text-muted-foreground" style={TABULAR}>
                      {[
                        payments ? `${payments} payment${payments === 1 ? '' : 's'}` : null,
                        dated.length > payments ? `${dated.length - payments} added by you` : null,
                        c.expectedCents > 0 ? `about ${formatMoney(c.expectedCents, AUD)} to come` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                  <Text className="text-sm font-semibold text-foreground" style={TABULAR}>
                    {formatMoney(c.spentCents, AUD)}
                  </Text>
                  {isOpen ? <ChevronDown size={16} className="text-muted-foreground" /> : <ChevronRight size={16} className="text-muted-foreground" />}
                </Pressable>
                {isOpen ? (
                  <View className="pb-2 pl-14 pr-4">
                    {visible.map((e, i) => entryRow(e, false, i > 0))}
                    {dated.length > visible.length ? (
                      <Pressable accessibilityRole="button" onPress={() => toggle(setWhole, id)} className="min-h-10 justify-center">
                        <Text className="text-sm font-semibold text-primary">All {dated.length}</Text>
                      </Pressable>
                    ) : null}
                    {extra.map((e) => entryRow(e, false, false))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : (
        <>
          {ghosts.length > 0 ? (
            <View className="gap-2">
              <Text className={cn(LABEL, 'px-1')}>Still to come in {name}</Text>
              <View className={cn(FORECAST_CARD, 'py-1')}>{ghosts.map(({ e }) => entryRow(e, true, false))}</View>
            </View>
          ) : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 px-1">
            <Chip active={chip === null} onPress={() => setChip(null)} label={`All ${counted.length}`} />
            {book.categories.map((c) => {
              const id = c.category ?? 'none';
              const n = c.entries.filter((e) => e.kind === 'payment' || e.kind === 'line').length;
              if (!n) return null;
              return (
                <Chip
                  key={id}
                  active={chip === id}
                  onPress={() => setChip((cur) => (cur === id ? null : id))}
                  label={`${c.category ? CATEGORY_META[c.category].label : 'No category'} ${n}`}
                />
              );
            })}
          </ScrollView>
          {days.length > 0 ? (
            <View className={CARD}>
              {days.map((g) => (
                <View key={g.label}>
                  <Text className="px-4 pb-1 pt-3 text-xs text-muted-foreground" style={TABULAR}>
                    {g.label} · {formatMoney(g.rows.reduce((s, e) => s + e.cents, 0), AUD)}
                  </Text>
                  <View className="px-4">{g.rows.map((e, i) => entryRow(e, true, i > 0))}</View>
                </View>
              ))}
            </View>
          ) : null}
        </>
      )}

      <TransactionSheet
        t={open}
        items={items}
        owner={open && !open.mine ? nameOf(open.userId) : null}
        onClose={() => setOpenId(null)}
        onPatch={(patch) => {
          if (open) void apply(open.id, patch);
        }}
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
    </View>
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
  divided,
  chip,
  nameOf,
  itemById,
  onOpenPayment,
  onOpenItem,
}: {
  e: Entry;
  name: string;
  now: Date;
  divided: boolean;
  chip: React.ReactNode;
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
  const onPress =
    e.kind === 'payment' ? () => onOpenPayment(e.payment.id) : e.kind === 'usual' ? undefined : () => onOpenItem(e.item);
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      className={cn(
        'min-h-[52px] flex-row items-center gap-3 py-2',
        divided && !ghost && 'border-t border-border/60',
        ghost && 'my-1 rounded-xl border border-dashed border-border px-3 opacity-70',
      )}
    >
      <View className="min-w-0 flex-1 gap-0.5">
        <Text numberOfLines={1} className={cn('text-sm font-medium text-foreground', ghost && 'italic')}>
          {title}
        </Text>
        {chip}
        <Text numberOfLines={1} className="text-xs text-muted-foreground">
          {entryMeta(e, name, now, nameOf, itemById)}
        </Text>
      </View>
      <Text className={cn('text-sm', ghost ? 'italic text-muted-foreground' : 'text-foreground')} style={TABULAR}>
        {ghost ? '~' : ''}
        {formatMoney(e.cents, AUD)}
      </Text>
    </Pressable>
  );
}

function CategoryTag({ e, itemById }: { e: Entry; itemById: ReadonlyMap<string, CostItem> }) {
  const category: CostCategory | null =
    e.kind === 'usual' ? e.category : e.kind === 'payment' ? paymentCategory(e.payment, itemById) : e.item.category;
  const tint = categoryTint(useThemeMaterial().scheme, category ?? '');
  if (!category) {
    return (
      <View className="min-h-6 self-start justify-center rounded-lg border border-dashed border-muted-foreground/60 px-2">
        <Text className="text-[11px] font-medium text-foreground">Pick a category</Text>
      </View>
    );
  }
  return (
    <View className={cn('min-h-6 self-start justify-center rounded-lg px-2', tint?.tile ?? 'bg-muted')}>
      <Text className={cn('text-[11px] font-medium', tint?.glyph ?? 'text-muted-foreground')}>{CATEGORY_META[category].label}</Text>
    </View>
  );
}

function Chip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={cn('min-h-9 justify-center rounded-full px-3', active ? 'bg-foreground' : 'bg-muted/60')}
    >
      <Text className={cn('text-xs', active ? 'text-background' : 'text-muted-foreground')} style={TABULAR}>
        {label}
      </Text>
    </Pressable>
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
  const [allBills, setAllBills] = React.useState(false);
  const bills = allBills ? outlook.bills : outlook.bills.slice(0, 5);
  const hidden = outlook.bills.length - bills.length;
  return (
    <View className="gap-3">
      <Text className={cn(LABEL, 'px-1')} style={TABULAR}>
        {name} forecast · about {formatMoney(outlook.totalCents, AUD)}
      </Text>
      {outlook.bills.length > 0 ? (
        <View className="gap-2">
          <Text className={cn(LABEL, 'px-1')} style={TABULAR}>
            Lines that repeat · {formatMoney(outlook.billsCents, AUD)}
          </Text>
          <View className={FORECAST_CARD}>
            {bills.map((b, i) => (
              <Pressable
                key={b.item.id}
                accessibilityRole="button"
                onPress={() => onOpenItem(b.item)}
                className={cn('min-h-[52px] flex-row items-center gap-3 py-2', i > 0 && 'border-t border-border/60')}
              >
                <Text numberOfLines={1} className="min-w-0 flex-1 text-sm font-medium text-foreground">
                  {b.item.name}
                </Text>
                <Text className="text-sm text-muted-foreground" style={TABULAR}>
                  {b.item.is_estimate ? '~' : ''}
                  {formatMoney(b.cents, AUD)}
                </Text>
              </Pressable>
            ))}
            {hidden > 0 ? (
              <Pressable accessibilityRole="button" onPress={() => setAllBills(true)} className="min-h-12 justify-center border-t border-border/60">
                <Text className="text-sm font-semibold text-primary">{hidden} more</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
      {outlook.everyday.length > 0 ? (
        <View className="gap-2">
          <Text className={cn(LABEL, 'px-1')} style={TABULAR}>
            Everyday spending · about {formatMoney(outlook.everydayCents, AUD)}
          </Text>
          <View className={FORECAST_CARD}>
            {outlook.everyday.map((e, n) => (
              <View key={e.category} className={cn('min-h-[52px] flex-row items-center gap-3 py-2', n > 0 && 'border-t border-border/60')}>
                <CategoryChip category={e.category} />
                <View className="min-w-0 flex-1">
                  <Text numberOfLines={1} className="text-sm font-medium text-foreground">
                    {CATEGORY_META[e.category].label}
                  </Text>
                  {n === 0 ? <Text className="text-xs text-muted-foreground">Last 3 months, recent ones count more</Text> : null}
                </View>
                <Text className="text-sm text-muted-foreground" style={TABULAR}>
                  ~{formatMoney(e.cents, AUD)}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      {outlook.planned.length > 0 ? (
        <View className="gap-2">
          <Text className={cn(LABEL, 'px-1')}>Planned by you</Text>
          <View className={cn(CARD, 'px-4')}>
            {outlook.planned.map((i, n) => (
              <Pressable
                key={i.id}
                accessibilityRole="button"
                onPress={() => onOpenItem(i)}
                className={cn('min-h-[52px] flex-row items-center gap-3 py-2', n > 0 && 'border-t border-border/60')}
              >
                <Text numberOfLines={1} className="min-w-0 flex-1 text-sm font-medium text-foreground">
                  {i.name}
                </Text>
                <Text className="text-sm text-foreground" style={TABULAR}>
                  {formatMoney(i.amount, AUD)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}
