'use client';

// HOUP-434: Shopper, the household's list of things to buy. The Hero counts
// what is at a good price now (H1); the segmented control sits on the list it
// filters (H5); each row carries its deal word and trend. Prices come from
// the server's sources into the synced offer and snapshot stores.
// Native twin: apps/mobile/src/app/(tabs)/shopper/index.tsx.
import { useEffect, useMemo, useState } from 'react';
import { use$ } from '@legendapp/state/react';
import { toast } from 'sonner';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, ShoppingBag, Sparkles } from 'lucide-react';
import {
  dialog,
  shopperWants$,
  shopperPriceSnapshots$,
  shopperSearches$,
  useModules,
  readScoutPrefill,
  scoutRunStatus,
  scoutTitle,
  timeAgo,
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
  type ScoutPrefill,
  type ShopperSearch,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { lookupWhenSynced, shopperSources } from '@/lib/shopper-api';
import { HeroLede } from '@/components/ui/hero-lede';
import { ListGroup, ListItem, ListItemContent, ListItemMeta, ListItemTitle } from '@/components/ui/list-item';
import { LeadingTile } from '@/components/ui/leading-tile';
import { navLinkClickHandler } from '@/lib/view-transitions';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { EmptyState } from '@/components/ui/empty-state';
import { OfflineHint } from '@/components/offline-hint';
import { WantRow } from './want-row';
import { WantFormSheet } from './want-form-sheet';
import { ScoutBriefSheet } from './scout-brief-sheet';
import { useWideLayout } from '@/lib/desktop-layout';
import { WideList } from '@/components/wide-list';
import { cn } from '@/lib/utils';

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
  const { writeRow, patchRow: patchWant, softDeleteRow: deleteWant } = useStoreHelpers(wants$, currentUserId);
  // The row menu's actions, as the item's own page does them.
  const setBought = (want: ShopperWant, bought: boolean) =>
    patchWant(want.id, bought ? { status: 'bought', bought_at: new Date().toISOString() } : { status: 'watching', bought_at: null });
  const removeWant = async (want: ShopperWant) => {
    if (await dialog.confirm({ title: `Delete "${want.title}"?`, destructive: true })) deleteWant(want.id);
  };
  // HOUP-435: Scout needs a server with its tables.
  const scoutOn = useModules().server('shopper.scout');
  const searches$ = shopperSearches$(scoutOn ? group?.id : undefined);
  useReconnectSync(searches$);
  const recentRuns = use$(() =>
    Object.values(searches$.get() ?? {})
      .filter((s): s is ShopperSearch => !!s && !s.deleted)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 3),
  );
  const [scouting, setScouting] = useState(false);
  const router = useRouter();
  // A Home Setup item's "Find with Scout" lands here as ?scout=…&upto=…: open
  // the brief prefilled once Scout is known to be on, then drop the params so
  // a reload or Back does not open it again.
  const [prefill, setPrefill] = useState<ScoutPrefill | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const found = readScoutPrefill({ scout: params.get('scout'), upto: params.get('upto') });
    if (!found) return;
    setPrefill(found);
    router.replace('/shopper');
  }, [router]);
  useEffect(() => {
    if (prefill && scoutOn) setScouting(true);
  }, [prefill, scoutOn]);
  const wide = useWideLayout();
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
      .then((sources) => setCanSearch(sources.some((s) => s.enabled !== false && s.capabilities.includes('offers'))))
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
    <div className={cn('mx-auto space-y-4 p-4 md:p-6 pb-24', wide ? 'max-w-[1400px] lg:px-8' : 'max-w-3xl')}>
      <HeroLede
        layout="inline"
        value={goodNow}
        label="at a good price now"
        caption={caption}
        trailing={
          <>
            {!isOnline && <OfflineHint />}
            {scoutOn && (
              <button
                type="button"
                onClick={() => setScouting(true)}
                disabled={!isOnline}
                className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-muted px-3.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-40"
              >
                <Sparkles className="h-4 w-4" />
                Scout
              </button>
            )}
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

      {recentRuns.length > 0 && (
        <div className="space-y-1.5">
          <p className="px-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Scout</p>
          <WideList>
            {recentRuns.map((run) => (
              <ScoutRunRow key={run.id} run={run} />
            ))}
          </WideList>
        </div>
      )}

      {wants.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title="Nothing on the list yet"
          description="Add something you want to buy. Rooftap watches the price and tells you when it's a good deal."
          action={{ label: 'Add something', onClick: () => setAdding(true), icon: <Plus className="h-4 w-4" /> }}
        />
      ) : (
        <div className="space-y-3">
          <div className={cn(wide && 'max-w-xl')}>
            <SegmentedControl ariaLabel="Show" value={tab} onChange={setTab} options={TABS} />
          </div>
          {shown.length === 0 ? (
            <p className="px-1 py-8 text-center text-sm text-muted-foreground">
              {tab === 'watching' ? 'Nothing being watched.' : tab === 'idea' ? 'No ideas saved.' : 'Nothing bought yet.'}
            </p>
          ) : (
            <WideList>
              {shown.map((row) => (
                <WantRow
                  key={row.want.id}
                  row={row}
                  currency={currency}
                  onSetBought={(bought) => setBought(row.want, bought)}
                  onDelete={() => void removeWant(row.want)}
                />
              ))}
            </WideList>
          )}
        </div>
      )}

      {scouting && (
        <ScoutBriefSheet
          isOpen
          currency={currency}
          prefill={prefill}
          onClose={() => {
            setScouting(false);
            setPrefill(null);
          }}
        />
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

function ScoutRunRow({ run }: { run: ShopperSearch }) {
  const router = useRouter();
  const href = `/shopper/scout/${run.id}`;
  const status = scoutRunStatus(run);
  const meta =
    status === 'running' ? 'Researching…' : status === 'failed' ? "Didn't finish" : [timeAgo(run.finished_at ?? run.created_at)].filter(Boolean).join(' · ');
  return (
    <ListItem asChild>
      <Link href={href} onClick={navLinkClickHandler('descend', router, href)}>
        <LeadingTile sectionId="shopper" Icon={Sparkles} size="md" />
        <ListItemContent>
          <ListItemTitle>
            <span className="truncate">{scoutTitle(run.brief)}</span>
          </ListItemTitle>
          <ListItemMeta>
            <span>{meta}</span>
          </ListItemMeta>
        </ListItemContent>
      </Link>
    </ListItem>
  );
}
