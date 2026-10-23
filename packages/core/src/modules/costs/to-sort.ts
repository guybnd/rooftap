'use client';

// The "To sort" card (Guy picked it with the quick moves, 2026-10-23): new
// shops this month that nobody has filed, one at a time, with the bank's
// guess as a one-tap "Yes". Saying yes (or picking another category) files
// the shop the way a move does, so it never comes back. Skip hides a shop for
// the rest of the month on this device (getStoreEnvironment().keyValue).

import { useSyncExternalStore } from 'react';
import { deviceKeyValue } from '../../data/store-environment';
import { squashVendor } from './up-bank';
import type { CostMonth, CostMonthLine } from './cost-month';
import type { CostCategory } from '../../types';

export interface ShopToSort {
  line: CostMonthLine;
  /** The bank's guess, the category it sits in now; null when it has none. */
  guess: CostCategory | null;
}

/** This month's unfiled bank shops, the most money first, less the ones skipped. */
export function costShopsToSort(month: Pick<CostMonth, 'categories'>, skipped: readonly string[] = []): ShopToSort[] {
  const skip = new Set(skipped.map(squashVendor));
  const out: ShopToSort[] = [];
  for (const c of month.categories) {
    if (c.category === 'income') continue;
    for (const line of c.lines) {
      if (line.kind !== 'shop' || !line.guessed || line.source !== 'up' || !line.vendor || line.paidCents <= 0) continue;
      if (skip.has(squashVendor(line.vendor))) continue;
      out.push({ line, guess: c.category });
    }
  }
  return out.sort((a, b) => b.line.paidCents - a.line.paidCents);
}

const SKIPPED_KEY = 'homeup-costs-sort-skipped';
const NONE: readonly string[] = [];

interface Skipped {
  month: string;
  vendors: string[];
}

let cache: Skipped | null = null;
const listeners = new Set<() => void>();

function read(): Skipped {
  if (cache) return cache;
  let stored: Skipped = { month: '', vendors: [] };
  try {
    const raw = deviceKeyValue()?.getItem(SKIPPED_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Skipped>) : null;
    if (parsed && typeof parsed.month === 'string' && Array.isArray(parsed.vendors)) stored = { month: parsed.month, vendors: parsed.vendors.filter((v) => typeof v === 'string') };
  } catch {
    // Store unavailable or unreadable: nothing skipped.
  }
  // Before the app registers its store, answer without caching.
  if (deviceKeyValue()) cache = stored;
  return stored;
}

/** The shops skipped in `month` on this device. */
export function getSkippedShops(month: string): readonly string[] {
  const s = read();
  return s.month === month ? s.vendors : NONE;
}

/** Skips a shop until the month is over. Only one month is kept. */
export function skipShop(month: string, vendor: string): void {
  const s = read();
  const vendors = s.month === month ? s.vendors : [];
  cache = { month, vendors: vendors.includes(vendor) ? vendors : [...vendors, vendor] };
  try {
    deviceKeyValue()?.setItem(SKIPPED_KEY, JSON.stringify(cache));
  } catch {
    // Store unavailable: the skip holds for this session.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The shops skipped in `month`, re-rendering when one is skipped. */
export function useSkippedShops(month: string): readonly string[] {
  return useSyncExternalStore(subscribe, () => getSkippedShops(month), () => NONE);
}

/** For tests: forget the cached skips. */
export function resetSkippedShopsForTests(): void {
  cache = null;
}
