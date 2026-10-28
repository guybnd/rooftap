'use client';

// Whether this server has a newer release, for its admins (app-release.ts).
// Each platform passes its own fetch of GET /api/server-update (cookie on
// web, Bearer on the phone); the answer is asked once per signed-in person
// per app session and shared by every surface that shows it.
// undefined = not known yet.

import { useEffect, useSyncExternalStore } from 'react';
import { cleanServerUpdate, type ServerUpdate } from './app-release';

let update: ServerUpdate | null | undefined;
let askedFor: string | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: ServerUpdate | null | undefined): void {
  update = next;
  for (const l of listeners) l();
}

/**
 * Asks the server once for `userId`; later calls reuse the answer, and a new
 * person asks again. A failed ask (offline, signed out) is asked again next time.
 */
export function loadServerUpdate(fetchUpdate: () => Promise<unknown>, userId: string | null | undefined): Promise<void> {
  if (!userId) return Promise.resolve();
  if (userId !== askedFor) {
    askedFor = userId;
    loading = null;
    set(undefined);
  }
  if (update !== undefined) return Promise.resolve();
  const ask: Promise<void> = (loading ??= fetchUpdate()
    .then((body) => {
      if (loading === ask) set(cleanServerUpdate((body as { update?: unknown } | null)?.update));
    })
    .catch(() => {
      if (loading === ask) loading = null;
    }));
  return ask;
}

/** Forget the answer (tests). */
export function resetServerUpdate(): void {
  askedFor = null;
  loading = null;
  set(undefined);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The newer release this server's admin can install; null when none or not an admin. */
export function useServerUpdate(fetchUpdate: () => Promise<unknown>, userId: string | null | undefined): ServerUpdate | null | undefined {
  const value = useSyncExternalStore(subscribe, () => update, () => undefined);
  useEffect(() => {
    void loadServerUpdate(fetchUpdate, userId);
  }, [fetchUpdate, userId]);
  return userId && userId === askedFor ? value : undefined;
}
