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
// cost").
// Native twin: apps/mobile/src/features/costs/money-view.tsx.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, EyeOff } from 'lucide-react';
import {
  CATEGORY_META,
  costItemsToOptions,
  filterBankTransactions,
  formatMoney,
  groupByDay,
  bankDayLabel,
  monthLabel,
  monthStartOf,
  shiftMonth,
  useUpConnected,
  useUpOverview,
  type BankTransactionPatch,
  type MakeCostPreview,
  type BankTransactionView,
  type CostItem,
} from '@homeup/core';
import { upBankApi } from '@/lib/up-bank-client';
import { HeroLede } from '@/components/ui/hero-lede';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SwipeActions } from '@/components/ui/swipe-actions';
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

  if (status && !status.connection) return <p className="text-sm text-muted-foreground">Connect Up in Settings, Connectors to see your money here.</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Reading your Up accounts…</p>;
  const accounts = data.accounts ?? [];
  const total = (data.everydayCents ?? 0) + (data.saversCents ?? 0);
  const monthName = monthLabel(month);
  const open = rows?.find((r) => r.id === openId) ?? null;
  const shown = rows ? filterBankTransactions(rows, { query, category }) : null;

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

      {data.categories.length > 0 && (
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
          {query || category ? 'Nothing matches.' : showHidden ? 'Nothing hidden.' : `No transactions in ${monthName}.`}
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
                    owner={t.mine ? null : nameOf(t.userId)}
                    onOpen={() => setOpenId(t.id)}
                    onToggleHidden={t.mine ? () => apply(t.id, { hidden: !t.hidden }) : undefined}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {!showHidden && rows && rows.length > 0 && (
        <p className="text-center text-xs text-muted-foreground">Swipe left to hide a payment. Tap one to file it under a cost.</p>
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
      />
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

function rowMeta(t: BankTransactionView, line: CostItem | null, owner: string | null): string {
  return [
    t.pending ? 'Pending' : null,
    line ? `counts toward ${line.name}` : t.isTransfer ? 'Transfer' : t.amountCents > 0 ? 'Money in' : t.categoryLabel,
    t.note,
    owner,
  ]
    .filter(Boolean)
    .join(' · ');
}

function MoneyRow({
  t,
  line,
  owner,
  onOpen,
  onToggleHidden,
}: {
  t: BankTransactionView;
  line: CostItem | null;
  owner: string | null;
  onOpen: () => void;
  onToggleHidden?: () => void;
}) {
  const body = (
    <button type="button" onClick={onOpen} className="flex min-h-[52px] w-full items-center gap-3 bg-card px-4 py-2 text-left hover:bg-muted/40">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{t.description}</p>
        <p className="truncate text-xs text-muted-foreground">{rowMeta(t, line, owner)}</p>
      </div>
      <span className={cn('text-sm tabular-nums', t.amountCents > 0 ? 'text-success' : 'text-foreground')}>
        {t.amountCents > 0 ? '+' : ''}
        {formatMoney(Math.abs(t.amountCents), AUD)}
      </span>
    </button>
  );
  if (!onToggleHidden) return body;
  return (
    <SwipeActions
      onSwipeLeft={onToggleHidden}
      left={{ bg: 'bg-muted', activeBg: 'bg-muted-foreground/30', icon: <EyeOff className="h-4 w-4" />, label: t.hidden ? 'Show' : 'Hide' }}
    >
      {body}
    </SwipeActions>
  );
}

function TransactionSheet({
  t,
  items,
  owner,
  onClose,
  onPatch,
  onMadeCost,
  onOpenItem,
  onSetAmount,
}: {
  t: BankTransactionView | null;
  items: CostItem[];
  owner: string | null;
  onClose: () => void;
  onPatch: (patch: BankTransactionPatch) => void;
  onMadeCost: (saved: BankTransactionView) => void;
  onOpenItem: (item: CostItem) => void;
  onSetAmount: (item: CostItem, cents: number) => void;
}) {
  const { data, reload } = useUpOverview();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [making, setMaking] = useState<MakeCostPreview | null>(null);
  const [costName, setCostName] = useState('');
  const [linkPayee, setLinkPayee] = useState(true);
  const [sheetError, setSheetError] = useState<string | null>(null);
  useEffect(() => {
    setNote(null);
    setMaking(null);
    setSheetError(null);
  }, [t?.id]);

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
  const rule = line ? data?.links?.find((l) => l.costItemId === line.id) ?? null : null;
  const always = !!rule && !!t && rule.match.toUpperCase() === t.description.toUpperCase();
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
            <div className="flex min-h-12 items-center gap-3 px-4 py-2">
              <span className="flex-1 text-sm text-foreground">Counts as</span>
              {t.mine && t.amountCents < 0 && !t.isTransfer ? (
                <div className="w-48">
                  <SearchablePicker
                    options={options}
                    value={t.costItemId}
                    onChange={(id) => onPatch({ costItemId: id })}
                    placeholder="Nothing"
                    searchPlaceholder="Search costs…"
                    ariaLabel="Counts as"
                  />
                </div>
              ) : (
                <span className="text-sm font-semibold text-foreground">{line?.name ?? 'Nothing'}</span>
              )}
            </div>
            {t.categoryLabel && (
              <div className="flex min-h-12 items-center gap-3 border-t border-border/60 px-4 py-2">
                <span className="flex-1 text-sm text-foreground">Category</span>
                <span className="text-sm text-muted-foreground">{t.categoryLabel}</span>
              </div>
            )}
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
            <button type="button" onClick={() => onOpenItem(line)} className="px-1 text-sm font-medium text-primary hover:text-primary/80">
              Open {line.name}
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
