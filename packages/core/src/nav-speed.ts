'use client';

// Hearth §8 "Navigation speed": a device-local choice between two clocks for
// moving between screens. Fast is Hearth's `slow` step; Smooth takes longer
// so a switch reads as one calm glide. One clock drives the page shift, the
// tab bar's pebble and the section glow, so they always move together.
// Stored per device (getStoreEnvironment().keyValue); Fast until changed.
import { useSyncExternalStore } from 'react';
import { MOTION_DURATIONS_MS } from './tokens';
import { deviceKeyValue } from './data/store-environment';

export type NavSpeed = 'fast' | 'smooth';

export const NAV_SPEEDS: readonly NavSpeed[] = ['fast', 'smooth'];

/** How long a page shift (and the pebble and glow with it) takes, per speed. */
export const NAV_SPEED_MS: Record<NavSpeed, number> = { fast: MOTION_DURATIONS_MS.slow, smooth: 550 };

export const DEFAULT_NAV_SPEED: NavSpeed = 'fast';

const NAV_SPEED_KEY = 'homeup-nav-speed';

let current: NavSpeed | null = null;
const listeners = new Set<() => void>();

export function parseNavSpeed(raw: string | null | undefined): NavSpeed {
  return raw === 'smooth' ? 'smooth' : DEFAULT_NAV_SPEED;
}

/** The speed this device uses, read from the device store the first time. */
export function getNavSpeed(): NavSpeed {
  if (current === null) {
    let stored: string | null = null;
    try {
      stored = deviceKeyValue()?.getItem(NAV_SPEED_KEY) ?? null;
    } catch {
      // Store unavailable: the default holds.
    }
    // Before the app registers its store, answer without caching, so the
    // stored choice still wins once the store is there.
    if (!deviceKeyValue()) return parseNavSpeed(stored);
    current = parseNavSpeed(stored);
  }
  return current;
}

export function setNavSpeed(next: NavSpeed): void {
  current = next;
  try {
    deviceKeyValue()?.setItem(NAV_SPEED_KEY, next);
  } catch {
    // Store unavailable: the choice holds for this session.
  }
  listeners.forEach((listener) => listener());
}

export function subscribeNavSpeed(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The device's navigation speed, re-rendering when it changes. */
export function useNavSpeed(): NavSpeed {
  return useSyncExternalStore(subscribeNavSpeed, getNavSpeed, () => DEFAULT_NAV_SPEED);
}

/** How long a page shift takes on this device, in ms. */
export function useNavShiftMs(): number {
  return NAV_SPEED_MS[useNavSpeed()];
}

/** For tests: forget the cached speed. */
export function resetNavSpeedForTests(): void {
  current = null;
}
