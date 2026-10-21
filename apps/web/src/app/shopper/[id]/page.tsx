'use client';

// HOUP-434: one Shopper item. The Hero is the cheapest price found (H1), the
// verdict line under it says how good a deal that is, the history card owns
// its range picker (H5), and "Where to buy" lists every store's price,
// nearest stock first at the same price. Plan to buy is the one primary
// action: a to-do (shopper.tasks) and a planned cost (shopper.costs), each
// only while its module is on. Native twin:
// apps/mobile/src/app/shopper/[id].tsx.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { use$ } from '@legendapp/state/react';
import { toast } from 'sonner';
import { ArrowLeft, ExternalLink, Pencil, RefreshCw, X } from 'lucide-react';
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
  type ShopperOffer,
  type ShopperPriceSnapshot,
  type ShopperWant,
  type SourceDeal,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { addManualPrice, lookupWhenSynced, removeManualPrice, shopperSources, wantDeals, type ShopperSourceInfo } from '@/lib/shopper-api';
import { navLinkClickHandler } from '@/lib/view-transitions';
import { HeroLede } from '@/components/ui/hero-lede';
import { ListGroup, ListItem, ListItemContent, ListItemMeta, ListItemTitle, ListItemTrailing } from '@/components/ui/list-item';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { PriceChart, dealToneClass } from '../price-chart';
import { WantFormSheet } from '../want-form-sheet';

type Range = '30' | '90' | '365';
const RANGES: { value: Range; label: string }[] = [
  { value: '30', label: '30d' },
  { value: '90', label: '90d' },
  { value: '365', label: '1y' },
];

export default function ShopperItemPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { group, currentUserId, isOnline } = useDataCache();
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
  const series = useMemo(() => dailyLows(snapshots), [snapshots]);
  const verdict = useMemo(() => dealVerdict(want?.best_cents ?? null, series, today), [want?.best_cents, series, today]);
  const sortedOffers = useMemo(() => sortOffers(offers), [offers]);
  const [range, setRange] = useState<Range>('90');
  const shownSeries = useMemo(() => priceWindow(series, today, Number(range)), [series, today, range]);

  const [checking, setChecking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deals, setDeals] = useState<(SourceDeal & { source: string })[]>([]);
  const [sources, setSources] = useState<ShopperSourceInfo[]>([]);
  const [priceFormOpen, setPriceFormOpen] = useState(false);

  const check = async (quiet = false) => {
    if (!want || checking) return;
    setChecking(true);
    try {
      const res = await lookupWhenSynced(want.id);
      if (!quiet && res) {
        if (res.failed.length) toast.error(`${res.failed.join(', ')} didn't answer. Try again later.`);
        else toast(res.offers ? `Found ${res.offers} price${res.offers === 1 ? '' : 's'}.` : 'No prices found this time.');
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
  useEffect(() => {
    if (wantId && stale && isOnline) void check(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantId, isOnline]);

  useEffect(() => {
    if (!wantId || !isOnline) return;
    wantDeals(wantId).then(setDeals).catch(() => setDeals([]));
    shopperSources().then(setSources).catch(() => setSources([]));
  }, [wantId, isOnline]);

  if (!group) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!want) {
    return (
      <div className="p-6 text-muted-foreground">
        Item not found.{' '}
        <Link href="/shopper" className="text-primary hover:text-primary/80">
          Back to Shopper
        </Link>
      </div>
    );
  }

  const best = sortedOffers[0] ?? null;
  const usual = usualRange(verdict.stats);
  const attribution = Array.from(
    new Set(
      offers.map((o) => (o.source_id === 'manual' ? 'added by you' : sources.find((s) => s.id === o.source_id)?.attribution ?? o.source_id)),
    ),
  );
  const checkedAgo = timeAgo(want.last_checked_at);

  const planToBuy = () => {
    const priceLabel = best ? `${formatMoney(best.price_cents, { currency })} at ${best.store}` : null;
    const made: string[] = [];
    if (tasksLinked) {
      writeTask(buildPlanToBuyTask({ id: crypto.randomUUID(), want, offer: best, priceLabel }));
      made.push('a to-do');
    }
    if (costsLinked) {
      writeCost(buildPlanToBuyCost({ id: crypto.randomUUID(), want, offer: best }));
      made.push('a planned cost');
    }
    toast(`Added ${made.join(' and ')}.`);
  };

  const markBought = () => {
    patchWant(want.id, { status: 'bought', bought_at: new Date().toISOString() });
    toast(`Marked ${want.title} as bought.`, {
      action: { label: 'Undo', onClick: () => patchWant(want.id, { status: 'watching', bought_at: null }) },
    });
  };

  const canPlan = (tasksLinked || costsLinked) && want.status !== 'bought';
  const heroCaption =
    want.best_cents == null ? (checking ? 'Checking prices…' : want.last_checked_at ? 'No prices found yet' : 'Not checked yet') : null;

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 md:p-6 pb-24">
      <div className="flex items-center gap-2">
        <Link
          href="/shopper"
          aria-label="Back to Shopper"
          className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={navLinkClickHandler('back', router, '/shopper')}
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <p className="min-w-0 flex-1 truncate text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{want.title}</p>
        <button
          type="button"
          onClick={() => void check()}
          disabled={checking || !isOnline || want.status === 'bought'}
          aria-label="Check prices now"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <RefreshCw className={cn('h-5 w-5', checking && 'animate-spin motion-reduce:animate-none')} />
        </button>
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="Edit item"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Pencil className="h-5 w-5" />
        </button>
      </div>

      <div className="space-y-1.5">
        <HeroLede
          value={want.best_cents != null ? formatMoney(want.best_cents, { currency }) : '–'}
          label={want.status === 'bought' ? 'last price seen' : best?.distance_m != null ? 'cheapest nearby' : 'cheapest'}
          caption={heroCaption}
        />
        {want.best_cents != null && (
          <p className={cn('text-sm font-semibold', hitTarget(want) ? 'text-success' : dealToneClass(verdict.rating))}>
            {verdictCaption(verdict, want)}
            {verdict.isLow && verdict.rating ? ` · ${DEAL_WINDOW_DAYS}-day low` : ''}
          </p>
        )}
      </div>

      {/* History: one card, its range picker in the header (H5). */}
      <section className="space-y-3 rounded-3xl border border-border/60 bg-card p-4 shadow-[var(--card-shadow)]">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Price history</h2>
          <SegmentedControl ariaLabel="Range" size="sm" value={range} onChange={setRange} options={RANGES} className="w-auto" />
        </div>
        <PriceChart series={shownSeries} usual={usual} rating={verdict.rating} currency={currency} />
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Where to buy</h2>
          <button
            type="button"
            onClick={() => setPriceFormOpen((v) => !v)}
            className="min-h-11 text-sm font-medium text-primary hover:text-primary/80"
          >
            {priceFormOpen ? 'Cancel' : 'Add a price'}
          </button>
        </div>
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
          <p className="px-1 py-4 text-sm text-muted-foreground">
            {checking ? 'Looking for prices…' : 'No prices yet. Add one you found, or check again later.'}
          </p>
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
        {(attribution.length > 0 || checkedAgo) && (
          <p className="px-1 text-xs text-muted-foreground">
            {[attribution.length ? `Prices from ${attribution.join(', ')}` : null, checkedAgo ? `checked ${checkedAgo.toLowerCase()}` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
      </section>

      {deals.length > 0 && (
        <section className="space-y-2">
          <h2 className="px-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Deals people shared</h2>
          <ListGroup>
            {deals.map((d) => (
              <ListItem asChild key={d.url}>
                <a href={d.url} target="_blank" rel="noopener noreferrer">
                  <ListItemContent>
                    <ListItemTitle>
                      <span className="line-clamp-2 whitespace-normal">{d.title}</span>
                    </ListItemTitle>
                    <ListItemMeta>
                      {d.source}
                      {d.posted_at && <span aria-hidden>·</span>}
                      {d.posted_at && <span>{timeAgo(d.posted_at)}</span>}
                    </ListItemMeta>
                  </ListItemContent>
                  <ListItemTrailing>
                    <ExternalLink className="h-4 w-4" />
                  </ListItemTrailing>
                </a>
              </ListItem>
            ))}
          </ListGroup>
        </section>
      )}

      {want.status !== 'bought' && (
        <div className="grid grid-cols-2 gap-2 pt-2">
          <button
            type="button"
            onClick={canPlan ? markBought : () => setEditing(true)}
            className="inline-flex h-12 items-center justify-center rounded-2xl bg-muted px-4 text-sm font-semibold text-foreground hover:bg-accent"
          >
            {canPlan ? 'Mark bought' : 'Set an alert'}
          </button>
          <button
            type="button"
            onClick={canPlan ? planToBuy : markBought}
            className="inline-flex h-12 items-center justify-center rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/80"
          >
            {canPlan ? 'Plan to buy' : 'Mark bought'}
          </button>
        </div>
      )}

      {editing && (
        <WantFormSheet
          isOpen
          want={want}
          groupId={group.id}
          currency={currency}
          onClose={() => setEditing(false)}
          onSave={(next) => writeWant(next)}
          onDelete={(w) => {
            deleteWant(w.id);
            router.push('/shopper');
          }}
        />
      )}
    </div>
  );
}

function OfferRow({ offer, currency, onRemove }: { offer: ShopperOffer; currency: string; onRemove?: () => void }) {
  const meta = [
    formatDistance(offer.distance_m),
    offer.in_stock === true ? 'in stock' : offer.in_stock === false ? 'out of stock' : null,
    offer.source_id === 'manual' ? 'added by you' : null,
  ].filter(Boolean) as string[];
  const body = (
    <>
      <ListItemContent>
        <ListItemTitle>
          <span className="truncate">{offer.store}</span>
        </ListItemTitle>
        {meta.length > 0 && (
          <ListItemMeta>
            <span className={cn('tabular-nums', offer.in_stock === false && 'text-warning')}>{meta.join(' · ')}</span>
          </ListItemMeta>
        )}
      </ListItemContent>
      <ListItemTrailing>
        <span className="text-sm font-semibold tabular-nums text-foreground">{formatMoney(offer.price_cents, { currency })}</span>
        {onRemove && (
          <button
            type="button"
            aria-label={`Remove the price from ${offer.store}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRemove();
            }}
            className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-lg hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </ListItemTrailing>
    </>
  );
  if (!offer.url) return <ListItem>{body}</ListItem>;
  return (
    <ListItem asChild>
      <a href={offer.url} target="_blank" rel="noopener noreferrer">
        {body}
      </a>
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
  const [store, setStore] = useState('');
  const [price, setPrice] = useState('');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const cents = parsePriceInput(price);
  return (
    <form
      className="grid gap-2 rounded-3xl border border-border/60 bg-card p-4 sm:grid-cols-[1fr_8rem]"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!store.trim() || !cents) return;
        setSaving(true);
        await onSubmit(store.trim(), cents, url.trim() || null);
        setSaving(false);
      }}
    >
      <Input aria-label="Store" placeholder="Store" value={store} onChange={(e) => setStore(e.target.value)} autoFocus className="h-11" />
      <Input
        aria-label={`Price in ${currency}`}
        placeholder="Price"
        inputMode="decimal"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        className="h-11"
      />
      <Input aria-label="Link (optional)" placeholder="Link (optional)" value={url} onChange={(e) => setUrl(e.target.value)} className="h-11 sm:col-span-2" />
      <button
        type="submit"
        disabled={disabled || saving || !store.trim() || !cents}
        className="h-11 rounded-xl bg-muted text-sm font-semibold text-foreground hover:bg-accent disabled:opacity-50 sm:col-span-2"
      >
        Save price
      </button>
    </form>
  );
}
