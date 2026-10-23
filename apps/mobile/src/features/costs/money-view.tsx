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
// Web twin: apps/web/src/app/costs/money-view.tsx.
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { ArrowRight, ChevronLeft, ChevronRight, EyeOff } from 'lucide-react-native';
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
  haptics,
  toast,
} from '@homeup/ui';
import {
  CATEGORY_META,
  bankDayLabel,
  formatMoney,
  groupByDay,
  monthLabel,
  monthStartOf,
  paymentCategory,
  paymentCategoryLabel,
  shiftMonth,
  useUpConnected,
  useUpOverview,
  useMoneyTransactions,
  useTransactionSheet,
  bankRowMeta,
  type BankTransactionPatch,
  type MakeCostPreview,
  type BankTransactionView,
  type CostItem,
  costPaymentMenu,
  likelyCostCategories,
  useCostCategoryChoices,
  useModules,
  type CostCategory,
} from '@homeup/core';
import { upBankApi } from './up-bank-api';
import { CategoryGrid, CategoryPickerSheet, type CategoryPick } from './category-picker';
import { CostRowSheet, type CostRowSheetState } from './cost-row-sheet';

const AUD = { currency: 'AUD' };
const TABULAR = { fontVariant: ['tabular-nums' as const] };

export type CostsView = 'plan' | 'money';

export function CostsViewSwitch({ value, onChange }: { value: CostsView; onChange: (v: CostsView) => void }) {
  const connected = useUpConnected();
  const { linking, scope, setScope } = useUpOverview();
  if (!connected || !linking) return null;
  return (
    <View className="gap-2">
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
      {/* Household (joint, shared) or Mine (personal accounts) for the Up card and Money. */}
      {scope ? (
        <SegmentedControl
          accessibilityLabel="Whose money"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'household', label: 'Household' },
            { value: 'mine', label: 'Mine' },
          ]}
          size="sm"
        />
      ) : null}
    </View>
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
  const { status, data, month, setMonth } = useUpOverview();
  const {
    rows,
    error,
    showHidden,
    setShowHidden,
    setOpenId,
    query,
    setQuery,
    category,
    setCategory,
    direction,
    setDirection,
    itemById,
    load,
    apply,
    moveTo,
    madeCost,
    accounts,
    total,
    open,
    shown,
    income,
  } = useMoneyTransactions(upBankApi, items, (m) => toast.message(m));
  const [rowSheet, setRowSheet] = useState<CostRowSheetState | null>(null);
  const [pick, setPick] = useState<CategoryPick | null>(null);
  const quickMove = useModules().server('costs.quick-move');
  const choices = useCostCategoryChoices();
  const thisMonth = monthStartOf(new Date());

  const pickFor = (t: BankTransactionView) => {
    const current = paymentCategory(t, itemById);
    haptics.select();
    setPick({
      title: `Move ${t.description}`,
      current,
      likely: likelyCostCategories({ sourceCategory: t.category }, current, null, choices),
      scope: { label: `Every payment at ${t.description}`, hint: 'Off moves this payment only' },
      onPick: (c, whole) => void moveTo(t, c, whole),
    });
  };
  const menuFor = (t: BankTransactionView) => {
    haptics.commit();
    const current = paymentCategory(t, itemById);
    setRowSheet({
      category: current,
      amount: `${t.amountCents > 0 ? '+' : ''}${formatMoney(Math.abs(t.amountCents), AUD)}`,
      meta: bankRowMeta(t, t.costItemId ? itemById.get(t.costItemId) ?? null : null, paymentCategoryLabel(t, itemById), t.mine ? null : nameOf(t.userId)),
      menu: costPaymentMenu({
        t,
        category: current,
        choices,
        quickMove,
        onMove: (c) => void moveTo(t, c, false),
        onOpen: () => setOpenId(t.id),
        onHide: t.mine ? () => void apply(t.id, { hidden: !t.hidden }) : null,
      }),
    });
  };

  if (status && !status.connection) return <Text className="text-sm text-muted-foreground">Connect Up in Settings, Connectors to see your money here.</Text>;
  if (!data) return <Text className="text-sm text-muted-foreground">Reading your Up accounts…</Text>;
  const monthName = monthLabel(month);

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

      <View className="flex-row items-center gap-1">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          onPress={() => setMonth(shiftMonth(month, -1))}
          className="h-11 w-11 items-center justify-center"
        >
          <ChevronLeft size={20} className="text-muted-foreground" />
        </Pressable>
        <Text className="min-w-24 text-center text-sm font-semibold text-foreground">{monthName}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          disabled={month >= thisMonth}
          onPress={() => setMonth(shiftMonth(month, 1))}
          className={cn('h-11 w-11 items-center justify-center', month >= thisMonth && 'opacity-30')}
        >
          <ChevronRight size={20} className="text-muted-foreground" />
        </Pressable>
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder="Search or #tag"
          accessibilityLabel="Search transactions"
          returnKeyType="search"
          className="ml-1 h-10 flex-1 rounded-xl"
        />
      </View>

      <SegmentedControl
        accessibilityLabel="Which way the money went"
        value={direction}
        onChange={setDirection}
        options={[
          { value: 'all', label: 'All' },
          { value: 'out', label: 'Out' },
          { value: 'in', label: 'In' },
        ]}
        size="sm"
      />

      {data.categories.length > 0 && direction !== 'in' ? (
        <View className="flex-row flex-wrap gap-2">
          {data.categories.slice(0, 8).map((c) => (
            <Pressable
              key={c.id}
              accessibilityRole="button"
              accessibilityState={{ selected: category === c.id }}
              onPress={() => setCategory((cur) => (cur === c.id ? null : c.id))}
              className={cn('min-h-9 justify-center rounded-full px-3', category === c.id ? 'bg-foreground' : 'bg-muted/60')}
            >
              <Text className={cn('text-xs', category === c.id ? 'text-background' : 'text-muted-foreground')} style={TABULAR}>
                {c.label} {formatMoney(c.cents, AUD)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {income && income.sources.length > 0 ? (
        <View className="gap-2">
          <View className="flex-row items-center justify-between px-1">
            <Text className="text-[10.5px] font-medium uppercase tracking-[1px] text-muted-foreground">Money in</Text>
            <Text className="text-sm font-semibold text-success" style={TABULAR}>
              +{formatMoney(income.totalCents, AUD)}
            </Text>
          </View>
          <View className="rounded-3xl border border-border/60 bg-card px-4">
            {income.sources.slice(0, 6).map((src, i) => (
              <View key={src.label} className={cn('min-h-12 flex-row items-center gap-3 py-2', i > 0 && 'border-t border-border/60')}>
                <Text numberOfLines={1} className="min-w-0 flex-1 text-sm text-foreground">
                  {src.label}
                  {src.count > 1 ? <Text className="text-muted-foreground"> · {src.count} times</Text> : null}
                </Text>
                <Text className="text-sm text-foreground" style={TABULAR}>
                  {formatMoney(src.cents, AUD)}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View className="flex-row items-center justify-between px-1">
        <Text className="text-[10.5px] font-medium uppercase tracking-[1px] text-muted-foreground">
          {showHidden ? 'Hidden from spending' : 'Transactions'}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => setShowHidden((v) => !v)} hitSlop={8} className="min-h-11 justify-center px-1">
          <Text className="text-sm font-semibold text-primary">{showHidden ? 'Back to spending' : 'Hidden'}</Text>
        </Pressable>
      </View>

      {error ? <Text className="px-1 text-xs text-destructive">{error}</Text> : null}
      {shown === null ? (
        <Text className="px-1 text-sm text-muted-foreground">Reading your transactions…</Text>
      ) : shown.length === 0 ? (
        <Text className="px-1 text-sm text-muted-foreground">
          {query || category || direction !== 'all' ? 'Nothing matches.' : showHidden ? 'Nothing hidden.' : `No transactions in ${monthName}.`}
        </Text>
      ) : (
        <View className="overflow-hidden rounded-3xl border border-border/60 bg-card">
          {groupByDay(shown).map((g) => (
            <View key={g.label}>
              <Text className="px-4 pb-1 pt-3 text-xs text-muted-foreground">{g.label}</Text>
              {g.rows.map((t, i) => (
                <MoneyRow
                  key={t.id}
                  t={t}
                  divided={i > 0}
                  line={t.costItemId ? itemById.get(t.costItemId) ?? null : null}
                  categoryLabel={paymentCategoryLabel(t, itemById)}
                  owner={t.mine ? null : nameOf(t.userId)}
                  onOpen={() => setOpenId(t.id)}
                  onToggleHidden={t.mine ? () => apply(t.id, { hidden: !t.hidden }) : undefined}
                  onMove={t.mine && quickMove && t.amountCents < 0 && !t.isTransfer ? () => pickFor(t) : undefined}
                  onMenu={() => menuFor(t)}
                />
              ))}
            </View>
          ))}
        </View>
      )}
      {!showHidden && rows && rows.length > 0 ? (
        <Text className="text-center text-xs text-muted-foreground">
          {quickMove ? 'Swipe right to move a payment, left to hide it. Hold one for more.' : 'Swipe left to hide a payment. Tap one to file it under a cost.'}
        </Text>
      ) : null}

      <TransactionSheet
        t={open}
        items={items}
        owner={open && !open.mine ? nameOf(open.userId) : null}
        onClose={() => setOpenId(null)}
        onPatch={(patch) => {
          if (open) void apply(open.id, patch);
        }}
        onMadeCost={madeCost}
        onOpenItem={(item) => {
          setOpenId(null);
          onOpenItem(item);
        }}
        onSetAmount={onSetAmount}
        onShopMoved={() => void load()}
      />
      <CostRowSheet state={rowSheet} choices={choices} onClose={() => setRowSheet(null)} />
      <CategoryPickerSheet pick={pick} choices={choices} onClose={() => setPick(null)} />
    </View>
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
  divided,
  onOpen,
  onToggleHidden,
  onMove,
  onMenu,
}: {
  t: BankTransactionView;
  line: CostItem | null;
  categoryLabel: string | null;
  owner: string | null;
  divided: boolean;
  onOpen: () => void;
  onToggleHidden?: () => void;
  onMove?: () => void;
  onMenu: () => void;
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
          {bankRowMeta(t, line, categoryLabel, owner)}
        </Text>
      </View>
      <Text className={cn('text-sm', t.amountCents > 0 ? 'text-success' : 'text-foreground')} style={TABULAR}>
        {t.amountCents > 0 ? '+' : ''}
        {formatMoney(Math.abs(t.amountCents), AUD)}
      </Text>
    </Pressable>
  );
  return (
    <SwipeActions
      onLongPress={onMenu}
      onSwipeLeft={onToggleHidden}
      left={onToggleHidden ? { bg: 'bg-muted', activeBg: 'bg-muted-foreground/30', icon: <EyeOff size={16} className="text-foreground" />, label: t.hidden ? 'Show' : 'Hide' } : undefined}
      onSwipeRight={onMove}
      right={onMove ? { bg: 'bg-muted', activeBg: 'bg-muted-foreground/30', icon: <ArrowRight size={16} className="text-foreground" />, label: 'Move' } : undefined}
    >
      {body}
    </SwipeActions>
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
  const quickMove = useModules().server('costs.quick-move');
  const choices = useCostCategoryChoices();
  const sheet = useTransactionSheet(upBankApi, { t, items, quickMove, onPatch, onMadeCost, onShopMoved, notify: (m) => toast.message(m) });
  const {
    note,
    setNote,
    busy,
    making,
    setMaking,
    costName,
    setCostName,
    linkPayee,
    setLinkPayee,
    sheetError,
    moving,
    setMoving,
    wholeShop,
    setWholeShop,
    canMove,
    startMaking,
    saveCost,
    line,
    category,
    always,
    options,
    paid,
    setAlways,
  } = sheet;
  const moveTo = (c: CostCategory) => {
    haptics.tick();
    void sheet.moveTo(c);
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
            {t.amountCents < 0 && !t.isTransfer ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: moving }}
                  disabled={!canMove}
                  onPress={() => setMoving((v) => !v)}
                  className="min-h-12 flex-row items-center gap-3 px-4 py-2"
                >
                  <Text className="flex-1 text-sm text-foreground">Category</Text>
                  <View className="items-end">
                    <Text className={cn('text-sm', canMove ? 'font-medium text-foreground' : 'text-muted-foreground')}>{category ? CATEGORY_META[category].label : 'None yet'}</Text>
                    {t.costCategory ? (
                      <Text className="text-xs text-muted-foreground">picked for this payment</Text>
                    ) : line ? (
                      <Text className="text-xs text-muted-foreground">from the {line.name} line</Text>
                    ) : t.categoryLabel ? (
                      <Text className="text-xs text-muted-foreground">from Up: {t.categoryLabel}</Text>
                    ) : null}
                  </View>
                  {canMove ? <ChevronRight size={14} className={cn('text-muted-foreground', moving && 'rotate-90')} /> : null}
                </Pressable>
                {moving ? (
                  <View className="gap-2 px-3 pb-3">
                    <CategoryGrid choices={choices} current={category} onPick={(c) => void moveTo(c)} />
                    <View className="min-h-12 flex-row items-center gap-3 px-1">
                      <View className="min-w-0 flex-1">
                        <Text className="text-sm text-foreground">Every payment at {t.description}</Text>
                        <Text className="text-xs text-muted-foreground">{wholeShop ? 'Later ones too' : 'Off moves this payment only'}</Text>
                      </View>
                      <Switch checked={wholeShop} label="Every payment at this shop" onChange={setWholeShop} />
                    </View>
                    {t.costCategory ? (
                      <Pressable accessibilityRole="button" onPress={() => { setMoving(false); onPatch({ costCategory: null }); }} className="min-h-11 justify-center px-1">
                        <Text className="text-sm text-muted-foreground">Go back to the shop's category</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </>
            ) : null}
            <View className={cn('min-h-12 flex-row items-center gap-3 px-4 py-2', t.amountCents < 0 && !t.isTransfer && 'border-t border-border/60')}>
              <Text className="flex-1 text-sm text-foreground">Bill or cost line</Text>
              {t.mine && t.amountCents < 0 && !t.isTransfer ? (
                <View className="w-48">
                  <SearchablePicker
                    options={options}
                    value={t.costItemId}
                    onChange={(id) => onPatch({ costItemId: id })}
                    placeholder="Nothing"
                    searchPlaceholder="Search costs…"
                    ariaLabel="Bill or cost line"
                  />
                </View>
              ) : (
                <Text className="text-sm font-semibold text-foreground">{line?.name ?? 'Nothing'}</Text>
              )}
            </View>
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

          {!line && t.mine && t.amountCents < 0 && !t.isTransfer ? (
            making ? (
              <View className="gap-2 rounded-2xl bg-muted/40 px-4 py-3">
                <Input value={costName} maxLength={200} onChangeText={setCostName} accessibilityLabel="Cost name" className="h-10 rounded-xl" />
                <Text className="text-xs text-muted-foreground" style={TABULAR}>
                  {[
                    `${making.estimate ? 'About ' : ''}${formatMoney(making.amountCents)} ${CADENCE_WORD[making.cadence]}`,
                    CATEGORY_META[making.category]?.label ?? making.category,
                    making.seen > 1 ? `${making.seen} payments in the last year` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                <View className="min-h-12 flex-row items-center gap-3">
                  <Text className="flex-1 text-sm text-foreground">Also file future payments to {t.description}</Text>
                  <Switch checked={linkPayee} label="Also file future payments" onChange={setLinkPayee} />
                </View>
                <View className="flex-row justify-end gap-2">
                  <Pressable accessibilityRole="button" onPress={() => setMaking(null)} className="min-h-11 justify-center px-3">
                    <Text className="text-sm text-muted-foreground">Cancel</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => void saveCost()}
                    className={cn('min-h-11 justify-center rounded-xl bg-primary px-4', busy && 'opacity-50')}
                  >
                    <Text className="text-sm font-medium text-primary-foreground">Add the cost</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => void startMaking()} className="min-h-11 justify-center px-1">
                <Text className={cn('text-sm font-medium text-primary', busy && 'opacity-50')}>Make it a cost</Text>
              </Pressable>
            )
          ) : null}
          {sheetError ? <Text className="px-1 text-xs text-destructive">{sheetError}</Text> : null}

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
              <Text className="text-sm font-medium text-primary">Edit the {line.name} line</Text>
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
