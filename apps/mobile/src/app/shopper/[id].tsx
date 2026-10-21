// HOUP-434: one Shopper item. The Hero is the cheapest price found (H1), the
// verdict line under it says how good a deal that is, the history card owns
// its range picker (H5), and "Where to buy" lists every store's price,
// nearest stock first at the same price. Plan to buy is the one primary
// action: a to-do (shopper.tasks) and a planned cost (shopper.costs), each
// only while its module is on. Web twin: apps/web/src/app/shopper/[id]/page.tsx.
import * as React from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { use$ } from '@legendapp/state/react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, ExternalLink, Pencil, RefreshCw, X } from 'lucide-react-native';
import {
  Text,
  Button,
  Card,
  HeroLede,
  Input,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
  ScreenBackground,
  SegmentedControl,
  cn,
  toast,
} from '@homeup/ui';
import {
  shopperWants$,
  shopperOffers$,
  shopperPriceSnapshots$,
  householdTasks$,
  costItems$,
  syncedGroupId,
  useModules,
  useReconnectSync,
  useStoreHelpers,
  useHouseholdCurrency,
  dailyLows,
  dealVerdict,
  priceWindow,
  usualRange,
  verdictCaption,
  sortOffers,
  formatMoney,
  formatDistance,
  isWantStale,
  hitTarget,
  parsePriceInput,
  timeAgo,
  todayISO,
  buildPlanToBuyTask,
  buildPlanToBuyCost,
  DEAL_WINDOW_DAYS,
  MOTION_DURATIONS_MS,
  type ShopperOffer,
  type ShopperPriceSnapshot,
  type ShopperWant,
  type SourceDeal,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { NoGroupScreen } from '@/components/no-group-screen';
import { useOpenRoute } from '@/lib/tab-routes';
import { randomUUID } from '@/lib/uuid';
import { PriceChart, dealToneClass } from '@/features/shopper/price-chart';
import { WantFormSheet } from '@/features/shopper/want-form-sheet';
import {
  addManualPrice,
  lookupWhenSynced,
  removeManualPrice,
  shopperSources,
  wantDeals,
  type ShopperSourceInfo,
} from '@/features/shopper/shopper-api';

type Range = '30' | '90' | '365';
const RANGES: { value: Range; label: string }[] = [
  { value: '30', label: '30d' },
  { value: '90', label: '90d' },
  { value: '365', label: '1y' },
];

export default function ShopperItemScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const openRoute = useOpenRoute();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { group, currentUserId, isOnline, loading: cacheLoading } = useDataCache();
  const currency = useHouseholdCurrency();
  const modules = useModules();
  const tasksLinked = modules.feature('shopper.tasks');
  const costsLinked = modules.feature('shopper.costs');

  const wants$ = shopperWants$(group?.id);
  const offers$ = shopperOffers$(group?.id);
  const snaps$ = shopperPriceSnapshots$(group?.id);
  const tasks$ = householdTasks$(tasksLinked ? syncedGroupId(householdTasks$, group?.id, modules.enabled) : undefined);
  const costs$ = costItems$(costsLinked ? syncedGroupId(costItems$, group?.id, modules.enabled) : undefined);
  useReconnectSync(wants$);
  useReconnectSync(offers$);
  useReconnectSync(snaps$);
  const { writeRow: writeWant, patchRow: patchWant, softDeleteRow: deleteWant } = useStoreHelpers(wants$, currentUserId);
  const { writeRow: writeTask } = useStoreHelpers(tasks$, currentUserId);
  const { writeRow: writeCost } = useStoreHelpers(costs$, currentUserId);

  const want = use$(() => {
    const w = wants$.get()?.[id];
    return w && !w.deleted ? (w as ShopperWant) : null;
  });
  const offers = use$(() =>
    Object.values(offers$.get() ?? {}).filter((o): o is ShopperOffer => !!o && !o.deleted && o.want_id === id),
  );
  const snapshots = use$(() =>
    Object.values(snaps$.get() ?? {}).filter((s): s is ShopperPriceSnapshot => !!s && !s.deleted && s.want_id === id),
  );

  const today = todayISO();
  const series = React.useMemo(() => dailyLows(snapshots), [snapshots]);
  const verdict = React.useMemo(() => dealVerdict(want?.best_cents ?? null, series, today), [want?.best_cents, series, today]);
  const sortedOffers = React.useMemo(() => sortOffers(offers), [offers]);
  const [range, setRange] = React.useState<Range>('90');
  const shownSeries = React.useMemo(() => priceWindow(series, today, Number(range)), [series, today, range]);

  const [checking, setChecking] = React.useState(false);
  const [editMounted, setEditMounted] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [deals, setDeals] = React.useState<(SourceDeal & { source: string })[]>([]);
  const [sources, setSources] = React.useState<ShopperSourceInfo[]>([]);
  const [priceFormOpen, setPriceFormOpen] = React.useState(false);

  const openEdit = () => {
    setEditMounted(true);
    setEditOpen(true);
  };
  const closeEdit = () => {
    setEditOpen(false);
    setTimeout(() => setEditMounted(false), MOTION_DURATIONS_MS.exit);
  };

  const check = async (quiet = false) => {
    if (!want || checking) return;
    setChecking(true);
    try {
      const res = await lookupWhenSynced(want.id);
      if (!quiet && res) {
        if (res.failed.length) toast.error(`${res.failed.join(', ')} didn't answer. Try again later.`);
        else toast.message(res.offers ? `Found ${res.offers} price${res.offers === 1 ? '' : 's'}.` : 'No prices found this time.');
      }
    } catch (err) {
      if (!quiet) toast.error(err instanceof Error ? err.message : 'Could not check prices.');
    } finally {
      setChecking(false);
    }
  };

  // Opening an item whose last check is stale checks it again, once.
  const wantId = want?.id;
  const stale = want ? isWantStale(want) && want.status === 'watching' : false;
  React.useEffect(() => {
    if (wantId && stale && isOnline) void check(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantId, isOnline]);

  React.useEffect(() => {
    if (!wantId || !isOnline) return;
    wantDeals(wantId).then(setDeals).catch(() => setDeals([]));
    shopperSources().then(setSources).catch(() => setSources([]));
  }, [wantId, isOnline]);

  if (cacheLoading) {
    return (
      <ScreenBackground className="items-center justify-center">
        <ActivityIndicator />
      </ScreenBackground>
    );
  }
  if (!group) return <NoGroupScreen />;
  if (!want) {
    return (
      <ScreenBackground className="items-center justify-center gap-3 p-6">
        <Text className="text-muted-foreground">Item not found.</Text>
        <Button variant="outline" size="sm" onPress={() => openRoute('/shopper')}>
          <Text className="text-sm font-medium text-foreground">Back to Shopper</Text>
        </Button>
      </ScreenBackground>
    );
  }

  const best = sortedOffers[0] ?? null;
  const usual = usualRange(verdict.stats);
  const attribution = Array.from(
    new Set(
      offers.map((o) =>
        o.source_id === 'manual' ? 'added by you' : sources.find((s) => s.id === o.source_id)?.attribution ?? o.source_id,
      ),
    ),
  );
  const checkedAgo = timeAgo(want.last_checked_at);

  const planToBuy = () => {
    const priceLabel = best ? `${formatMoney(best.price_cents, { currency })} at ${best.store}` : null;
    const made: string[] = [];
    if (tasksLinked) {
      writeTask(buildPlanToBuyTask({ id: randomUUID(), want, offer: best, priceLabel }));
      made.push('a to-do');
    }
    if (costsLinked) {
      writeCost(buildPlanToBuyCost({ id: randomUUID(), want, offer: best }));
      made.push('a planned cost');
    }
    toast.success(`Added ${made.join(' and ')}.`);
  };

  const markBought = () => {
    patchWant(want.id, { status: 'bought', bought_at: new Date().toISOString() });
    toast.message(`Marked ${want.title} as bought.`, {
      action: { label: 'Undo', onPress: () => patchWant(want.id, { status: 'watching', bought_at: null }) },
    });
  };

  const canPlan = (tasksLinked || costsLinked) && want.status !== 'bought';
  const heroCaption =
    want.best_cents == null ? (checking ? 'Checking prices…' : want.last_checked_at ? 'No prices found yet' : 'Not checked yet') : undefined;

  return (
    <ScreenBackground>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 p-4"
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            className="-ml-2 h-11 w-11 items-center justify-center rounded-lg"
          >
            <ArrowLeft size={20} className="text-muted-foreground" />
          </Pressable>
          <Text numberOfLines={1} className="min-w-0 flex-1 text-micro-label uppercase text-muted-foreground">
            {want.title}
          </Text>
          <Pressable
            onPress={() => void check()}
            disabled={checking || !isOnline || want.status === 'bought'}
            accessibilityRole="button"
            accessibilityLabel="Check prices now"
            className={cn('h-11 w-11 items-center justify-center rounded-lg', (!isOnline || want.status === 'bought') && 'opacity-40')}
          >
            {checking ? <ActivityIndicator size="small" /> : <RefreshCw size={18} className="text-muted-foreground" />}
          </Pressable>
          <Pressable
            onPress={openEdit}
            accessibilityRole="button"
            accessibilityLabel="Edit item"
            className="h-11 w-11 items-center justify-center rounded-lg"
          >
            <Pencil size={18} className="text-muted-foreground" />
          </Pressable>
        </View>

        <View className="gap-1.5">
          <HeroLede
            value={want.best_cents != null ? formatMoney(want.best_cents, { currency }) : '–'}
            label={want.status === 'bought' ? 'last price seen' : best?.distance_m != null ? 'cheapest nearby' : 'cheapest'}
            caption={heroCaption}
          />
          {want.best_cents != null && (
            <Text className={cn('text-sm font-semibold', hitTarget(want) ? 'text-success' : dealToneClass(verdict.rating))}>
              {verdictCaption(verdict, want)}
              {verdict.isLow && verdict.rating ? ` · ${DEAL_WINDOW_DAYS}-day low` : ''}
            </Text>
          )}
        </View>

        {/* History: one card, its range picker in the header (H5). */}
        <Card className="gap-3 rounded-3xl px-4">
          <View className="flex-row items-center justify-between gap-3">
            <Text className="text-micro-label uppercase text-muted-foreground">Price history</Text>
            <SegmentedControl accessibilityLabel="Range" size="sm" fitContent value={range} onChange={setRange} options={RANGES} />
          </View>
          <PriceChart series={shownSeries} usual={usual} rating={verdict.rating} currency={currency} />
        </Card>

        <View className="gap-2">
          <View className="flex-row items-center justify-between px-1">
            <Text className="text-micro-label uppercase text-muted-foreground">Where to buy</Text>
            <Pressable
              onPress={() => setPriceFormOpen((v) => !v)}
              accessibilityRole="button"
              hitSlop={8}
              className="min-h-11 justify-center"
            >
              <Text className="text-sm font-medium text-primary">{priceFormOpen ? 'Cancel' : 'Add a price'}</Text>
            </Pressable>
          </View>
          {priceFormOpen && (
            <ManualPriceForm
              currency={currency}
              disabled={!isOnline}
              onSubmit={async (store, cents, url) => {
                try {
                  await addManualPrice({ wantId: want.id, store, price_cents: cents, url });
                  setPriceFormOpen(false);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Could not save the price.');
                }
              }}
            />
          )}
          {sortedOffers.length === 0 ? (
            <Text className="px-1 py-4 text-sm text-muted-foreground">
              {checking ? 'Looking for prices…' : 'No prices yet. Add one you found, or check again later.'}
            </Text>
          ) : (
            <ListGroup>
              {sortedOffers.map((o) => (
                <OfferRow
                  key={o.id}
                  offer={o}
                  currency={currency}
                  onRemove={o.source_id === 'manual' ? () => void removeManualPrice(want.id, o.id).catch(() => {}) : undefined}
                />
              ))}
            </ListGroup>
          )}
          {(attribution.length > 0 || !!checkedAgo) && (
            <Text className="px-1 text-xs text-muted-foreground">
              {[attribution.length ? `Prices from ${attribution.join(', ')}` : null, checkedAgo ? `checked ${checkedAgo.toLowerCase()}` : null]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          )}
        </View>

        {deals.length > 0 && (
          <View className="gap-2">
            <Text className="px-1 text-micro-label uppercase text-muted-foreground">Deals people shared</Text>
            <ListGroup>
              {deals.map((d) => (
                <ListItem key={d.url} onPress={() => void Linking.openURL(d.url)} accessibilityRole="link">
                  <ListItemContent>
                    <ListItemTitle numberOfLines={2}>{d.title}</ListItemTitle>
                    <ListItemMeta>
                      <Text className="text-caption text-muted-foreground">
                        {d.source}
                        {d.posted_at ? ` · ${timeAgo(d.posted_at)}` : ''}
                      </Text>
                    </ListItemMeta>
                  </ListItemContent>
                  <ListItemTrailing>
                    <ExternalLink size={16} className="text-muted-foreground" />
                  </ListItemTrailing>
                </ListItem>
              ))}
            </ListGroup>
          </View>
        )}

        {want.status !== 'bought' && (
          <View className="flex-row gap-2 pt-2">
            <Button variant="secondary" className="h-12 flex-1 rounded-2xl" onPress={canPlan ? markBought : openEdit}>
              <Text className="text-sm font-semibold text-foreground">{canPlan ? 'Mark bought' : 'Set an alert'}</Text>
            </Button>
            <Button className="h-12 flex-1 rounded-2xl" onPress={canPlan ? planToBuy : markBought}>
              <Text className="text-sm font-semibold text-primary-foreground">{canPlan ? 'Plan to buy' : 'Mark bought'}</Text>
            </Button>
          </View>
        )}
      </ScrollView>

      {editMounted && (
        <WantFormSheet
          open={editOpen}
          onOpenChange={(next) => {
            if (!next) closeEdit();
          }}
          want={want}
          groupId={group.id}
          currency={currency}
          onSave={(next) => writeWant(next)}
          onDelete={(w) => {
            deleteWant(w.id);
            openRoute('/shopper');
          }}
        />
      )}
    </ScreenBackground>
  );
}

function OfferRow({ offer, currency, onRemove }: { offer: ShopperOffer; currency: string; onRemove?: () => void }) {
  const meta = [
    formatDistance(offer.distance_m),
    offer.in_stock === true ? 'in stock' : offer.in_stock === false ? 'out of stock' : null,
    offer.source_id === 'manual' ? 'added by you' : null,
  ].filter(Boolean) as string[];
  const url = offer.url;
  return (
    <ListItem onPress={url ? () => void Linking.openURL(url) : undefined} accessibilityRole={url ? 'link' : undefined}>
      <ListItemContent>
        <ListItemTitle numberOfLines={1}>{offer.store}</ListItemTitle>
        {meta.length > 0 && (
          <ListItemMeta>
            <Text
              className={cn('text-caption', offer.in_stock === false ? 'text-warning' : 'text-muted-foreground')}
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {meta.join(' · ')}
            </Text>
          </ListItemMeta>
        )}
      </ListItemContent>
      <ListItemTrailing>
        <Text className="text-sm font-semibold text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
          {formatMoney(offer.price_cents, { currency })}
        </Text>
        {onRemove && (
          <Pressable
            onPress={onRemove}
            accessibilityRole="button"
            accessibilityLabel={`Remove the price from ${offer.store}`}
            hitSlop={8}
            className="-mr-2 h-9 w-9 items-center justify-center rounded-lg"
          >
            <X size={16} className="text-muted-foreground" />
          </Pressable>
        )}
      </ListItemTrailing>
    </ListItem>
  );
}

function ManualPriceForm({
  currency,
  disabled,
  onSubmit,
}: {
  currency: string;
  disabled: boolean;
  onSubmit: (store: string, cents: number, url: string | null) => Promise<void>;
}) {
  const [store, setStore] = React.useState('');
  const [price, setPrice] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const cents = parsePriceInput(price);
  const submit = async () => {
    if (!store.trim() || !cents) return;
    setSaving(true);
    await onSubmit(store.trim(), cents, url.trim() || null);
    setSaving(false);
  };
  return (
    <Card className="gap-2 rounded-3xl px-4">
      <View className="flex-row gap-2">
        <Input accessibilityLabel="Store" placeholder="Store" value={store} onChangeText={setStore} autoFocus className="flex-1" />
        <Input
          accessibilityLabel={`Price in ${currency}`}
          placeholder="Price"
          keyboardType="decimal-pad"
          value={price}
          onChangeText={setPrice}
          className="w-28"
        />
      </View>
      <Input
        accessibilityLabel="Link (optional)"
        placeholder="Link (optional)"
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        keyboardType="url"
      />
      <Button variant="secondary" onPress={() => void submit()} disabled={disabled || saving || !store.trim() || !cents}>
        <Text className="text-sm font-semibold text-foreground">Save price</Text>
      </Button>
    </Card>
  );
}
