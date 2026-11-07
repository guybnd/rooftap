'use client';

// Hearth §8 "Cheer burst" on Costs (Guy, 2026-11-07): the first time this
// device opens a month that finished under its goal, the Hero number gets
// the coral burst and the meter glows mint once. Each month cheers once per
// device (getStoreEnvironment().keyValue), newest kept.

import { useEffect, useState } from 'react';
import { deviceKeyValue } from '../../data/store-environment';
import type { CostMonth } from './cost-month';

const CHEERED_KEY = 'homeup-under-goal-cheered';
/** How many months to remember. */
const KEEP = 36;

let cache: string[] | null = null;

/** Whether `month` is over and its spending (some, so not still loading) stayed within the goal. */
export function finishedUnderGoal(month: Pick<CostMonth, 'when' | 'paidCents'>, goalCents: number | null): boolean {
  return month.when === 'past' && !!goalCents && goalCents > 0 && month.paidCents > 0 && month.paidCents <= goalCents;
}

function cheered(): string[] {
  if (cache) return cache;
  let stored: string[] = [];
  try {
    const raw = deviceKeyValue()?.getItem(CHEERED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) stored = parsed.filter((k): k is string => typeof k === 'string');
  } catch {
    // Store unavailable or unreadable: nothing cheered yet.
  }
  if (deviceKeyValue()) cache = stored;
  return stored;
}

/**
 * Whether to cheer `key` (a month, and the scope it shows) now: true the
 * first time only, and from then on it counts as cheered on this device.
 */
export function takeUnderGoalCheer(key: string): boolean {
  const done = cheered();
  if (done.includes(key)) return false;
  cache = [key, ...done].slice(0, KEEP);
  try {
    deviceKeyValue()?.setItem(CHEERED_KEY, JSON.stringify(cache));
  } catch {
    // Store unavailable: cheered for this session only.
  }
  return true;
}

/**
 * The Costs Hero's cheer: 0 until this device first opens `month` finished
 * under `goalCents`, then 1 (a key to play the burst once).
 */
export function useUnderGoalCheer(month: Pick<CostMonth, 'month' | 'when' | 'paidCents'>, goalCents: number | null): number {
  const [play, setPlay] = useState(0);
  const under = finishedUnderGoal(month, goalCents);
  useEffect(() => {
    if (under && takeUnderGoalCheer(month.month)) setPlay((n) => n + 1);
  }, [under, month.month]);
  return play;
}

/** For tests: forget the cached months. */
export function resetUnderGoalCheerForTests(): void {
  cache = null;
}
