'use client';

// What the server said about versions (app-release.ts), for any surface that
// shows it. Each platform's DataCacheProvider records it from
// /api/public-config next to the schema. undefined = not known yet.

import { useSyncExternalStore } from 'react';
import type { ServerRelease } from './app-release';

let release: ServerRelease | undefined;
const listeners = new Set<() => void>();

export function setServerRelease(next: ServerRelease | undefined): void {
  release = next;
  for (const l of listeners) l();
}

export function getServerRelease(): ServerRelease | undefined {
  return release;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useServerRelease(): ServerRelease | undefined {
  return useSyncExternalStore(subscribe, getServerRelease, () => undefined);
}
