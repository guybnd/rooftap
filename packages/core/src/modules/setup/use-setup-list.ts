'use client';

// Home Setup list: the screen state both apps' Setup screens share (the
// items store, stores, row portal chips, filters, select and reorder modes,
// the notice and starter-item seeding). Each app passes its own Supabase
// client getter and keeps its own rendering, search and haptics.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { syncState } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';
import type { SetupItem, SetupStore } from '../../types';
import { setupItems$ } from '../../data/stores/setup-items-store';
import { useReconnectSync, useStoreHelpers } from '../../data/create-group-store';
import { useStoreLoaded } from '../../data/use-store-loaded';
import { deviceKeyValue } from '../../data/store-environment';
import { listSetupStores } from '../../data/setup-stores';
import { seedTemplateItems } from './setup-templates';
import {
  liveSetupItems,
  setupCommentSummaries,
  setupDocLinks,
  setupSeedNotice,
  setupStatusFiltersFor,
  setupStatusSegment,
  SETUP_SEED_FAILED_NOTICE,
  type SetupCommentRow,
  type SetupCommentSummary,
  type SetupDocLink,
  type SetupDocLinkRow,
  type SetupStatusSegment,
} from './setup-list-view';

/** The group's setup items (live, in sort order) and the store's write helpers. */
export function useSetupItems(groupId: string | null | undefined, currentUserId: string | null | undefined) {
  const items$ = setupItems$(groupId);
  useReconnectSync(items$);
  const { writeRow, patchRow, softDeleteRow } = useStoreHelpers(items$, currentUserId);
  const loaded = useStoreLoaded(items$);
  const items = use$(() => liveSetupItems(Object.values(items$.get() ?? {})));
  const refresh = useCallback(() => syncState(items$).sync(), [items$]);
  return { items$, items, loaded, writeRow, patchRow, softDeleteRow, refresh };
}

/** `getClient` must be stable (a module function), or the fetch reruns each render. */
export function useSetupStores(groupId: string | null | undefined, getClient: () => SupabaseClient) {
  const [stores, setStores] = useState<SetupStore[]>([]);

  // setup_stores isn't in a Legend store: fetch when the group loads.
  useEffect(() => {
    if (!groupId) return;
    let cancelled = false;
    void listSetupStores(getClient(), groupId).then((rows) => {
      if (!cancelled) setStores(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [groupId, getClient]);

  /** Add a store just made in a picker, without a refetch. */
  const addStore = useCallback((store: SetupStore) => setStores((prev) => [...prev, store]), []);

  return { stores, addStore };
}

export interface SetupRowPortals {
  /** Comment count and newest comment per item. */
  commentSummaries: Record<string, SetupCommentSummary>;
  /** The newest linked document per item (empty while Documents is off). */
  docLinks: Record<string, SetupDocLink>;
  /** Fetch comment summaries again, e.g. after a comment was added. */
  refreshComments: () => void;
}

/**
 * The row portal chips: comment summaries and linked documents. Each is
 * fetched once the items store has loaded; comments wait for the first
 * items, docs for Documents to be on (the owner may switch it on later).
 * `getClient` must be stable.
 */
export function useSetupRowPortals(opts: {
  groupId: string | null | undefined;
  getClient: () => SupabaseClient;
  loaded: boolean;
  items: readonly SetupItem[];
  docsOn: boolean;
}): SetupRowPortals {
  const { groupId, getClient, loaded, items, docsOn } = opts;
  const [commentSummaries, setCommentSummaries] = useState<Record<string, SetupCommentSummary>>({});
  const [docLinks, setDocLinks] = useState<Record<string, SetupDocLink>>({});

  const itemsRef = useRef(items);
  itemsRef.current = items;

  const fetchComments = useCallback(
    async (itemIds: string[]) => {
      if (itemIds.length === 0) {
        setCommentSummaries({});
        return;
      }
      const { data } = await getClient()
        .from('setup_item_comments')
        .select('setup_item_id, content, user_id, created_at')
        .in('setup_item_id', itemIds)
        .order('created_at', { ascending: false });
      setCommentSummaries(setupCommentSummaries((data ?? []) as SetupCommentRow[]));
    },
    [getClient],
  );

  const fetchDocs = useCallback(async () => {
    if (!groupId) {
      setDocLinks({});
      return;
    }
    const { data } = await getClient()
      .from('document_links')
      .select('entity_id, created_at, documents(storage_path, source)')
      .eq('group_id', groupId)
      .eq('entity_type', 'setup_item')
      .order('created_at', { ascending: false });
    setDocLinks(setupDocLinks((data ?? []) as unknown as SetupDocLinkRow[]));
  }, [groupId, getClient]);

  // Once, when the store has loaded with items. Keyed on the count so items
  // that stream in after an empty first load still get their chips.
  const commentsFetchedRef = useRef(false);
  const itemCount = items.length;
  useEffect(() => {
    if (!loaded || commentsFetchedRef.current || itemCount === 0) return;
    commentsFetchedRef.current = true;
    void fetchComments(itemsRef.current.map((i) => i.id));
  }, [loaded, itemCount, fetchComments]);

  const docsFetchedRef = useRef(false);
  useEffect(() => {
    if (!loaded || !docsOn || docsFetchedRef.current) return;
    docsFetchedRef.current = true;
    void fetchDocs();
  }, [loaded, docsOn, fetchDocs]);

  const refreshComments = useCallback(() => {
    void fetchComments(itemsRef.current.map((i) => i.id));
  }, [fetchComments]);

  return { commentSummaries, docLinks, refreshComments };
}

const STATUS_FILTER_KEY = 'setup_status_filters';

function readSavedStatusFilters(): string[] {
  try {
    const raw = deviceKeyValue()?.getItem(STATUS_FILTER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore malformed or unavailable storage
  }
  return [];
}

/**
 * The list filters. The status filter is remembered on the device. Web
 * passes `restoreAfterMount` so the server render and hydration agree.
 */
export function useSetupFilters(opts: { restoreAfterMount?: boolean } = {}) {
  const { restoreAfterMount = false } = opts;
  const [search, setSearch] = useState('');
  const [roomFilter, setRoomFilter] = useState<string | null>(null);
  const [storeFilter, setStoreFilter] = useState<string | null>(null);
  const [statusFilters, setStatusFilters] = useState<string[]>(() => (restoreAfterMount ? [] : readSavedStatusFilters()));
  const [mineOnly, setMineOnly] = useState(false);

  useEffect(() => {
    if (!restoreAfterMount) return;
    const saved = readSavedStatusFilters();
    if (saved.length > 0) setStatusFilters(saved);
    // Restore once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusSegment = setupStatusSegment(statusFilters);
  const setStatusSegment = useCallback((segment: SetupStatusSegment) => {
    const next = setupStatusFiltersFor(segment);
    setStatusFilters(next);
    try {
      deviceKeyValue()?.setItem(STATUS_FILTER_KEY, JSON.stringify(next));
    } catch {
      // in memory only if storage is unavailable
    }
  }, []);

  const toggleMineOnly = useCallback(() => setMineOnly((v) => !v), []);

  return {
    search,
    setSearch,
    roomFilter,
    setRoomFilter,
    storeFilter,
    setStoreFilter,
    statusFilters,
    statusSegment,
    setStatusSegment,
    mineOnly,
    toggleMineOnly,
  };
}

function toggled<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** Collapsed rooms, and the Select and Reorder modes (never both at once). */
export function useSetupListModes() {
  const [collapsedRooms, setCollapsedRooms] = useState<Set<string>>(() => new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const toggleRoomCollapsed = useCallback((room: string) => setCollapsedRooms((prev) => toggled(prev, room)), []);
  const toggleSelect = useCallback((id: string) => setSelectedIds((prev) => toggled(prev, id)), []);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);
  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);
  const toggleSelectMode = useCallback(() => {
    if (selectMode) exitSelectMode();
    else setSelectMode(true);
  }, [selectMode, exitSelectMode]);
  /** Reorder is entered from the select bar, so it leaves Select mode. */
  const startReorder = useCallback(() => {
    exitSelectMode();
    setReorderMode(true);
  }, [exitSelectMode]);
  const exitReorder = useCallback(() => setReorderMode(false), []);
  /** The bar's X: clear the selection, or leave Select mode when nothing is picked. */
  const clearOrExitSelect = useCallback(() => {
    if (selectedIds.size > 0) clearSelection();
    else exitSelectMode();
  }, [selectedIds, clearSelection, exitSelectMode]);

  return {
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
  };
}

/** A short notice that clears itself after five seconds. */
export function useSetupNotice() {
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  return [notice, setNotice] as const;
}

/** "Add starter items": seeds the template list, pulls it into the store and reports the result. */
export function useSeedSetupTemplates(opts: {
  groupId: string | null | undefined;
  getClient: () => SupabaseClient;
  refresh: () => Promise<unknown> | unknown;
  onNotice: (notice: string) => void;
}) {
  const { groupId, getClient, refresh, onNotice } = opts;
  const [isSeeding, setIsSeeding] = useState(false);

  const seed = useCallback(async () => {
    if (!groupId) return;
    setIsSeeding(true);
    try {
      const count = await seedTemplateItems(groupId, getClient());
      if (count > 0) await refresh();
      onNotice(setupSeedNotice(count));
    } catch (error) {
      console.error('Failed to seed templates:', error);
      onNotice(SETUP_SEED_FAILED_NOTICE);
    } finally {
      setIsSeeding(false);
    }
  }, [groupId, getClient, refresh, onNotice]);

  return useMemo(() => ({ isSeeding, seed }), [isSeeding, seed]);
}
