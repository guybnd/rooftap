// Up Bank connector: the Money view inside Costs (Guy's pick B). "Plan" is the
// cost lines as before; "Money" is what's in Up and where it went. It leads
// with the total across the accounts the viewer may see as the Hero (H1),
// then the accounts, then every transaction by day as line items (three-slot
// anatomy, relative day headings, tabular numbers). A tap opens the
// transaction (B2): which cost line it counts as, "always link" for its
// payee, a price-change nudge, hide from spending and a note. Swipe left
// hides a payment. Only the person who connected an account can change its
// transactions; shared ones read only.
// Web twin: apps/web/src/app/costs/money-view.tsx.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { EyeOff } from 'lucide-react-native';
import {
  BottomSheet,
  HeroLede,
  Input,
  SearchablePicker,
  SegmentedControl,
  SwipeActions,
  Switch,
  Text,
  cn,
} from '@homeup/ui';
import {
  bankDayLabel,
  costItemsToOptions,
  formatMoney,
  groupByDay,
  useUpConnected,
  useUpOverview,
  type BankTransactionPatch,
  type BankTransactionView,
  type CostItem,
} from '@homeup/core';
import { upBankApi } from './up-bank-api';

const AUD = { currency: 'AUD' };
const TABULAR = { fontVariant: ['tabular-nums' as const] };

export type CostsView = 'plan' | 'money';

export function CostsViewSwitch({ value, onChange }: { value: CostsView; onChange: (v: CostsView) => void }) {
  const connected = useUpConnected();
  const { linking } = useUpOverview();
  if (!connected || !linking) return null;
  return (
    <SegmentedControl
      accessibilityLabel="Costs view"
      value={value}
      onChange={onChange}
      options={[
        { value: 'plan', label: 'Plan' },
        { value: 'money', label: 'Money' },
      ]}
      tone="accent"
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
      setRows((cur) => (cur ?? []).map((r) => (r.id === id ? saved : r)).filter((r) => r.hidden === showHidden));
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    }
  };

  if (status && !status.connection) return <Text className="text-sm text-muted-foreground">Connect Up in Settings, Connectors to see your money here.</Text>;
  if (!data) return <Text className="text-sm text-muted-foreground">Reading your Up accounts…</Text>;
  const accounts = data.accounts ?? [];
  const total = (data.everydayCents ?? 0) + (data.saversCents ?? 0);
  const monthName = new Date().toLocaleString('default', { month: 'long' });
  const open = rows?.find((r) => r.id === openId) ?? null;

  return (
    <View className="gap-4">
      <HeroLede
        value={formatMoney(total, AUD)}
        label={`across ${accounts.length} Up account${accounts.length === 1 ? '' : 's'}`}
        caption={`${formatMoney(data.spentCents, AUD)} spent in ${monthName}`}
      />

      {accounts.length > 0 && (
        <View className="rounded-3xl border border-border/60 bg-card px-4">
          {accounts.map((a, i) => (
            <View key={a.id} className={cn('min-h-12 flex-row items-center gap-3 py-2', i > 0 && 'border-t border-border/60')}>
              <Text numberOfLines={1} className="min-w-0 flex-1 text-sm text-foreground">
                {a.name}
                {a.joint ? <Text className="text-muted-foreground"> · joint</Text> : null}
                {!a.joint && a.userId !== currentUserId ? <Text className="text-muted-foreground"> · {nameOf(a.userId)}</Text> : null}
              </Text>
              <Text className="text-sm font-semibold text-foreground" style={TABULAR}>
                {formatMoney(a.balanceCents, AUD)}
              </Text>
            </View>
          ))}
        </View>
      )}

      <View className="flex-row items-center justify-between px-1">
        <Text className="text-[10.5px] font-medium uppercase tracking-[1px] text-muted-foreground">
          {showHidden ? 'Hidden from spending' : 'Transactions'}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => setShowHidden((v) => !v)} hitSlop={8} className="min-h-11 justify-center px-1">
          <Text className="text-sm font-semibold text-primary">{showHidden ? 'Back to spending' : 'Hidden'}</Text>
        </Pressable>
      </View>

      {error ? <Text className="px-1 text-xs text-destructive">{error}</Text> : null}
      {rows === null ? (
        <Text className="px-1 text-sm text-muted-foreground">Reading your transactions…</Text>
      ) : rows.length === 0 ? (
        <Text className="px-1 text-sm text-muted-foreground">{showHidden ? 'Nothing hidden.' : 'No transactions yet.'}</Text>
      ) : (
        <View className="overflow-hidden rounded-3xl border border-border/60 bg-card">
          {groupByDay(rows).map((g) => (
            <View key={g.label}>
              <Text className="px-4 pb-1 pt-3 text-xs text-muted-foreground">{g.label}</Text>
              {g.rows.map((t, i) => (
                <MoneyRow
                  key={t.id}
                  t={t}
                  divided={i > 0}
                  line={t.costItemId ? itemById.get(t.costItemId) ?? null : null}
                  owner={t.mine ? null : nameOf(t.userId)}
                  onOpen={() => setOpenId(t.id)}
                  onToggleHidden={t.mine ? () => apply(t.id, { hidden: !t.hidden }) : undefined}
                />
              ))}
            </View>
          ))}
          {next ? (
            <Pressable accessibilityRole="button" onPress={() => load(next)} className="min-h-12 items-center justify-center border-t border-border/60">
              <Text className="text-sm font-medium text-primary">Show older</Text>
            </Pressable>
          ) : null}
        </View>
      )}
      {!showHidden && rows && rows.length > 0 ? (
        <Text className="text-center text-xs text-muted-foreground">Swipe left to hide a payment. Tap one to file it under a cost.</Text>
      ) : null}

      <TransactionSheet
        t={open}
        items={items}
        owner={open && !open.mine ? nameOf(open.userId) : null}
        onClose={() => setOpenId(null)}
        onPatch={(patch) => {
          if (open) void apply(open.id, patch);
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
  divided,
  onOpen,
  onToggleHidden,
}: {
  t: BankTransactionView;
  line: CostItem | null;
  owner: string | null;
  divided: boolean;
  onOpen: () => void;
  onToggleHidden?: () => void;
}) {
  const body = (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      className={cn('min-h-[52px] flex-row items-center gap-3 bg-card px-4 py-2', divided && 'border-t border-border/60')}
    >
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-sm font-medium text-foreground">
          {t.description}
        </Text>
        <Text numberOfLines={1} className="text-xs text-muted-foreground">
          {rowMeta(t, line, owner)}
        </Text>
      </View>
      <Text className={cn('text-sm', t.amountCents > 0 ? 'text-success' : 'text-foreground')} style={TABULAR}>
        {t.amountCents > 0 ? '+' : ''}
        {formatMoney(Math.abs(t.amountCents), AUD)}
      </Text>
    </Pressable>
  );
  if (!onToggleHidden) return body;
  return (
    <SwipeActions
      onSwipeLeft={onToggleHidden}
      left={{ bg: 'bg-muted', activeBg: 'bg-muted-foreground/30', icon: <EyeOff size={16} className="text-foreground" />, label: t.hidden ? 'Show' : 'Hide' }}
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
    <BottomSheet open={!!t} onOpenChange={(o) => !o && onClose()} className="max-h-[88%] pb-3">
      {t ? (
        <View className="gap-3 px-4 pb-2">
          <View>
            <Text className={cn('text-4xl font-extrabold', t.amountCents > 0 ? 'text-success' : 'text-foreground')} style={TABULAR}>
              {t.amountCents > 0 ? '+' : ''}
              {formatMoney(Math.abs(t.amountCents), AUD)}
            </Text>
            <Text className="text-base font-semibold text-foreground">{t.description}</Text>
            <Text className="text-xs text-muted-foreground">
              {[bankDayLabel(t.occurredAt), t.accountName, t.pending ? 'pending' : 'settled', owner ? `shared by ${owner}` : null]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {t.message ? <Text className="pt-1 text-sm text-muted-foreground">{t.message}</Text> : null}
          </View>

          <View className="rounded-2xl bg-muted/40">
            <View className="min-h-12 flex-row items-center gap-3 px-4 py-2">
              <Text className="flex-1 text-sm text-foreground">Counts as</Text>
              {t.mine && t.amountCents < 0 && !t.isTransfer ? (
                <View className="w-48">
                  <SearchablePicker
                    options={options}
                    value={t.costItemId}
                    onChange={(id) => onPatch({ costItemId: id })}
                    placeholder="Nothing"
                    searchPlaceholder="Search costs…"
                    ariaLabel="Counts as"
                  />
                </View>
              ) : (
                <Text className="text-sm font-semibold text-foreground">{line?.name ?? 'Nothing'}</Text>
              )}
            </View>
            {t.categoryLabel ? (
              <View className="min-h-12 flex-row items-center gap-3 border-t border-border/60 px-4 py-2">
                <Text className="flex-1 text-sm text-foreground">Category</Text>
                <Text className="text-sm text-muted-foreground">{t.categoryLabel}</Text>
              </View>
            ) : null}
            {t.tags.length > 0 ? (
              <View className="min-h-12 flex-row items-center gap-3 border-t border-border/60 px-4 py-2">
                <Text className="flex-1 text-sm text-foreground">Up tags</Text>
                <Text numberOfLines={1} className="text-sm text-muted-foreground">
                  {t.tags.map((x) => `#${x}`).join(' ')}
                </Text>
              </View>
            ) : null}
            {line && t.mine ? (
              <View className="min-h-12 flex-row items-center gap-3 border-t border-border/60 px-4 py-2">
                <View className="min-w-0 flex-1">
                  <Text numberOfLines={1} className="text-sm text-foreground">
                    Always link {t.description} to {line.name}
                  </Text>
                  <Text className="text-xs text-muted-foreground">Next time, the payment lands on the line by itself</Text>
                </View>
                <Switch checked={always} disabled={busy} label="Always link" onChange={(on) => void setAlways(on)} />
              </View>
            ) : null}
            {line && t.linkKind === 'manual' && t.mine ? (
              <Pressable accessibilityRole="button" onPress={() => onPatch({ costItemId: null })} className="min-h-12 justify-center border-t border-border/60 px-4">
                <Text className="text-sm text-muted-foreground">Let the link rules decide</Text>
              </Pressable>
            ) : null}
          </View>

          {line && line.cadence !== 'one_off' && t.amountCents < 0 && paid !== (line.amount ?? 0) ? (
            <View className="min-h-12 flex-row items-center gap-3 rounded-2xl bg-muted/40 px-4 py-2">
              <View className="h-2 w-2 rounded-full bg-warning" />
              <Text className="flex-1 text-sm text-foreground">
                The {line.name} line says {formatMoney(line.amount ?? 0)}
              </Text>
              <Pressable accessibilityRole="button" onPress={() => onSetAmount(line, paid)} hitSlop={8} className="min-h-11 justify-center px-1">
                <Text className="text-sm font-semibold text-primary">Use {formatMoney(paid)}</Text>
              </Pressable>
            </View>
          ) : null}

          {line ? (
            <Pressable accessibilityRole="button" onPress={() => onOpenItem(line)} className="min-h-11 justify-center px-1">
              <Text className="text-sm font-medium text-primary">Open {line.name}</Text>
            </Pressable>
          ) : null}

          {t.mine ? (
            note !== null ? (
              <View className="gap-2">
                <Input
                  autoFocus
                  value={note}
                  maxLength={500}
                  onChangeText={setNote}
                  placeholder="A note for this payment"
                  multiline
                  className="h-20 text-top"
                />
                <View className="flex-row justify-end gap-2">
                  <Pressable accessibilityRole="button" onPress={() => setNote(null)} className="min-h-11 justify-center px-3">
                    <Text className="text-sm text-muted-foreground">Cancel</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      onPatch({ note });
                      setNote(null);
                    }}
                    className="min-h-11 justify-center rounded-xl bg-primary px-4"
                  >
                    <Text className="text-sm font-medium text-primary-foreground">Save note</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <>
                {t.note ? <Text className="px-1 text-sm text-foreground">{t.note}</Text> : null}
                <View className="flex-row gap-2">
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => onPatch({ hidden: !t.hidden })}
                    className="h-12 flex-1 items-center justify-center rounded-xl border border-border"
                  >
                    <Text className="text-sm font-medium text-foreground">{t.hidden ? 'Show in spending' : 'Hide from spending'}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setNote(t.note ?? '')}
                    className="h-12 flex-1 items-center justify-center rounded-xl border border-border"
                  >
                    <Text className="text-sm font-medium text-foreground">{t.note ? 'Edit note' : 'Add a note'}</Text>
                  </Pressable>
                </View>
              </>
            )
          ) : null}
        </View>
      ) : null}
    </BottomSheet>
  );
}
