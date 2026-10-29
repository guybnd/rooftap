'use client';

// Whether this server has a newer release, for its admins (app-release.ts),
// and how a one-click update is going (server-updater.ts). Each platform
// passes its own fetch of GET /api/server-update (cookie on web, Bearer on
// the phone); the answer is asked once per signed-in person per app session
// and shared by every surface that shows it. While an update runs, an open
// panel asks again every few seconds. undefined = not known yet.

import { useEffect, useSyncExternalStore } from 'react';
import { cleanServerUpdate, type ServerUpdate } from './app-release';
import { cleanServerUpdater, currentUpdaterStatus, updaterRequestStuck, UPDATER_POLL_MS, type ServerUpdater } from './server-updater';

interface Answer {
  update: ServerUpdate | null;
  updater: ServerUpdater | null;
}

let answer: Answer | undefined;
let askedFor: string | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: Answer | undefined): void {
  answer = next;
  for (const l of listeners) l();
}

function clean(body: unknown): Answer {
  const b = (body ?? {}) as { update?: unknown; updater?: unknown };
  return { update: cleanServerUpdate(b.update), updater: cleanServerUpdater(b.updater) };
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
  if (answer !== undefined) return Promise.resolve();
  const ask: Promise<void> = (loading ??= fetchUpdate()
    .then((body) => {
      if (loading === ask) set(clean(body));
    })
    .catch(() => {
      if (loading === ask) loading = null;
    }));
  return ask;
}

/**
 * Asks again and keeps the last answer until the new one lands, so a panel
 * does not blink. A failure (the server restarting mid-update) keeps the last answer.
 */
export function refreshServerUpdate(fetchUpdate: () => Promise<unknown>): Promise<void> {
  if (!askedFor) return Promise.resolve();
  const forUser = askedFor;
  return fetchUpdate()
    .then((body) => {
      if (askedFor === forUser) set(clean(body));
    })
    .catch(() => {});
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

function useAnswer(fetchUpdate: () => Promise<unknown>, userId: string | null | undefined): Answer | undefined {
  const value = useSyncExternalStore(subscribe, () => answer, () => undefined);
  useEffect(() => {
    void loadServerUpdate(fetchUpdate, userId);
  }, [fetchUpdate, userId]);
  return userId && userId === askedFor ? value : undefined;
}

/** The newer release this server's admin can install; null when none or not an admin. */
export function useServerUpdate(fetchUpdate: () => Promise<unknown>, userId: string | null | undefined): ServerUpdate | null | undefined {
  const value = useAnswer(fetchUpdate, userId);
  return value === undefined ? undefined : value.update;
}

/**
 * The server's one-click updater for its admin, or null (not an admin, or a
 * server too old to have one). Asks again every few seconds while an update runs.
 */
export function useServerUpdater(fetchUpdate: () => Promise<unknown>, userId: string | null | undefined): ServerUpdater | null | undefined {
  const value = useAnswer(fetchUpdate, userId);
  const updater = value?.updater;
  const busy =
    !!updater && ((updater.pending && !updaterRequestStuck(updater)) || currentUpdaterStatus(updater.status)?.state === 'running');
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void refreshServerUpdate(fetchUpdate), UPDATER_POLL_MS);
    return () => clearInterval(timer);
  }, [busy, fetchUpdate]);
  return value === undefined ? undefined : (updater ?? null);
}
