'use client';

// The More sheet's Recent strip: the spaces you opened last, kept per device.
// Each app hands initRecentSections() its synchronous key-value store (native
// kv-store, web localStorage) and calls recordRecentSection() when the active
// section changes; the sheet reads useRecentSectionIds() and narrows it with
// pickRecentSections() to what it can show right now, so a switched-off,
// hidden or bar section never appears there.

import { useSyncExternalStore } from 'react';

export const RECENT_SECTIONS_KEY = 'homeup-recent-sections';

/** How many the strip shows. */
export const RECENT_SECTIONS_SHOWN = 3;

// Kept beyond the shown three so filtering out bar, hidden or switched-off
// sections still leaves enough to fill the strip.
const RECENT_SECTIONS_KEPT = 10;

/** `id` moved to the front; the same array back when it already leads. */
export function pushRecentSection(ids: readonly string[], id: string): readonly string[] {
  if (ids[0] === id) return ids;
  return [id, ...ids.filter((x) => x !== id)].slice(0, RECENT_SECTIONS_KEPT);
}

/** The stored list; anything unreadable is an empty one. */
export function parseRecentSections(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, RECENT_SECTIONS_KEPT) : [];
  } catch {
    return [];
  }
}

/**
 * The sections the strip shows, most recent first: only ones in `visible`
 * (on, not hidden), none in `exclude` (the tab bar's own, the one you're on).
 */
export function pickRecentSections<T extends { id: string }>(
  ids: readonly string[],
  visible: readonly T[],
  exclude: ReadonlySet<string>,
  count: number = RECENT_SECTIONS_SHOWN
): T[] {
  const byId = new Map(visible.map((s) => [s.id, s]));
  const out: T[] = [];
  for (const id of ids) {
    const section = byId.get(id);
    if (!section || exclude.has(id)) continue;
    out.push(section);
    if (out.length === count) break;
  }
  return out;
}

export interface RecentSectionsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const EMPTY: readonly string[] = [];
let storage: RecentSectionsStorage | null = null;
let recentIds: readonly string[] = EMPTY;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Load the stored list. Safe to call again (it just reloads). */
export function initRecentSections(kv: RecentSectionsStorage): void {
  storage = kv;
  try {
    recentIds = parseRecentSections(kv.getItem(RECENT_SECTIONS_KEY));
  } catch {
    recentIds = EMPTY;
  }
  emit();
}

/** The active section changed to `id`. */
export function recordRecentSection(id: string): void {
  const next = pushRecentSection(recentIds, id);
  if (next === recentIds) return;
  recentIds = next;
  try {
    storage?.setItem(RECENT_SECTIONS_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the list still holds for this session.
  }
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRecentSectionIds(): readonly string[] {
  return useSyncExternalStore(subscribe, () => recentIds, () => EMPTY);
}

/** Test-only: forget the list and the storage. */
export function resetRecentSections(): void {
  storage = null;
  recentIds = EMPTY;
  emit();
}
