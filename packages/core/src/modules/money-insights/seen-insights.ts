'use client';

// Which money insights this device has shown. The Costs page's glance card
// (Latest and Worth a look, Guy 2026-10-23) opens on Worth a look, with a dot
// on its tab, while an insight is new; once its page is on screen they count
// as seen. Stored per device (getStoreEnvironment().keyValue), newest kept.

import { useSyncExternalStore } from 'react';
import { deviceKeyValue } from '../../data/store-environment';

const SEEN_KEY = 'homeup-insights-seen';
/** How many keys to remember; old insights fall off the end. */
const KEEP = 200;
const NONE: readonly string[] = [];

let cache: readonly string[] | null = null;
const listeners = new Set<() => void>();

/** The insight keys this device has shown. */
export function getSeenInsights(): readonly string[] {
  if (cache) return cache;
  let stored: readonly string[] = NONE;
  try {
    const raw = deviceKeyValue()?.getItem(SEEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) stored = parsed.filter((k): k is string => typeof k === 'string');
  } catch {
    // Store unavailable or unreadable: nothing seen.
  }
  // Before the app registers its store, answer without caching.
  if (deviceKeyValue()) cache = stored;
  return stored;
}

/** Whether any of `keys` is new to this device. */
export function hasUnseenInsights(keys: readonly string[], seen: readonly string[] = getSeenInsights()): boolean {
  return keys.some((k) => !seen.includes(k));
}

/** Notes `keys` as shown. */
export function markInsightsSeen(keys: readonly string[]): void {
  const seen = getSeenInsights();
  if (!hasUnseenInsights(keys, seen)) return;
  cache = [...keys, ...seen.filter((k) => !keys.includes(k))].slice(0, KEEP);
  try {
    deviceKeyValue()?.setItem(SEEN_KEY, JSON.stringify(cache));
  } catch {
    // Store unavailable: seen for this session only.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The keys this device has shown, re-rendering when more are seen. */
export function useSeenInsights(): readonly string[] {
  return useSyncExternalStore(subscribe, getSeenInsights, () => NONE);
}

/** For tests: forget the cached keys. */
export function resetSeenInsightsForTests(): void {
  cache = null;
}
