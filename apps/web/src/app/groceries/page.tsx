'use client';

import { HeroLede } from '@/components/ui/hero-lede';
import { Fragment, useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import { use$ } from '@legendapp/state/react';
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  DragOverlay,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDataCache } from '@/lib/data-cache';
import { createClient } from '@/lib/supabase/client';
import type { GroceryItem, GroceryAisle, GroceryCustomAisle, GrocerySession, GrocerySortMode } from '@homeup/core';
import { dialog, POP_IN_HOLD_MS } from '@homeup/core';
import { useArrivals } from '@/hooks/use-arrivals';
import {
  AISLE_META,
  AISLE_COLOR,
  AISLE_ORDER,
  CUSTOM_AISLE_COLOR_KEYS,
  getAisleMeta,
  getAisleColor,
  countNeeded,
  countBought,
  countHave,
  formatMoney,
  suggestReAdd,
  grocerySearchAddOptions,
  groceryAislesMatching,
  parseGroceryEntry,
  canonicalizeItemName,
  sortGroceriesFlat,
  DEFAULT_GROCERY_SORT_MODE,
  GROCERY_SHOW_KEY,
  parseGroceryShow,
  type GroceryShowFilter,
} from '@homeup/core';
import {
  Plus,
  CheckSquare,
  ChevronDown,
  Trash2,
  X,
  ArrowRightLeft,
  GripVertical,
  BookOpen,
  WalletCards,
  LayoutList,
  MoreHorizontal,
  Search,
  ArrowUpDown,
  Receipt,
  RotateCcw,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { GroceryItemCard, GroceryItemCardStandalone } from './grocery-item-card';
import { ListGroup } from '@/components/ui/list-item';
import { GroceryItemModal } from './grocery-item-modal';
import { SectionSearchBar } from '@/components/section-search-bar';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useFuzzySearch } from '@/hooks/use-fuzzy-search';
import { PopMenu, MenuItem, MenuLabel } from '../setup/pop-menu';
import { memberLabel } from '../setup/member-label';
import { getRegionProvider, groceryItems$, loyaltyCards$, sortLoyaltyCards, type LoyaltyCard, useReconnectSync, useStoreHelpers, useStoreLoaded, createPendingActionTracker, usePendingIds, createUndoBatchTracker } from '@homeup/core';
import { fetchItemLibrary, buildLibraryMap, resolveItemDefaults, learnItemLibrary, type LibraryOverride } from '@homeup/core';
import { TrackShopPrompt, ShopTrackingPill, FinishShopSheet, TrackShopLink } from './grocery-session-panel';
import { uploadReceipt } from '@/lib/grocery-sessions';
import { parseReceiptFile } from '@/lib/grocery-receipt-parse';
import { RewardsCardsSheet } from './rewards-cards-sheet';
import { fetchTodaySession, isBoughtToday, syncSession, todayStr, closeSession, updateSession as updateGrocerySession, effectiveSessionTotal, applyReceiptLearning, getEnabledModules, isFeatureEnabled } from '@homeup/core';
import { useGroupTableRealtime } from '@/lib/hooks/use-group-table-realtime';
import { ReAddSuggestions } from './re-add-suggestions';
import { GrocerySearchAdd } from './grocery-search-add';
import { useSuggestDismiss } from './use-suggest-dismiss';
import { toastUndoDelete } from '@/lib/undo-toast';
import { useGroceryUndo } from './use-grocery-undo';
import { GroceryGlyph } from '@/components/grocery-glyph';
import { useMediaQuery, useWideLayout } from '@/lib/desktop-layout';
import { prefersStillMotion } from "@/lib/still-motion";

const SHOPPING_TOOLTIP_KEY = 'homeup_shopping_tooltip_dismissed';

// "This trip" card verbs: small secondary pills, neutral (H5), 44px tall (M2).
const TRIP_PILL_CLASS =
  'inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-muted px-4 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50';
const AISLE_ORDER_KEY = 'homeup_grocery_aisle_order';

function loadAisleOrder(): string[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(AISLE_ORDER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveAisleOrder(order: string[]) {
  try { localStorage.setItem(AISLE_ORDER_KEY, JSON.stringify(order)); } catch { /* noop */ }
}

const SORT_MODE_KEY = 'homeup_grocery_sort_mode';

function isGrocerySortMode(v: unknown): v is GrocerySortMode {
  return v === 'aisle' || v === 'flat';
}

function loadSortMode(): GrocerySortMode | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SORT_MODE_KEY);
    return isGrocerySortMode(raw) ? raw : null;
  } catch { return null; }
}

function saveSortMode(mode: GrocerySortMode) {
  try { localStorage.setItem(SORT_MODE_KEY, mode); } catch { /* noop */ }
}

const COLLAPSED_AISLES_KEY = 'homeup_grocery_collapsed_aisles';

function loadCollapsedAisles(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(COLLAPSED_AISLES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveCollapsedAisles(ids: string[]) {
  try { localStorage.setItem(COLLAPSED_AISLES_KEY, JSON.stringify([...ids])); } catch { /* noop */ }
}

export default function GroceriesPage() {
  const { group, groupMembers, memberProfiles, userSettings, currentUserId, refresh: refreshCache, loading: cacheLoading } = useDataCache();

  // FLUX-149: grocery_items is now a local-first Legend-State store (synced to
  // Supabase, persisted to IndexedDB, offline-durable writes). `items` is a
  // derived sorted array so all the read logic below is unchanged.
  const items$ = groceryItems$(group?.id);
  // Reactive derived array. use$ with a SELECTOR re-runs whenever the store
  // changes (add / check-off / soft-delete) and returns a fresh array, so React
  // re-renders. Reading the observable value directly returns a stable proxy
  // reference that wouldn't trip a downstream useMemo (the offline-write bug).
  const allItems = use$(() => {
    const rec = items$.get() ?? {};
    return Object.values(rec)
      .filter((i): i is GroceryItem => !!i && !i.deleted)
      // created_at is transiently null on an optimistic create until it syncs.
      .sort((a, b) => (a.sort_order - b.sort_order) || (a.created_at ?? '').localeCompare(b.created_at ?? ''));
  });
  // Locally-hidden ids during the 5s undo window (DB untouched until commit).
  // Still used by Archive/Done-shopping's own undo flow below (unchanged);
  // Delete no longer uses this — see handleRequestDelete.
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set());
  const items = useMemo(
    () => allItems.filter((i) => !pendingDeleteIds.has(i.id)),
    [allItems, pendingDeleteIds],
  );

  // Write helpers via the shared factory (bakes in all FLUX-149 gotchas).
  useReconnectSync(items$);
  const { writeRow: writeItem, patchRow: patchItem, softDeleteRow: softDeleteItem } =
    useStoreHelpers(items$, currentUserId);
  const storeLoaded = useStoreLoaded(items$);

  // Rewards cards: local-first like the list itself, so a card still opens
  // at the checkout with no signal.
  const cards$ = loyaltyCards$(group?.id);
  useReconnectSync(cards$);
  const { writeRow: writeCard, softDeleteRow: softDeleteCard } = useStoreHelpers(cards$, currentUserId);
  const cards = use$(() =>
    sortLoyaltyCards(Object.values(cards$.get() ?? {}).filter((c): c is LoyaltyCard => !!c && !c.deleted))
  );
  const [cardsOpen, setCardsOpen] = useState(false);

  // HOUP-245: tick-off "linger" (checking an item off while "Only needed" is on
  // would otherwise remove it from view instantly) + the delete-undo pill. One
  // instance per screen — see pending-actions.ts for the grace-window contract.
  const pendingTracker = useMemo(() => createPendingActionTracker(), []);
  const pendingIds = usePendingIds(pendingTracker);
  const undoBatchTracker = useMemo(() => createUndoBatchTracker<GroceryItem>(() => {}), []);

  // Wraps the card's onUpdate to arm/disarm the linger timer whenever a card
  // flips an item away from/back to 'needed' — the only status transition that
  // can make "Only needed" hide a row (see the `visible` filter below).
  const handleItemUpdate = useCallback(
    (updated: GroceryItem) => {
      const prev = allItems.find((i) => i.id === updated.id);
      if (prev && prev.status === 'needed' && updated.status !== 'needed') {
        pendingTracker.schedule(updated.id, () => {});
      } else if (prev && prev.status !== 'needed' && updated.status === 'needed') {
        pendingTracker.cancel(updated.id);
      }
      writeItem(updated);
    },
    [allItems, pendingTracker, writeItem],
  );

  const [loading, setLoading] = useState(true);

  const [customAisles, setCustomAisles] = useState<GroceryCustomAisle[]>([]);
  const [library, setLibrary] = useState<LibraryOverride[]>([]);
  const [session, setSession] = useState<GrocerySession | null>(null);
  const sessionSyncRef = useRef<string>('');
  // Today's shop floating layers: the pill's receipt read and the finish sheet.
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const receiptInputRef = useRef<HTMLInputElement>(null);
  // What the picked receipt is for: the pill's Receipt, or the sheet's finish.
  const receiptIntentRef = useRef<'add' | 'finish'>('add');
  // Set whenever a realtime echo arrives, so the session-sync effect can tell a
  // remote-driven run from a local one and avoid a multi-device sync ping-pong.
  const remoteUpdateRef = useRef(false);

  // The Show switch (To buy / Everything), remembered in localStorage and
  // hydrated in an effect below to keep SSR and the client in step.
  const [show, setShow] = useState<GroceryShowFilter>(() => parseGroceryShow(null));
  const hideNonNeeded = show === 'needed';
  const [sortMode, setSortMode] = useState<GrocerySortMode>(DEFAULT_GROCERY_SORT_MODE);
  const [search, setSearch] = useState('');
  // While a query is active the list shows every match: "Only needed" would
  // otherwise hide a have/bought item you searched for with no way to tell.
  const searching = search.trim().length > 0;
  const filterNeeded = hideNonNeeded && !searching;
  const [showShoppingTooltip, setShowShoppingTooltip] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<GroceryItem | undefined>();
  const [defaultAisle, setDefaultAisle] = useState<string>('other');

  const [aisleOrder, setAisleOrder] = useState<string[]>(AISLE_ORDER as string[]);
  const wide = useWideLayout();
  const twoAisleColumns = useMediaQuery('(min-width: 1280px)');
  const [collapsedAisles, setCollapsedAisles] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  // Reorder aisles (More menu, By aisle only): aisles fold to their headers
  // and the drag grip shows at every width, phones included.
  const [reorderMode, setReorderMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkSaving, setIsBulkSaving] = useState(false);

  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [activeAisleId, setActiveAisleId] = useState<string | null>(null);

  // Custom aisle form state
  const [showAddAisle, setShowAddAisle] = useState(false);
  const [newAisleName, setNewAisleName] = useState('');
  const [newAisleColor, setNewAisleColor] = useState<string>(CUSTOM_AISLE_COLOR_KEYS[0]);
  const [addingAisle, setAddingAisle] = useState(false);

  // FLUX-65: aisle order now syncs via user_settings.grocery_aisle_order.
  // Hydrate once — DB wins when present, else the legacy localStorage mirror.
  const aisleHydratedRef = useRef(false);
  useEffect(() => {
    if (cacheLoading || aisleHydratedRef.current) return;
    aisleHydratedRef.current = true;
    const dbOrder = userSettings?.grocery_aisle_order;
    const saved = Array.isArray(dbOrder) && dbOrder.length ? dbOrder : loadAisleOrder();
    if (saved?.length) {
      const extra = (AISLE_ORDER as string[]).filter((a) => !saved.includes(a));
      setAisleOrder([...saved, ...extra]);
    }
    // HOUP-317: hydrate the list view mode the same way, but the mirror is a
    // *pending* marker (see persistSortMode) rather than a fallback — it only
    // exists while a write is unconfirmed, so it must win over a DB value that
    // predates it. A confirmed write clears the mirror, so the DB is consulted
    // whenever there's nothing pending. Sorting no longer touches the Show
    // switch: that has its own control now.
    const dbMode = userSettings?.grocery_sort_mode;
    const savedMode = loadSortMode() ?? (isGrocerySortMode(dbMode) ? dbMode : null);
    if (savedMode) setSortMode(savedMode);
  }, [cacheLoading, userSettings]);

  useEffect(() => {
    try {
      setShow(parseGroceryShow(localStorage.getItem(GROCERY_SHOW_KEY)));
    } catch {
      /* storage blocked: keep the default */
    }
  }, []);
  const handleShowChange = useCallback((next: GroceryShowFilter) => {
    setShow(next);
    try { localStorage.setItem(GROCERY_SHOW_KEY, next); } catch { /* noop */ }
  }, []);

  // Hydrate collapsed-aisle state from localStorage once on mount. Done in an
  // effect (not a lazy useState initializer) to avoid an SSR/client hydration
  // mismatch, matching the aisle-order hydration pattern above.
  const collapsedHydratedRef = useRef(false);
  useEffect(() => {
    if (collapsedHydratedRef.current) return;
    collapsedHydratedRef.current = true;
    const saved = loadCollapsedAisles();
    if (saved.length) setCollapsedAisles(new Set(saved));
  }, []);

  const persistAisleOrder = useCallback(async (order: string[]) => {
    saveAisleOrder(order); // localStorage mirror (offline / first paint)
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase
        .from('user_settings')
        .upsert(
          { user_id: user.id, grocery_aisle_order: order, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        );
      refreshCache();
    } catch {
      /* offline — localStorage mirror still holds the order */
    }
  }, [refreshCache]);

  const persistSortMode = useCallback(async (mode: GrocerySortMode) => {
    // Written unconditionally up front, mirroring persistAisleOrder: neither
    // an offline getUser() nor a failed upsert throws (both Supabase client
    // libraries swallow the error and resolve normally), so a marker written
    // only in `catch` would never see an offline change. It is removed below
    // only once the write is actually confirmed.
    saveSortMode(mode);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return; // unconfirmed — marker stays
      const { error } = await supabase
        .from('user_settings')
        .upsert(
          { user_id: user.id, grocery_sort_mode: mode, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        );
      if (error) return; // unconfirmed — marker stays
      // The DB write is confirmed, so it — not the mirror — is now the source
      // of truth; clear the pending marker or a stale mirror value would win
      // at the next hydration and mask this device's own successful write.
      localStorage.removeItem(SORT_MODE_KEY);
      refreshCache();
    } catch {
      /* unconfirmed — marker stays */
    }
  }, [refreshCache]);

  const handleSortModeChange = useCallback((mode: GrocerySortMode) => {
    if (mode === sortMode) return;
    setSortMode(mode);
    void persistSortMode(mode);
  }, [sortMode, persistSortMode]);

  useEffect(() => {
    const dismissed = localStorage.getItem(SHOPPING_TOOLTIP_KEY);
    if (!dismissed) setShowShoppingTooltip(true);
  }, []);

  // ── Collapse on scroll ─────────────────────────────────────────────────────
  // Once the compact head (lede row + search row) has scrolled out of view, a
  // slim sticky bar takes over its verbs. An IntersectionObserver on the head,
  // not a per-frame scroll listener; root is the viewport, and IO clips by the
  // route region's own scroller, so it works under the sidebar and the phone
  // top bar alike. A callback ref, because the head mounts after loading.
  const router = useRouter();
  const [headEl, setHeadEl] = useState<HTMLDivElement | null>(null);
  const [headGone, setHeadGone] = useState(false);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!headEl || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => {
      // Only "scrolled past" counts; a head below the fold is not collapsed.
      setHeadGone(!entry.isIntersecting && entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0) + 1);
    });
    io.observe(headEl);
    return () => io.disconnect();
  }, [headEl]);

  // Reorder is a By-aisle mode; leaving for One list ends it.
  useEffect(() => { if (sortMode === 'flat') setReorderMode(false); }, [sortMode]);

  // The bar's Search: back to the head, with the search box focused. Focus
  // first (inside the tap, so a phone raises its keyboard), then glide.
  const jumpToSearch = () => {
    searchWrapRef.current?.querySelector('input')?.focus({ preventScroll: true });
    const reduce = prefersStillMotion();
    headEl?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const fetchItems = useCallback(async () => {
    if (!group?.id) return;
    try {
      setLoading(true);
      const supabase = createClient();
      // grocery_items now lives in the Legend-State store (FLUX-149); this fetch
      // only loads the auxiliary data (aisles / item library / today's session).
      const [aislesRes, libraryRows, todaySession] = await Promise.all([
        supabase
          .from('grocery_aisles')
          .select('*')
          .eq('group_id', group.id)
          .order('sort_order', { ascending: true }),
        fetchItemLibrary(supabase, group.id),
        fetchTodaySession(supabase, group.id),
      ]);
      const fetchedCustomAisles = (aislesRes.data ?? []) as GroceryCustomAisle[];
      setCustomAisles(fetchedCustomAisles);
      setLibrary(libraryRows);
      setSession(todaySession);
      // Merge new custom aisles into order
      if (fetchedCustomAisles.length) {
        setAisleOrder((prev) => {
          const extra = fetchedCustomAisles.map((a) => a.name).filter((n) => !prev.includes(n));
          return extra.length ? [...prev, ...extra] : prev;
        });
      }
    } catch (err) {
      console.error('Failed to fetch grocery items:', err instanceof Error ? err.message : err);
    } finally {
      setLoading(false);
    }
  }, [group?.id]);

  useEffect(() => {
    if (group?.id) fetchItems();
  }, [group?.id, fetchItems]);

  // ── Keep today's session cost line in sync with the cart ────────────────────
  useEffect(() => {
    // Consume the realtime flag every run so a stale value can't linger.
    const wasRemote = remoteUpdateRef.current;
    remoteUpdateRef.current = false;
    // FLUX-1559: a closed (finalized) session is frozen — skip the recompute so
    // converting today's got-it items to have-it doesn't zero summed_total_cents
    // and delete the day's Costs line.
    if (!group?.id || !session || session.tracking !== 'on' || session.closed_at) return;
    // Only the member who made the local change writes the session/cost line;
    // other devices just reflect the echo, preventing a write ping-pong.
    if (wasRemote) return;
    const libMap = buildLibraryMap(library);
    const today = todayStr();
    const summed = items
      .filter((i) => i.status === 'bought' && (i.last_purchased_at ?? '').slice(0, 10) === today)
      .reduce((s, i) => s + (i.last_price ?? i.price_cents ?? resolveItemDefaults(i.name, libMap).priceCents ?? 0), 0);
    const sig = `${summed}|${session.override_total_cents}|${session.receipt_total_cents}|${session.retailer}|${session.receipt_path}`;
    if (sessionSyncRef.current === sig) return;
    sessionSyncRef.current = sig;
    // Modules: the trip's cost line needs costs and groceries (module-features.ts).
    const writeCostLine = isFeatureEnabled('costs.from-groceries', getEnabledModules());
    void syncSession(createClient(), session, group.id, summed, writeCostLine).then((s) => setSession(s));
  }, [group?.id, session, items, library]);

  // ── Realtime: live-sync the list + session across group members' devices ─────
  // The Legend-State store owns grocery_items data sync (FLUX-149); this
  // subscription only flags a remote change so the session-cost effect below can
  // tell a remote echo from a local edit and avoid a multi-device write ping-pong.
  useGroupTableRealtime({
    table: 'grocery_items',
    groupId: group?.id,
    onChange: () => { remoteUpdateRef.current = true; },
  });

  useGroupTableRealtime({
    table: 'grocery_sessions',
    groupId: group?.id,
    // FLUX-107: only flag a remote update on the paths that actually apply a
    // state change the sync effect depends on. Flagging unconditionally left the
    // ref stuck `true` for non-today updates / deletes of a non-current session
    // (no dep change → effect never runs → next LOCAL change gets wrongly skipped).
    onChange: (payload) => {
      if (payload.eventType === 'DELETE') {
        const id = (payload.old as unknown as { id?: string })?.id;
        setSession((s) => {
          if (s && s.id === id) {
            remoteUpdateRef.current = true;
            return null;
          }
          return s;
        });
        return;
      }
      const row = payload.new as unknown as GrocerySession;
      if (row.session_date === todayStr()) {
        remoteUpdateRef.current = true;
        setSession(row);
      }
    },
  });

  // ── End-of-day auto-convert (FLUX-1559) ──────────────────────────────────────
  // Any "Got it" item left over from a prior day (its session already frozen —
  // past sessions don't recompute) silently finishes into "Have it" on open, so
  // the list doesn't accumulate stale got-it items across days. Runs once per
  // mount, after the store has hydrated; idempotent, so a re-run finds nothing.
  const autoConvertedRef = useRef(false);
  useEffect(() => {
    if (autoConvertedRef.current || !storeLoaded || items.length === 0) return;
    autoConvertedRef.current = true;
    const stale = items.filter((i) => i.status === 'bought' && !isBoughtToday(i));
    if (!stale.length) return;
    const now = new Date().toISOString();
    stale.forEach((i) => patchItem(i.id, { status: 'have', status_changed_at: now, last_purchased_at: null }));
  }, [storeLoaded, items, patchItem]);

  // ── Undoable delete ──────────────────────────────────────────────────────────
  const [toast, setToast] = useState<string | null>(null);
  // `undo` is optional: delete/archive fall back to clearing pendingDeleteIds
  // (their existing behavior); actions with no local-hide stage (e.g. Done
  // shopping, which commits immediately) supply their own reversal.
  const pendingRef = useRef<{ commit: () => Promise<void>; undo?: () => void; timer: ReturnType<typeof setTimeout> } | null>(null);

  const flushPending = useCallback(async () => {
    const p = pendingRef.current;
    if (!p) return;
    clearTimeout(p.timer);
    pendingRef.current = null;
    await p.commit();
  }, []);

  // HOUP-245: the delete commits immediately (already excluded everywhere via
  // !item.deleted — see `allItems` above) and the undo pill tracks what to
  // restore, replacing the old delay-the-mutation approach (which lost the
  // delete entirely if the tab closed mid-window). Archive/Done-shopping below
  // keep their own pendingRef-based undo — different actions, out of scope here.
  const handleRequestDelete = useCallback(
    (item: GroceryItem) => {
      softDeleteItem(item.id);
      undoBatchTracker.add(item);
      toastUndoDelete(undoBatchTracker.count(), () => {
        undoBatchTracker.restoreAll().forEach((it) => patchItem(it.id, { deleted: false }));
      });
    },
    [softDeleteItem, undoBatchTracker, patchItem]
  );

  const handleUndo = useCallback(() => {
    const p = pendingRef.current;
    pendingRef.current = null;
    if (p) clearTimeout(p.timer);
    if (p?.undo) p.undo();
    else setPendingDeleteIds(new Set());
    setToast(null);
  }, []);

  // ── Archive ────────────────────────────────────────────────────────────────
  // Push the item's learnable details (shelf life, typical price, aisle) into the
  // shared library, THEN remove it from the active list — so it can be re-added
  // fully-populated later via the search "no match" suggestions (FLUX-188). No
  // blocking confirm (unlike the destructive Delete): a 5s undo toast is the
  // affordance, with the library write deferred to commit so Undo is clean.
  const handleArchive = useCallback(
    (item: GroceryItem) => {
      if (!group?.id) return;
      void flushPending();
      setPendingDeleteIds((prev) => new Set(prev).add(item.id));
      setToast('Item archived to library');
      const commit = async () => {
        setPendingDeleteIds((prev) => { const next = new Set(prev); next.delete(item.id); return next; });
        const defaults = resolveItemDefaults(item.name, buildLibraryMap(library));
        const supabase = createClient();
        await learnItemLibrary(supabase, group.id, item.name, {
          shelf_life_days: item.shelf_life_days ?? defaults.days,
          typical_price_cents: item.price_cents ?? defaults.priceCents,
          aisle: item.aisle,
        });
        softDeleteItem(item.id);
        // Refresh library state so search suggestions immediately see the entry.
        try { setLibrary(await fetchItemLibrary(supabase, group.id)); } catch { /* offline — entry still synced */ }
      };
      const timer = setTimeout(() => {
        pendingRef.current = null;
        setToast(null);
        void commit();
      }, 5000);
      pendingRef.current = { commit, timer };
    },
    [group?.id, flushPending, softDeleteItem, library]
  );

  const groceryUndo = useGroceryUndo(patchItem);
  // Hearth §8 "Pop out, pop in": a re-added suggestion's row pops into its aisle.
  const arrivals = useArrivals(POP_IN_HOLD_MS);
  const markArrivals = arrivals.mark;
  const needAgainWithPop = useCallback(
    (list: GroceryItem | GroceryItem[]) => {
      markArrivals((Array.isArray(list) ? list : [list]).map((i) => i.id));
      groceryUndo.needAgain(list);
    },
    [markArrivals, groceryUndo],
  );
  const suggestDismiss = useSuggestDismiss({ hide: groceryUndo.hide, archive: handleArchive });

  useEffect(() => () => void flushPending(), [flushPending]);

  // ── Drag and drop ────────────────────────────────────────────────────────────
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveItemId(null);
    setActiveAisleId(null);
    if (!over || active.id === over.id) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    // Aisle reorder
    const isAisleDrag = aisleOrder.includes(activeId);
    if (isAisleDrag) {
      const oldIdx = aisleOrder.indexOf(activeId);
      const newIdx = aisleOrder.indexOf(overId);
      if (oldIdx === -1 || newIdx === -1) return;
      const next = arrayMove(aisleOrder, oldIdx, newIdx);
      setAisleOrder(next);
      persistAisleOrder(next);
      return;
    }

    const activeItem = items.find((i) => i.id === activeId);
    if (!activeItem) return;
    const overItem = items.find((i) => i.id === overId);

    // Cross-aisle move: dropped onto an aisle header, or onto an item in another aisle.
    const targetAisle = aisleOrder.includes(overId) ? overId : overItem?.aisle ?? null;
    if (targetAisle && targetAisle !== activeItem.aisle) {
      patchItem(activeId, { aisle: targetAisle });
      return;
    }

    // Item reorder within an aisle
    if (!overItem || activeItem.aisle !== overItem.aisle) return;

    const aisleItems = items.filter((i) => i.aisle === activeItem.aisle);
    const oldIdx = aisleItems.findIndex((i) => i.id === activeId);
    const newIdx = aisleItems.findIndex((i) => i.id === overId);
    if (oldIdx === -1 || newIdx === -1) return;

    const reordered = arrayMove(aisleItems, oldIdx, newIdx).map((it, idx) => ({ ...it, sort_order: idx }));
    reordered.forEach((it) => patchItem(it.id, { sort_order: it.sort_order }));
  };

  // ── Custom aisle management ───────────────────────────────────────────────────
  const addCustomAisle = async () => {
    if (!group?.id || !newAisleName.trim()) return;
    setAddingAisle(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('grocery_aisles')
        .insert({
          group_id: group.id,
          name: newAisleName.trim(),
          color: newAisleColor,
          sort_order: customAisles.length,
        })
        .select()
        .single();
      if (error) throw error;
      const newAisle = data as GroceryCustomAisle;
      setCustomAisles((prev) => [...prev, newAisle]);
      setAisleOrder((prev) => [...prev, newAisle.name]);
      setNewAisleName('');
      setNewAisleColor(CUSTOM_AISLE_COLOR_KEYS[customAisles.length % CUSTOM_AISLE_COLOR_KEYS.length]);
      setShowAddAisle(false);
    } catch (err) {
      console.error('Failed to add custom aisle:', err);
    } finally {
      setAddingAisle(false);
    }
  };

  const deleteCustomAisle = async (aisle: GroceryCustomAisle) => {
    const confirmed = await dialog.confirm({
      title: `Delete aisle "${aisle.name}"?`,
      message: 'Items in this aisle will be moved to Other.',
      destructive: true,
    });
    if (!confirmed) return;
    const supabase = createClient();
    // Move items out of the deleted aisle via the store; the aisle row itself is
    // not migrated yet, so it's still deleted directly on Supabase.
    items.filter((i) => i.aisle === aisle.name).forEach((i) => patchItem(i.id, { aisle: 'other' }));
    await supabase.from('grocery_aisles').delete().eq('id', aisle.id);
    setCustomAisles((prev) => prev.filter((a) => a.id !== aisle.id));
    setAisleOrder((prev) => prev.filter((a) => a !== aisle.name));
  };

  // ── Bulk actions ─────────────────────────────────────────────────────────────
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()); };
  const enterSelectMode = () => { setReorderMode(false); setSelectMode(true); };
  const enterReorderMode = () => { exitSelectMode(); setReorderMode(true); };

  const bulkUpdate = async (payload: Partial<GroceryItem>) => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    setIsBulkSaving(true);
    try {
      ids.forEach((id) => patchItem(id, payload));
    } finally { setIsBulkSaving(false); }
  };

  const bulkDelete = async () => {
    const count = selectedIds.size;
    if (!count) return;
    const confirmed = await dialog.confirm({
      title: `Delete ${count} item${count === 1 ? '' : 's'}?`,
      message: 'This cannot be undone.',
      destructive: true,
    });
    if (!confirmed) return;
    setIsBulkSaving(true);
    try {
      [...selectedIds].forEach((id) => softDeleteItem(id));
      setSelectedIds(new Set());
    } finally { setIsBulkSaving(false); }
  };

  // Move every "Got it" item back to Needed (the summary's reset action).
  // Relegated to a secondary spot + gated behind a confirm dialog (FLUX-1559):
  // easy to fat-finger next to Done shopping, and unlike Done shopping it has
  // no undo affordance.
  const resetBought = async () => {
    // Runs at once with an Undo pill (replaced the old confirm() dialog).
    groceryUndo.resetBought(items.filter((i) => i.status === 'bought'));
  };

  // Finalize today's shop (FLUX-1559): freeze the session first (so its Costs
  // line survives — see the sync effect's closed_at early-return above), then
  // flip every item bought today to "Have it". Committed immediately; the 5s
  // undo toast reverses both halves. The finish sheet passes the session it
  // just read and synced, since `session` state lags its own chained writes.
  const doneShopping = async (sessionArg?: GrocerySession) => {
    if (!group?.id) return;
    const todayBought = items.filter((i) => isBoughtToday(i));
    if (!todayBought.length) return;
    void flushPending();
    const now = new Date().toISOString();
    const snapshot = todayBought.map((i) => ({ id: i.id, last_purchased_at: i.last_purchased_at }));
    const activeSession = sessionArg ?? session;
    // Only this call's own close should be reversed on undo — a session closed
    // by an earlier action must stay closed.
    const didClose = !!(activeSession && activeSession.tracking === 'on' && !activeSession.closed_at);
    if (didClose && activeSession) {
      const closed = await closeSession(createClient(), activeSession.id);
      if (!closed) {
        setToast("Couldn't finish shop. Try again");
        return;
      }
      setSession(closed);
    }
    snapshot.forEach((s) => patchItem(s.id, { status: 'have', status_changed_at: now, last_purchased_at: null }));
    setToast(`${snapshot.length} item${snapshot.length === 1 ? '' : 's'} marked Have it`);
    const undo = () => {
      snapshot.forEach((s) =>
        patchItem(s.id, { status: 'bought', status_changed_at: new Date().toISOString(), last_purchased_at: s.last_purchased_at })
      );
      if (didClose && activeSession) void updateGrocerySession(createClient(), activeSession.id, { closed_at: null }).then((s) => { if (s) setSession(s); });
    };
    const commit = async () => { /* already applied above — nothing further to persist on timeout */ };
    const timer = setTimeout(() => {
      pendingRef.current = null;
      setToast(null);
      void commit();
    }, 5000);
    pendingRef.current = { commit, undo, timer };
  };

  // ── Today's shop: receipt and finish (HOUP-226, mobile twin in
  // apps/mobile/src/app/(tabs)/groceries/index.tsx) ──────────────────────────
  // One hidden file input serves both layers. `camera` asks phones for the
  // camera straight away; without it the browser offers photos and files.
  const pickReceipt = (intent: 'add' | 'finish', camera: boolean) => {
    const input = receiptInputRef.current;
    if (!input) return;
    receiptIntentRef.current = intent;
    if (camera) input.setAttribute('capture', 'environment');
    else input.removeAttribute('capture');
    input.click();
  };

  // Upload a picked receipt onto the trip, then read it (OCR via
  // /api/parse-receipt -> receipt_total_cents + retailer; applyReceiptLearning
  // writes learned prices to grocery_items). Returns the updated session, or
  // null with `receiptError` set. Takes the session explicitly: the finish
  // flow chains writes faster than `session` state updates.
  const attachAndReadReceipt = async (file: File, base: GrocerySession): Promise<GrocerySession | null> => {
    if (!group?.id) return null;
    const supabase = createClient();
    setReceiptBusy(true);
    setReceiptError(null);
    try {
      const up = await uploadReceipt(supabase, group.id, base.session_date, file);
      if (!up) {
        setReceiptError('Receipt upload failed. Tap to try again.');
        return null;
      }
      let updated = (await updateGrocerySession(supabase, base.id, { receipt_path: up.path, receipt_name: up.name })) ?? base;
      onSessionChange(updated);
      const parsed = await parseReceiptFile(file);
      if (!parsed) {
        setReceiptError("Couldn't read the receipt. Tap to try again.");
        return null;
      }
      const patch: Partial<GrocerySession> = {};
      if (parsed.total != null) patch.receipt_total_cents = Math.round(parsed.total * 100);
      if (parsed.retailer) patch.retailer = parsed.retailer;
      if (Object.keys(patch).length) updated = (await updateGrocerySession(supabase, updated.id, patch)) ?? updated;
      onSessionChange(updated);
      await applyReceiptLearning(supabase, group.id, parsed, items);
      return updated;
    } catch (err) {
      console.error('receipt attach failed:', err);
      setReceiptError('Receipt upload failed. Tap to try again.');
      return null;
    } finally {
      setReceiptBusy(false);
    }
  };

  // The finish sheet: optionally read a receipt, bring the Costs line up to
  // the trip's effective total (receipt or override), then Done shopping. A
  // failed read keeps the sheet open with its error.
  const finishShop = async (file: File | null) => {
    if (!session || !group?.id || receiptBusy || finishing) return;
    setFinishing(true);
    try {
      let current: GrocerySession = session;
      if (file) {
        const read = await attachAndReadReceipt(file, session);
        if (!read) return;
        current = read;
      }
      try {
        // Modules: the trip's cost line needs costs and groceries (module-features.ts).
        current = await syncSession(createClient(), current, group.id, sessionSum, isFeatureEnabled('costs.from-groceries', getEnabledModules()));
        setSession(current);
      } catch (err) {
        console.error('grocery session sync failed:', err);
      }
      setFinishOpen(false);
      await doneShopping(current);
      // Learned prices (and the closed session) come back with the refetch.
      if (file) void fetchItems();
    } finally {
      setFinishing(false);
    }
  };

  const onReceiptPicked = async (file: File) => {
    if (receiptIntentRef.current === 'finish') {
      await finishShop(file);
      return;
    }
    if (!session) return;
    if (await attachAndReadReceipt(file, session)) void fetchItems();
  };

  const overrideTotal = async (cents: number | null) => {
    if (!session) return;
    onSessionChange((await updateGrocerySession(createClient(), session.id, { override_total_cents: cents })) ?? session);
  };

  const stopTracking = async () => {
    if (!session) return;
    setFinishOpen(false);
    onSessionChange((await updateGrocerySession(createClient(), session.id, { tracking: 'skipped' })) ?? session);
  };

  // ── Quick-add per aisle ──────────────────────────────────────────────────────
  const quickAdd = async (aisle: string, name: string, entry?: { quantity: number | null; unit: string | null }) => {
    if (!group?.id || !name.trim()) return;
    // Auto-fill shelf life + typical price from the item library
    const { days, priceCents } = resolveItemDefaults(name, buildLibraryMap(library));
    // FLUX-65: prefill the aisle's configured default unit, if any.
    const defaultUnit = userSettings?.grocery_aisle_units?.[aisle] ?? null;
    const now = new Date().toISOString();
    writeItem({
      id: crypto.randomUUID(),
      group_id: group.id,
      name: name.trim(),
      aisle,
      quantity: entry?.quantity ?? null,
      unit: entry?.unit ?? defaultUnit,
      status: 'needed',
      notes: null,
      assigned_to: null,
      private: false,
      template_key: null,
      sort_order: 0,
      created_by: currentUserId ?? null,
      updated_by: null,
      created_at: now,
      updated_at: now,
      deleted: false,
      recurrence_days: null,
      status_changed_at: now,
      last_purchased_at: null,
      last_price: null,
      lowest_price: null,
      expiry_date: null,
      shelf_life_days: days,
      price_cents: priceCents,
      is_essential: false,
      recipe_note: null,
      recipe_source_id: null,
      re_add_snoozed_until: null,
      re_add_dismissed_at: null,
    });
  };

  // ── Starter staples ──────────────────────────────────────────────────────────
  const seedStaples = async () => {
    if (!group?.id) return;
    const region = getRegionProvider(group.region ?? undefined);
    if (!region?.groceryStaples?.length) return;
    const existingKeys = new Set(items.map((i) => i.template_key).filter(Boolean));
    const now = new Date().toISOString();
    region.groceryStaples
      .filter((s) => !existingKeys.has(s.template_key))
      .forEach((s, idx) => writeItem({
        id: crypto.randomUUID(),
        group_id: group.id,
        name: s.name,
        aisle: s.aisle,
        quantity: s.quantity,
        unit: s.unit,
        status: 'needed',
        notes: null,
        assigned_to: null,
        private: false,
        template_key: s.template_key,
        sort_order: idx,
        created_by: currentUserId ?? null,
        updated_by: null,
        created_at: now,
        updated_at: now,
        deleted: false,
        recurrence_days: null,
        status_changed_at: now,
        last_purchased_at: null,
        last_price: null,
        lowest_price: null,
        expiry_date: null,
        shelf_life_days: null,
        price_cents: null,
        is_essential: false,
        recipe_note: null,
        recipe_source_id: null,
        re_add_snoozed_until: null,
        re_add_dismissed_at: null,
      }));
  };

  // Fuzzy search narrows the displayed items (name/notes — NOT aisle, which is a
  // category filter). Empty query returns items unchanged (FLUX-110).
  // "2 milk" searches for "milk"; the quantity rides along to the add panel.
  const searchEntry = useMemo(() => parseGroceryEntry(search), [search]);
  const fuzzyItems = useFuzzySearch(items, searchEntry.name, ['name', 'notes']);
  // Naming an aisle ("dairy") also lists everything in it.
  const searchedItems = useMemo(() => {
    const aisles = groceryAislesMatching(searchEntry.name, customAisles);
    if (aisles.length === 0) return fuzzyItems;
    const seen = new Set(fuzzyItems.map((i) => i.id));
    return [...fuzzyItems, ...items.filter((i) => aisles.includes(i.aisle) && !seen.has(i.id))];
  }, [fuzzyItems, items, searchEntry.name, customAisles]);

  // HOUP-317: One list's flat ordering — same search + To buy filter
  // contract as the aisle view (including the pendingIds grace window), then
  // the shared essentials-first/A-to-Z comparator.
  const flatItems = useMemo(
    () => sortGroceriesFlat(searchedItems.filter((i) => !filterNeeded || i.status === 'needed' || pendingIds.has(i.id))),
    [searchedItems, filterNeeded, pendingIds],
  );
  const flatTailStart = flatItems.findIndex((i) => i.status !== 'needed');

  if ((cacheLoading || loading || !storeLoaded) && items.length === 0)
    return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!group) return <div className="p-6 text-muted-foreground">No group selected</div>;

  const region = getRegionProvider(group.region ?? undefined);
  const needed = countNeeded(items);
  const bought = countBought(items);
  const haveCount = countHave(items);

  // Items you'll actually buy (Needed + Got it) — "Have it" is excluded from totals/progress.
  const buyableItems = items.filter((i) => i.status !== 'have');

  // Effective price = the item's own price, else the library's typical price for its name.
  const libMap = buildLibraryMap(library);
  const effectivePriceCents = (item: GroceryItem): number | null =>
    item.price_cents ?? resolveItemDefaults(item.name, libMap).priceCents;

  // Re-add suggestions (FLUX-207): 'have' items past shelf life.
  const reAddSuggestions = suggestReAdd(items, libMap);

  // Search add options (FLUX-188 grew into this): the query itself with a
  // guessed aisle, plus library entries not on the list, shown under the
  // matches so a known item comes back with its learned price / shelf life.
  const searchAdd = grocerySearchAddOptions(items, library, search, customAisles);
  const submitSearchAdd = async () => {
    const exact = searchAdd.librarySuggestions.find((o) => canonicalizeItemName(o.item_name) === canonicalizeItemName(searchEntry.name));
    if (exact) await quickAdd(exact.aisle ?? 'other', exact.item_name, searchAdd);
    else if (searchAdd.addName) await quickAdd(searchAdd.addAisle, searchAdd.addName, searchAdd);
    else return;
    setSearch('');
  };

  // Estimate = sum of unit prices, once per item (no quantity multiply, matching the session convention).
  const sumEstimate = (list: GroceryItem[]) =>
    list.reduce((sum, i) => sum + (effectivePriceCents(i) ?? 0), 0);
  const countUnpriced = (list: GroceryItem[]) =>
    list.filter((i) => effectivePriceCents(i) == null).length;

  const totalEstimate = sumEstimate(buyableItems);
  const unpricedCount = countUnpriced(buyableItems);

  // Today's purchasing session (items marked Got it today).
  const boughtToday = items.filter((i) => isBoughtToday(i));
  const sessionSum = boughtToday.reduce((s, i) => s + (i.last_price ?? effectivePriceCents(i) ?? 0), 0);
  const sessionUnpriced = boughtToday.filter((i) => (i.last_price ?? effectivePriceCents(i)) == null).length;

  // Today's shop floats (ShopTrackingPill) and the collapsed bar carries the
  // cart total, so aisle headers stick to the very top, or just under the
  // collapsed bar (56px: py-1.5 around 44px targets) while it shows.
  const sessionBarActive = session?.tracking === 'on';
  const aisleStickyTop = headGone ? 'top-14' : 'top-0';
  // Reorder only means something in By aisle.
  const reordering = reorderMode && sortMode === 'aisle';
  // Hearth §13.7 "Desktop shell": on a wide screen the aisles flow into
  // columns like a store map, beside the Running low sidebar. Reorder
  // aisles stays one column so the drag reads top to bottom.
  // One list stays a single centred column.
  const wideAisles = wide && sortMode === 'aisle';
  const aisleColumns = wideAisles && !reordering;

  // Lede caption fragments (H6): what's left beyond the to-buy count. The
  // estimate moved to the "This trip" card at the end of the list.
  const heroCaption = (() => {
    if (items.length === 0) return 'Your list is empty';
    const fragments = [
      needed === 0 ? 'All bought' : null,
      haveCount > 0 ? `${haveCount} have` : null,
      boughtToday.length > 0 ? `${boughtToday.length} got today` : null,
    ].filter(Boolean);
    return fragments.length ? fragments.join(' · ') : undefined;
  })();
  const cartCents = sessionBarActive && session
    ? effectiveSessionTotal({ ...session, summed_total_cents: sessionSum })
    : null;
  const onSessionChange = (s: GrocerySession | null) => { sessionSyncRef.current = ''; setSession(s); };
  // Purchasing session (to Costs when costs.from-groceries is on): the
  // floating ask until decided, then the shop pill in the same spot. Both
  // step aside while searching and while Select's bulk bar owns the bottom
  // edge; the pill also yields to Reorder.
  const showTrackPrompt = !searching && !selectMode && session === null && boughtToday.length > 0;
  const showShopPill = !searching && !selectMode && !reordering && session?.tracking === 'on' && !session.closed_at;
  const shopTotal = cartCents ?? sessionSum;
  const openAdd = () => { setEditingItem(undefined); setDefaultAisle('other'); setIsModalOpen(true); };

  // Collapsed bar's sort menu (the list bar holds the same choice in full).
  const sortMenu = (
    <PopMenu
      align="right"
      width="w-56"
      triggerLabel={`Sort: ${sortMode === 'flat' ? 'One list' : 'By aisle'}`}
      triggerClassName="grid h-11 w-11 flex-shrink-0 place-items-center rounded-lg border border-border bg-muted text-foreground transition-colors hover:bg-accent"
      trigger={<ArrowUpDown className="h-4 w-4" />}
    >
      {(close) => (
        <>
          <MenuLabel>Sort</MenuLabel>
          <MenuItem active={sortMode === 'aisle'} onClick={() => { handleSortModeChange('aisle'); close(); }}>By aisle</MenuItem>
          <MenuItem active={sortMode === 'flat'} onClick={() => { handleSortModeChange('flat'); close(); }}>One list</MenuItem>
        </>
      )}
    </PopMenu>
  );

  const iconButtonClass =
    'grid h-11 w-11 flex-shrink-0 place-items-center rounded-lg border border-border bg-muted text-foreground transition-colors hover:bg-accent';

  // Group items by aisle (over the searched subset so non-matching items and
  // their now-empty aisles drop out).
  const grouped = searchedItems.reduce((acc, i) => {
    (acc[i.aisle] ??= []).push(i);
    return acc;
  }, {} as Record<string, GroceryItem[]>);

  // Ordered aisles that have items, plus maintain any items in custom aisles not yet in order.
  // When "hide non-needed" is on, drop aisles with nothing left to buy.
  const allAisleIds = new Set(aisleOrder);
  Object.keys(grouped).forEach((a) => allAisleIds.add(a));
  const orderedAisles = [...allAisleIds].filter((a) => {
    const list = grouped[a];
    if (!list?.length) {
      // Empty custom aisles stay visible so users have a place to add items;
      // built-in empties, and anything under an active filter, still drop out.
      const isCustom = customAisles.some((c) => c.name === a);
      return isCustom && !search.trim() && !hideNonNeeded;
    }
    return filterNeeded ? list.some((i) => i.status === 'needed' || pendingIds.has(i.id)) : true;
  });

  const activeItem = activeItemId ? items.find((i) => i.id === activeItemId) : null;

  const toggleAisle = (a: string) =>
    setCollapsedAisles((prev) => {
      const next = new Set(prev);
      if (next.has(a)) next.delete(a);
      else next.add(a);
      saveCollapsedAisles([...next]);
      return next;
    });

  const dismissShoppingTooltip = () => {
    setShowShoppingTooltip(false);
    localStorage.setItem(SHOPPING_TOOLTIP_KEY, '1');
  };

  // All aisles (built-in + custom) for bulk aisle picker
  const allAisleOptions = [
    ...AISLE_ORDER.map((a) => ({ id: a, label: AISLE_META[a as GroceryAisle].label, dot: AISLE_COLOR[a as GroceryAisle].dot })),
    ...customAisles.map((a) => ({ id: a.name, label: a.name, dot: getAisleColor(a.name, customAisles).dot })),
  ];

  // Running low (re-add suggestions) as its own group, in the aisle
  // header grammar, ahead of the aisles. Steps aside while searching so
  // the results sit directly under the search bar.
  const runningLowGroup = !searching ? (
    <ReAddSuggestions
      variant="group"
      runningLow={reAddSuggestions}
      onAdd={needAgainWithPop}
      onAddAll={() => needAgainWithPop(reAddSuggestions)}
      onSnooze={groceryUndo.snooze}
      dismissAction={suggestDismiss.dismissAction}
      onDismiss={suggestDismiss.dismiss}
    />
  ) : null;

  // This trip (end of the list): the estimate the old pulse strip's Est
  // total tile carried, as a card's Display lede (H1: never a second
  // Hero), its caption, then the trip's quiet verbs as secondary pills.
  // Hidden while searching and when there's nothing to buy.
  const tripCard = !searching && buyableItems.length > 0 ? (
      <section aria-label="This trip" className="rounded-3xl border border-border/60 bg-card p-4 shadow-[var(--card-shadow)]">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">This trip</p>
        <p className="mt-1 font-heading text-2xl font-bold tracking-[-0.02em] tabular-nums text-foreground">~{formatMoney(totalEstimate)}</p>
        <p className="text-xs tabular-nums text-muted-foreground">
          estimated for {buyableItems.length} item{buyableItems.length === 1 ? '' : 's'}
          {unpricedCount > 0 && <span className="text-warning"> · {unpricedCount} unpriced</span>}
        </p>
        {(session?.tracking === 'skipped' || bought > 0 || (!sessionBarActive && boughtToday.length > 0)) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {/* Done shopping lives on the shop pill while tracking; with
                no tracked shop it stays reachable here (FLUX-1559). */}
            {!sessionBarActive && boughtToday.length > 0 && (
              <button onClick={() => void doneShopping()} className={TRIP_PILL_CLASS}>
                Done shopping
              </button>
            )}
            {session?.tracking === 'skipped' && (
              <TrackShopLink session={session} onChange={onSessionChange} className={TRIP_PILL_CLASS} />
            )}
            {bought > 0 && (
              <button onClick={() => void resetBought()} className={TRIP_PILL_CLASS}>
                Reset bought ({bought})
              </button>
            )}
          </div>
        )}
      </section>
  ) : null;

  // Hearth §13.7 (Guy, 2026-10-22): on a wide screen Running low and This
  // trip sit in a right sidebar, so the list keeps a readable width.

  return (
    // The floating ask or pill reserves room so it never covers the list's end.
    <div className={cn('space-y-5 p-4 md:p-6 mx-auto', wideAisles ? 'max-w-[1400px] lg:px-8' : wide ? 'max-w-[1200px] lg:px-8' : 'max-w-3xl', showTrackPrompt || showShopPill ? 'pb-44' : 'pb-28')}>
      {/* Collapsed bar: a zero-height sticky anchor (so it never shifts the
          page or re-trips the observer) holding a slim bar that slides in
          once the head has scrolled away. MO: transform + opacity only, base
          swift-out in and fast ease-in out; reduced motion collapses the
          tokens to 0ms. Full-bleed like the page's other sticky rows. */}
      <div className="sticky top-0 z-30 -mx-4 h-0 md:-mx-6">
        <div
          inert={!headGone}
          aria-hidden={!headGone}
          className={cn(
            'absolute inset-x-0 top-0 flex items-center gap-2 border-b border-border/50 bg-background/90 px-4 py-1.5 backdrop-blur-md transition-[opacity,transform] md:px-6',
            headGone
              ? 'translate-y-0 opacity-100 duration-[var(--motion-base)] ease-[var(--motion-ease-out)]'
              : 'pointer-events-none -translate-y-2 opacity-0 duration-[var(--motion-fast)] ease-[var(--motion-ease-in)]'
          )}
        >
          {/* T-scale has no in-betweens: the small number takes the Display
              step (heading face, tabular), the label and caption beside it. */}
          <p className="flex min-w-0 flex-1 items-center gap-2">
            <span className="font-heading text-2xl font-bold leading-none tracking-[-0.02em] tabular-nums text-foreground">{needed}</span>
            <span className="flex min-w-0 flex-col">
              <span className="font-heading text-sm font-semibold leading-tight text-muted-foreground">to buy</span>
              {(cartCents != null || heroCaption) && (
                <span className="truncate text-xs tabular-nums text-muted-foreground">
                  {cartCents != null ? `${formatMoney(cartCents)} in cart` : heroCaption}
                </span>
              )}
            </span>
          </p>
          {items.length > 0 && (
            <button onClick={jumpToSearch} aria-label="Search" title="Search" className={iconButtonClass}>
              <Search className="h-4 w-4" />
            </button>
          )}
          <button onClick={() => setCardsOpen(true)} aria-label="Rewards cards" title="Rewards cards" className={iconButtonClass}>
            <WalletCards className="h-4 w-4" />
          </button>
          {items.length > 0 && (
            <SegmentedControl
              ariaLabel="Show"
              size="sm"
              tone="accent"
              wrap
              className="w-fit flex-shrink-0"
              options={[
                { value: 'needed', label: 'To buy' },
                { value: 'all', label: 'All' },
              ]}
              value={show}
              onChange={handleShowChange}
            />
          )}
          {items.length > 0 && sortMenu}
          {/* H5: the bar replaces the head, so its Add is the same one accent. */}
          <button
            onClick={openAdd}
            aria-label="Add item"
            title="Add item"
            className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Compact head (Hearth §13.2 Hero lede, inline): the to-buy Hero number
          with its label and caption stacked beside it, then the head verbs on
          the same row. H5: "+ Add" is the screen's one accent fill; Rewards
          cards stays a one-tap shortcut to the checkout barcode (Guy), and
          the rarer verbs (Select, Reorder, Library, Track shop, Reset) live
          behind More. M2: every target is 44px. */}
      <div ref={setHeadEl} className="!mt-0 space-y-3">
        <HeroLede
          layout="inline"
          value={needed}
          label="to buy"
          caption={heroCaption}
          trailing={
            <>
              <button onClick={() => setCardsOpen(true)} aria-label="Rewards cards" title="Rewards cards" className={iconButtonClass}>
                <WalletCards className="h-4 w-4" />
              </button>
              {/* A mode is never stuck behind a menu: while Select or Reorder
                  is on, More yields to a visible Done. */}
              {selectMode || reordering ? (
                <button
                  onClick={() => { exitSelectMode(); setReorderMode(false); }}
                  className="flex h-11 flex-shrink-0 items-center whitespace-nowrap rounded-lg border border-primary/40 bg-primary/15 px-3 text-sm font-medium tabular-nums text-primary transition-colors hover:bg-primary/20"
                >
                  {selectMode && selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Done'}
                </button>
              ) : (
                <PopMenu
                  align="right"
                  width="w-56"
                  triggerLabel="More"
                  triggerClassName={iconButtonClass}
                  trigger={<MoreHorizontal className="h-4 w-4" />}
                >
                  {(close) => (
                    <>
                      {items.length > 0 && (
                        <MenuItem icon={<CheckSquare className="h-4 w-4" />} onClick={() => { enterSelectMode(); close(); }}>
                          Select
                        </MenuItem>
                      )}
                      {sortMode === 'aisle' && orderedAisles.length > 1 && (
                        <MenuItem icon={<ArrowUpDown className="h-4 w-4" />} onClick={() => { enterReorderMode(); close(); }}>
                          Reorder aisles
                        </MenuItem>
                      )}
                      <MenuItem icon={<BookOpen className="h-4 w-4" />} onClick={() => { close(); router.push('/groceries/shelf-life'); }}>
                        Item library
                      </MenuItem>
                      {/* The quiet way back after "Not today" or stopping. */}
                      {session?.tracking === 'skipped' && (
                        <MenuItem
                          icon={<Receipt className="h-4 w-4" />}
                          onClick={async () => { close(); onSessionChange(await updateGrocerySession(createClient(), session.id, { tracking: 'on' })); }}
                        >
                          Track shop
                        </MenuItem>
                      )}
                      {bought > 0 && (
                        <MenuItem icon={<RotateCcw className="h-4 w-4" />} onClick={() => { close(); void resetBought(); }}>
                          Reset bought ({bought})
                        </MenuItem>
                      )}
                    </>
                  )}
                </PopMenu>
              )}
              <button
                onClick={openAdd}
                className="flex h-11 flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" />
                Add
              </button>
            </>
          }
        />

        {/* Search row. */}
        {items.length > 0 && (
          <div ref={searchWrapRef} className={cn('flex items-center gap-2', wideAisles && 'max-w-2xl')}>
            <SectionSearchBar
              value={search}
              onChange={setSearch}
              onSubmit={() => void submitSearchAdd()}
              placeholder="Search or add, e.g. 2 milk"
              className="max-w-none"
            />
          </div>
        )}
      </div>

      <SideRail on={wide}>
        <div className="min-w-0 space-y-5">
      {!wide && runningLowGroup}

      {/* Empty state */}
      {items.length === 0 && (
        <div className="space-y-4 rounded-3xl border border-border/60 bg-card p-10 text-center shadow-[var(--card-shadow)]">
          <p className="text-sm text-muted-foreground">Add items, or start from the starter staples.</p>
          {region?.groceryStaples?.length > 0 && (
            <button
              onClick={seedStaples}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-border bg-muted px-4 py-2 text-sm text-foreground hover:bg-accent transition-colors"
            >
              <Plus className="h-4 w-4" />
              Add starter staples
            </button>
          )}
        </div>
      )}

      {/* Swipe hint (dismissable, M3): sits right above the list it teaches.
          A neutral card (H2/H4); the colour words name the swipe reveals. */}
      {showShoppingTooltip && items.length > 0 && !searching && (
        <div className="flex gap-3 rounded-3xl border border-border/60 bg-card p-4 shadow-[var(--card-shadow)]">
          <ArrowRightLeft className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Swipe to shop</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Swipe a row <span className="text-success">right for Got it</span> to count it toward today&apos;s spend,
              or <span className="text-primary">left for Have it</span> if it&apos;s already at home.
              <span className="hidden sm:inline"> Drag the grip to reorder.</span> To buy hides the rest.
            </p>
          </div>
          <button
            onClick={dismissShoppingTooltip}
            aria-label="Dismiss"
            className="-m-2 grid h-10 w-10 flex-shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground/80"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* The list bar (Guy, 2026-10-22, option C): what the list holds and
          how it is arranged, as two small toggles right above the rows. */}
      {items.length > 0 && (
        <div className={cn('flex items-center justify-between gap-2', wideAisles && 'max-w-2xl')}>
          <SegmentedControl
            ariaLabel="Show"
            size="sm"
            tone="accent"
            wrap
            className="w-fit"
            options={[
              { value: 'needed', label: 'To buy' },
              { value: 'all', label: 'All items' },
            ]}
            value={show}
            onChange={handleShowChange}
          />
          <SegmentedControl
            ariaLabel="Arrange"
            size="sm"
            wrap
            className="w-fit"
            options={[
              { value: 'aisle', label: 'Aisles' },
              { value: 'flat', label: 'One list' },
            ]}
            value={sortMode}
            onChange={handleSortModeChange}
          />
        </div>
      )}

      {/* One list (HOUP-317) — a sibling flat path, not conditionals threaded
          through the aisle code below: single continuous card, no aisle
          headers, no drag. The tier label is a plain ListGroup child before
          the first non-"needed" row, so `divide-y` renders it as an in-card
          divided row — AC 3's single card holds with no extra work. */}
      {sortMode === 'flat' && flatItems.length > 0 && (
        <ListGroup>
          {flatItems.map((item, i) => (
            <Fragment key={item.id}>
              {i === flatTailStart && (
                <div className="px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  Not needed
                </div>
              )}
              <div className={cn('flex items-start', arrivals.ids.has(item.id) && 'row-pop-in')}>
                {selectMode && (
                  <input
                    type="checkbox"
                    checked={selectedIds.has(item.id)}
                    onChange={() => toggleSelect(item.id)}
                    className="mt-3 ml-3 h-4 w-4 rounded accent-primary flex-shrink-0 cursor-pointer"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <GroceryItemCardStandalone
                    item={item}
                    groupId={group.id}
                    groupMembers={groupMembers}
                    memberProfiles={memberProfiles}
                    customAisles={customAisles}
                    libraryPriceCents={resolveItemDefaults(item.name, libMap).priceCents}
                    resolvedShelfLifeDays={resolveItemDefaults(item.name, libMap).days}
                    onUpdate={handleItemUpdate}
                    onRequestDelete={handleRequestDelete}
                    onArchive={handleArchive}
                    onEdit={(it) => { setEditingItem(it); setIsModalOpen(true); }}
                    showAisleDot
                    showNeedAgain={searching}
                  />
                </div>
              </div>
            </Fragment>
          ))}
        </ListGroup>
      )}

      {sortMode === 'aisle' && orderedAisles.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e) => {
            const id = String(e.active.id);
            if (aisleOrder.includes(id)) setActiveAisleId(id);
            else setActiveItemId(id);
          }}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={orderedAisles} strategy={verticalListSortingStrategy}>
            {(() => {
              const renderAisle = (aisle: string) => {
                const aisleItems = grouped[aisle] ?? [];
                const collapsed = collapsedAisles.has(aisle);
                const am = getAisleMeta(aisle, customAisles);
                const aisleNeeded = aisleItems.filter((i) => i.status === 'needed').length;
                const aisleBought = aisleItems.filter((i) => i.status === 'bought').length;
                const aisleBuyable = aisleNeeded + aisleBought; // exclude Have it
                const isCustomAisle = customAisles.some((a) => a.name === aisle);
                const aisleSubtotal = sumEstimate(aisleItems.filter((i) => i.status !== 'have'));

                // Filter (hide non-needed), then order Needed -> Got it -> Have it.
                // HOUP-245: a just-checked-off item stays visible through its grace
                // window (pendingIds) instead of vanishing the instant its status
                // flips away from 'needed'.
                const visible = filterNeeded
                  ? aisleItems.filter((i) => i.status === 'needed' || pendingIds.has(i.id))
                  : aisleItems;
                const sortedItems = [
                  ...visible.filter((i) => i.status === 'needed'),
                  ...visible.filter((i) => i.status === 'bought'),
                  ...visible.filter((i) => i.status === 'have'),
                ];

                return (
                  <SortableAisleGroup key={aisle} id={aisle} disabled={selectMode}>
                    {({ attributes, listeners, disabled }) => (
                    <div className="space-y-1.5">
                      {/* Aisle header (Hearth §6 "Group header" row: chevron /
                          micro label + count / tabular aggregate) — sits directly
                          above the ListGroup, not wrapping it (H4: the card below
                          owns the only border in this view). */}
                      <div
                        className={cn(
                          'flex items-center gap-2 px-1 py-1',
                          // Columns can't hold a sticky header; each aisle is short there anyway.
                          !aisleColumns && ['sticky z-20 bg-background/90 backdrop-blur-sm', aisleStickyTop]
                        )}
                      >
                        {/* The grip shows on wide screens always, and at every
                            width in Reorder aisles (then at a 44px target, M2). */}
                        {!disabled && (
                          <span
                            {...attributes}
                            {...(listeners ?? {})}
                            className={cn(
                              'place-items-center text-muted-foreground/70 hover:text-muted-foreground cursor-grab active:cursor-grabbing flex-shrink-0 touch-none',
                              reordering ? 'grid -my-2 h-11 w-8 text-muted-foreground' : 'hidden sm:grid'
                            )}
                            title="Drag to reorder aisle"
                          >
                            <GripVertical className="h-3.5 w-3.5" />
                          </span>
                        )}
                        <button
                          onClick={() => toggleAisle(aisle)}
                          className="flex flex-1 items-center gap-2 text-left min-w-0 py-1"
                        >
                          <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground flex-shrink-0 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${collapsed ? '-rotate-90' : ''}`} />
                          <GroceryGlyph emoji={am.icon} size={16} />
                          {/* H2: group headers stay neutral; "all done"
                              reads from the ratio (5/5), not a tint. */}
                          <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] flex-shrink-0 text-muted-foreground">
                            {am.label}
                          </span>
                          <span className="text-xs text-muted-foreground/70 tabular-nums flex-shrink-0">{aisleItems.length}</span>
                        </button>
                        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
                          {(aisleBuyable > 0 || aisleSubtotal > 0) && (
                            <span className="text-xs font-medium tabular-nums text-muted-foreground">
                              {aisleBuyable > 0 && <span>{aisleBought}/{aisleBuyable}</span>}
                              {aisleBuyable > 0 && aisleSubtotal > 0 && ' · '}
                              {aisleSubtotal > 0 && `~${formatMoney(aisleSubtotal)}`}
                            </span>
                          )}
                          {isCustomAisle && (
                            <button
                              onClick={(e) => { e.stopPropagation(); void deleteCustomAisle(customAisles.find((a) => a.name === aisle)!); }}
                              className="-my-1 grid h-9 w-9 place-items-center rounded-full text-muted-foreground/70 hover:bg-muted hover:text-destructive transition-colors"
                              title="Delete this aisle"
                              aria-label={`Delete the ${am.label} aisle`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Reorder aisles folds every aisle to its header so the
                          drag is short; the saved collapse state is untouched. */}
                      {!collapsed && !reordering && (
                        <div className="space-y-2">
                          {sortedItems.length > 0 ? (
                            <ListGroup>
                              <SortableContext items={sortedItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                                {sortedItems.map((item) => (
                                  <div key={item.id} className={cn('flex items-start', arrivals.ids.has(item.id) && 'row-pop-in')}>
                                    {selectMode && (
                                      <input
                                        type="checkbox"
                                        checked={selectedIds.has(item.id)}
                                        onChange={() => toggleSelect(item.id)}
                                        className="mt-3 ml-3 h-4 w-4 rounded accent-primary flex-shrink-0 cursor-pointer"
                                      />
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <GroceryItemCard
                                        item={item}
                                        groupId={group.id}
                                        groupMembers={groupMembers}
                                        memberProfiles={memberProfiles}
                                        customAisles={customAisles}
                                        libraryPriceCents={resolveItemDefaults(item.name, libMap).priceCents}
                                        resolvedShelfLifeDays={resolveItemDefaults(item.name, libMap).days}
                                        onUpdate={handleItemUpdate}
                                        onRequestDelete={handleRequestDelete}
                                        onArchive={handleArchive}
                                        onEdit={(it) => { setEditingItem(it); setIsModalOpen(true); }}
                                        showNeedAgain={searching}
                                      />
                                    </div>
                                  </div>
                                ))}
                              </SortableContext>
                            </ListGroup>
                          ) : (
                            <p className="px-1 py-1 text-sm text-muted-foreground">No items yet. Add one below.</p>
                          )}
                          {!selectMode && !hideNonNeeded && !searching && (
                            <GroceryQuickAdd
                              onAdd={(name) => quickAdd(aisle, name)}
                              onOpenModal={() => {
                                setEditingItem(undefined);
                                setDefaultAisle(aisle);
                                setIsModalOpen(true);
                              }}
                            />
                          )}
                        </div>
                      )}
                    </div>
                    )}
                  </SortableAisleGroup>
                );
              };
              if (!aisleColumns) return <div className="space-y-3">{orderedAisles.map(renderAisle)}</div>;
              // Two fixed columns, filled by item count. CSS columns rebalance
              // whenever a card's height changes, so a hover that grew a card
              // threw it into the other column and back (Guy, 2026-10-22).
              const columns = splitAisleColumns(orderedAisles, (a) => (grouped[a] ?? []).length + 2, twoAisleColumns ? 2 : 1);
              return (
                <div className="flex items-start gap-5">
                  {columns.map((col, i) => (
                    <div key={i} className="flex min-w-0 flex-1 flex-col gap-5">
                      {col.map(renderAisle)}
                    </div>
                  ))}
                </div>
              );
            })()}
          </SortableContext>

          {/* Drag overlay */}
          <DragOverlay>
            {activeItem && (
              <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground shadow-2xl opacity-90">
                {activeItem.name}
              </div>
            )}
            {activeAisleId && (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm font-semibold text-foreground shadow-2xl opacity-90">
                <GroceryGlyph emoji={getAisleMeta(activeAisleId, customAisles).icon} size={16} />
                {getAisleMeta(activeAisleId, customAisles).label}
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {!wide && tripCard}

      {/* Search add options — under the matches (or alone when nothing matched). */}
      {items.length > 0 && searching && (
        <GrocerySearchAdd
          noMatches={searchedItems.length === 0}
          addName={searchAdd.addName}
          addAisle={searchAdd.addAisle}
          suggestions={searchAdd.librarySuggestions}
          quantity={searchAdd}
          customAisles={customAisles}
          onAddSuggestion={async (s) => { await quickAdd(s.aisle ?? 'other', s.item_name, searchAdd); setSearch(''); }}
          onAddPlain={async (name, aisle) => { await quickAdd(aisle, name, searchAdd); setSearch(''); }}
        />
      )}

      {/* Add custom aisle — HOUP-317: also gated to By aisle, so a list
          showing no aisles never offers one. */}
      {!hideNonNeeded && !searching && !selectMode && !reordering && sortMode === 'aisle' && (
        <div>
          {showAddAisle ? (
            <div className="space-y-3 rounded-3xl border border-border/60 bg-card p-4 shadow-[var(--card-shadow)]">
              <p className="text-sm font-medium text-foreground flex items-center gap-2">
                <LayoutList className="h-4 w-4 text-muted-foreground" />
                New aisle
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newAisleName}
                  onChange={(e) => setNewAisleName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void addCustomAisle(); if (e.key === 'Escape') setShowAddAisle(false); }}
                  placeholder="e.g., Spices, Baby, Pet food…"
                  autoFocus
                  maxLength={40}
                  className="flex-1 bg-muted border border-border rounded px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-ring"
                />
              </div>
              {/* Color picker */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">Color:</span>
                {CUSTOM_AISLE_COLOR_KEYS.map((key) => {
                  const col = getAisleColor(`__${key}`, [{ id: '', group_id: '', name: `__${key}`, color: key, sort_order: 0 }]);
                  return (
                    <button
                      key={key}
                      onClick={() => setNewAisleColor(key)}
                      className={cn(
                        'h-5 w-5 rounded-full transition-all',
                        col.fill,
                        newAisleColor === key ? 'ring-2 ring-foreground ring-offset-2 ring-offset-card scale-110' : 'opacity-60 hover:opacity-100'
                      )}
                      title={key}
                    />
                  );
                })}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => void addCustomAisle()}
                  disabled={!newAisleName.trim() || addingAisle}
                  className="min-h-[44px] flex-1 rounded-lg border border-border bg-muted py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {addingAisle ? 'Adding…' : 'Add aisle'}
                </button>
                <button
                  onClick={() => { setShowAddAisle(false); setNewAisleName(''); }}
                  className="min-h-[44px] px-4 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAddAisle(true)}
              className="flex min-h-[44px] items-center gap-2 text-sm text-muted-foreground hover:text-foreground/80 transition-colors"
            >
              <LayoutList className="h-4 w-4" />
              Add custom aisle
            </button>
          )}
        </div>
      )}
        </div>
        {wide && (
          <aside aria-label="Running low and this trip" className="sticky top-16 space-y-5">
            {runningLowGroup}
            {tripCard}
          </aside>
        )}
      </SideRail>

      {/* Bulk action bar */}
      {selectMode && selectedIds.size > 0 && (
        // Clears the phone tab bar and its raised capture button (the bar is
        // in-flow, so bottom-4 alone sat on top of it); one row at 390px.
        <div className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1.5 rounded-2xl border border-border bg-card px-2.5 py-2 shadow-xl shadow-black/40 max-w-[calc(100vw-2rem)]">
          <span className="whitespace-nowrap px-1 text-sm tabular-nums text-foreground">{selectedIds.size} selected</span>

          <PopMenu
            align="left"
            width="w-44"
            triggerLabel="Set aisle"
            triggerClassName="flex items-center gap-1 rounded-lg border border-border bg-accent/60 px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
            trigger={<>Aisle <ChevronDown className="h-3.5 w-3.5" /></>}
          >
            {(close) => (
              <>
                <MenuLabel>Set aisle</MenuLabel>
                {allAisleOptions.map((a) => (
                  <MenuItem
                    key={a.id}
                    icon={<span className={`h-2.5 w-2.5 rounded-full ${a.dot}`} />}
                    onClick={() => { bulkUpdate({ aisle: a.id }); close(); }}
                  >
                    {a.label}
                  </MenuItem>
                ))}
              </>
            )}
          </PopMenu>

          <PopMenu
            align="left"
            width="w-44"
            triggerLabel="Assign to"
            triggerClassName="flex items-center gap-1 rounded-lg border border-border bg-accent/60 px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
            trigger={<>Assign <ChevronDown className="h-3.5 w-3.5" /></>}
          >
            {(close) => (
              <>
                <MenuLabel>Assign to</MenuLabel>
                <MenuItem onClick={() => { bulkUpdate({ assigned_to: null }); close(); }}>Unassigned</MenuItem>
                {groupMembers.map((m) => (
                  <MenuItem key={m.user_id} onClick={() => { bulkUpdate({ assigned_to: m.user_id }); close(); }}>
                    {memberLabel(m.user_id, memberProfiles)}
                  </MenuItem>
                ))}
              </>
            )}
          </PopMenu>

          <button
            onClick={bulkDelete}
            disabled={isBulkSaving}
            aria-label="Delete selected"
            className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Delete</span>
          </button>

          <button
            onClick={() => setSelectedIds(new Set())}
            aria-label="Clear selection"
            className="flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/60"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {showTrackPrompt && (
        <TrackShopPrompt groupId={group.id} boughtCount={boughtToday.length} summedCents={sessionSum} onChange={onSessionChange} />
      )}

      {showShopPill && session && (
        <ShopTrackingPill
          session={session}
          total={shopTotal}
          boughtCount={boughtToday.length}
          onOverrideTotal={(cents) => void overrideTotal(cents)}
          onReceipt={() => pickReceipt('add', true)}
          receiptBusy={receiptBusy}
          receiptError={receiptError}
          onDone={() => { setReceiptError(null); setFinishOpen(true); }}
        />
      )}

      <FinishShopSheet
        open={finishOpen}
        onOpenChange={setFinishOpen}
        session={session}
        total={shopTotal}
        boughtCount={boughtToday.length}
        unpricedCount={sessionUnpriced}
        onOverrideTotal={(cents) => void overrideTotal(cents)}
        onScan={() => pickReceipt('finish', true)}
        onPickPhoto={() => pickReceipt('finish', false)}
        onFinishWithout={() => void finishShop(null)}
        onStopTracking={() => void stopTracking()}
        busy={receiptBusy || finishing}
        error={receiptError}
      />

      <input
        ref={receiptInputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void onReceiptPicked(f); e.target.value = ''; }}
      />

      {/* Undo toast */}
      {toast && (
        <div className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 rounded-2xl border border-border bg-card px-4 py-2.5 shadow-xl shadow-black/40">
          <span className="text-sm text-foreground">{toast}</span>
          <button onClick={handleUndo} className="text-sm font-semibold text-primary hover:text-primary/80">Undo</button>
        </div>
      )}

      <RewardsCardsSheet
        open={cardsOpen}
        onOpenChange={setCardsOpen}
        cards={cards}
        groupId={group.id}
        initialCardId={cards.length === 1 ? cards[0].id : null}
        onSave={writeCard}
        onDelete={(card) => softDeleteCard(card.id)}
      />

      <GroceryItemModal
        key={editingItem?.id ?? 'new'}
        isOpen={isModalOpen}
        item={editingItem}
        groupId={group.id}
        defaultAisle={defaultAisle}
        customAisles={customAisles}
        library={buildLibraryMap(library)}
        aisleUnits={userSettings?.grocery_aisle_units ?? undefined}
        onClose={() => { setIsModalOpen(false); setEditingItem(undefined); }}
        onSave={(saved) => {
          writeItem(saved);
          setIsModalOpen(false);
          setEditingItem(undefined);
        }}
        onArchive={(archived) => {
          handleArchive(archived);
          setIsModalOpen(false);
          setEditingItem(undefined);
        }}
      />
    </div>
  );
}

// ── Sortable aisle group wrapper ──────────────────────────────────────────────
type AisleHandleProps = { attributes: object; listeners: object | undefined; disabled: boolean };

/** Hearth §13.7: the list and a right sidebar side by side, or the children as they are. */
function SideRail({ on, children }: { on: boolean; children: ReactNode }) {
  if (!on) return <>{children}</>;
  return <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">{children}</div>;
}

function SortableAisleGroup({
  id,
  children,
  disabled,
}: {
  id: string;
  children: (handle: AisleHandleProps) => React.ReactNode;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      {children({ attributes, listeners, disabled: !!disabled })}
    </div>
  );
}

// ── Per-aisle quick-add ───────────────────────────────────────────────────────
function GroceryQuickAdd({ onAdd, onOpenModal }: { onAdd: (name: string) => Promise<void>; onOpenModal: () => void }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try { await onAdd(name.trim()); setName(''); }
    finally { setSaving(false); }
  };

  return (
    <div className="flex min-h-[44px] items-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-1.5 focus-within:border-ring transition-colors">
      <Plus className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
        placeholder="Quick add…"
        disabled={saving}
        className="flex-1 min-w-0 bg-transparent text-sm text-foreground placeholder-muted-foreground focus:outline-none"
      />
      {name.trim() && (
        <button onClick={() => void submit()} disabled={saving} className="text-xs font-medium text-primary hover:text-primary/80 flex-shrink-0 disabled:opacity-50">
          {saving ? 'Adding…' : 'Add'}
        </button>
      )}
      <button onClick={onOpenModal} className="text-xs text-muted-foreground hover:text-foreground/80 flex-shrink-0 transition-colors" title="Add with details">
        Details
      </button>
    </div>
  );
}

/**
 * Deals aisles into a fixed number of columns in shop order, each to the
 * column with the least weight so far. The split depends only on the list,
 * never on rendered heights, so cards stay put while they animate.
 */
function splitAisleColumns(aisles: string[], weight: (aisle: string) => number, count: number): string[][] {
  const columns: string[][] = Array.from({ length: count }, () => []);
  const totals = new Array<number>(count).fill(0);
  for (const aisle of aisles) {
    const i = totals.indexOf(Math.min(...totals));
    columns[i].push(aisle);
    totals[i] += weight(aisle);
  }
  return columns;
}
