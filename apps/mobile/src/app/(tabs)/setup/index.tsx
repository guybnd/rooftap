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
import { ArrowUpDown, Check, ChevronDown, ChevronRight, X } from 'lucide-react-native';
import { Text, BottomSheet, Button, Card, SegmentedControl, ListGroup, ListItem, ListItemContent, ListItemTitle, ListItemTrailing, ReorderableList, ScreenBackground, haptics, cn } from '@homeup/ui';
import {
  MOTION_DURATIONS_MS,
  summarize,
  useModules,
  type SetupItem,
  dialog,
  filterSetupItems,
  finishesSetupRoom,
  groupSetupByRoom,
  moveInRoom,
  reindexRoomOrder,
  setupRoomNames,
  setupStoreTrip,
  topSetupRooms,
  useSeedSetupTemplates,
  useSetupFilters,
  useSetupItems,
  useSetupListModes,
  useSetupNotice,
  useSetupRowPortals,
  useSetupStores,
} from '@homeup/core';
import { useLocalSearchParams } from 'expo-router';
import { useDataCache } from '@/lib/data-cache';
import { CareView } from '@/features/setup/care-view';
import { NoGroupScreen } from '@/components/no-group-screen';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { SetupItemCard } from '@/features/setup/setup-item-card';
import { SetupItemSheet } from '@/features/setup/setup-item-sheet';
import { QuickAddRow } from '@/features/setup/quick-add-row';
import { SegmentedBar } from '@/features/setup/segmented-bar';
import { BulkActionsSheet } from '@/features/setup/bulk-actions-sheet';
import { groupFrameClass, type RowPos } from '@homeup/ui';
import { SetupListHeader, SetupBudgetFooter, money } from '@/features/setup/list-header';

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

export default function SetupSectionScreen() {
  const insets = useSafeAreaInsets();
  const { group, currentUserId, memberProfiles, groupMembers, loading: cacheLoading } = useDataCache();
  const supabase = getCurrentSupabaseClient();

  // The list state and its view logic are shared with web from @homeup/core
  // (use-setup-list.ts, setup-list-view.ts); this screen only renders.
  const { items: allSetupItems, loaded: storeLoaded, writeRow, patchRow, softDeleteRow, refresh } = useSetupItems(group?.id, currentUserId);

  const { stores, addStore } = useSetupStores(group?.id, getCurrentSupabaseClient);
  const filters = useSetupFilters();
  const { search, setSearch, roomFilter, setRoomFilter, storeFilter, setStoreFilter, statusSegment, setStatusSegment, mineOnly, toggleMineOnly } = filters;
  const [roomPickerOpen, setRoomPickerOpen] = React.useState(false);
  const [storePickerOpen, setStorePickerOpen] = React.useState(false);
  // Modules: the "Doc" chip on a setup item needs documents and setup (module-features.ts).
  const modules = useModules();
  const docsOn = modules.feature('documents.setup');
  // HOUP-174: comment counts + linked documents for the row portal chips.
  const { commentSummaries, docLinks: docLinksByItem, refreshComments } = useSetupRowPortals({
    groupId: group?.id,
    getClient: getCurrentSupabaseClient,
    loaded: storeLoaded,
    items: allSetupItems,
    docsOn,
  });
  // Home care (module `home-care`) is Setup's second view; a care reminder
  // opened from Home or a push lands on it through ?view=care.
  const careOn = modules.isEnabled('home-care');
  const viewParam = useLocalSearchParams<{ view?: string }>().view;
  const [view, setView] = React.useState<'setup' | 'care'>(viewParam === 'care' ? 'care' : 'setup');
  React.useEffect(() => {
    if (viewParam === 'care') setView('care');
  }, [viewParam]);
  const {
    collapsedRooms,
    toggleRoomCollapsed,
    selectMode,
    toggleSelectMode,
    exitSelectMode,
    selectedIds,
    toggleSelect,
    clearOrExitSelect,
    reorderMode,
    startReorder,
    exitReorder,
  } = useSetupListModes();
  const [bulkSheetOpen, setBulkSheetOpen] = React.useState(false);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [editingItem, setEditingItem] = React.useState<SetupItem | undefined>();
  const [defaultRoom, setDefaultRoom] = React.useState('');
  const [notice, setNotice] = useSetupNotice();
  const { isSeeding, seed: handleSeedTemplates } = useSeedSetupTemplates({
    groupId: group?.id,
    getClient: getCurrentSupabaseClient,
    refresh,
    onNotice: setNotice,
  });

  // Status toggle (checkbox/swipe/overflow) — offline-safe via patchRow.
  // HA: installing clicks, the one that finishes the room rolls, other moves select.
  const handleStatusChange = React.useCallback(
    (item: SetupItem, status: SetupItem['status']) => {
      if (status === item.status) return;
      patchRow(item.id, { status });
      if (status === 'installed') {
        if (finishesSetupRoom(allSetupItems, item)) haptics.celebrate();
        else haptics.tick();
      } else {
        haptics.select();
      }
    },
    [patchRow, allSetupItems]
  );

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

  const filteredItems = filterSetupItems(allSetupItems, filters, currentUserId);

  const searchedItems = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return filteredItems;
    return filteredItems.filter((item) =>
      [item.name, item.notes, item.where_to_buy, item.room].some((f) => (f ?? '').toLowerCase().includes(q))
    );
  }, [filteredItems, search]);

  const groupedByRoom = React.useMemo(() => groupSetupByRoom(searchedItems), [searchedItems]);

  // HOUP-129: the reorder-mode mirror of groupedByRoom, grouped directly off
  // the unfiltered allSetupItems (already sort_order-sorted). groupedByRoom
  // reflects filter *state* (statusFilters/roomFilter/storeFilter/mineOnly/
  // search), not whether the filter chips are rendered, so hiding them alone
  // would still feed drag from a filtered subset and corrupt sort_order for
  // hidden items. Reorder mode must always read from here, never groupedByRoom.
  const reorderGroupedByRoom = React.useMemo(() => groupSetupByRoom(allSetupItems), [allSetupItems]);

  const existingRooms = React.useMemo(() => setupRoomNames(allSetupItems), [allSetupItems]);

  const overall = summarize(allSetupItems);
  const doneCount = overall.total - overall.outstanding;

  const topRoomSummaries = React.useMemo(() => topSetupRooms(allSetupItems), [allSetupItems]);

  const moveItem = React.useCallback(
    (roomItems: SetupItem[], index: number, direction: -1 | 1) => {
      moveInRoom(roomItems, index, index + direction).forEach(({ id, sort_order }) => patchRow(id, { sort_order }));
    },
    [patchRow]
  );

  // HOUP-129: drag-reorder commit — nextOrderedIds is the room's full next id
  // order from ReorderableList, sourced from reorderGroupedByRoom above, so
  // this always reindexes every item in the room (never a filtered subset).
  const reorderRoom = (nextOrderedIds: string[]) => {
    reindexRoomOrder(nextOrderedIds).forEach(({ id, sort_order }) => patchRow(id, { sort_order }));
  };

  // HOUP-174: shopping-trip rollup for the active store filter (header prop).
  const storeTrip = React.useMemo(() => setupStoreTrip(filteredItems, storeFilter, stores), [storeFilter, filteredItems, stores]);

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
              commentCount={commentSummaries[row.item.id]?.count ?? 0}
              docLink={docsOn ? docLinksByItem[row.item.id] : undefined}
              onCommentsChanged={refreshComments}
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
      commentSummaries,
      docLinksByItem,
      docsOn,
      refreshComments,
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

  const viewSwitch = careOn ? (
    <SegmentedControl
      options={[
        { value: 'setup' as const, label: 'Setting up' },
        { value: 'care' as const, label: 'Care' },
      ]}
      value={view}
      onChange={setView}
      size="sm"
      accessibilityLabel="Home Setup view"
    />
  ) : null;

  if (careOn && view === 'care') {
    return (
      <ScreenBackground>
        <CareView
          header={viewSwitch}
          groupId={group.id}
          currentUserId={currentUserId}
          region={group.region}
          groupMembers={groupMembers}
          memberProfiles={memberProfiles}
          setupRooms={existingRooms}
        />
      </ScreenBackground>
    );
  }

  const listHeaderElement = (
    <View className="gap-4">
    {viewSwitch}
    <SetupListHeader
      allItemsCount={allSetupItems.length}
      reorderMode={reorderMode}
      onExitReorderMode={exitReorder}
      selectMode={selectMode}
      onToggleSelectMode={toggleSelectMode}
      onRefresh={() => void refresh()}
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
      onToggleMineOnly={toggleMineOnly}
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
    </View>
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
                            commentCount={commentSummaries[item.id]?.count ?? 0}
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
                onPress={startReorder}
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
              onPress={clearOrExitSelect}
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
        onStoreCreated={addStore}
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
