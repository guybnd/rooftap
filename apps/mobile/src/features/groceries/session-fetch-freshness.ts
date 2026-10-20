import type * as React from 'react';
import type { GrocerySession } from '@homeup/core';

type VersionRef = React.MutableRefObject<number>;

export function startSessionFetch(versionRef: VersionRef): number {
  versionRef.current += 1;
  return versionRef.current;
}

export function invalidateSessionFetch(versionRef: VersionRef): void {
  versionRef.current += 1;
}

export function isFreshSessionFetch(versionRef: VersionRef, fetchVersion: number): boolean {
  return versionRef.current === fetchVersion;
}

// HOUP-240: react-freeze destroys and recreates this screen's effects on
// every tab swap back to Groceries, so the session fetch's network round
// trip (measured ~1.9s on a real device) reran on every single visit, not
// just the first — the dominant chunk of the reported ~3s page-swap delay.
// A module-level cache keyed by group+date lets a re-mount paint last-known
// data immediately while the effect still revalidates in the background;
// only the first visit per group/day pays the network cost. Realtime echoes
// (grocery_sessions onChange) keep it in sync same as `session` state.
const sessionCache = new Map<string, GrocerySession | null>();

function cacheKey(groupId: string, date: string): string {
  return `${groupId}:${date}`;
}

export function getCachedSession(groupId: string, date: string): GrocerySession | null | undefined {
  return sessionCache.get(cacheKey(groupId, date));
}

export function setCachedSession(groupId: string, date: string, session: GrocerySession | null): void {
  sessionCache.set(cacheKey(groupId, date), session);
}
