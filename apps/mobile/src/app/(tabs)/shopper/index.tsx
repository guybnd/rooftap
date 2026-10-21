// HOUP-434: Shopper, the household's list of things to buy. The Hero counts
// what is at a good price now (H1); the segmented control sits on the list it
// filters (H5); each row carries its deal word and trend. Prices come from
// the server's sources into the synced offer and snapshot stores.
// Web twin: apps/web/src/app/shopper/page.tsx.
import * as React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import { use$ } from '@legendapp/state/react';
import { useRouter, type Href } from 'expo-router';
import { Plus, ShoppingBag, Sparkles, WifiOff } from 'lucide-react-native';
import {
  Text,
  Button,
  EmptyState,
  HeroLede,
  LeadingTile,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemMeta,
  ListItemTitle,
  ScreenBackground,
  SegmentedControl,
  flattenGroups,
  groupFrameClass,
  toast,
  type SectionRow,
} from '@homeup/ui';
import {
  shopperWants$,
  shopperPriceSnapshots$,
  shopperSearches$,
  useModules,
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
  MOTION_DURATIONS_MS,
  type ShopperRowSummary,
  type ShopperWant,
  type ShopperWantStatus,
  type ShopperPriceSnapshot,
  type ShopperSearch,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { NoGroupScreen } from '@/components/no-group-screen';
import { WantRow } from '@/features/shopper/want-row';
import { WantFormSheet } from '@/features/shopper/want-form-sheet';
import { ScoutBriefSheet } from '@/features/shopper/scout-brief-sheet';
import { lookupWhenSynced, shopperSources } from '@/features/shopper/shopper-api';

const TABS: { value: ShopperWantStatus; label: string }[] = [
  { value: 'watching', label: 'Watching' },
  { value: 'idea', label: 'Ideas' },
  { value: 'bought', label: 'Bought' },
];

export default function ShopperScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { group, currentUserId, isOnline, loading: cacheLoading } = useDataCache();
  const currency = useHouseholdCurrency();
  const wants$ = shopperWants$(group?.id);
  const snaps$ = shopperPriceSnapshots$(group?.id);
  useReconnectSync(wants$);
  useReconnectSync(snaps$);
  const { writeRow } = useStoreHelpers(wants$, currentUserId);
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
  const [scouting, setScouting] = React.useState(false);
  const [scoutOpen, setScoutOpen] = React.useState(false);
  const storeLoaded = useStoreLoaded(wants$, snaps$);

  const wants = use$(() => Object.values(wants$.get() ?? {}).filter((w): w is ShopperWant => !!w && !w.deleted));
  const snapshots = use$(() =>
    Object.values(snaps$.get() ?? {}).filter((s): s is ShopperPriceSnapshot => !!s && !s.deleted),
  );
  const rows = React.useMemo(() => summarizeWants(wants, snapshots, todayISO()), [wants, snapshots]);

  const [tab, setTab] = React.useState<ShopperWantStatus>('watching');
  // `open` is separate from mounting so the sheet's exit animation can play (HOUP-191).
  const [adding, setAdding] = React.useState(false);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [canSearch, setCanSearch] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    if (!isOnline) return;
    shopperSources()
      .then((sources) => setCanSearch(sources.some((s) => s.enabled !== false && s.capabilities.includes('offers'))))
      .catch(() => setCanSearch(null));
  }, [isOnline]);

  const shown = React.useMemo(() => {
    const inTab = rows.filter((r) => r.want.status === tab);
    if (tab === 'watching') return sortWatching(inTab);
    if (tab === 'bought') return inTab.sort((a, b) => (b.want.bought_at ?? '').localeCompare(a.want.bought_at ?? ''));
    return inTab.sort((a, b) => a.want.title.localeCompare(b.want.title));
  }, [rows, tab]);

  const flatData = React.useMemo<SectionRow<ShopperRowSummary>[]>(
    () => flattenGroups<ShopperRowSummary>([{ rows: shown }], (r) => r.want.id),
    [shown],
  );

  const watching = rows.filter((r) => r.want.status === 'watching');
  const goodNow = watching.filter(isGoodNow).length;
  const targetsHit = watching.filter((r) => hitTarget(r.want)).length;

  const openAdd = () => {
    setAdding(true);
    setSheetOpen(true);
  };
  const closeAdd = () => {
    setSheetOpen(false);
    setTimeout(() => setAdding(false), MOTION_DURATIONS_MS.exit);
  };

  const openScout = () => {
    setScouting(true);
    setScoutOpen(true);
  };
  const closeScout = () => {
    setScoutOpen(false);
    setTimeout(() => setScouting(false), MOTION_DURATIONS_MS.exit);
  };

  const save = (want: ShopperWant, isNew: boolean) => {
    writeRow(want);
    if (isNew && want.status === 'watching' && isOnline) {
      lookupWhenSynced(want.id)
        .then((res) => {
          if (res && res.offers === 0 && res.sources.length) toast.message(`No prices found for ${want.title} yet.`);
        })
        .catch((err) => toast.error(err instanceof Error ? err.message : 'Could not check prices.'));
    }
  };

  if (cacheLoading || (!storeLoaded && wants.length === 0)) {
    return (
      <ScreenBackground className="items-center justify-center">
        <ActivityIndicator />
      </ScreenBackground>
    );
  }
  if (!group) return <NoGroupScreen />;

  const caption = [
    `${watching.length} watching`,
    targetsHit > 0 ? `${targetsHit} hit your target` : null,
    canSearch === false ? 'prices by hand on this server' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const listHeader = (
    <View className="gap-4 pb-4">
      <View className="flex-row items-center justify-between gap-3">
        <Text numberOfLines={1} className="shrink text-micro-label uppercase text-muted-foreground">
          Shopper
        </Text>
        <View className="shrink-0 flex-row items-center gap-1.5">
          {!isOnline && (
            <View className="flex-row items-center gap-1 pr-0.5">
              <WifiOff size={12} className="shrink-0 text-muted-foreground" />
              <Text className="text-xs text-muted-foreground">Offline</Text>
            </View>
          )}
          {scoutOn && (
            <Button size="sm" variant="secondary" onPress={openScout} disabled={!isOnline}>
              <Sparkles size={14} className="text-foreground" />
              <Text className="text-sm font-medium text-foreground">Scout</Text>
            </Button>
          )}
          <Button size="sm" onPress={openAdd}>
            <Plus size={14} className="text-primary-foreground" />
            <Text className="text-sm font-medium text-primary-foreground">Add</Text>
          </Button>
        </View>
      </View>
      <HeroLede value={goodNow} label="at a good price now" caption={caption} />

      {recentRuns.length > 0 && (
        <View className="gap-1.5">
          <Text className="px-1 text-micro-label uppercase text-muted-foreground">Scout</Text>
          <ListGroup>
            {recentRuns.map((run) => (
              <ScoutRunRow key={run.id} run={run} onPress={() => router.push(`/shopper/scout/${run.id}` as Href)} />
            ))}
          </ListGroup>
        </View>
      )}

      {wants.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title="Nothing on the list yet"
          description="Add something you want to buy. Rooftap watches the price and tells you when it's a good deal."
          action={{ label: 'Add something', onPress: openAdd, icon: <Plus size={14} className="text-primary-foreground" /> }}
        />
      ) : (
        <>
          <SegmentedControl accessibilityLabel="Show" value={tab} onChange={setTab} options={TABS} />
          {shown.length === 0 && (
            <Text className="px-1 py-8 text-center text-sm text-muted-foreground">
              {tab === 'watching' ? 'Nothing being watched.' : tab === 'idea' ? 'No ideas saved.' : 'Nothing bought yet.'}
            </Text>
          )}
        </>
      )}
    </View>
  );

  const renderItem: ListRenderItem<SectionRow<ShopperRowSummary>> = ({ item: row }) => {
    if (row.kind === 'group-header') return null;
    return (
      <View className={groupFrameClass(row.pos)}>
        <WantRow row={row.item} currency={currency} onPress={() => router.push(`/shopper/${row.item.want.id}` as Href)} />
      </View>
    );
  };

  return (
    <ScreenBackground>
      <FlashList
        data={flatData}
        keyExtractor={(row) => row.id}
        getItemType={(row) => row.kind}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: insets.top + 16, paddingBottom: 32 }}
      />
      {scouting && (
        <ScoutBriefSheet
          open={scoutOpen}
          onOpenChange={(next) => {
            if (!next) closeScout();
          }}
          currency={currency}
        />
      )}
      {adding && (
        <WantFormSheet
          open={sheetOpen}
          onOpenChange={(next) => {
            if (!next) closeAdd();
          }}
          groupId={group.id}
          currency={currency}
          onSave={save}
        />
      )}
    </ScreenBackground>
  );
}

function ScoutRunRow({ run, onPress }: { run: ShopperSearch; onPress: () => void }) {
  const status = scoutRunStatus(run);
  const meta = status === 'running' ? 'Researching…' : status === 'failed' ? "Didn't finish" : timeAgo(run.finished_at ?? run.created_at) ?? '';
  return (
    <ListItem onPress={onPress} accessibilityRole="button">
      <LeadingTile sectionId="shopper" Icon={Sparkles} size="md" />
      <ListItemContent>
        <ListItemTitle numberOfLines={1}>{scoutTitle(run.brief)}</ListItemTitle>
        <ListItemMeta>
          <Text numberOfLines={1} className="text-caption text-muted-foreground">
            {meta}
          </Text>
        </ListItemMeta>
      </ListItemContent>
    </ListItem>
  );
}
