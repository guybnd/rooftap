// HOUP-88: native Home Setup — room-grouped moving-in checklist + budget.
// Faithful-but-focused port of apps/web/src/app/setup/page.tsx: lede +
// PulseTile strip, search/status/room/store/mine-only filters, room-grouped
// collapsible ListGroups with per-room quick-add, budget summary,
// select-mode bulk set-status/set-store/delete, starter-template seeding.
// Reuses @homeup/core's setupItems$ store + setup vocab verbatim. Comments
// (HOUP-128) is wired via the shared @homeup/ui EntityComments primitive,
// same as native tasks. HOUP-129 adds a Reorder mode (mutually exclusive
// with Select) that drags within a room via @homeup/ui's ReorderableList,
// sourced from the unfiltered reorderGroupedByRoom below — Move up/down in
// the overflow sheet remains as the non-gesture proof path.
//
// HOUP-207: browse path (Select mode included) now renders via `FlashList`,
// flattening room-header/item/quick-add rows into one array (`getItemType`
// per row kind) instead of ScrollView+.map() — real datasets no longer
// freeze on first paint. Reorder mode is UNCHANGED and stays on a plain
// `ScrollView` + per-room `ReorderableList`: that primitive's long-press
// gesture only claims the touch from a ScrollView ancestor (see
// reorderable-list.tsx's header comment), and never from a virtualized
// list, so the two modes are now two sibling top-level branches (FlashList
// vs ScrollView) instead of both living inside one ScrollView. The header
// controls (lede, filters, notices) and the trailing Budget Summary are
// shared between both branches via `SetupListHeader`/`SetupBudgetFooter`.
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList, type ListRenderItem } from '@shopify/flash-list';
// HOUP-318: per-group quick-add rows sit anywhere in the list, so the FlashList
// scrolls via the keyboard-aware scroll view (Costs precedent, HOUP-284).
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { use$ } from '@legendapp/state/react';
import { syncState } from '@legendapp/state';
import { ArrowUpDown, Check, ChevronDown, ChevronRight, Plus, RotateCw, Sparkles, Store as StoreIcon, X } from 'lucide-react-native';
import {
  Text,
  BottomSheet,
  Button,
  Card,
  HeroLede,
  LeadingTile,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemTitle,
  ListItemTrailing,
  PulseTile,
  ReorderableList,
  ScreenBackground,
  SectionSearchBar,
  SegmentedControl,
  haptics,
  cn,
} from '@homeup/ui';
import {
  setupItems$,
  useReconnectSync,
  useStoreHelpers,
  useStoreLoaded,
  seedTemplateItems,
  getStoreEnvironment,
  MOTION_DURATIONS_MS,
  STATUS_ORDER,
  summarize,
  useModules,
  type SetupItem,
  type SetupStore,
  type DocumentSource,
  type SetupSummary,
  SETUP_STATUS_LABEL,
  currencySymbol,
  dialog,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { NoGroupScreen } from '@/components/no-group-screen';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { SetupItemCard, type SetupDocLink } from '@/features/setup/setup-item-card';
import { SetupItemSheet } from '@/features/setup/setup-item-sheet';
import { QuickAddRow } from '@/features/setup/quick-add-row';
import { BudgetSummary } from '@/features/setup/budget-summary';
import { SegmentedBar } from '@/features/setup/segmented-bar';
import { BulkActionsSheet } from '@/features/setup/bulk-actions-sheet';
import { reindexRoomOrder } from '@/features/setup/reorder';
import { groupFrameClass, type RowPos } from '@homeup/ui';

const STATUS_FILTER_KEY = 'setup_status_filters';
const money = (n: number) => `${currencySymbol()}${n.toLocaleString()}`;

// The status filter as one segmented track (H5), mirroring web page.tsx: the
// stored filter list stays an array, so "All" is the empty list and each
// status is a list of one.
type StatusSegment = 'all' | (typeof STATUS_ORDER)[number];
const STATUS_SEGMENTS: { value: StatusSegment; label: string }[] = [
  { value: 'all', label: 'All' },
  ...STATUS_ORDER.map((s) => ({ value: s as StatusSegment, label: SETUP_STATUS_LABEL[s] })),
];

// Filter chips: neutral at rest, the interactive accent when on (H2).
const chipClass = (active: boolean) =>
  cn('min-h-9 flex-row items-center justify-center gap-1 rounded-full border px-3', active ? 'border-primary/40 bg-primary/15' : 'border-border bg-transparent');
const chipTextClass = (active: boolean) => cn('text-xs font-medium', active ? 'text-primary' : 'text-muted-foreground');

function readSavedStatusFilters(): string[] {
  try {
    const raw = getStoreEnvironment().keyValue.getItem(STATUS_FILTER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore malformed / unconfigured environment
  }
  return [];
}

// HOUP-207: the browse-path flattened row union — one room produces a
// header row, its item rows (each carrying its room-local index so
// Move up/down still work), then an optional quick-add trailer row
// (omitted in Select mode, matching the pre-FlashList behavior).
type SetupRow =
  | { kind: 'room-header'; id: string; room: string; count: number; counts: Record<string, number>; est: number; outstanding: number; collapsed: boolean }
  | { kind: 'item'; id: string; item: SetupItem; room: string; localIndex: number; roomLength: number; pos: RowPos }
  | { kind: 'quick-add'; id: string; room: string };

// HOUP-207: reproduces the original ScrollView's `gap-2` (header→content)
// and `gap-4` (between room blocks) rhythm now that rows are flattened
// with no wrapping `View`s to carry gap spacing.
function setupRowSpacing(prev: SetupRow | undefined, current: SetupRow): string | undefined {
  if (!prev) return undefined;
  if (current.kind === 'room-header') return 'mt-4';
  if (prev.kind === 'room-header') return 'mt-2';
  if (current.kind === 'quick-add') return 'mt-2';
  return undefined;
}

interface SetupListHeaderProps {
  allItemsCount: number;
  reorderMode: boolean;
  onExitReorderMode: () => void;
  selectMode: boolean;
  onToggleSelectMode: () => void;
  onRefresh: () => void;
  onAddItem: () => void;
  overall: SetupSummary;
  doneCount: number;
  topRoomSummaries: ({ room: string } & SetupSummary)[];
  notice: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  statusSegment: StatusSegment;
  onStatusSegmentChange: (segment: StatusSegment) => void;
  mineOnly: boolean;
  onToggleMineOnly: () => void;
  existingRooms: string[];
  roomFilter: string | null;
  onOpenRoomPicker: () => void;
  stores: SetupStore[];
  storeFilter: string | null;
  onOpenStorePicker: () => void;
  storeTrip: (SetupSummary & { storeName: string }) | null;
  isSeeding: boolean;
  onSeedTemplates: () => void;
}

/** HOUP-207: the setup lede, top controls, notices, and filters — hoisted into
 * `FlashList`'s `ListHeaderComponent` (and reused verbatim atop the reorder-mode
 * `ScrollView`) so it scrolls with content in both modes. Passed as a memoized
 * element (never an inline closure) so the search bar never remounts mid-type. */
function SetupListHeader({
  allItemsCount,
  reorderMode,
  onExitReorderMode,
  selectMode,
  onToggleSelectMode,
  onRefresh,
  onAddItem,
  overall,
  doneCount,
  topRoomSummaries,
  notice,
  search,
  onSearchChange,
  statusSegment,
  onStatusSegmentChange,
  mineOnly,
  onToggleMineOnly,
  existingRooms,
  roomFilter,
  onOpenRoomPicker,
  stores,
  storeFilter,
  onOpenStorePicker,
  storeTrip,
  isSeeding,
  onSeedTemplates,
}: SetupListHeaderProps) {
  return (
    <View className="gap-4 pb-4">
      {/* H1: one lede. Hearth v2 (Pulse): what's still to get is a Hero
          number, with its own meter once something is done (H3); the
          actions sit on the label row above it. Mirrors web page.tsx. */}
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-micro-label uppercase text-muted-foreground">Setup</Text>
        <View className="flex-row items-center gap-2">
          {/* H5: "Add" is the screen's one filled action; an active toggle
              takes the accent tint, not a second fill (mirrors web). The count
              lives in the select bar below. */}
          {allItemsCount > 0 && !reorderMode && (
            <Button
              size="sm"
              variant="outline"
              onPress={onToggleSelectMode}
              accessibilityState={{ selected: selectMode }}
              className={cn(selectMode && 'border-primary/40 bg-primary/15')}
              textClassName={cn(selectMode && 'text-primary')}
            >
              {selectMode ? 'Done' : 'Select'}
            </Button>
          )}
          {/* HOUP-174: Reorder is no longer a persistent header peer of Select —
              it now only surfaces inside the Select-mode action bar below.
              This button just gives reorder mode an exit affordance. */}
          {reorderMode && (
            <Button size="sm" variant="outline" onPress={onExitReorderMode} className="border-primary/40 bg-primary/15" textClassName="text-primary">
              Done
            </Button>
          )}
          <Button size="icon-sm" variant="outline" onPress={onRefresh} accessibilityLabel="Refresh">
            <RotateCw size={14} className="text-foreground" />
          </Button>
          <Button size="sm" onPress={onAddItem}>
            <Plus size={14} className="text-primary-foreground" />
            <Text className="text-sm font-medium text-primary-foreground">Add</Text>
          </Button>
        </View>
      </View>
      <HeroLede
        value={overall.outstanding}
        label="to get"
        meter={doneCount > 0 ? { done: doneCount, total: overall.total } : undefined}
        caption={(() => {
          if (overall.total === 0) return undefined;
          const fragments = [
            overall.outstanding === 0 ? 'All set up' : doneCount > 0 ? `${doneCount} done` : null,
            overall.spent > 0 ? `${money(overall.spent)} spent` : null,
          ].filter(Boolean);
          return fragments.length ? fragments.join(' · ') : undefined;
        })()}
      />

      {/* Pulse strip: with a single room its tile would restate the Hero
          number (H1), so room tiles show only once there are two or more. */}
      {overall.total > 0 && (
        <View className="flex-row gap-2">
          {topRoomSummaries.length > 1 &&
            topRoomSummaries.map((r) => (
              <PulseTile
                key={r.room}
                label={r.room}
                value={r.outstanding > 0 ? `${r.outstanding} left` : 'Done'}
                meter={{ value: r.total - r.outstanding, total: r.total }}
                tone={r.outstanding === 0 ? 'success' : 'neutral'}
                className="flex-1"
              />
            ))}
          <PulseTile
            label="Budget left"
            value={money(Math.max(0, overall.est - overall.spent))}
            meter={{ value: overall.spent, total: overall.est }}
            tone={overall.spent > overall.est ? 'danger' : 'neutral'}
            className="flex-1"
          />
        </View>
      )}

      {notice && (
        <Card className="rounded-3xl px-4 py-3">
          <Text className="text-body text-foreground">{notice}</Text>
        </Card>
      )}

      {reorderMode && (
        <Card className="rounded-3xl px-4 py-3">
          <Text className="text-body text-muted-foreground">Drag the handle to reorder items within a room</Text>
        </Card>
      )}

      {allItemsCount > 0 && !reorderMode && (
        <View className="gap-3">
          <SectionSearchBar value={search} onChange={onSearchChange} placeholder="Search items…" />

          {/* H2: still to buy is not a danger state, so status filters by a
              neutral segmented track instead of red/green chips (mirrors web). */}
          <View className="flex-row items-center gap-2">
            <SegmentedControl
              options={STATUS_SEGMENTS}
              value={statusSegment}
              onChange={onStatusSegmentChange}
              size="sm"
              accessibilityLabel="Filter by status"
              className="min-h-11 flex-1"
            />
            <Pressable
              onPress={onToggleMineOnly}
              accessibilityRole="button"
              accessibilityState={{ selected: mineOnly }}
              className={cn(chipClass(mineOnly), 'min-h-11 rounded-lg')}
            >
              <Text className={chipTextClass(mineOnly)}>Mine only</Text>
            </Pressable>
          </View>

          {(existingRooms.length > 0 || stores.length > 0) && (
            <View className="flex-row flex-wrap items-center gap-2">
              {/* HOUP-174: chip walls replaced with a single trigger chip each,
                  opening a BottomSheet picker (H5 — the control lives with the
                  surface it filters, without flooding the row with one chip
                  per room/store). */}
              {existingRooms.length > 0 && (
                <Pressable onPress={onOpenRoomPicker} hitSlop={4} accessibilityRole="button" className={chipClass(!!roomFilter)}>
                  <Text className={chipTextClass(!!roomFilter)}>{roomFilter ?? 'All rooms'}</Text>
                  <ChevronDown size={12} className={roomFilter ? 'text-primary' : 'text-muted-foreground'} />
                </Pressable>
              )}
              {stores.length > 0 && (
                <Pressable onPress={onOpenStorePicker} hitSlop={4} accessibilityRole="button" className={chipClass(!!storeFilter)}>
                  <Text className={chipTextClass(!!storeFilter)}>
                    {stores.find((s) => s.id === storeFilter)?.name ?? 'All stores'}
                  </Text>
                  <ChevronDown size={12} className={storeFilter ? 'text-primary' : 'text-muted-foreground'} />
                </Pressable>
              )}
            </View>
          )}
        </View>
      )}

      {/* HOUP-174: shopping-trip rollup for the active store filter — ports
          web page.tsx:515-534's store-trip summary card. Not gated on
          reorderMode — mirrors the original, which only hid the *picker*
          in reorder mode, not an already-active trip card. */}
      {storeTrip && (
        // H2: a neutral card with the Setup tile; coral is for controls.
        <Card className="gap-2.5 rounded-3xl px-4 py-3">
          <View className="flex-row items-center gap-3">
            <LeadingTile sectionId="setup" Icon={StoreIcon} size="md" />
            <View className="min-w-0 flex-1">
              <Text numberOfLines={1} className="text-sm font-semibold text-foreground">{storeTrip.storeName}</Text>
              <Text className="text-xs text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                {storeTrip.total - storeTrip.outstanding} of {storeTrip.total} bought
              </Text>
            </View>
            <Text className="shrink-0" style={{ fontVariant: ['tabular-nums'] }}>
              <Text className="text-sm font-semibold text-foreground">{money(storeTrip.est)}</Text>
              <Text className="text-xs text-muted-foreground"> est</Text>
            </Text>
          </View>
          <SegmentedBar counts={storeTrip.counts} />
        </Card>
      )}

      {allItemsCount === 0 && (
        <Card className="items-center gap-3 rounded-3xl px-4 py-10">
          <Text className="text-center text-body text-muted-foreground">No setup items yet. Add items room by room, or start from a ready-made list.</Text>
          <Button variant="outline" size="sm" onPress={onSeedTemplates} disabled={isSeeding}>
            <Sparkles size={14} className="text-foreground" />
            <Text className="text-sm text-foreground">{isSeeding ? 'Adding…' : 'Add starter items'}</Text>
          </Button>
        </Card>
      )}
    </View>
  );
}

interface SetupBudgetFooterProps {
  allItemsCount: number;
  allSetupItems: SetupItem[];
}

function SetupBudgetFooter({ allItemsCount, allSetupItems }: SetupBudgetFooterProps) {
  if (allItemsCount === 0) return null;
  return (
    <View className="mt-6 gap-2">
      <Text className="px-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Budget</Text>
      <BudgetSummary items={allSetupItems} />
    </View>
  );
}

export default function SetupSectionScreen() {
  const insets = useSafeAreaInsets();
  const { group, currentUserId, memberProfiles, loading: cacheLoading } = useDataCache();
  const supabase = getCurrentSupabaseClient();

  const items$ = setupItems$(group?.id);
  useReconnectSync(items$);
  const { writeRow, patchRow, softDeleteRow } = useStoreHelpers(items$, currentUserId);
  const storeLoaded = useStoreLoaded(items$);
  const allSetupItems = use$(() =>
    Object.values(items$.get() ?? {})
      .filter((i): i is SetupItem => !!i && !i.deleted)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  );

  const [stores, setStores] = React.useState<SetupStore[]>([]);
  const [search, setSearch] = React.useState('');
  const [roomFilter, setRoomFilter] = React.useState<string | null>(null);
  const [storeFilter, setStoreFilter] = React.useState<string | null>(null);
  const [roomPickerOpen, setRoomPickerOpen] = React.useState(false);
  const [storePickerOpen, setStorePickerOpen] = React.useState(false);
  const [statusFilters, setStatusFilters] = React.useState<string[]>(readSavedStatusFilters);
  const [mineOnly, setMineOnly] = React.useState(false);
  const [commentCounts, setCommentCounts] = React.useState<Record<string, number>>({});
  const [docLinksByItem, setDocLinksByItem] = React.useState<Record<string, SetupDocLink>>({});
  // Modules: the "Doc" chip on a setup item needs documents and setup (module-features.ts).
  const docsOn = useModules().feature('documents.setup');
  const [collapsedRooms, setCollapsedRooms] = React.useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = React.useState(false);
  const [reorderMode, setReorderMode] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [bulkSheetOpen, setBulkSheetOpen] = React.useState(false);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [editingItem, setEditingItem] = React.useState<SetupItem | undefined>();
  const [defaultRoom, setDefaultRoom] = React.useState('');
  const [isSeeding, setIsSeeding] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  // Fetch stores when the group loads (setup_stores isn't in the Legend store).
  React.useEffect(() => {
    if (!group) return;
    let cancelled = false;
    (async () => {
      const supabase = getCurrentSupabaseClient();
      const { data } = await supabase.from('setup_stores').select('*').eq('group_id', group.id).order('name', { ascending: true });
      if (!cancelled) setStores((data as SetupStore[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [group]);

  // HOUP-174: comment counts + linked documents for the row portal chips —
  // ports web page.tsx's fetchCommentSummaries/fetchSetupDocs.
  const fetchCommentCounts = React.useCallback(
    async (itemIds: string[]) => {
      if (itemIds.length === 0) {
        setCommentCounts({});
        return;
      }
      const { data } = await supabase.from('setup_item_comments').select('setup_item_id').in('setup_item_id', itemIds);
      const counts: Record<string, number> = {};
      for (const c of (data as { setup_item_id: string }[] | null) ?? []) {
        counts[c.setup_item_id] = (counts[c.setup_item_id] ?? 0) + 1;
      }
      setCommentCounts(counts);
    },
    [supabase]
  );

  const fetchSetupDocs = React.useCallback(async () => {
    if (!group?.id) {
      setDocLinksByItem({});
      return;
    }
    const { data } = await supabase
      .from('document_links')
      .select('entity_id, created_at, documents(storage_path, source)')
      .eq('group_id', group.id)
      .eq('entity_type', 'setup_item')
      .order('created_at', { ascending: false });

    const map: Record<string, SetupDocLink> = {};
    for (const row of (data ?? []) as unknown as { entity_id: string; documents: { storage_path: string; source: DocumentSource } | null }[]) {
      if (!row.documents || map[row.entity_id]) continue;
      map[row.entity_id] = { storagePath: row.documents.storage_path, source: row.documents.source };
    }
    setDocLinksByItem(map);
  }, [group, supabase]);

  // Fetch comments and doc-links once, when the Legend store finishes its initial sync.
  const rowPortalsFetchedRef = React.useRef(false);
  React.useEffect(() => {
    if (!storeLoaded || rowPortalsFetchedRef.current) return;
    const ids = allSetupItems.map((i) => i.id);
    if (ids.length > 0) {
      rowPortalsFetchedRef.current = true;
      void fetchCommentCounts(ids);
    }
    // allSetupItems (the array) is intentionally omitted in favor of its length — the once-only
    // guarantee comes from rowPortalsFetchedRef, and .length re-triggers the effect when items
    // stream in after an empty initial load without rerunning on unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeLoaded, allSetupItems.length, fetchCommentCounts]);

  // Doc chips: fetched once the store has synced and Documents is on, which
  // may be later than the first load if the owner switches Documents on.
  const docsFetchedRef = React.useRef(false);
  React.useEffect(() => {
    if (!storeLoaded || !docsOn || docsFetchedRef.current) return;
    docsFetchedRef.current = true;
    void fetchSetupDocs();
  }, [storeLoaded, docsOn, fetchSetupDocs]);

  const statusSegment: StatusSegment = statusFilters.length === 1 ? (statusFilters[0] as StatusSegment) : 'all';
  const setStatusSegment = (seg: StatusSegment) => {
    const next = seg === 'all' ? [] : [seg];
    setStatusFilters(next);
    try {
      getStoreEnvironment().keyValue.setItem(STATUS_FILTER_KEY, JSON.stringify(next));
    } catch {
      // in-memory only if the KV path is unavailable
    }
  };

  const toggleRoomCollapsed = React.useCallback((room: string) => {
    setCollapsedRooms((prev) => {
      const next = new Set(prev);
      if (next.has(room)) next.delete(room);
      else next.add(room);
      return next;
    });
  }, []);

  const toggleSelect = React.useCallback((itemId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  // Status toggle (checkbox/swipe/overflow) — offline-safe via patchRow.
  // HA: installing clicks, the one that finishes the room rolls, other moves select.
  const handleStatusChange = React.useCallback(
    (item: SetupItem, status: SetupItem['status']) => {
      if (status === item.status) return;
      patchRow(item.id, { status });
      if (status === 'installed') {
        const room = item.room || 'Other';
        const siblings = allSetupItems.filter((i) => i.id !== item.id && (i.room || 'Other') === room);
        if (siblings.length > 0 && siblings.every((i) => i.status === 'installed')) haptics.celebrate();
        else haptics.tick();
      } else {
        haptics.select();
      }
    },
    [patchRow, allSetupItems]
  );

  const handleSeedTemplates = async () => {
    if (!group?.id) return;
    setIsSeeding(true);
    try {
      const supabase = getCurrentSupabaseClient();
      const count = await seedTemplateItems(group.id, supabase);
      if (count > 0) {
        await syncState(items$).sync();
        setNotice(`Added ${count} starter item${count === 1 ? '' : 's'}.`);
      } else {
        setNotice('Starter items are already in your list.');
      }
    } catch (error) {
      console.error('Failed to seed templates:', error);
      setNotice('Could not add starter items.');
    } finally {
      setIsSeeding(false);
    }
  };

  const bulkSetStatus = (status: SetupItem['status']) => {
    selectedIds.forEach((id) => patchRow(id, { status }));
    if (status === 'installed') haptics.success();
    else haptics.select();
    setBulkSheetOpen(false);
    exitSelectMode();
  };

  const bulkSetStore = (storeId: string | null) => {
    selectedIds.forEach((id) => patchRow(id, { store_id: storeId }));
    setBulkSheetOpen(false);
    exitSelectMode();
  };

  const bulkDelete = () => {
    dialog.alert('Delete selected items?', `${selectedIds.size} item(s) will be removed. This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          selectedIds.forEach((id) => softDeleteRow(id));
          exitSelectMode();
        },
      },
    ]);
  };

  const deleteItem = React.useCallback(
    (itemId: string, itemName: string) => {
      dialog.alert(`Delete "${itemName}"?`, undefined, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            softDeleteRow(itemId);
          },
        },
      ]);
    },
    [softDeleteRow]
  );

  const filteredItems = allSetupItems.filter((item) => {
    if (roomFilter && item.room !== roomFilter) return false;
    if (storeFilter && item.store_id !== storeFilter) return false;
    if (statusFilters.length > 0 && !statusFilters.includes(item.status)) return false;
    if (mineOnly && item.assigned_to !== currentUserId) return false;
    return true;
  });

  const searchedItems = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return filteredItems;
    return filteredItems.filter((item) =>
      [item.name, item.notes, item.where_to_buy, item.room].some((f) => (f ?? '').toLowerCase().includes(q))
    );
  }, [filteredItems, search]);

  const groupedByRoom = React.useMemo(() => {
    const map = new Map<string, SetupItem[]>();
    for (const item of searchedItems) {
      const room = item.room || 'Other';
      if (!map.has(room)) map.set(room, []);
      map.get(room)!.push(item);
    }
    return map;
  }, [searchedItems]);

  // HOUP-129: the reorder-mode mirror of groupedByRoom, grouped directly off
  // the unfiltered allSetupItems (already sort_order-sorted). groupedByRoom
  // reflects filter *state* (statusFilters/roomFilter/storeFilter/mineOnly/
  // search), not whether the filter chips are rendered, so hiding them alone
  // would still feed drag from a filtered subset and corrupt sort_order for
  // hidden items. Reorder mode must always read from here, never groupedByRoom.
  const reorderGroupedByRoom = React.useMemo(() => {
    const map = new Map<string, SetupItem[]>();
    for (const item of allSetupItems) {
      const room = item.room || 'Other';
      if (!map.has(room)) map.set(room, []);
      map.get(room)!.push(item);
    }
    return map;
  }, [allSetupItems]);

  const existingRooms = React.useMemo(
    () => Array.from(new Set(allSetupItems.map((i) => i.room).filter(Boolean))).sort() as string[],
    [allSetupItems]
  );

  const overall = summarize(allSetupItems);
  const doneCount = overall.total - overall.outstanding;

  const topRoomSummaries = React.useMemo(() => {
    const byRoom = allSetupItems.reduce((acc, item) => {
      const room = item.room || 'Other';
      (acc[room] ??= []).push(item);
      return acc;
    }, {} as Record<string, SetupItem[]>);
    return Object.entries(byRoom)
      .map(([room, roomItems]) => ({ room, ...summarize(roomItems) }))
      .sort((a, b) => b.outstanding - a.outstanding || b.total - a.total)
      .slice(0, 2);
  }, [allSetupItems]);

  const moveItem = React.useCallback(
    (roomItems: SetupItem[], index: number, direction: -1 | 1) => {
      const target = index + direction;
      if (target < 0 || target >= roomItems.length) return;
      const reordered = [...roomItems];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
      reordered.forEach((it, idx) => patchRow(it.id, { sort_order: idx }));
    },
    [patchRow]
  );

  // HOUP-129: drag-reorder commit — nextOrderedIds is the room's full next id
  // order from ReorderableList, sourced from reorderGroupedByRoom above, so
  // this always reindexes every item in the room (never a filtered subset).
  const reorderRoom = (nextOrderedIds: string[]) => {
    reindexRoomOrder(nextOrderedIds).forEach(({ id, sort_order }) => patchRow(id, { sort_order }));
  };

  // HOUP-174: shopping-trip rollup for the active store filter (header prop) —
  // ports web page.tsx:515-534's store-trip summary card.
  const storeTrip = React.useMemo(() => {
    if (!storeFilter) return null;
    const trip = summarize(filteredItems);
    const storeName = stores.find((s) => s.id === storeFilter)?.name ?? 'Store';
    return { ...trip, storeName };
  }, [storeFilter, filteredItems, stores]);

  // HOUP-207: browse-path flattening — one row array feeding FlashList,
  // matching HOUP-205/206's room-header + row union pattern.
  const flatData = React.useMemo<SetupRow[]>(() => {
    if (allSetupItems.length === 0) return [];
    const rows: SetupRow[] = [];
    for (const [room, roomItems] of groupedByRoom.entries()) {
      const collapsed = collapsedRooms.has(room);
      const roll = summarize(roomItems);
      rows.push({
        kind: 'room-header',
        id: `room-header:${room}`,
        room,
        count: roomItems.length,
        counts: roll.counts,
        est: roll.est,
        outstanding: roll.outstanding,
        collapsed,
      });

      if (collapsed) continue;

      const lastIndex = roomItems.length - 1;
      roomItems.forEach((item, index) => {
        const pos: RowPos = roomItems.length === 1 ? 'only' : index === 0 ? 'first' : index === lastIndex ? 'last' : 'middle';
        rows.push({ kind: 'item', id: item.id, item, room, localIndex: index, roomLength: roomItems.length, pos });
      });

      if (!selectMode) {
        rows.push({ kind: 'quick-add', id: `quick-add:${room}`, room });
      }
    }
    return rows;
  }, [allSetupItems.length, groupedByRoom, collapsedRooms, selectMode]);

  const renderItem = React.useCallback<ListRenderItem<SetupRow>>(
    ({ item: row, index }) => {
      const prev = index > 0 ? flatData[index - 1] : undefined;
      const spacing = setupRowSpacing(prev, row);
      if (row.kind === 'room-header') {
        return (
          <Pressable
            onPress={() => toggleRoomCollapsed(row.room)}
            accessibilityRole="button"
            accessibilityState={{ expanded: !row.collapsed }}
            className={cn('min-h-11 flex-row items-center gap-1.5 px-1', spacing)}
          >
            {row.collapsed ? <ChevronRight size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
            <Text className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              {row.room} <Text style={{ fontVariant: ['tabular-nums'] }}>({row.count})</Text>
            </Text>
            {/* H3: meters are local — capped, not edge-to-edge. */}
            <View className="mx-2 max-w-[180px] flex-1">
              <SegmentedBar counts={row.counts} />
            </View>
            <Text className="ml-auto text-xs tabular-nums text-muted-foreground">
              <Text className="font-medium text-foreground">{money(row.est)}</Text>
              {row.outstanding > 0 && <Text> · {row.outstanding} to buy</Text>}
            </Text>
          </Pressable>
        );
      }
      if (row.kind === 'item') {
        const roomItems = groupedByRoom.get(row.room) ?? [];
        return (
          <View className={cn(groupFrameClass(row.pos), spacing)}>
            <SetupItemCard
              item={row.item}
              stores={stores}
              selectMode={selectMode}
              selected={selectedIds.has(row.item.id)}
              onToggleSelect={toggleSelect}
              onStatusChange={handleStatusChange}
              onPatch={patchRow}
              onDelete={(id) => deleteItem(id, row.item.name)}
              onEdit={(it) => {
                setEditingItem(it);
                setSheetOpen(true);
              }}
              onMoveUp={() => moveItem(roomItems, row.localIndex, -1)}
              onMoveDown={() => moveItem(roomItems, row.localIndex, 1)}
              canMoveUp={row.localIndex > 0}
              canMoveDown={row.localIndex < row.roomLength - 1}
              commentCount={commentCounts[row.item.id] ?? 0}
              docLink={docsOn ? docLinksByItem[row.item.id] : undefined}
              onCommentsChanged={() => fetchCommentCounts(allSetupItems.map((i) => i.id))}
              supabase={supabase}
              currentUserId={currentUserId}
              memberProfiles={memberProfiles}
            />
          </View>
        );
      }
      // quick-add
      return (
        <View className={spacing}>
          <QuickAddRow groupId={group?.id ?? ''} room={row.room} onCreated={(item) => writeRow(item)} />
        </View>
      );
    },
    [
      flatData,
      groupedByRoom,
      stores,
      selectMode,
      selectedIds,
      toggleSelect,
      handleStatusChange,
      patchRow,
      deleteItem,
      moveItem,
      commentCounts,
      docLinksByItem,
      docsOn,
      fetchCommentCounts,
      allSetupItems,
      supabase,
      currentUserId,
      memberProfiles,
      toggleRoomCollapsed,
      group?.id,
      writeRow,
    ]
  );

  if (cacheLoading || (!storeLoaded && allSetupItems.length === 0)) {
    return (
      <ScreenBackground className="items-center justify-center">
        <ActivityIndicator />
      </ScreenBackground>
    );
  }

  if (!group) {
    return <NoGroupScreen />;
  }

  const listHeaderElement = (
    <SetupListHeader
      allItemsCount={allSetupItems.length}
      reorderMode={reorderMode}
      onExitReorderMode={() => setReorderMode(false)}
      selectMode={selectMode}
      onToggleSelectMode={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
      onRefresh={() => void syncState(items$).sync()}
      onAddItem={() => {
        setEditingItem(undefined);
        setDefaultRoom('');
        setSheetOpen(true);
      }}
      overall={overall}
      doneCount={doneCount}
      topRoomSummaries={topRoomSummaries}
      notice={notice}
      search={search}
      onSearchChange={setSearch}
      statusSegment={statusSegment}
      onStatusSegmentChange={setStatusSegment}
      mineOnly={mineOnly}
      onToggleMineOnly={() => setMineOnly((v) => !v)}
      existingRooms={existingRooms}
      roomFilter={roomFilter}
      onOpenRoomPicker={() => setRoomPickerOpen(true)}
      stores={stores}
      storeFilter={storeFilter}
      onOpenStorePicker={() => setStorePickerOpen(true)}
      storeTrip={storeTrip}
      isSeeding={isSeeding}
      onSeedTemplates={handleSeedTemplates}
    />
  );

  const budgetFooterElement = <SetupBudgetFooter allItemsCount={allSetupItems.length} allSetupItems={allSetupItems} />;

  const emptyMatchElement =
    allSetupItems.length > 0 ? (
      <Card className="items-center rounded-3xl px-4 py-10">
        <Text className="text-center text-body text-muted-foreground">No items match the current filters.</Text>
      </Card>
    ) : null;

  return (
    <ScreenBackground>
      {reorderMode ? (
        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-4 p-4"
          contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 96 }}
          keyboardShouldPersistTaps="handled"
        >
          {listHeaderElement}

          {allSetupItems.length > 0 && (
            <View className="gap-4">
              {Array.from(reorderGroupedByRoom.entries()).map(([room, roomItems]) => {
                const collapsed = collapsedRooms.has(room);
                const roll = summarize(roomItems);
                return (
                  <View key={room} className="gap-2">
                    <Pressable
                      onPress={() => toggleRoomCollapsed(room)}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: !collapsed }}
                      className="min-h-11 flex-row items-center gap-1.5 px-1"
                    >
                      {collapsed ? <ChevronRight size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                      <Text className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                        {room} <Text style={{ fontVariant: ['tabular-nums'] }}>({roomItems.length})</Text>
                      </Text>
                      {/* H3: meters are local — capped, not edge-to-edge. */}
                      <View className="mx-2 max-w-[180px] flex-1">
                        <SegmentedBar counts={roll.counts} />
                      </View>
                      <Text className="ml-auto text-xs tabular-nums text-muted-foreground">
                        <Text className="font-medium text-foreground">{money(roll.est)}</Text>
                        {roll.outstanding > 0 && <Text> · {roll.outstanding} to buy</Text>}
                      </Text>
                    </Pressable>

                    {!collapsed && (
                      <ReorderableList
                        data={roomItems}
                        keyExtractor={(item) => item.id}
                        onReorder={reorderRoom}
                        renderItem={(item, dragging) => (
                          <SetupItemCard
                            item={item}
                            stores={stores}
                            reorderMode
                            dragging={dragging}
                            onStatusChange={handleStatusChange}
                            onPatch={patchRow}
                            onDelete={(id) => deleteItem(id, item.name)}
                            onEdit={(it) => {
                              setEditingItem(it);
                              setSheetOpen(true);
                            }}
                            commentCount={commentCounts[item.id] ?? 0}
                            docLink={docsOn ? docLinksByItem[item.id] : undefined}
                            supabase={supabase}
                            currentUserId={currentUserId}
                            memberProfiles={memberProfiles}
                          />
                        )}
                      />
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {budgetFooterElement}
        </ScrollView>
      ) : (
        <FlashList
          data={flatData}
          keyExtractor={(row) => row.id}
          getItemType={(row) => row.kind}
          renderItem={renderItem}
          ListHeaderComponent={listHeaderElement}
          ListEmptyComponent={emptyMatchElement}
          ListFooterComponent={budgetFooterElement}
          keyboardShouldPersistTaps="handled"
          renderScrollComponent={KeyboardAwareScrollView}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 96 }}
        />
      )}

      {/* HOUP-174: Select-mode action bar — Reorder now lives here rather than
          as a persistent header peer (it needs no selection, unlike
          Actions/Delete, so it stays visible whether or not anything's
          checked). */}
      {selectMode && (
        <View
          className="absolute inset-x-4 flex-row items-center justify-between gap-2 rounded-2xl border border-border bg-popover px-3.5 py-2.5 shadow-lg"
          style={{ bottom: insets.bottom + 16 }}
        >
          <Text className="text-caption text-muted-foreground">
            {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select items'}
          </Text>
          <View className="flex-row gap-2">
            {selectedIds.size === 0 && (
              <Button
                size="sm"
                variant="outline"
                onPress={() => {
                  exitSelectMode();
                  setReorderMode(true);
                }}
              >
                <ArrowUpDown size={14} className="text-foreground" />
                <Text className="text-[0.8rem] font-medium text-foreground">Reorder</Text>
              </Button>
            )}
            {selectedIds.size > 0 && (
              <>
                <Button size="sm" variant="outline" onPress={() => setBulkSheetOpen(true)}>
                  Actions
                </Button>
                {/* E4: destructive is danger text, no fill. */}
                <Button size="sm" variant="outline" textClassName="text-destructive" onPress={bulkDelete}>
                  Delete
                </Button>
              </>
            )}
            <Button
              size="icon-sm"
              variant="outline"
              onPress={() => (selectedIds.size > 0 ? setSelectedIds(new Set()) : exitSelectMode())}
              accessibilityLabel={selectedIds.size > 0 ? 'Clear selection' : 'Exit select mode'}
            >
              <X size={14} className="text-foreground" />
            </Button>
          </View>
        </View>
      )}

      <SetupItemSheet
        key={editingItem?.id ?? `new-${defaultRoom}`}
        open={sheetOpen}
        onOpenChange={(open) => {
          // HOUP-191: keyed on `editingItem?.id` — clearing it in the same
          // tick as `sheetOpen=false` remounts the sheet mid-close and
          // skips the 250ms exit animation entirely.
          setSheetOpen(open);
          if (!open) {
            setTimeout(() => {
              setEditingItem(undefined);
              setDefaultRoom('');
            }, MOTION_DURATIONS_MS.exit);
          }
        }}
        item={editingItem}
        groupId={group.id}
        existingRooms={existingRooms}
        stores={stores}
        defaultRoom={defaultRoom}
        onStoreCreated={(store) => setStores((prev) => [...prev, store])}
        onSave={(saved) => writeRow(saved)}
        onDelete={(itemId) => softDeleteRow(itemId)}
      />

      <BulkActionsSheet open={bulkSheetOpen} onOpenChange={setBulkSheetOpen} stores={stores} onSetStatus={bulkSetStatus} onSetStore={bulkSetStore} />

      {/* HOUP-174: Room/Store filter pickers — replace the chip-wall filters
          with a single trigger chip each (H5: the control lives with the
          surface it filters). */}
      <BottomSheet open={roomPickerOpen} onOpenChange={setRoomPickerOpen} className="max-h-[70%] pb-2">
        <View className="gap-1.5 px-1.5 pt-1.5">
          <Text className="px-1.5 text-micro-label uppercase text-muted-foreground">Room</Text>
          <ListGroup>
            <ListItem
              onPress={() => {
                setRoomFilter(null);
                setRoomPickerOpen(false);
              }}
            >
              <ListItemContent>
                <ListItemTitle className={cn(!roomFilter && 'text-primary')}>All rooms</ListItemTitle>
              </ListItemContent>
              <ListItemTrailing>{!roomFilter && <Check size={16} className="text-primary" />}</ListItemTrailing>
            </ListItem>
            {existingRooms.map((room) => (
              <ListItem
                key={room}
                onPress={() => {
                  setRoomFilter(room);
                  setRoomPickerOpen(false);
                }}
              >
                <ListItemContent>
                  <ListItemTitle className={cn(roomFilter === room && 'text-primary')}>{room}</ListItemTitle>
                </ListItemContent>
                <ListItemTrailing>{roomFilter === room && <Check size={16} className="text-primary" />}</ListItemTrailing>
              </ListItem>
            ))}
          </ListGroup>
        </View>
      </BottomSheet>

      <BottomSheet open={storePickerOpen} onOpenChange={setStorePickerOpen} className="max-h-[70%] pb-2">
        <View className="gap-1.5 px-1.5 pt-1.5">
          <Text className="px-1.5 text-micro-label uppercase text-muted-foreground">Store</Text>
          <ListGroup>
            <ListItem
              onPress={() => {
                setStoreFilter(null);
                setStorePickerOpen(false);
              }}
            >
              <ListItemContent>
                <ListItemTitle className={cn(!storeFilter && 'text-primary')}>All stores</ListItemTitle>
              </ListItemContent>
              <ListItemTrailing>{!storeFilter && <Check size={16} className="text-primary" />}</ListItemTrailing>
            </ListItem>
            {stores.map((s) => (
              <ListItem
                key={s.id}
                onPress={() => {
                  setStoreFilter(s.id);
                  setStorePickerOpen(false);
                }}
              >
                <ListItemContent>
                  <ListItemTitle className={cn(storeFilter === s.id && 'text-primary')}>{s.name}</ListItemTitle>
                </ListItemContent>
                <ListItemTrailing>{storeFilter === s.id && <Check size={16} className="text-primary" />}</ListItemTrailing>
              </ListItem>
            ))}
          </ListGroup>
        </View>
      </BottomSheet>
    </ScreenBackground>
  );
}
