'use client';

// HOUP-327: per-list, device-local checklist view state (sort override,
// completed-to-bottom override, band collapsed) — one JSON map keyed by
// checklist id, behind getStoreEnvironment().keyValue (localStorage on web,
// sqliteStorage on native; both wired in apps/*/src/lib/legend/environment.ts).
// The account-wide *defaults* (checklists_default_sort etc.) live on
// user_settings and are threaded in by the caller (D1) — this hook only owns
// the per-device override layer and the merge over those defaults.
//
// Hydrates via an effect (not a lazy useState initializer) so a web SSR pass
// and the client's first paint render the same (default) markup — matches
// the aisle-order/collapsed-aisle hydration pattern elsewhere in this repo —
// then re-syncs from storage once mounted. getStoreEnvironment() throws when
// unconfigured and web's keyValue.getItem calls bare window.localStorage with
// no SSR guard; the try/catch below is load-bearing on both paths (SSR, and
// any test with no environment registered), falling back to `defaults`.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getStoreEnvironment } from './store-environment';
import { resolveSortMode, type ChecklistSortMode } from '../checklist-view';
import type { ChecklistType } from '../types';

const STORAGE_KEY = 'homeup_checklist_view_prefs';

interface StoredListPrefs {
  sortMode?: string;
  completedToBottom?: boolean;
  collapsed?: boolean;
}

type StoredMap = Record<string, StoredListPrefs>;

function readMap(): StoredMap {
  try {
    const raw = getStoreEnvironment().keyValue.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as StoredMap) : {};
  } catch {
    return {};
  }
}

function writeMap(map: StoredMap): void {
  try {
    getStoreEnvironment().keyValue.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Offline/unconfigured environment — this render's state already reflects
    // the change; worst case the override doesn't survive a reload.
  }
}

export interface ChecklistViewDefaults {
  /** Account default sort mode (`user_settings.checklists_default_sort`) — resolved against `type` below. */
  sortMode: string | null;
  completedToBottom: boolean;
  collapsed: boolean;
}

export interface ChecklistViewPrefs {
  sortMode: ChecklistSortMode;
  completedToBottom: boolean;
  collapsed: boolean;
  setSortMode: (mode: ChecklistSortMode) => void;
  setCompletedToBottom: (on: boolean) => void;
  setCollapsed: (on: boolean) => void;
}

export function useChecklistViewPrefs(
  checklistId: string,
  type: ChecklistType,
  defaults: ChecklistViewDefaults,
): ChecklistViewPrefs {
  const [override, setOverride] = useState<StoredListPrefs>({});
  const hydratedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (hydratedForRef.current === checklistId) return;
    hydratedForRef.current = checklistId;
    setOverride(readMap()[checklistId] ?? {});
  }, [checklistId]);

  const patch = useCallback(
    (next: StoredListPrefs) => {
      const map = readMap();
      const merged = { ...map[checklistId], ...next };
      map[checklistId] = merged;
      writeMap(map);
      setOverride(merged);
    },
    [checklistId],
  );

  const rawSortMode = override.sortMode ?? defaults.sortMode;
  const sortMode = resolveSortMode(rawSortMode, type);
  const completedToBottom = override.completedToBottom ?? defaults.completedToBottom;
  const collapsed = override.collapsed ?? defaults.collapsed;

  const setSortMode = useCallback((mode: ChecklistSortMode) => patch({ sortMode: mode }), [patch]);
  const setCompletedToBottom = useCallback((on: boolean) => patch({ completedToBottom: on }), [patch]);
  const setCollapsed = useCallback((on: boolean) => patch({ collapsed: on }), [patch]);

  return { sortMode, completedToBottom, collapsed, setSortMode, setCompletedToBottom, setCollapsed };
}
