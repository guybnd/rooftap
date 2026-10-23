// Home Setup list: the pure view logic both apps' Setup screens share
// (filters, room groups, the pulse strip's top rooms, the store-trip card,
// reorder patches and the row portal maps). Each app keeps its own
// rendering, search and haptics.

import type { DocumentSource, SetupItem, SetupStore } from '../../types';
import { STATUS_ORDER, SETUP_STATUS_LABEL, summarize, type SetupSummary } from './setup';

/** Items without a room group under this name. */
export const SETUP_NO_ROOM = 'Other';

export function setupRoomOf(item: Pick<SetupItem, 'room'>): string {
  return item.room || SETUP_NO_ROOM;
}

/** Live store rows: deleted rows dropped, in sort_order. */
export function liveSetupItems(rows: readonly (SetupItem | null | undefined)[]): SetupItem[] {
  return rows
    .filter((i): i is SetupItem => !!i && !i.deleted)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

export interface SetupFilterState {
  roomFilter: string | null;
  storeFilter: string | null;
  /** Empty means every status. */
  statusFilters: readonly string[];
  mineOnly: boolean;
}

/** The room, store, status and "Mine only" filters. Search is applied after, per app. */
export function filterSetupItems(
  items: readonly SetupItem[],
  filters: SetupFilterState,
  currentUserId: string | null | undefined,
): SetupItem[] {
  const { roomFilter, storeFilter, statusFilters, mineOnly } = filters;
  return items.filter((item) => {
    if (roomFilter && item.room !== roomFilter) return false;
    if (storeFilter && item.store_id !== storeFilter) return false;
    if (statusFilters.length > 0 && !statusFilters.includes(item.status)) return false;
    if (mineOnly && item.assigned_to !== currentUserId) return false;
    return true;
  });
}

/** Items by room, rooms in first-seen order, each room in the items' order. */
export function groupSetupByRoom(items: readonly SetupItem[]): Map<string, SetupItem[]> {
  const map = new Map<string, SetupItem[]>();
  for (const item of items) {
    const room = setupRoomOf(item);
    const list = map.get(room);
    if (list) list.push(item);
    else map.set(room, [item]);
  }
  return map;
}

/** The named rooms in use, alphabetical (the room filter and the editor's room picker). */
export function setupRoomNames(items: readonly SetupItem[]): string[] {
  return (Array.from(new Set(items.map((i) => i.room).filter(Boolean))) as string[]).sort();
}

export type SetupRoomSummary = { room: string } & SetupSummary;

/**
 * The pulse strip's room tiles: the rooms with the most still to get, then
 * the largest once everything is done. Read from the unfiltered list so the
 * tiles stay put while the list below is filtered.
 */
export function topSetupRooms(items: readonly SetupItem[], limit = 2): SetupRoomSummary[] {
  return Array.from(groupSetupByRoom(items).entries())
    .map(([room, roomItems]) => ({ room, ...summarize(roomItems) }))
    .sort((a, b) => b.outstanding - a.outstanding || b.total - a.total)
    .slice(0, limit);
}

export type SetupStoreTrip = SetupSummary & { storeName: string };

/** The shopping-trip card for the store filter, over the filtered items. Null with no store filter. */
export function setupStoreTrip(
  filteredItems: readonly SetupItem[],
  storeFilter: string | null,
  stores: readonly SetupStore[],
): SetupStoreTrip | null {
  if (!storeFilter) return null;
  const storeName = stores.find((s) => s.id === storeFilter)?.name ?? 'Store';
  return { ...summarize(filteredItems as SetupItem[]), storeName };
}

/** The Hero lede's caption: "All set up" or "N done", then the amount spent. */
export function setupHeroCaption(overall: SetupSummary, money: (n: number) => string): string | undefined {
  if (overall.total === 0) return undefined;
  const done = overall.total - overall.outstanding;
  const fragments = [
    overall.outstanding === 0 ? 'All set up' : done > 0 ? `${done} done` : null,
    overall.spent > 0 ? `${money(overall.spent)} spent` : null,
  ].filter(Boolean);
  return fragments.length ? fragments.join(' · ') : undefined;
}

/** The notice after "Add starter items". */
export function setupSeedNotice(count: number): string {
  return count > 0 ? `Added ${count} starter item${count === 1 ? '' : 's'}.` : 'Starter items are already in your list.';
}

export const SETUP_SEED_FAILED_NOTICE = 'Could not add starter items.';

/** True when installing `item` gets the last thing in its room (the celebrate cue). */
export function finishesSetupRoom(items: readonly SetupItem[], item: SetupItem): boolean {
  const room = setupRoomOf(item);
  const siblings = items.filter((i) => i.id !== item.id && setupRoomOf(i) === room);
  return siblings.length > 0 && siblings.every((i) => i.status === 'installed');
}

// The status filter as one segmented track (H5): the stored filter list
// stays an array, so "All" is the empty list and each status is a list of one.
export type SetupStatusSegment = 'all' | (typeof STATUS_ORDER)[number];

export const SETUP_STATUS_SEGMENTS: { value: SetupStatusSegment; label: string }[] = [
  { value: 'all', label: 'All' },
  ...STATUS_ORDER.map((s) => ({ value: s as SetupStatusSegment, label: SETUP_STATUS_LABEL[s] })),
];

export function setupStatusSegment(statusFilters: readonly string[]): SetupStatusSegment {
  return statusFilters.length === 1 ? (statusFilters[0] as SetupStatusSegment) : 'all';
}

export function setupStatusFiltersFor(segment: SetupStatusSegment): string[] {
  return segment === 'all' ? [] : [segment];
}

export interface SortOrderPatch {
  id: string;
  sort_order: number;
}

/** Contiguous 0..n sort_order writes for a room's full next id order (drag to reorder). */
export function reindexRoomOrder(nextOrderedIds: readonly string[]): SortOrderPatch[] {
  return nextOrderedIds.map((id, index) => ({ id, sort_order: index }));
}

/**
 * Move one item within its room and reindex the room. Returns no patches
 * when either index is out of range or nothing moves.
 */
export function moveInRoom(roomItems: readonly Pick<SetupItem, 'id'>[], from: number, to: number): SortOrderPatch[] {
  if (from === to || from < 0 || to < 0 || from >= roomItems.length || to >= roomItems.length) return [];
  const ids = roomItems.map((i) => i.id);
  const [moved] = ids.splice(from, 1);
  ids.splice(to, 0, moved);
  return reindexRoomOrder(ids);
}

export interface SetupCommentSummary {
  count: number;
  latest: { content: string; user_id: string; created_at: string } | null;
}

export interface SetupCommentRow {
  setup_item_id: string;
  content: string;
  user_id: string;
  created_at: string;
}

/** Comment count and newest comment per item, from rows sorted newest first. */
export function setupCommentSummaries(rows: readonly SetupCommentRow[]): Record<string, SetupCommentSummary> {
  const summaries: Record<string, SetupCommentSummary> = {};
  for (const c of rows) {
    const existing = summaries[c.setup_item_id];
    if (existing) existing.count += 1;
    else summaries[c.setup_item_id] = { count: 1, latest: { content: c.content, user_id: c.user_id, created_at: c.created_at } };
  }
  return summaries;
}

/** A document linked to a setup item (the row's Doc chip). */
export interface SetupDocLink {
  storagePath: string;
  source: DocumentSource;
}

export interface SetupDocLinkRow {
  entity_id: string;
  documents: { storage_path: string; source: DocumentSource } | null;
}

/** The newest linked document per item, from rows sorted newest first. */
export function setupDocLinks(rows: readonly SetupDocLinkRow[]): Record<string, SetupDocLink> {
  const map: Record<string, SetupDocLink> = {};
  for (const row of rows) {
    if (!row.documents || map[row.entity_id]) continue;
    map[row.entity_id] = { storagePath: row.documents.storage_path, source: row.documents.source };
  }
  return map;
}
