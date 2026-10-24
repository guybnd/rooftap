'use client';

import { useState, useEffect, useCallback } from 'react';
import { useDataCache } from '@/lib/data-cache';
import { createClient } from '@/lib/supabase/client';
import {
  STATUS_ORDER,
  summarize,
  useModules,
  SETUP_STATUS_LABEL,
  SETUP_STATUS_SEGMENTS,
  currencySymbol,
  filterSetupItems,
  groupSetupByRoom,
  moveInRoom,
  setupHeroCaption,
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
import { dialog } from '@homeup/core';
import { ListGroup } from '@/components/ui/list-item';
import type { SetupItem } from '@homeup/core';
import { SetupItemModal } from './setup-item-modal';
import { SortableSetupItem } from './setup-sortable-item';
import { SectionSearchBar } from '@/components/section-search-bar';
import { useFuzzySearch } from '@/hooks/use-fuzzy-search';
import { QuickAddCard } from './setup-quick-add';
import { BudgetSummary } from './budget-summary';
import { SegmentedBar } from './segmented-bar';
import { PulseTile } from '@/components/ui/pulse-tile';
import { HeroLede } from '@/components/ui/hero-lede';
import { ModuleSettingsButton } from '@/components/module-settings-sheet';
import { LeadingTile } from '@/components/ui/leading-tile';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { PopMenu, MenuItem, MenuLabel } from './pop-menu';
import { STATUS_FILL } from './setup-status';
import {
  Plus,
  RotateCw,
  Sparkles,
  Store,
  ChevronDown,
  CheckSquare,
  ArrowUpDown,
  Trash2,
  X,
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useWideLayout } from '@/lib/desktop-layout';
import { CareView } from './care/care-view';
import { cn } from '@/lib/utils';

// FLUX-150 slice 3: Legend-State local-first migration. The list state and
// its view logic are shared with mobile from @homeup/core (use-setup-list.ts,
// setup-list-view.ts); this file only renders.

// Header and filter controls share one height: 44px on phones (M2), compact
// on desktop.
const CONTROL_H = 'h-11 sm:h-9';

const BAR_BUTTON =
  'flex h-9 shrink-0 items-center gap-1 rounded-lg border border-border bg-secondary/60 px-2.5 text-xs font-medium text-secondary-foreground hover:bg-secondary';

type SetupView = 'setup' | 'care';
const VIEW_SEGMENTS: { value: SetupView; label: string }[] = [
  { value: 'setup', label: 'Setting up' },
  { value: 'care', label: 'Care' },
];

const money = (n: number) => `${currencySymbol()}${n.toLocaleString()}`;

export default function SetupPage() {
  const { group, loading: cacheLoading, currentUserId, groupMembers, memberProfiles } = useDataCache();

  const {
    items: allSetupItems,
    loaded: storeLoaded,
    writeRow,
    patchRow,
    softDeleteRow,
    refresh,
  } = useSetupItems(group?.id, currentUserId);

  // Modules: the "Doc" chip on a setup item needs documents and setup (module-features.ts).
  const modules = useModules();
  const docsOn = modules.feature('documents.setup');

  // Home care (module `home-care`) is Setup's second view: ?view=care, so a
  // care reminder opened from Home or a push lands on it.
  const careOn = modules.isEnabled('home-care');
  const [view, setView] = useState<SetupView>('setup');
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('view') === 'care') setView('care');
  }, []);
  const switchView = useCallback((next: SetupView) => {
    setView(next);
    const url = new URL(window.location.href);
    if (next === 'care') url.searchParams.set('view', 'care');
    else url.searchParams.delete('view');
    window.history.replaceState(window.history.state, '', url);
  }, []);

  const { stores, addStore } = useSetupStores(group?.id, createClient);
  const wide = useWideLayout();
  const { commentSummaries, docLinks: docLinksByItem, refreshComments } = useSetupRowPortals({
    groupId: group?.id,
    getClient: createClient,
    loaded: storeLoaded,
    items: allSetupItems,
    docsOn,
  });
  const filters = useSetupFilters({ restoreAfterMount: true });
  const { search, setSearch, roomFilter, setRoomFilter, storeFilter, setStoreFilter, statusSegment, setStatusSegment, mineOnly, toggleMineOnly } = filters;
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
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<SetupItem | undefined>();
  const [defaultRoom, setDefaultRoom] = useState('');
  const [notice, setNotice] = useSetupNotice();
  const { isSeeding, seed: handleSeedTemplates } = useSeedSetupTemplates({
    groupId: group?.id,
    getClient: createClient,
    refresh,
    onNotice: setNotice,
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Reorder items within a room: update sort_order in Legend (queued Supabase sync).
  const handleReorder = (roomItems: SetupItem[], event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = roomItems.findIndex((i) => i.id === active.id);
    const newIndex = roomItems.findIndex((i) => i.id === over.id);
    moveInRoom(roomItems, oldIndex, newIndex).forEach(({ id, sort_order }) => {
      patchRow(id, { sort_order } as Partial<SetupItem>);
    });
  };

  const bulkUpdate = (payload: Partial<SetupItem>) => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    ids.forEach((id) => patchRow(id, payload));
    exitSelectMode();
  };

  const bulkDelete = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const confirmed = await dialog.confirm({
      title: `Delete ${ids.length} item${ids.length === 1 ? '' : 's'}?`,
      message: 'This cannot be undone.',
      destructive: true,
    });
    if (!confirmed) return;
    ids.forEach((id) => softDeleteRow(id));
    exitSelectMode();
  };

  // Client-side filters: room, store, status, mine only.
  const filteredItems = filterSetupItems(allSetupItems, filters, currentUserId);

  const searchedItems = useFuzzySearch(filteredItems, search, ['name', 'notes', 'where_to_buy', 'room']);

  // Reorder mode always works on the unfiltered list (as on mobile): reindexing
  // a filtered subset would scramble the order of the hidden items.
  const groupedByRoom = groupSetupByRoom(reorderMode ? allSetupItems : searchedItems);

  const existingRooms = setupRoomNames(allSetupItems);

  const overall = summarize(allSetupItems);
  const doneCount = overall.total - overall.outstanding;

  // Per-room summaries for the pulse strip's top-rooms tiles (Hearth 5 /
  // FLUX-277), unfiltered so the tiles read as stable overview stats.
  const topRoomSummaries = topSetupRooms(allSetupItems);

  const storeTrip = setupStoreTrip(filteredItems, storeFilter, stores);

  if (cacheLoading || (!storeLoaded && allSetupItems.length === 0)) {
    return <div className="p-6 text-muted-foreground">Loading...</div>;
  }

  if (!group) {
    return <div className="p-6 text-muted-foreground">No group selected</div>;
  }

  const selectControlClass = `${CONTROL_H} w-full min-w-0 rounded-lg border border-input bg-input px-3 text-xs font-medium text-foreground focus:outline-none focus:border-ring sm:w-auto`;
  const headerButtonClass = `flex ${CONTROL_H} items-center justify-center gap-1.5 rounded-xl border text-sm font-medium transition-colors`;

  const viewSwitch = careOn ? (
    <SegmentedControl
      options={VIEW_SEGMENTS}
      value={view}
      onChange={switchView}
      size="sm"
      ariaLabel="Home Setup view"
      className="w-full sm:w-auto"
    />
  ) : null;

  if (careOn && view === 'care') {
    return (
      <div className={cn('space-y-5 p-4 md:p-6 mx-auto pb-24', wide ? 'max-w-[1400px] lg:px-8' : 'max-w-5xl')}>
        {viewSwitch}
        <CareView
          groupId={group?.id}
          currentUserId={currentUserId}
          region={group?.region}
          groupMembers={groupMembers}
          memberProfiles={memberProfiles}
          setupRooms={Array.from(new Set(allSetupItems.map((i) => i.room).filter(Boolean)))}
        />
      </div>
    );
  }

  return (
    <div className={cn('space-y-5 p-4 md:p-6 mx-auto pb-24', wide ? 'max-w-[1400px] lg:px-8' : 'max-w-5xl')}>
      {viewSwitch}
      {/* Hearth v2 (Pulse, H1): what's still to get is the page's Hero lede,
          with its own meter once something is done (H3); the actions sit
          beside it. Title + tagline stay removed (FLUX-187/190): the nav
          names the section. */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <HeroLede
          value={overall.outstanding}
          label="to get"
          meter={doneCount > 0 ? { done: doneCount, total: overall.total } : undefined}
          caption={setupHeroCaption(overall, money)}
        />
        <div className="flex items-center gap-2">
          {reorderMode ? (
            <button
              onClick={exitReorder}
              className={`${headerButtonClass} border-primary/40 bg-primary/15 px-4 text-primary`}
            >
              Done
            </button>
          ) : (
            allSetupItems.length > 0 && (
              <button
                onClick={toggleSelectMode}
                aria-pressed={selectMode}
                className={`${headerButtonClass} px-3.5 ${
                  selectMode
                    ? 'border-primary/40 bg-primary/15 text-primary'
                    : 'border-border bg-secondary text-secondary-foreground hover:bg-accent'
                }`}
              >
                <CheckSquare className="h-4 w-4" />
                {selectMode ? 'Done' : 'Select'}
              </button>
            )
          )}
          <button
            onClick={() => void refresh()}
            className={`${headerButtonClass} aspect-square border-border bg-secondary text-secondary-foreground hover:bg-accent`}
            aria-label="Refresh"
          >
            <RotateCw className="h-4 w-4" />
          </button>
          <ModuleSettingsButton moduleId="setup" className={`${headerButtonClass} aspect-square w-auto border-border bg-secondary text-secondary-foreground hover:bg-accent`} />
          <button
            onClick={() => {
              setEditingItem(undefined);
              setDefaultRoom('');
              setIsModalOpen(true);
            }}
            className={`${headerButtonClass} border-transparent bg-primary px-4 text-primary-foreground hover:bg-primary/80`}
          >
            <Plus className="h-4 w-4" />
            Add item
          </button>
        </div>
      </div>

      {/* Pulse strip (Hearth 5 / FLUX-277): per-room bars stay local (H3).
          With a single room its tile would restate the Hero number (H1), so
          room tiles show only once there are two or more rooms. */}
      {overall.total > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {topRoomSummaries.length > 1 &&
            topRoomSummaries.map((r) => (
              <PulseTile
                key={r.room}
                label={r.room}
                value={r.outstanding > 0 ? `${r.outstanding} left` : 'Done'}
                meter={{ value: r.total - r.outstanding, total: r.total }}
                tone={r.outstanding === 0 ? 'success' : 'neutral'}
              />
            ))}
          <PulseTile
            label="Budget left"
            value={money(Math.max(0, overall.est - overall.spent))}
            meter={{ value: overall.spent, total: overall.est }}
            tone={overall.spent > overall.est ? 'danger' : 'neutral'}
          />
        </div>
      )}

      {notice && (
        <div className="rounded-3xl border border-border/60 bg-card px-4 py-3 text-sm text-foreground shadow-[var(--card-shadow)]">
          {notice}
        </div>
      )}

      {reorderMode && (
        <div className="rounded-3xl border border-border/60 bg-card px-4 py-3 text-sm text-muted-foreground shadow-[var(--card-shadow)]">
          Drag the handle to reorder items within a room
        </div>
      )}

      {/* Filters (H5): owned by the item list below, not a floating panel —
          inset controls sitting directly above the list they scope, no
          second border level (H4). Only position changed; behavior identical. */}
      {allSetupItems.length > 0 && !reorderMode && (
        <div className="space-y-2.5">
          <SectionSearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search items…"
            className="max-w-none"
          />
          <div className="flex items-center gap-2">
            <SegmentedControl
              options={SETUP_STATUS_SEGMENTS}
              value={statusSegment}
              onChange={setStatusSegment}
              size="sm"
              ariaLabel="Filter by status"
              className={`${CONTROL_H} flex-1 sm:flex-none`}
            />
            <button
              onClick={toggleMineOnly}
              aria-pressed={mineOnly}
              className={`${CONTROL_H} shrink-0 whitespace-nowrap rounded-lg border px-3 text-xs font-medium transition-colors ${
                mineOnly
                  ? 'border-primary/40 bg-primary/15 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              Mine only
            </button>
          </div>

          <div className={`grid gap-2 sm:flex ${stores.length > 0 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <select
              value={roomFilter ?? ''}
              onChange={(e) => setRoomFilter(e.target.value || null)}
              className={selectControlClass}
              aria-label="Room"
            >
              <option value="">All rooms</option>
              {existingRooms.map((room) => (
                <option key={room} value={room}>{room}</option>
              ))}
            </select>

            {stores.length > 0 && (
              <select
                value={storeFilter ?? ''}
                onChange={(e) => setStoreFilter(e.target.value || null)}
                className={selectControlClass}
                aria-label="Store"
              >
                <option value="">All stores</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}
          </div>
        </div>
      )}

      {/* Store shopping-trip summary */}
      {storeTrip && (() => {
        const trip = storeTrip;
        const bought = trip.total - trip.outstanding;
        const storeName = trip.storeName;
        return (
          // H2: a neutral card with the Setup tile; coral is for controls.
          <div className="sticky top-0 z-20 space-y-2.5 rounded-3xl border border-border/60 bg-card px-4 py-3 shadow-[var(--card-shadow)]">
            <div className="flex items-center gap-3">
              <LeadingTile sectionId="setup" Icon={Store} size="md" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground">{storeName}</div>
                <div className="text-xs tabular-nums text-muted-foreground">
                  {bought} of {trip.total} bought
                </div>
              </div>
              <div className="shrink-0 text-right tabular-nums">
                <span className="text-sm font-semibold text-foreground">{money(trip.est)}</span>
                <span className="ml-1 text-xs text-muted-foreground">est</span>
              </div>
            </div>
            <SegmentedBar counts={trip.counts} />
          </div>
        );
      })()}

      {/* Items grouped by room. Hearth §13.7 "Desktop shell": on a wide
          screen the rooms flow into columns, like Groceries' aisles. */}
      <div className={wide && groupedByRoom.size > 0 ? 'columns-2 gap-5 xl:columns-3 [&>*]:mb-4 [&>*]:break-inside-avoid' : 'space-y-3'}>
        {groupedByRoom.size === 0 ? (
          <div className="space-y-3 rounded-3xl border border-border/60 bg-card p-10 text-center shadow-[var(--card-shadow)]">
            <p className="text-muted-foreground">
              {allSetupItems.length === 0
                ? 'No setup items yet. Add items room by room, or start from a ready-made list.'
                : 'No items match the current filters.'}
            </p>
            {allSetupItems.length === 0 && (
              <button
                onClick={handleSeedTemplates}
                disabled={isSeeding}
                className={`inline-flex ${CONTROL_H} items-center gap-1.5 rounded-xl border border-border bg-secondary px-4 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent disabled:opacity-50`}
              >
                <Sparkles className="h-4 w-4" />
                {isSeeding ? 'Adding…' : 'Add starter items'}
              </button>
            )}
          </div>
        ) : (
          Array.from(groupedByRoom.entries()).map(([room, roomItems]) => {
            const collapsed = collapsedRooms.has(room);
            const roll = summarize(roomItems);
            return (
              // H4: no group-level border here — the header is plain text/controls
              // sitting above the single bordered `ListGroup` for this room's items.
              <div key={room}>
                <button
                  onClick={() => toggleRoomCollapsed(room)}
                  aria-expanded={!collapsed}
                  className="flex min-h-11 w-full items-center gap-3 px-1 py-2 text-left"
                >
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform ${collapsed ? '-rotate-90' : ''}`}
                  />
                  <span className="flex-shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    {room} <span className="tabular-nums">({roomItems.length})</span>
                  </span>
                  <span className="hidden sm:block flex-1 max-w-[180px]">
                    <SegmentedBar counts={roll.counts} />
                  </span>
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground flex-shrink-0">
                    <span className="text-foreground font-medium">{money(roll.est)}</span>
                    {roll.outstanding > 0 && (
                      <span className="text-muted-foreground"> · {roll.outstanding} to buy</span>
                    )}
                  </span>
                </button>

                {!collapsed && (
                  <div className="pb-3 space-y-2">
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={(event) => handleReorder(roomItems, event)}
                    >
                      <SortableContext items={roomItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                        <ListGroup>
                          {roomItems.map((item) => (
                            <SortableSetupItem
                              key={item.id}
                              item={item}
                              reorderMode={reorderMode}
                              commentSummary={commentSummaries[item.id]}
                              docLink={docsOn ? docLinksByItem[item.id] : undefined}
                              groupId={group.id}
                              stores={stores}
                              selectMode={selectMode}
                              selected={selectedIds.has(item.id)}
                              onToggleSelect={toggleSelect}
                              onUpdate={(updatedItem) => {
                                // Inline card edit — patch through the store (offline-safe).
                                patchRow(updatedItem.id, updatedItem);
                              }}
                              onDelete={(itemId) => {
                                // Inline card delete — soft-delete via the store (offline-safe).
                                softDeleteRow(itemId);
                              }}
                              onEdit={(it) => {
                                setEditingItem(it);
                                setIsModalOpen(true);
                              }}
                              onCommentsChanged={refreshComments}
                              onStoreCreated={addStore}
                            />
                          ))}
                        </ListGroup>
                      </SortableContext>
                    </DndContext>
                    {!selectMode && !reorderMode && (
                      <QuickAddCard
                        groupId={group.id}
                        room={room}
                        onCreated={(item) => {
                          // QuickAddCard builds the row; write it through the store
                          // (offline-safe — stamps created_by/timestamps).
                          writeRow(item);
                        }}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Budget summary */}
      {allSetupItems.length > 0 && (
        <div>
          <h2 className="mb-1 flex min-h-11 items-center px-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Budget
          </h2>
          <BudgetSummary items={allSetupItems} />
        </div>
      )}

      {/* Select-mode action bar (mirrors mobile): Reorder needs no selection,
          so the bar shows for the whole of select mode; bulk edits join it
          once something is checked. On phones it floats above the tab bar
          and its capture button, which would otherwise cover it. */}
      {selectMode && (
        <div className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:bottom-4 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-1.5 rounded-2xl border border-border bg-popover px-2.5 py-2 shadow-xl shadow-black/40">
          <span className="whitespace-nowrap px-1.5 text-sm tabular-nums text-foreground">
            {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select items'}
          </span>

          {selectedIds.size === 0 && (
            <button
              onClick={startReorder}
              className={BAR_BUTTON}
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              Reorder
            </button>
          )}

          {selectedIds.size > 0 && (
            <>
              <PopMenu
                align="left"
                width="w-40"
                triggerLabel="Set status"
                triggerClassName={BAR_BUTTON}
                trigger={<>Status <ChevronDown className="h-3.5 w-3.5" /></>}
              >
                {(close) => (
                  <>
                    <MenuLabel>Set status</MenuLabel>
                    {STATUS_ORDER.map((s) => (
                      <MenuItem
                        key={s}
                        icon={<span className={`h-2.5 w-2.5 rounded-full ${STATUS_FILL[s]}`} />}
                        onClick={() => {
                          bulkUpdate({ status: s } as Partial<SetupItem>);
                          close();
                        }}
                      >
                        {SETUP_STATUS_LABEL[s]}
                      </MenuItem>
                    ))}
                  </>
                )}
              </PopMenu>

              {stores.length > 0 && (
                <PopMenu
                  align="left"
                  width="w-44"
                  triggerLabel="Set store"
                  triggerClassName={BAR_BUTTON}
                  trigger={<>Store <ChevronDown className="h-3.5 w-3.5" /></>}
                >
                  {(close) => (
                    <>
                      <MenuLabel>Set store</MenuLabel>
                      <MenuItem
                        onClick={() => {
                          bulkUpdate({ store_id: null } as Partial<SetupItem>);
                          close();
                        }}
                      >
                        No store
                      </MenuItem>
                      {stores.map((s) => (
                        <MenuItem
                          key={s.id}
                          onClick={() => {
                            bulkUpdate({ store_id: s.id } as Partial<SetupItem>);
                            close();
                          }}
                        >
                          {s.name}
                        </MenuItem>
                      ))}
                    </>
                  )}
                </PopMenu>
              )}

              {/* E4: destructive is danger text, no fill. */}
              <button onClick={bulkDelete} className={`${BAR_BUTTON} text-destructive`}>
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </>
          )}

          <button
            onClick={clearOrExitSelect}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={selectedIds.size > 0 ? 'Clear selection' : 'Exit select mode'}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <SetupItemModal
        key={editingItem?.id ?? `new-${defaultRoom}`}
        isOpen={isModalOpen}
        item={editingItem}
        groupId={group.id}
        existingRooms={existingRooms}
        stores={stores}
        defaultRoom={defaultRoom}
        onStoreCreated={addStore}
        onClose={() => {
          setIsModalOpen(false);
          setEditingItem(undefined);
          setDefaultRoom('');
        }}
        onSave={(saved) => {
          // Modal builds the row; write it through the store (offline-safe —
          // classifies insert vs update and stamps created_by).
          writeRow(saved);
          setIsModalOpen(false);
          setEditingItem(undefined);
          setDefaultRoom('');
        }}
        onDelete={() => {
          // Modal requested delete — soft-delete via the store (offline-safe).
          if (editingItem?.id) softDeleteRow(editingItem.id);
          setIsModalOpen(false);
          setEditingItem(undefined);
          setDefaultRoom('');
        }}
      />
    </div>
  );
}
