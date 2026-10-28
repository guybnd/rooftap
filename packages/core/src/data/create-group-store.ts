'use client';

// ── FLUX-150 / HOUP-73: shared Legend-State factory for group-scoped Supabase tables ──
//
// All seven FLUX-149 integration gotchas are baked in here so section stores
// never re-discover them:
//
//  1. persist.plugin passed explicitly — configureSyncedSupabase's global plugin
//     is NOT inherited by per-store persist, so it must be threaded through.
//  2. retry.maxDelay in MILLISECONDS — the default is 30_000; writing `30` caps
//     at 30ms and causes a ~33 req/s offline request storm.
//  3. onError ignores offline failures — a push that fails while offline is
//     expected (retrySync will replay it); only warn when genuinely online.
//  4. One Observable per groupId, memoised in a module-level Map — creating a
//     new observable on every render loses the IndexedDB-seeded state.
//
// Write-path gotchas (INSERT vs UPDATE classification, 409 on swipe) live in
// useStoreHelpers() below.
//
// REACTIVITY NOTE: always use the selector form with use$:
//   const rows = use$(() => Object.values(store$.get() ?? {}).filter(...))
// NOT:  const rows = use$(store$)
// The reference form returns a stable Proxy — downstream useMemo/effects never
// detect child-level changes, so adds/edits silently don't re-render.
//
// HOUP-73: all platform coupling (IndexedDB/expo-sqlite persistence, online/
// visibility detection, the Supabase client) goes through getStoreEnvironment()
// instead of a browser/RN global — see store-environment.ts.

import { observable, syncState, when, type Observable } from '@legendapp/state';
import { onChangeRemote } from '@legendapp/state/sync';
import { syncedSupabase, configureSyncedSupabase } from '@legendapp/state/sync-plugins/supabase';
import { useCallback, useEffect } from 'react';
import { getStoreEnvironment, envRandomUUID, type StoreEnvironment } from './store-environment';
import { reportWriteFailure } from './write-failures';

// Minimum shape every synced row must have.
export interface SyncedRow {
  id: string;
  group_id: string;
  deleted: boolean;
}

export type GroupRecord<T> = Record<string, T>;

/**
 * A table's `store$(groupId)` accessor. `collection` names the Supabase table,
 * which store-modules.ts maps to the modules whose data it holds.
 */
export type GroupStore<T> = ((groupId: string | undefined | null) => Observable<GroupRecord<T>>) & {
  readonly collection: string;
};

let configured = false;

/**
 * Configure the Supabase-plugin defaults exactly once. Safe (and cheap) to
 * call from any store factory before first use.
 */
export function ensureLegendConfigured(): void {
  if (configured) return;
  configured = true;

  configureSyncedSupabase({
    // Local optimistic primary key so an offline create is stable before it ever
    // reaches Supabase (reconciled by id on sync — no temp-id swap needed).
    generateId: () => envRandomUUID(),
    // Incremental sync: pull only rows changed since our last sync, and learn
    // about deletions via the `deleted` tombstone (schema added in FLUX-148).
    changesSince: 'last-sync',
    fieldCreatedAt: 'created_at',
    fieldUpdatedAt: 'updated_at',
    fieldDeleted: 'deleted',
  });
}

// FLUX-1545: (collection, groupId) for each memoised store observable, so
// useReconnectSync can mount a table/group-scoped realtime watchdog and
// fallback-sync scheduler without changing its call signature at every
// consumer (11 stores across the app already call `useReconnectSync(store$)`).
const storeMeta = new WeakMap<Observable<GroupRecord<SyncedRow>>, { collection: string; groupId: string }>();

// Fast delta cadence: caps worst-case staleness while the realtime channel is
// down. Delta-only (changesSince: 'last-sync'), so each pull is small — but by
// construction it cannot backfill a row that already sits below the advanced
// `lastSync` watermark.
export const FALLBACK_SYNC_INTERVAL_MS = 20_000;
// Safety-net cadence while the realtime channel reports SUBSCRIBED: realtime
// already delivers every change, so this only catches a silently dropped event.
// Polling every store every 20s regardless of channel health was the likely
// main source of hosted Supabase log ingestion: about 20 mounted stores times two
// requests (delta pull + delete reconcile) per tick is ~7,000 requests an hour
// for each visible tab or open phone.
export const HEALTHY_SYNC_INTERVAL_MS = 5 * 60_000;
// Slow reset cadence (absorbs FLUX-266): the only thing that repairs a
// permanent hole left by a dropped realtime event advancing `lastSync` past a
// missed row. Group tables are small, so a daily full re-pull is trivial.
const RESET_SYNC_THROTTLE_MS = 24 * 60 * 60 * 1000;
const RESET_SYNC_STORAGE_PREFIX = 'legend:lastFullPull:';

function dueForResetSync(collection: string, groupId: string): boolean {
  try {
    const raw = getStoreEnvironment().keyValue.getItem(`${RESET_SYNC_STORAGE_PREFIX}${collection}:${groupId}`);
    const last = raw ? Number(raw) : 0;
    return !Number.isFinite(last) || Date.now() - last >= RESET_SYNC_THROTTLE_MS;
  } catch {
    return true;
  }
}

/**
 * Runs `run` once the store has loaded and no pull is in flight. Legend applies
 * only the latest pull to finish (sync.js: a get that resolves after a later
 * one is dropped), so the daily full re-pull started next to the opening delta
 * pull lost to it every time: the delta answers first, the full pull's rows
 * (tombstones included) are thrown away, and a row deleted while this device
 * wasn't listening stayed on screen for days (rent counted twice in Costs).
 */
export function whenPullsSettled(state$: Observable<{ isLoaded?: boolean; isGetting?: boolean }>, run: () => void): void {
  void when(() => !!state$.isLoaded.get() && !state$.isGetting.get(), run);
}

function markResetSyncDone(collection: string, groupId: string): void {
  try {
    getStoreEnvironment().keyValue.setItem(`${RESET_SYNC_STORAGE_PREFIX}${collection}:${groupId}`, String(Date.now()));
  } catch { /* noop — worst case the reset cadence just fires again next visit */ }
}

// HOUP-243: reconcile soft-deletes independent of the `lastSync` watermark.
// The Supabase plugin's realtime subscribe handler advances `lastSync` to the
// `updated_at` of ANY delivered row on this collection (legend-state's
// syncedCrud `subscribe` wrapper calls `computeLastSync` over every incoming
// row and sets it unconditionally — sync-plugins/crud.js). So a delete event
// missed while the channel briefly drops (reconnect, backgrounded tab) can be
// stranded forever: once a LATER event for any other row is delivered, the
// fallback delta pull's `.gt(updated_at, lastSync)` permanently skips the
// missed tombstone — only the 24h `resetLastSync` full re-pull used to catch
// it. This asks the server directly "which rows are deleted?" (no watermark
// involved) and removes any that are still visible locally. Cheap: group
// tables are small and only deleted rows are selected.
//
// HOUP-267: the removal below runs inside onChangeRemote() so it doesn't
// echo back to the server. This store runs in soft-delete mode
// (fieldDeleted: 'deleted'), so the Supabase plugin's `deleteFn` is
// `undefined` (sync-plugins/supabase.js: `deleteFn = !fieldDeleted && …`),
// and a plain `.delete()` on the local key gets routed through the crud
// plugin's `set` → deletes handler's `fieldDeleted && updateFn` branch
// (sync-plugins/crud.js:614-654), pushing a redundant `{ id, deleted: true }`
// UPDATE for a row that is already `deleted: true` server-side. `onChangeRemote`
// (from '@legendapp/state/sync') tags the mutation `isFromSync`, which the
// crud plugin reads to skip the outbound push (`saveRemote = !inRemoteChange
// && …` in sync.js) while still updating local persistence — the same seam
// the plugin itself uses to apply an incoming tombstone without re-pushing it.
export async function reconcileDeletedRows<T extends SyncedRow>(
  env: Pick<StoreEnvironment, 'supabase'>,
  collection: string,
  groupId: string,
  store$: Observable<GroupRecord<T>>,
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (env.supabase.from(collection) as any)
      .select('id')
      .eq('group_id', groupId)
      .eq('deleted', true);
    const rows = (res?.data as { id: string }[] | null) ?? [];
    if (!rows.length) return;
    const current = store$.peek() ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const at = (id: string): any => (store$ as unknown as Record<string, Observable<T>>)[id];
    const staleIds = rows.filter((row) => row.id in current).map((row) => row.id);
    if (!staleIds.length) return;
    onChangeRemote(() => {
      for (const id of staleIds) {
        at(id).delete();
      }
    });
  } catch {
    // Best-effort — the 24h resetLastSync pull remains the backstop.
  }
}

// FLUX-263: classify write failures. Anything that can succeed on a later
// attempt MUST be thrown so Legend retries it — a swallowed transient error
// permanently drops the row server-side while it stays visible in the local
// cache (the "recipe shows 2 of 12 ingredients on every other device" bug).
// Only genuinely permanent errors (RLS, constraint, schema) may be dropped.
const TRANSIENT_HTTP_STATUS = new Set([401, 408, 425, 429]);
const TRANSIENT_MESSAGE =
  /failed to fetch|fetch failed|networkerror|network request failed|load failed|timed? ?out|aborted/i;

function isTransientWriteError(
  error: { message?: string; code?: string },
  status?: number,
): boolean {
  if (typeof status === 'number' && (status >= 500 || TRANSIENT_HTTP_STATUS.has(status))) return true;
  if (TRANSIENT_MESSAGE.test(String(error.message ?? ''))) return true;
  // PGRST301 = JWT expired/invalid — succeeds once the auth client refreshes.
  return String(error.code ?? '') === 'PGRST301';
}

// Stuck-sync fix: a server that answers with a "transient" error (5xx, 401,
// 429, a statement timeout) on every attempt used to be retried forever, so
// one bad row kept the "Syncing 1 pending change" banner up for good. Only a
// write that got no answer at all (offline, dropped connection) may wait
// indefinitely. One the server keeps refusing gets this many attempts
// (1s + 2s + 4s + ... about 2 minutes with the backoff below), then it is
// dropped and reported like a permanent error.
export const MAX_SERVER_ERROR_ATTEMPTS = 8;

export type WriteErrorAction = 'retry' | 'drop';

export function writeErrorAction(
  error: { message?: string; code?: string },
  status: number | undefined,
  context: { online: boolean; attempts: number },
): WriteErrorAction {
  if (!isTransientWriteError(error, status)) return 'drop';
  // No HTTP status means the request never got an answer.
  if (!context.online || !status) return 'retry';
  return context.attempts < MAX_SERVER_ERROR_ATTEMPTS ? 'retry' : 'drop';
}

/**
 * Returns a `store$(groupId)` function backed by a memoised synced observable.
 * Call once at module level per table:
 *
 *   export const groceryItems$ = createGroupStore<GroceryItem>({
 *     collection: 'grocery_items',
 *     storageName: 'grocery_items',
 *   });
 */
export function createGroupStore<T extends SyncedRow>(config: {
  collection: string;
  /** Must match one of the platform env's declared persistence table names. */
  storageName: string;
  logTag?: string;
  /**
   * HOUP-333: optional per-row normaliser applied to every row that arrives from
   * Supabase — the initial list, each realtime event, and the row echoed back by
   * a create/update — before it enters the store (Legend `transform.load`, which
   * syncedCrud runs per row and skips for tombstoned rows). Use it to backfill a
   * field consumers iterate unguarded (recipes.cuisines) so one malformed row can
   * never crash a whole section. Rows already sitting in the persisted local
   * cache are NOT passed through it — render sites keep their own guard.
   */
  normalizeRow?: (row: T) => T;
}): GroupStore<T> {
  const { collection, storageName, normalizeRow } = config;
  const logTag = config.logTag ?? `[legend ${collection}]`;

  const stores = new Map<string, Observable<GroupRecord<T>>>();
  // Server-error attempts per row id since its last success (see writeErrorAction).
  const serverErrorAttempts = new Map<string, number>();
  const empty$ = observable<GroupRecord<T>>({});

  function store$(groupId: string | undefined | null): Observable<GroupRecord<T>> {
    if (!groupId) return empty$;
    ensureLegendConfigured();
    const env = getStoreEnvironment();

    let store = stores.get(groupId);
    if (!store) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pushRow = async (input: any): Promise<any> => {
        const key = String(input?.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await (env.supabase.from(collection) as any)
          .upsert(input, { onConflict: 'id' })
          .select();
        const { data, error } = res;
        if (error) {
          const attempts = (serverErrorAttempts.get(key) ?? 0) + 1;
          if (res.status) serverErrorAttempts.set(key, attempts);
          // Transient failure (network drop, aborted fetch, expired JWT,
          // rate limit, 5xx) → rethrow so runWithRetry backs off and
          // retries, and retrySync replays it across restarts (upsert is
          // idempotent, so retrying is always safe). Returning instead of
          // throwing marks the write SAVED and drops it permanently while
          // the row stays visible in the local cache — that is how recipe
          // ingredients and checklist items went missing on every other
          // device (FLUX-263). A server that refuses it every time is capped
          // by writeErrorAction, so the outbox can't stall on it forever.
          if (writeErrorAction(error, res.status, { online: env.isOnline(), attempts }) === 'retry') {
            throw error instanceof Error ? error : new Error(String(error.message ?? error));
          }
          // Permanent error (RLS / constraint / schema, or a server error
          // that never cleared). Do NOT return {error} here: Legend's
          // wrapSupabaseFn reads onError off the input row for the create
          // path (a library quirk) and would throw a confusing TypeError.
          // Log and report it ourselves, and drop the write.
          serverErrorAttempts.delete(key);
          console.warn(logTag, error);
          reportWriteFailure(collection, key, error);
          return { data: null, error: null };
        }
        serverErrorAttempts.delete(key);
        // wrapSupabaseFn hands this `data` straight to saveResult, which wants
        // a single row — not the array .select() returns. Unwrap [0] here.
        return { data: (data as unknown[] | null)?.[0] ?? null, error: null };
      };

      store = observable(
        syncedSupabase({
          supabase: env.supabase,
          collection,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          filter: (select: any) => select.eq('group_id', groupId),
          // No hard deletes — the `deleted` tombstone (configured globally in
          // ensureLegendConfigured) is how we signal a removal to Supabase.
          actions: ['read', 'create', 'update'],
          realtime: { filter: `group_id=eq.${groupId}` },
          // HOUP-333: per-row normaliser (see `normalizeRow` on the config type).
          ...(normalizeRow ? { transform: { load: (row: T) => normalizeRow(row) } } : {}),
          // Idempotent create — the structural fix for the 409 duplicate-key loop.
          // When the network drops a create's 201 response, Legend retries the
          // INSERT, but the server already made the row → 409. upsert turns that
          // retry into ON CONFLICT DO UPDATE; handle_times() preserves created_at
          // and bumps updated_at, so the retry returns 200 with real timestamps
          // instead of failing. Bonus: this self-heals any stale created_at:null
          // rows left in IndexedDB by older builds — no manual cache clear needed.
          //
          // FLUX-265: update uses the same upsert — the "ghost row" fix for the
          // UPDATE path. If a row exists in this device's local cache but never
          // reached Supabase (a hole left by a dropped create, e.g.
          // pre-FLUX-263), the default `.update().eq('id', ...)` matches 0
          // server rows and returns `data: []` — treated as success, so the
          // edit silently syncs nowhere. upsert self-heals the hole by
          // recreating the row with the edit applied. Safe because deletes are
          // soft (tombstone `deleted` column), so upsert can never resurrect a
          // hard-deleted row, and the store syncs with updatePartial: false, so
          // `input` here is always the full row — valid as an insert too.
          create: pushRow,
          update: pushRow,
          // Gotcha 1: plugin must be passed explicitly — it is NOT inherited.
          // HOUP-70: also where the group-scoping fix lives — the env's
          // getPersistConfig keys the local cache by groupId, not just
          // storageName, so two groups' stores can't share one local table.
          persist: env.getPersistConfig(storageName, groupId),
          // Gotcha 2: delay + maxDelay are MILLISECONDS (not seconds).
          // 1s → 2s → 4s … capped at 30s: at most ~2 retries/min while offline.
          retry: { infinite: true, backoff: 'exponential', delay: 1000, maxDelay: 30_000 },
          // Gotcha 3: a push that fails while offline is expected — retrySync
          // persists and replays it. Only log genuine online failures.
          // (409 duplicate-key is now handled structurally by the idempotent
          // `create` above, so it never reaches here.)
          onError: (error: unknown) => {
            if (!env.isOnline()) return;
            console.warn(logTag, error);
          },
        }),
      ) as unknown as Observable<GroupRecord<T>>;
      stores.set(groupId, store);
      storeMeta.set(store as unknown as Observable<GroupRecord<SyncedRow>>, { collection, groupId });
    }
    return store;
  }
  return Object.assign(store$, { collection });
}

export interface FallbackScheduler {
  /** Foregrounded: run the fallback timer at the cadence the channel health calls for. */
  start(): void;
  /** Backgrounded or unmounted: no timer at all. */
  stop(): void;
  /** Feed the watchdog channel's subscribe status in. */
  onChannelStatus(status: string): void;
}

/**
 * The fallback pull timer for one store, paced by realtime health: every 20s
 * while the watchdog channel is down (or not yet joined), every 5 minutes
 * while it is SUBSCRIBED. A channel failure pulls at once; a channel that
 * rejoins after a failure pulls once more to catch up on what it missed.
 */
export function createFallbackScheduler(
  sync: () => void,
  intervals: { fast: number; healthy: number } = { fast: FALLBACK_SYNC_INTERVAL_MS, healthy: HEALTHY_SYNC_INTERVAL_MS },
): FallbackScheduler {
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let healthy = false;
  let everFailed = false;

  const clear = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };
  const schedule = () => {
    clear();
    if (running) timer = setInterval(sync, healthy ? intervals.healthy : intervals.fast);
  };

  return {
    start() {
      if (running) return;
      running = true;
      schedule();
    },
    stop() {
      running = false;
      clear();
    },
    onChannelStatus(status) {
      if (status === 'SUBSCRIBED') {
        if (healthy) return;
        healthy = true;
        if (everFailed) sync();
        schedule();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        everFailed = true;
        sync();
        if (!healthy) return;
        healthy = false;
        schedule();
      }
    },
  };
}

interface SyncCoordinator {
  refCount: number;
  stop: () => void;
}

// FLUX-1545: one channel-health watchdog + one fallback scheduler per
// `collection:groupId`, ref-counted across every mounted
// `useReconnectSync(store$)` consumer that shares the same store (e.g. the
// home page, the groceries widget, and the always-mounted capture sheet all
// call `useReconnectSync(groceries$(groupId))` for the same group).
//
// Review fix (was a Blocker): an earlier version of this mounted the
// watchdog via `useGroupTableRealtime` on the bare `rt:${table}:${groupId}`
// topic — the SAME topic a feature channel may already hold (e.g. the
// FLUX-107 ping-pong guard on the groceries page). Supabase's
// `RealtimeClient.channel(topic)` returns the SAME object for a shared
// topic, and `removeChannel()` fully tears it down — so any one consumer
// unmounting killed realtime for every other holder of that topic. This
// coordinator instead (a) subscribes on its own `rt:watchdog:...` topic,
// which can never collide with a feature channel, and (b) is ref-counted so
// only the LAST consumer's unmount tears it down — earlier consumers
// unmounting (e.g. hiding the groceries widget) leave it running for the
// survivors.
//
// Review fix (was a Major): this also collapses what used to be one 20s
// `setInterval` per mounted component into one per store — N co-mounted
// consumers of the same store now cost one fallback timer, not N.
const syncCoordinators = new Map<string, SyncCoordinator>();

function acquireSyncCoordinator(
  store$: Observable<GroupRecord<SyncedRow>>,
  collection: string,
  groupId: string,
): () => void {
  const key = `${collection}:${groupId}`;
  let coord = syncCoordinators.get(key);
  if (!coord) {
    const env = getStoreEnvironment();
    const sync = () => {
      void syncState(store$ as Observable).sync();
      // HOUP-243: watermark-independent delete reconciliation — see
      // reconcileDeletedRows above. Runs on the same cadence as the delta
      // pull and on channel-error recovery, so a missed delete is caught
      // within one fallback tick instead of waiting for the 24h full reset.
      void reconcileDeletedRows(env, collection, groupId, store$);
    };
    const runResetIfDue = () => {
      if (!dueForResetSync(collection, groupId)) return;
      markResetSyncDone(collection, groupId);
      const state$ = syncState(store$ as Observable);
      whenPullsSettled(state$, () => void state$.sync({ resetLastSync: true }));
    };

    const scheduler = createFallbackScheduler(sync);
    // A delete this device missed would otherwise stay on screen until the
    // first fallback tick (5 minutes while realtime is healthy), so check for
    // one as soon as the store is first used in this app session.
    let reconciledOnStart = false;
    const startTimer = () => {
      scheduler.start();
      runResetIfDue();
      if (!reconciledOnStart) {
        reconciledOnStart = true;
        void reconcileDeletedRows(env, collection, groupId, store$);
      }
    };
    const stopTimer = () => scheduler.stop();

    // Distinct "watchdog:" topic namespace — never the bare
    // `rt:${collection}:${groupId}` topic a feature channel might hold.
    // `onChange` is a no-op: row delivery stays with Legend's own realtime
    // channel, this one exists solely to observe connection health.
    const channel = env.supabase
      .channel(`rt:watchdog:${collection}:${groupId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: collection, filter: `group_id=eq.${groupId}` },
        () => {},
      )
      .subscribe((status: string) => scheduler.onChannelStatus(status));

    const unsubscribeForeground = env.subscribeForeground(startTimer, stopTimer);
    if (env.isForeground()) startTimer();

    coord = {
      refCount: 0,
      stop: () => {
        stopTimer();
        unsubscribeForeground();
        void env.supabase.removeChannel(channel);
      },
    };
    syncCoordinators.set(key, coord);
  }

  coord.refCount += 1;
  const activeCoord = coord;
  return () => {
    activeCoord.refCount -= 1;
    if (activeCoord.refCount > 0) return;
    syncCoordinators.delete(key);
    activeCoord.stop();
  };
}

/**
 * Pushes pending offline writes on reconnect, pulls any missed rows when the
 * tab comes back into focus, and — FLUX-1545 — keeps a foregrounded, nominally
 * "online" tab converged even when Legend's realtime channel silently dies
 * (e.g. a flaky supermarket connection) and neither reconnect trigger fires:
 *
 *  - "back online": flushed writes that were queued while offline.
 *  - "returned to foreground": catches realtime events missed while the tab
 *    was backgrounded (the channel only fires when the observable is subscribed).
 *  - **Channel-health watchdog + fallback scheduler**: see
 *    `acquireSyncCoordinator` above — a singleton per (collection, groupId),
 *    ref-counted across every mounted consumer of the same store.
 */
export function useReconnectSync(store$: Observable<GroupRecord<SyncedRow>>) {
  const meta = storeMeta.get(store$);

  useEffect(() => {
    const env = getStoreEnvironment();
    const sync = () => {
      void syncState(store$ as Observable).sync();
      // HOUP-243: catch a delete missed while offline as soon as we're back,
      // instead of waiting on the watermark-gated delta pull (see
      // reconcileDeletedRows above).
      if (meta) void reconcileDeletedRows(env, meta.collection, meta.groupId, store$);
    };
    return env.subscribeReconnect(sync);
  }, [store$, meta]);

  // Deliberately inert when this store has no meta, i.e. the `empty$`
  // fallback returned for a not-yet-known groupId.
  useEffect(() => {
    if (!meta) return;
    return acquireSyncCoordinator(store$, meta.collection, meta.groupId);
  }, [store$, meta]);
}

/**
 * Pulls a store's latest rows now, for a table the server writes (a Scout
 * run archived through the API) when the screen shouldn't wait on realtime.
 */
export function syncStoreNow(store$: Observable<GroupRecord<SyncedRow>>): void {
  void syncState(store$ as Observable).sync();
}

/**
 * Safe write helpers for a group Legend store.
 *
 * Bakes in the two write-path gotchas from FLUX-149:
 *
 *  5. New rows MUST carry null created_at / updated_at so Legend classifies
 *     the write as INSERT. Legend uses `isCreate = !value[fieldCreatedAt]`; a
 *     real timestamp makes it a PATCH of a non-existent row → silent no-op.
 *     The DB handle_times() trigger fills real timestamps on insert.
 *
 *  6. Update path uses assign() without server timestamps, never set().
 *     set({...row, created_at: null}) overwrites a real timestamp back to null,
 *     re-classifying the next write as INSERT → duplicate POST → 409 conflict.
 */
export function useStoreHelpers<T extends SyncedRow>(
  store$: Observable<GroupRecord<T>>,
  currentUserId: string | null | undefined,
) {
  // Internal helper: keyed access into the observable (Legend uses Proxy at runtime).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const at = (id: string): any =>
    (store$ as unknown as Record<string, Observable<T>>)[id];

  const writeRow = useCallback(
    (row: T) => {
      const existing = at(row.id).peek();
      // A row is new (INSERT) only when it's absent from the store AND has no
      // real created_at. A Supabase-returned item (real created_at) must always
      // go through the UPDATE path even if the store hasn't hydrated yet —
      // otherwise peek()===undefined misclassifies it as INSERT → 409 conflict.
      const isNew = existing === undefined && !(row as Record<string, unknown>).created_at;
      if (isNew) {
        // Gotcha 5: null timestamps signal INSERT to Legend's CRUD plugin.
        const stamped = { ...row, created_at: null, updated_at: null } as unknown as T;
        if ('created_by' in stamped) {
          (stamped as Record<string, unknown>).created_by =
            (row as Record<string, unknown>).created_by ?? currentUserId ?? null;
        }
        at(row.id).set(stamped);
      } else {
        // Gotcha 6: exclude server timestamps so we never null them out.
        const { created_at: _ct, updated_at: _ut, ...rest } = row as Record<string, unknown>;
        at(row.id).assign(rest as Partial<T>);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store$, currentUserId],
  );

  // patchRow/softDeleteRow only touch rows the store already holds: assign() on
  // a missing id creates a partial row (just the patch's fields, no `name` etc.)
  // that the server then rejects on its not-null columns, so it never syncs
  // away and sits in the local cache crashing whatever reads it.
  const patchRow = useCallback(
    (id: string, patch: Partial<T>) => {
      if (at(id).peek() === undefined) {
        console.warn('[legend] patchRow skipped: no row', id);
        return;
      }
      at(id).assign(patch);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store$],
  );

  const softDeleteRow = useCallback(
    (id: string) => {
      // Use assign() — same proven update path as patchRow. A deep nested
      // .deleted.set(true) doesn't reliably dirty-mark the parent record for
      // syncedSupabase's PATCH queue.
      if (at(id).peek() === undefined) return;
      at(id).assign({ deleted: true } as Partial<T>);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store$],
  );

  // Put a row the server already holds into the local store without pushing
  // it back: for rows written outside the store (e.g. adoptLegacyDocument's
  // insert) that the next patchRow must find whole. Same onChangeRemote seam
  // as reconcileDeletedRows above.
  const seedRow = useCallback(
    (row: T) => {
      onChangeRemote(() => {
        at(row.id).set(row);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store$],
  );

  return { writeRow, patchRow, softDeleteRow, seedRow };
}
