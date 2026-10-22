'use client';

// Up Bank connector: the Money view inside Costs (Guy's pick B). "Plan" is the
// cost lines as before; "Money" is what's in Up and where it went. It leads
// with the total across the accounts the viewer may see as the Hero (H1),
// then the accounts, then every transaction by day as line items (three-slot
// anatomy, relative day headings, tabular numbers). A tap opens the
// transaction (B2): which cost line it counts as, "always link" for its
// payee, a price-change nudge, hide from spending and a note. Swipe left
// hides a payment. Only the person who connected an account can change its
// transactions; shared ones read only.
// Native twin: apps/mobile/src/features/costs/money-view.tsx.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { EyeOff } from 'lucide-react';
import {
  costItemsToOptions,
  formatMoney,
  groupByDay,
  bankDayLabel,
  useUpConnected,
  useUpOverview,
  type BankTransactionPatch,
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
import { cn } from '@/lib/utils';

const AUD = { currency: 'AUD' };

export type CostsView = 'plan' | 'money';

export function CostsViewSwitch({ value, onChange }: { value: CostsView; onChange: (v: CostsView) => void }) {
  const connected = useUpConnected();
  const { linking } = useUpOverview();
  if (!connected || !linking) return null;
  return (
    <SegmentedControl
      ariaLabel="Costs view"
      value={value}
      onChange={onChange}
      options={[
        { value: 'plan', label: 'Plan' },
        { value: 'money', label: 'Money' },
      ]}
      tone="accent"
      className="sm:max-w-xs"
    />
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
  const { status, data, reload } = useUpOverview();
  const [showHidden, setShowHidden] = useState(false);
  const [rows, setRows] = useState<BankTransactionView[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const load = useCallback(
    async (before: string | null) => {
      try {
        const page = await upBankApi.transactions({ before, hidden: showHidden });
        setRows((cur) => (before && cur ? [...cur, ...page.transactions] : page.transactions));
        setNext(page.next);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't read your transactions.");
      }
    },
    [showHidden],
  );

  useEffect(() => {
    setRows(null);
    void load(null);
  }, [load, status?.connection?.lastSyncedAt]);

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
  const monthName = new Date().toLocaleString('default', { month: 'long' });
  const open = rows?.find((r) => r.id === openId) ?? null;

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
      {rows === null ? (
        <p className="px-1 text-sm text-muted-foreground">Reading your transactions…</p>
      ) : rows.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">{showHidden ? 'Nothing hidden.' : 'No transactions yet.'}</p>
      ) : (
        <div className="rounded-3xl border border-border/60 bg-card shadow-[var(--card-shadow)]">
          {groupByDay(rows).map((g) => (
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
          {next && (
            <button
              type="button"
              onClick={() => load(next)}
              className="flex min-h-12 w-full items-center justify-center border-t border-border/60 text-sm font-medium text-primary hover:bg-muted/40"
            >
              Show older
            </button>
          )}
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
        onOpenItem={onOpenItem}
        onSetAmount={onSetAmount}
      />
    </div>
  );
}

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
  onOpenItem,
  onSetAmount,
}: {
  t: BankTransactionView | null;
  items: CostItem[];
  owner: string | null;
  onClose: () => void;
  onPatch: (patch: BankTransactionPatch) => void;
  onOpenItem: (item: CostItem) => void;
  onSetAmount: (item: CostItem, cents: number) => void;
}) {
  const { data, reload } = useUpOverview();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setNote(null), [t?.id]);

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
