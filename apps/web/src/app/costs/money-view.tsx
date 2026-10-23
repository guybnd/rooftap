'use client';

// Up Bank connector: the Money view inside Costs (Guy's pick B). "Plan" is the
// cost lines as before; "Money" is what's in Up and where it went. It leads
// with the total across the accounts the viewer may see as the Hero (H1),
// then the accounts, then every transaction by day as line items (three-slot
// anatomy, relative day headings, tabular numbers). A tap opens the
// transaction (B2): which cost line it counts as, "always link" for its
// payee, a price-change nudge, hide from spending and a note. Swipe left
// hides a payment. Only the person who connected an account can change its
// transactions; shared ones read only. Household | Mine picks the joint
// (shared) or personal accounts, a month stepper walks back through the
// months (the whole month loads at once), and a search box and the category
// chips narrow the list. A payment with no line can become one ("Make it a
// cost"). All, Out and In pick which way the money went; every payment
// shows its category (its cost line's, else the closest fit to Up's), and
// the sheet opens the line to edit it.
// Native twin: apps/mobile/src/features/costs/money-view.tsx.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  CATEGORY_META,
  bankMatchParts,
  costItemsToOptions,
  filterBankTransactions,
  formatMoney,
  groupByDay,
  bankDayLabel,
  monthLabel,
  monthStartOf,
  moneyIn,
  paymentCategory,
  paymentCategoryLabel,
  paymentGoes,
  shiftMonth,
  useUpConnected,
  useUpOverview,
  bankRowMeta,
  type BankTransactionPatch,
  type MakeCostPreview,
  type BankTransactionView,
  type CostItem,
  type PaymentDirection,
  costPaymentMenu,
  likelyCostCategories,
  useCostCategoryChoices,
  useModules,
  type CostCategory,
  type RowMenu,
} from '@homeup/core';
import { CategoryGrid, CategoryPickerSheet, type CategoryPick } from './category-picker';
import { CostRowShell, CostRowSheet, type CostRowSheetState } from './cost-row-sheet';
import { commit, tick } from '@/lib/haptics';
import { upBankApi } from '@/lib/up-bank-client';
import { HeroLede } from '@/components/ui/hero-lede';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { SearchablePicker } from '@/components/ui/searchable-picker';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const AUD = { currency: 'AUD' };

export type CostsView = 'plan' | 'money';

export function CostsViewSwitch({ value, onChange }: { value: CostsView; onChange: (v: CostsView) => void }) {
  const connected = useUpConnected();
  const { linking, scope, setScope } = useUpOverview();
  if (!connected || !linking) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedControl
        ariaLabel="Costs view"
        value={value}
        onChange={onChange}
        options={[
          { value: 'plan', label: 'Plan' },
          { value: 'money', label: 'Money' },
        ]}
        tone="accent"
        className="flex-1 sm:max-w-xs"
      />
      {/* Household (joint, shared) or Mine (personal accounts) for the Up card and Money. */}
      {scope && (
        <SegmentedControl
          ariaLabel="Whose money"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'household', label: 'Household' },
            { value: 'mine', label: 'Mine' },
          ]}
          size="sm"
        />
      )}
    </div>
  );
}

export function MoneyView({
  items,
  currentUserId,
  nameOf,
  onOpenItem,
  onSetAmount,
}: {
  items: CostItem[];
  currentUserId: string | null;
  nameOf: (userId: string) => string;
  onOpenItem: (item: CostItem) => void;
  onSetAmount: (item: CostItem, cents: number) => void;
}) {
  const { status, data, reload, month, setMonth, scope } = useUpOverview();
  const [showHidden, setShowHidden] = useState(false);
  const [rows, setRows] = useState<BankTransactionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [direction, setDirection] = useState<PaymentDirection>('all');
  const [rowSheet, setRowSheet] = useState<CostRowSheetState | null>(null);
  const [pick, setPick] = useState<CategoryPick | null>(null);
  const quickMove = useModules().server('costs.quick-move');
  const choices = useCostCategoryChoices();
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const thisMonth = monthStartOf(new Date());

  const load = useCallback(async () => {
    try {
      const page = await upBankApi.transactions({ month, scope: scope ?? undefined, hidden: showHidden });
      setRows(page.transactions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read your transactions.");
    }
  }, [month, scope, showHidden]);

  useEffect(() => {
    setRows(null);
    void load();
  }, [load, status?.connection?.lastSyncedAt]);
  useEffect(() => setCategory(null), [month, scope]);

  const apply = async (id: string, patch: BankTransactionPatch) => {
    try {
      const saved = await upBankApi.updateTransaction(id, patch);
      setRows((cur) =>
        (cur ?? [])
          .map((r) => (r.id === id ? saved : r))
          .filter((r) => r.hidden === showHidden),
      );
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    }
  };

  // Swipe right or "Move to": this payment alone, or its whole shop with the switch.
  const moveTo = async (t: BankTransactionView, c: CostCategory, wholeShop: boolean) => {
    if (!wholeShop) return apply(t.id, { costCategory: c });
    try {
      await upBankApi.changeShop({ vendor: t.description, category: c });
      reload();
      await load();
      toast(`Moved ${t.description} to ${CATEGORY_META[c].label}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't move the shop.");
    }
  };
  const canMove = (t: BankTransactionView) => t.mine && quickMove && t.amountCents < 0 && !t.isTransfer;
  const pickFor = (t: BankTransactionView) => {
    const current = paymentCategory(t, itemById);
    setPick({
      title: `Move ${t.description}`,
      current,
      likely: likelyCostCategories({ sourceCategory: t.category }, current, null, choices),
      scope: { label: `Every payment at ${t.description}`, hint: 'Off moves this payment only' },
      onPick: (c, whole) => void moveTo(t, c, whole),
    });
  };
  const menuFor = (t: BankTransactionView) =>
    costPaymentMenu({
      t,
      category: paymentCategory(t, itemById),
      choices,
      quickMove,
      onMove: (c) => void moveTo(t, c, false),
      onOpen: () => setOpenId(t.id),
      onHide: t.mine ? () => void apply(t.id, { hidden: !t.hidden }) : null,
    });
  const sheetFor = (t: BankTransactionView) => {
    commit();
    setRowSheet({
      category: paymentCategory(t, itemById),
      amount: `${t.amountCents > 0 ? '+' : ''}${formatMoney(Math.abs(t.amountCents), AUD)}`,
      meta: bankRowMeta(t, t.costItemId ? itemById.get(t.costItemId) ?? null : null, paymentCategoryLabel(t, itemById), t.mine ? null : nameOf(t.userId)),
      menu: menuFor(t),
    });
  };

  if (status && !status.connection) return <p className="text-sm text-muted-foreground">Connect Up in Settings, Connectors to see your money here.</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Reading your Up accounts…</p>;
  const accounts = data.accounts ?? [];
  const total = (data.everydayCents ?? 0) + (data.saversCents ?? 0);
  const monthName = monthLabel(month);
  const open = rows?.find((r) => r.id === openId) ?? null;
  const shown = rows ? filterBankTransactions(rows, { query, category }).filter((r) => paymentGoes(r, direction)) : null;
  // Household only: what came into the joint accounts this month.
  const income =
    scope === 'household' && rows && !showHidden
      ? moneyIn(rows, accounts.filter((a) => a.joint).map((a) => a.name))
      : null;

  return (
    <div className="space-y-5">
      <HeroLede
        value={formatMoney(total, AUD)}
        label={`across ${accounts.length} Up account${accounts.length === 1 ? '' : 's'}`}
        caption={`${formatMoney(data.spentCents, AUD)} spent in ${monthName}`}
      />

      {accounts.length > 0 && (
        <div className="divide-y divide-border/60 rounded-3xl border border-border/60 bg-card px-4 shadow-[var(--card-shadow)]">
          {accounts.map((a) => (
            <div key={a.id} className="flex min-h-12 items-center gap-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-foreground">
                {a.name}
                {a.joint ? <span className="text-muted-foreground"> · joint</span> : null}
                {!a.joint && a.userId !== currentUserId ? <span className="text-muted-foreground"> · {nameOf(a.userId)}</span> : null}
              </span>
              <span className="font-semibold tabular-nums text-foreground">{formatMoney(a.balanceCents, AUD)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setMonth(shiftMonth(month, -1))}
          className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="min-w-28 text-center text-sm font-semibold text-foreground">{monthName}</span>
        <button
          type="button"
          aria-label="Next month"
          disabled={month >= thisMonth}
          onClick={() => setMonth(shiftMonth(month, 1))}
          className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/40 hover:text-foreground disabled:opacity-30"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search payee, note or #tag"
          aria-label="Search transactions"
          className="ml-2 h-10 flex-1 rounded-xl"
        />
      </div>

      <SegmentedControl
        ariaLabel="Which way the money went"
        value={direction}
        onChange={setDirection}
        options={[
          { value: 'all', label: 'All' },
          { value: 'out', label: 'Out' },
          { value: 'in', label: 'In' },
        ]}
        size="sm"
        className="w-full sm:max-w-xs"
      />

      {data.categories.length > 0 && direction !== 'in' && (
        <div className="flex flex-wrap gap-2">
          {data.categories.slice(0, 8).map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={category === c.id}
              onClick={() => setCategory((cur) => (cur === c.id ? null : c.id))}
              className={cn(
                'min-h-9 rounded-full px-3 text-xs tabular-nums',
                category === c.id ? 'bg-foreground text-background' : 'bg-muted/60 text-muted-foreground hover:text-foreground',
              )}
            >
              {c.label} {formatMoney(c.cents, AUD)}
            </button>
          ))}
        </div>
      )}

      {income && income.sources.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Money in</h2>
            <span className="text-sm font-semibold tabular-nums text-success">+{formatMoney(income.totalCents, AUD)}</span>
          </div>
          <div className="divide-y divide-border/60 rounded-3xl border border-border/60 bg-card px-4 shadow-[var(--card-shadow)]">
            {income.sources.slice(0, 6).map((src) => (
              <div key={src.label} className="flex min-h-12 items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {src.label}
                  {src.count > 1 ? <span className="text-muted-foreground"> · {src.count} times</span> : null}
                </span>
                <span className="tabular-nums text-foreground">{formatMoney(src.cents, AUD)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
          {showHidden ? 'Hidden from spending' : 'Transactions'}
        </h2>
        <button
          type="button"
          onClick={() => setShowHidden((v) => !v)}
          className="min-h-10 px-1 text-sm font-semibold text-primary hover:text-primary/80"
        >
          {showHidden ? 'Back to spending' : 'Hidden'}
        </button>
      </div>

      {error && <p className="px-1 text-xs text-destructive">{error}</p>}
      {shown === null ? (
        <p className="px-1 text-sm text-muted-foreground">Reading your transactions…</p>
      ) : shown.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">
          {query || category || direction !== 'all' ? 'Nothing matches.' : showHidden ? 'Nothing hidden.' : `No transactions in ${monthName}.`}
        </p>
      ) : (
        <div className="rounded-3xl border border-border/60 bg-card shadow-[var(--card-shadow)]">
          {groupByDay(shown).map((g) => (
            <div key={g.label}>
              <p className="px-4 pb-1 pt-3 text-xs text-muted-foreground">{g.label}</p>
              <div className="divide-y divide-border/60">
                {g.rows.map((t) => (
                  <MoneyRow
                    key={t.id}
                    t={t}
                    line={t.costItemId ? itemById.get(t.costItemId) ?? null : null}
                    categoryLabel={paymentCategoryLabel(t, itemById)}
                    owner={t.mine ? null : nameOf(t.userId)}
                    onOpen={() => setOpenId(t.id)}
                    onToggleHidden={t.mine ? () => apply(t.id, { hidden: !t.hidden }) : undefined}
                    onMove={canMove(t) ? () => pickFor(t) : undefined}
                    menu={() => menuFor(t)}
                    onSheet={() => sheetFor(t)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {!showHidden && rows && rows.length > 0 && (
        <p className="text-center text-xs text-muted-foreground">
          {quickMove ? 'Swipe right to move a payment, left to hide it. Right-click or hold one for more.' : 'Swipe left to hide a payment. Tap one to file it under a cost.'}
        </p>
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
        onOpenItem={onOpenItem}
        onSetAmount={onSetAmount}
        onShopMoved={() => void load()}
      />
      <CostRowSheet state={rowSheet} choices={choices} onClose={() => setRowSheet(null)} />
      <CategoryPickerSheet pick={pick} choices={choices} onClose={() => setPick(null)} />
    </div>
  );
}

const CADENCE_WORD: Record<MakeCostPreview['cadence'], string> = {
  weekly: 'a week',
  fortnightly: 'a fortnight',
  monthly: 'a month',
  quarterly: 'a quarter',
  yearly: 'a year',
  one_off: 'once',
};

function MoneyRow({
  t,
  line,
  categoryLabel,
  owner,
  onOpen,
  onToggleHidden,
  onMove,
  menu,
  onSheet,
}: {
  t: BankTransactionView;
  line: CostItem | null;
  categoryLabel: string | null;
  owner: string | null;
  onOpen: () => void;
  onToggleHidden?: () => void;
  onMove?: () => void;
  menu: () => RowMenu;
  onSheet: () => void;
}) {
  return (
    <CostRowShell
      label={t.description}
      className="hover:bg-muted/40"
      onOpen={onOpen}
      menu={menu}
      onSheet={onSheet}
      onMove={onMove}
      away={onToggleHidden ? { label: t.hidden ? 'Show' : 'Hide', kind: 'hide' } : null}
      onAway={onToggleHidden}
    >
    <div className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{t.description}</p>
        <p className="truncate text-xs text-muted-foreground">{bankRowMeta(t, line, categoryLabel, owner)}</p>
      </div>
      <span className={cn('text-sm tabular-nums', t.amountCents > 0 ? 'text-success' : 'text-foreground')}>
        {t.amountCents > 0 ? '+' : ''}
        {formatMoney(Math.abs(t.amountCents), AUD)}
      </span>
    </div>
    </CostRowShell>
  );
}

export function TransactionSheet({
  t,
  items,
  owner,
  onClose,
  onPatch,
  onMadeCost,
  onOpenItem,
  onSetAmount,
  onShopMoved,
}: {
  t: BankTransactionView | null;
  items: CostItem[];
  owner: string | null;
  onClose: () => void;
  onPatch: (patch: BankTransactionPatch) => void;
  onMadeCost: (saved: BankTransactionView) => void;
  onOpenItem: (item: CostItem) => void;
  onSetAmount: (item: CostItem, cents: number) => void;
  /** A whole shop moved: read the payments again. */
  onShopMoved?: () => void;
}) {
  const { data, reload } = useUpOverview();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [making, setMaking] = useState<MakeCostPreview | null>(null);
  const [costName, setCostName] = useState('');
  const [linkPayee, setLinkPayee] = useState(true);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [wholeShop, setWholeShop] = useState(false);
  const quickMove = useModules().server('costs.quick-move');
  const choices = useCostCategoryChoices();
  useEffect(() => {
    setNote(null);
    setMaking(null);
    setSheetError(null);
    setMoving(false);
    setWholeShop(false);
  }, [t?.id]);
  const canMove = !!t && t.mine && t.amountCents < 0 && !t.isTransfer && quickMove;
  // One payment moves on its own; with the switch on, its whole shop does.
  const moveTo = async (c: CostCategory) => {
    if (!t) return;
    tick();
    setMoving(false);
    if (!wholeShop) {
      onPatch({ costCategory: c });
      return;
    }
    try {
      await upBankApi.changeShop({ vendor: t.description, category: c });
      reload();
      onShopMoved?.();
      toast(`Moved ${t.description} to ${CATEGORY_META[c].label}`);
    } catch (err) {
      setSheetError(err instanceof Error ? err.message : "Couldn't move the shop.");
    }
  };

  const startMaking = async () => {
    if (!t) return;
    setBusy(true);
    setSheetError(null);
    try {
      const plan = await upBankApi.costPreview(t.id);
      setMaking(plan);
      setCostName(plan.name);
      setLinkPayee(plan.seen > 1);
    } catch (err) {
      setSheetError(err instanceof Error ? err.message : "Couldn't read that payment.");
    } finally {
      setBusy(false);
    }
  };
  const saveCost = async () => {
    if (!t || !making) return;
    setBusy(true);
    setSheetError(null);
    try {
      const made = await upBankApi.makeCost(t.id, { name: costName.trim() || making.name, linkPayee });
      setMaking(null);
      onMadeCost(made.transaction);
    } catch (err) {
      setSheetError(err instanceof Error ? err.message : "Couldn't make the cost.");
    } finally {
      setBusy(false);
    }
  };

  const line = t?.costItemId ? items.find((i) => i.id === t.costItemId) ?? null : null;
  const category = t ? paymentCategory(t, new Map(line ? [[line.id, line]] : [])) : null;
  const rule = line ? data?.links?.find((l) => l.costItemId === line.id) ?? null : null;
  const always = !!rule && !!t && bankMatchParts(rule.match).some((m) => m.toUpperCase() === t.description.toUpperCase());
  const options = useMemo(() => costItemsToOptions(items.filter((i) => !i.deleted)), [items]);
  const paid = t ? -t.amountCents : 0;

  const setAlways = async (on: boolean) => {
    if (!t || !line) return;
    setBusy(true);
    try {
      if (on) await upBankApi.setCostLink(line.id, { match: t.description, keepAmount: rule?.keepAmount ?? false });
      else await upBankApi.removeCostLink(line.id);
      reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      open={!!t}
      onOpenChange={(o) => !o && onClose()}
      overlayClassName="bg-black/40"
      className="max-h-[88dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-popover px-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-popover-foreground shadow-2xl shadow-black/50 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:pt-4"
      handleClassName="sm:hidden"
      popupProps={{ 'aria-label': 'Transaction' }}
    >
      {t && (
        <div className="space-y-3 pb-2 pt-1">
          <div>
            <p className={cn('text-4xl font-extrabold tabular-nums', t.amountCents > 0 ? 'text-success' : 'text-foreground')}>
              {t.amountCents > 0 ? '+' : ''}
              {formatMoney(Math.abs(t.amountCents), AUD)}
            </p>
            <p className="text-base font-semibold text-foreground">{t.description}</p>
            <p className="text-xs text-muted-foreground">
              {[bankDayLabel(t.occurredAt), t.accountName, t.pending ? 'pending' : 'settled', owner ? `shared by ${owner}` : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {t.message && <p className="pt-1 text-sm text-muted-foreground">{t.message}</p>}
          </div>

          <div className="rounded-2xl bg-muted/40">
            {t.amountCents < 0 && !t.isTransfer && (
              <>
                <button
                  type="button"
                  aria-expanded={moving}
                  disabled={!canMove}
                  onClick={() => setMoving((v) => !v)}
                  className="flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left enabled:hover:bg-muted/60"
                >
                  <span className="flex-1 text-sm text-foreground">Category</span>
                  <span className="text-right text-sm">
                    <span className={cn('block', canMove ? 'font-medium text-foreground' : 'text-muted-foreground')}>{category ? CATEGORY_META[category].label : 'None yet'}</span>
                    {t.costCategory ? (
                      <span className="block text-xs text-muted-foreground">picked for this payment</span>
                    ) : line ? (
                      <span className="block text-xs text-muted-foreground">from the {line.name} line</span>
                    ) : t.categoryLabel ? (
                      <span className="block text-xs text-muted-foreground">from Up: {t.categoryLabel}</span>
                    ) : null}
                  </span>
                  {canMove ? <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', moving && 'rotate-90')} /> : null}
                </button>
                {moving && (
                  <div className="space-y-2 px-3 pb-3">
                    <CategoryGrid choices={choices} current={category} onPick={(c) => void moveTo(c)} />
                    <div className="flex min-h-12 items-center gap-3 px-1">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-foreground">Every payment at {t.description}</p>
                        <p className="text-xs text-muted-foreground">{wholeShop ? 'Later ones too' : 'Off moves this payment only'}</p>
                      </div>
                      <Switch checked={wholeShop} label="Every payment at this shop" onChange={setWholeShop} />
                    </div>
                    {t.costCategory ? (
                      <button type="button" onClick={() => { setMoving(false); onPatch({ costCategory: null }); }} className="min-h-11 px-1 text-sm text-muted-foreground hover:text-foreground">
                        Go back to the shop&apos;s category
                      </button>
                    ) : null}
                  </div>
                )}
              </>
            )}
            <div className={cn('flex min-h-12 items-center gap-3 px-4 py-2', t.amountCents < 0 && !t.isTransfer && 'border-t border-border/60')}>
              <span className="flex-1 text-sm text-foreground">Bill or cost line</span>
              {t.mine && t.amountCents < 0 && !t.isTransfer ? (
                <div className="w-48">
                  <SearchablePicker
                    options={options}
                    value={t.costItemId}
                    onChange={(id) => onPatch({ costItemId: id })}
                    placeholder="Nothing"
                    searchPlaceholder="Search costs…"
                    ariaLabel="Bill or cost line"
                  />
                </div>
              ) : (
                <span className="text-sm font-semibold text-foreground">{line?.name ?? 'Nothing'}</span>
              )}
            </div>
            {t.tags.length > 0 && (
              <div className="flex min-h-12 items-center gap-3 border-t border-border/60 px-4 py-2">
                <span className="flex-1 text-sm text-foreground">Up tags</span>
                <span className="truncate text-sm text-muted-foreground">{t.tags.map((x) => `#${x}`).join(' ')}</span>
              </div>
            )}
            {line && t.mine && (
              <div className="flex min-h-12 items-center gap-3 border-t border-border/60 px-4 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">
                    Always link {t.description} to {line.name}
                  </p>
                  <p className="text-xs text-muted-foreground">Next time, the payment lands on the line by itself</p>
                </div>
                <Switch checked={always} disabled={busy} label="Always link" onChange={(on) => void setAlways(on)} />
              </div>
            )}
            {line && t.linkKind === 'manual' && t.mine && (
              <button
                type="button"
                onClick={() => onPatch({ costItemId: null })}
                className="flex min-h-12 w-full items-center border-t border-border/60 px-4 text-left text-sm text-muted-foreground hover:text-foreground"
              >
                Let the link rules decide
              </button>
            )}
          </div>

          {!line && t.mine && t.amountCents < 0 && !t.isTransfer && (
            making ? (
              <div className="space-y-2 rounded-2xl bg-muted/40 px-4 py-3">
                <Input value={costName} maxLength={200} onChange={(e) => setCostName(e.target.value)} aria-label="Cost name" className="h-10 rounded-xl" />
                <p className="text-xs tabular-nums text-muted-foreground">
                  {[
                    `${making.estimate ? 'About ' : ''}${formatMoney(making.amountCents)} ${CADENCE_WORD[making.cadence]}`,
                    CATEGORY_META[making.category]?.label ?? making.category,
                    making.seen > 1 ? `${making.seen} payments in the last year` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <div className="flex min-h-12 items-center gap-3">
                  <span className="flex-1 text-sm text-foreground">Also file future payments to {t.description}</span>
                  <Switch checked={linkPayee} label="Also file future payments" onChange={setLinkPayee} />
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setMaking(null)} className="min-h-10 px-3 text-sm text-muted-foreground">
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void saveCost()}
                    className="min-h-10 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  >
                    Add the cost
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void startMaking()}
                className="px-1 text-sm font-medium text-primary hover:text-primary/80 disabled:opacity-50"
              >
                Make it a cost
              </button>
            )
          )}
          {sheetError && <p className="px-1 text-xs text-destructive">{sheetError}</p>}

          {line && line.cadence !== 'one_off' && t.amountCents < 0 && paid !== (line.amount ?? 0) && (
            <div className="flex min-h-12 items-center gap-3 rounded-2xl bg-muted/40 px-4 py-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-warning" aria-hidden />
              <span className="flex-1 text-sm text-foreground">
                The {line.name} line says {formatMoney(line.amount ?? 0)}
              </span>
              <button type="button" onClick={() => onSetAmount(line, paid)} className="min-h-10 px-1 text-sm font-semibold text-primary hover:text-primary/80">
                Use {formatMoney(paid)}
              </button>
            </div>
          )}

          {line && (
            <button type="button" onClick={() => onOpenItem(line)} className="min-h-10 px-1 text-sm font-medium text-primary hover:text-primary/80">
              Edit the {line.name} line
            </button>
          )}

          {t.mine && (
            <>
              {note !== null ? (
                <div className="space-y-2">
                  <textarea
                    autoFocus
                    value={note}
                    maxLength={500}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="A note for this payment"
                    className="h-20 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
                  />
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setNote(null)} className="min-h-10 px-3 text-sm text-muted-foreground">
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onPatch({ note });
                        setNote(null);
                      }}
                      className="min-h-10 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground"
                    >
                      Save note
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {t.note && <p className="px-1 text-sm text-foreground">{t.note}</p>}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => onPatch({ hidden: !t.hidden })}
                      className="h-12 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-muted/40"
                    >
                      {t.hidden ? 'Show in spending' : 'Hide from spending'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setNote(t.note ?? '')}
                      className="h-12 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-muted/40"
                    >
                      {t.note ? 'Edit note' : 'Add a note'}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
