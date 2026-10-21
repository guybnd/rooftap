'use client';

// HOUP-434: Shopper, the household's list of things to buy. The Hero counts
// what is at a good price now (H1); the segmented control sits on the list it
// filters (H5); each row carries its deal word and trend. Prices come from
// the server's sources into the synced offer and snapshot stores.
// Native twin: apps/mobile/src/app/(tabs)/shopper/index.tsx.
import { useEffect, useMemo, useState } from 'react';
import { use$ } from '@legendapp/state/react';
import { toast } from 'sonner';
import { Plus, ShoppingBag } from 'lucide-react';
import {
  shopperWants$,
  shopperPriceSnapshots$,
  useReconnectSync,
  useStoreHelpers,
  useStoreLoaded,
  useHouseholdCurrency,
  summarizeWants,
  sortWatching,
  isGoodNow,
  hitTarget,
  todayISO,
  type ShopperWant,
  type ShopperWantStatus,
  type ShopperPriceSnapshot,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { lookupWhenSynced, shopperSources } from '@/lib/shopper-api';
import { HeroLede } from '@/components/ui/hero-lede';
import { ListGroup } from '@/components/ui/list-item';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { EmptyState } from '@/components/ui/empty-state';
import { OfflineHint } from '@/components/offline-hint';
import { WantRow } from './want-row';
import { WantFormSheet } from './want-form-sheet';

const TABS: { value: ShopperWantStatus; label: string }[] = [
  { value: 'watching', label: 'Watching' },
  { value: 'idea', label: 'Ideas' },
  { value: 'bought', label: 'Bought' },
];

export default function ShopperPage() {
  const { group, currentUserId, isOnline, loading: cacheLoading } = useDataCache();
  const currency = useHouseholdCurrency();
  const wants$ = shopperWants$(group?.id);
  const snaps$ = shopperPriceSnapshots$(group?.id);
  useReconnectSync(wants$);
  useReconnectSync(snaps$);
  const { writeRow } = useStoreHelpers(wants$, currentUserId);
  const storeLoaded = useStoreLoaded(wants$, snaps$);

  const wants = use$(() => Object.values(wants$.get() ?? {}).filter((w): w is ShopperWant => !!w && !w.deleted));
  const snapshots = use$(() =>
    Object.values(snaps$.get() ?? {}).filter((s): s is ShopperPriceSnapshot => !!s && !s.deleted),
  );
  const rows = useMemo(() => summarizeWants(wants, snapshots, todayISO()), [wants, snapshots]);

  const [tab, setTab] = useState<ShopperWantStatus>('watching');
  const [adding, setAdding] = useState(false);
  const [canSearch, setCanSearch] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isOnline) return;
    shopperSources()
      .then((sources) => setCanSearch(sources.some((s) => s.capabilities.includes('offers'))))
      .catch(() => setCanSearch(null));
  }, [isOnline]);

  const shown = useMemo(() => {
    const inTab = rows.filter((r) => r.want.status === tab);
    if (tab === 'watching') return sortWatching(inTab);
    if (tab === 'bought') return inTab.sort((a, b) => (b.want.bought_at ?? '').localeCompare(a.want.bought_at ?? ''));
    return inTab.sort((a, b) => a.want.title.localeCompare(b.want.title));
  }, [rows, tab]);

  const watching = rows.filter((r) => r.want.status === 'watching');
  const goodNow = watching.filter(isGoodNow).length;
  const targetsHit = watching.filter((r) => hitTarget(r.want)).length;

  const save = (want: ShopperWant, isNew: boolean) => {
    writeRow(want);
    if (isNew && want.status === 'watching' && isOnline) {
      lookupWhenSynced(want.id)
        .then((res) => {
          if (res && res.offers === 0 && res.sources.length) toast(`No prices found for ${want.title} yet.`);
        })
        .catch((err) => toast.error(err instanceof Error ? err.message : 'Could not check prices.'));
    }
  };

  if (cacheLoading || (!storeLoaded && wants.length === 0)) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!group) return <div className="p-6 text-muted-foreground">No group selected</div>;

  const caption = [
    `${watching.length} watching`,
    targetsHit > 0 ? `${targetsHit} hit your target` : null,
    canSearch === false ? 'prices by hand on this server' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6 pb-24">
      <HeroLede
        layout="inline"
        value={goodNow}
        label="at a good price now"
        caption={caption}
        trailing={
          <>
            {!isOnline && <OfflineHint />}
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/80"
            >
              <Plus className="h-4 w-4" />
              Add
            </button>
          </>
        }
      />

      {wants.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title="Nothing on the list yet"
          description="Add something you want to buy. Rooftap watches the price and tells you when it's a good deal."
          action={{ label: 'Add something', onClick: () => setAdding(true), icon: <Plus className="h-4 w-4" /> }}
        />
      ) : (
        <div className="space-y-3">
          <SegmentedControl ariaLabel="Show" value={tab} onChange={setTab} options={TABS} />
          {shown.length === 0 ? (
            <p className="px-1 py-8 text-center text-sm text-muted-foreground">
              {tab === 'watching' ? 'Nothing being watched.' : tab === 'idea' ? 'No ideas saved.' : 'Nothing bought yet.'}
            </p>
          ) : (
            <ListGroup>
              {shown.map((row) => (
                <WantRow key={row.want.id} row={row} currency={currency} />
              ))}
            </ListGroup>
          )}
        </div>
      )}

      {adding && (
        <WantFormSheet
          isOpen
          groupId={group.id}
          currency={currency}
          onClose={() => setAdding(false)}
          onSave={save}
        />
      )}
    </div>
  );
}
