import { syncState } from '@legendapp/state';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import {
  applyGroceryDisposition,
  applyTaskCompletion,
  buildHeroItems,
  buildWidgetGrocerySnapshotItems,
  buildWidgetSnapshotItems,
  countNeeded,
  groceryItems$,
  mergeWidgetTaskRows,
  householdTasks$,
  readWidgetModuleFlags,
  todayISO,
  widgetHeroVisibility,
  widgetTodayProgress,
  WIDGET_SNAPSHOT_VERSION,
  WIDGET_UNDO_WINDOW_MS,
  type GroceryItem,
  type HouseholdTask,
  type WidgetGrocerySnapshotItem,
  type WidgetSummary,
  type WidgetTaskSnapshotItem,
  type WidgetTodaySnapshot,
} from '@homeup/core';
// HOUP-110: module-load side effect registers nativeStoreEnvironment — safe
// to import here even though no Activity/React tree is mounted (a headless
// widget click never runs _layout.tsx, which is this seam's usual entry
// point). getSupabaseClient(config) below is what actually binds the client;
// this import only wires up persistence/online/keyValue.
import '../lib/legend/environment';
import { getStoredServer } from '../lib/server-config';
import { getSupabaseClient } from '../lib/supabase-client';
import { readDataCacheSnapshot } from '../lib/legend/data-cache-snapshot';
import { randomUUID } from '../lib/uuid';
import { isWeatherStale } from './weather-cache';
import { readWidgetSnapshot, readWidgetThemePreference, writeWidgetSnapshot } from './widget-snapshot';
import { tasksWidgetRepresentation } from './TasksWidget';

const HYDRATION_TIMEOUT_MS = 4000;
const HYDRATION_POLL_MS = 50;

// Modules: the snapshot's summary carries which modules the widget may show
// (written by use-widget-sync.ts); TasksWidget reads them from it, an
// omitted flag (a snapshot from an older app, or none at all) counting as on.
function renderFromSnapshot(props: WidgetTaskHandlerProps, snapshot: WidgetTodaySnapshot | null): void {
  const widgetProps = {
    items: snapshot?.items ?? [],
    groceries: snapshot?.groceries ?? [],
    summary: snapshot?.summary ?? {
      openTodoCount: 0,
      toBuyCount: 0,
      doneTodayCount: 0,
      budget: null,
      bills: [],
      weather: null,
    },
  };
  // A light and a dark render in the app's picked theme; Android shows the one matching the phone's dark mode.
  props.renderWidget(tasksWidgetRepresentation(widgetProps, readWidgetThemePreference()));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pollUntilLoaded(store$: any, timeoutMs = HYDRATION_TIMEOUT_MS): Promise<boolean> {
  // `syncedSupabase`'s `list()` fetch is lazy — .peek() forces the resolution
  // that a mounted component's `use$(() => store$.get())` would otherwise
  // trigger (same pattern as apps/web's create-group-store.offline.test.ts).
  store$.peek();
  const start = Date.now();
  while (!syncState(store$).peek()?.isLoaded) {
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, HYDRATION_POLL_MS));
  }
  return true;
}

interface HeadlessContext {
  groupId: string;
  currentUserId: string | null;
}

async function bindHeadlessContext(): Promise<HeadlessContext | null> {
  const snapshot = readDataCacheSnapshot();
  if (!snapshot?.group?.id) return null;
  try {
    const server = await getStoredServer();
    if (!server) return null;
    // Idempotent — a no-op if a live app session already bound this exact
    // config, which is the common case (the widget click's headless task
    // shares the process with a backgrounded, not fully killed, app).
    getSupabaseClient(server.config);
  } catch {
    return null;
  }
  return { groupId: snapshot.group.id, currentUserId: snapshot.currentUserId };
}

export interface ToggleTaskPayload {
  id: string;
  snapshotVersion: number;
  snapshotDone: boolean;
  snapshotSourceUpdatedAt: string | null;
}

export function isToggleTaskPayload(raw: unknown): raw is ToggleTaskPayload {
  if (!raw || typeof raw !== 'object') return false;
  const data = raw as Record<string, unknown>;
  return (
    typeof data.id === 'string' &&
    typeof data.snapshotVersion === 'number' &&
    typeof data.snapshotDone === 'boolean' &&
    (data.snapshotSourceUpdatedAt === null || typeof data.snapshotSourceUpdatedAt === 'string')
  );
}

export interface ToggleGroceryPayload {
  id: string;
  snapshotVersion: number;
  snapshotStatus: GroceryItem['status'];
  snapshotSourceUpdatedAt: string | null;
}

export function isToggleGroceryPayload(raw: unknown): raw is ToggleGroceryPayload {
  if (!raw || typeof raw !== 'object') return false;
  const data = raw as Record<string, unknown>;
  return (
    typeof data.id === 'string' &&
    typeof data.snapshotVersion === 'number' &&
    (data.snapshotStatus === 'needed' || data.snapshotStatus === 'bought' || data.snapshotStatus === 'have') &&
    (data.snapshotSourceUpdatedAt === null || typeof data.snapshotSourceUpdatedAt === 'string')
  );
}

// HOUP-110: the stale-render guard's pure decision, split into its two
// stages so each is unit-testable without a live Legend-State environment
// (`widgetTaskHandler.test.ts`). Stage 1 (checkTask/GrocerySnapshotGuard)
// runs against the widget's own last-written snapshot — cheap, catches
// "tapped an old render before this device's own next sync" — and gates
// whether the handler bothers binding the headless store context at all.
// Stage 2 (checkTask/GroceryHydratedGuard) runs after hydrating the real
// row, against the authoritative store — catches a change that arrived from
// ANOTHER device/session since the snapshot was written. Either stage
// returning null rejects with no mutation; the snapshot is a visible-event
// guard, never authority — group/eligibility/recurrence come only from the
// hydrated row in stage 2.
export function checkTaskSnapshotGuard(
  snapshot: WidgetTodaySnapshot | null,
  payload: ToggleTaskPayload,
): { snapshot: WidgetTodaySnapshot; cached: WidgetTaskSnapshotItem } | null {
  if (!snapshot || payload.snapshotVersion !== WIDGET_SNAPSHOT_VERSION) return null;
  const cached = snapshot.items.find((i) => i.id === payload.id);
  if (
    !cached ||
    !cached.toggleable ||
    cached.done !== payload.snapshotDone ||
    cached.sourceUpdatedAt !== payload.snapshotSourceUpdatedAt
  ) {
    return null;
  }
  return { snapshot, cached };
}

export function checkTaskHydratedGuard(
  row: HouseholdTask | undefined,
  groupId: string,
  payload: ToggleTaskPayload,
): HouseholdTask | null {
  if (
    !row ||
    row.deleted ||
    row.group_id !== groupId ||
    row.done !== payload.snapshotDone ||
    (row.updated_at ?? null) !== payload.snapshotSourceUpdatedAt
  ) {
    return null;
  }
  return row;
}

export function checkGrocerySnapshotGuard(
  snapshot: WidgetTodaySnapshot | null,
  payload: ToggleGroceryPayload,
): { snapshot: WidgetTodaySnapshot; cached: WidgetGrocerySnapshotItem } | null {
  if (!snapshot || payload.snapshotVersion !== WIDGET_SNAPSHOT_VERSION) return null;
  // Modules: no grocery write-back from a render made before Groceries went off.
  if (!readWidgetModuleFlags(snapshot.summary).groceriesOn) return null;
  const cached = snapshot.groceries.find((g) => g.id === payload.id);
  if (!cached || cached.status !== payload.snapshotStatus || cached.sourceUpdatedAt !== payload.snapshotSourceUpdatedAt) {
    return null;
  }
  return { snapshot, cached };
}

export function checkGroceryHydratedGuard(
  row: GroceryItem | undefined,
  groupId: string,
  payload: ToggleGroceryPayload,
): GroceryItem | null {
  if (
    !row ||
    row.deleted ||
    row.group_id !== groupId ||
    row.status !== payload.snapshotStatus ||
    (row.updated_at ?? null) !== payload.snapshotSourceUpdatedAt
  ) {
    return null;
  }
  return row;
}

// HOUP-110: a toggle's best-effort weather line is carried forward from the
// pre-toggle snapshot verbatim (no re-fetch on every task/grocery tap) — but
// `stale` must be re-derived from `updatedAt` at repaint time, or a reading
// keeps rendering as fresh past the 3h threshold until the next foreground
// sync recomputes it.
export function recomputeWeatherStale(
  weather: WidgetSummary['weather'],
  now: Date = new Date(),
): WidgetSummary['weather'] {
  if (!weather) return null;
  return { ...weather, stale: isWeatherStale(weather.updatedAt, now) };
}

// The tap's answer on screen comes before the store: binding the headless
// context and hydrating the tasks store can take seconds (a cold store waits
// on its first pull), and a widget that sits unchanged that long reads as a
// missed tap and gets tapped again. So the tick is drawn from the snapshot
// alone the moment the guard passes, and the real rebuild replaces it (or the
// old snapshot comes back) once the store has answered.
export function optimisticTaskSnapshot(
  snapshot: WidgetTodaySnapshot,
  cached: WidgetTaskSnapshotItem,
  now: Date = new Date(),
): WidgetTodaySnapshot {
  const done = !cached.done;
  const items = snapshot.items.map((i) => (i.id === cached.id ? { ...i, done } : i));
  const progress = widgetTodayProgress(items, todayISO());
  return {
    ...snapshot,
    updatedAt: now.toISOString(),
    items,
    summary: {
      ...snapshot.summary,
      openTodoCount: progress.left,
      doneTodayCount: progress.done,
      weather: recomputeWeatherStale(snapshot.summary.weather, now),
      lastTick: { id: cached.id, title: cached.title, done, at: now.toISOString() },
    },
  };
}

export function optimisticGrocerySnapshot(
  snapshot: WidgetTodaySnapshot,
  cached: WidgetGrocerySnapshotItem,
  now: Date = new Date(),
): WidgetTodaySnapshot {
  // The widget lists needed items only, so buying one drops it from the list.
  const bought = cached.status !== 'bought';
  const groceries = bought
    ? snapshot.groceries.filter((g) => g.id !== cached.id)
    : snapshot.groceries.map((g) => (g.id === cached.id ? { ...g, status: 'needed' as const } : g));
  return {
    ...snapshot,
    updatedAt: now.toISOString(),
    groceries,
    summary: {
      ...snapshot.summary,
      toBuyCount: Math.max(0, snapshot.summary.toBuyCount + (bought ? -1 : 1)),
      weather: recomputeWeatherStale(snapshot.summary.weather, now),
    },
  };
}

function writeAndRender(props: WidgetTaskHandlerProps, snapshot: WidgetTodaySnapshot): void {
  writeWidgetSnapshot(snapshot.items, snapshot.groceries, snapshot.summary);
  renderFromSnapshot(props, snapshot);
}

// One tick at a time. A second tap that lands while the first is still
// syncing (an impatient double tap, or Undo before the store answered) is
// dropped, so two headless runs never race on the same snapshot.
let toggleInFlight = false;

async function runExclusive(props: WidgetTaskHandlerProps, run: () => Promise<void>): Promise<void> {
  if (toggleInFlight) {
    renderFromSnapshot(props, readWidgetSnapshot());
    return;
  }
  toggleInFlight = true;
  try {
    await run();
  } finally {
    toggleInFlight = false;
  }
}

// The Undo line shows for WIDGET_UNDO_WINDOW_MS after a tick, but nothing
// else redraws the widget that soon. So the tick's headless task waits out
// the window (well inside the task's 30s limit) and draws the latest
// snapshot once more, which no longer has the line. A newer tick in the
// meantime keeps its own line, since its window has not run out yet.
const UNDO_DISMISS_SLACK_MS = 250;

async function dismissUndoLater(props: WidgetTaskHandlerProps): Promise<void> {
  if (!readWidgetSnapshot()?.summary.lastTick) return;
  await new Promise((resolve) => setTimeout(resolve, WIDGET_UNDO_WINDOW_MS + UNDO_DISMISS_SLACK_MS));
  renderFromSnapshot(props, readWidgetSnapshot());
}

async function handleToggleTask(payload: ToggleTaskPayload, props: WidgetTaskHandlerProps): Promise<void> {
  const snapshot = readWidgetSnapshot();
  const guard = checkTaskSnapshotGuard(snapshot, payload);
  if (!guard) {
    renderFromSnapshot(props, snapshot);
    return;
  }

  // Draw the tick now. The stored snapshot moves with it, so a repeat tap on
  // the old render no longer matches and is rejected by the guard above.
  writeAndRender(props, optimisticTaskSnapshot(guard.snapshot, guard.cached));
  const revert = () => writeAndRender(props, guard.snapshot);

  try {
    const ctx = await bindHeadlessContext();
    if (!ctx) {
      revert();
      return;
    }

    const tasksStore$ = householdTasks$(ctx.groupId);
    if (!(await pollUntilLoaded(tasksStore$))) {
      revert();
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rowObs = (tasksStore$ as any)[payload.id];
    const row = checkTaskHydratedGuard(rowObs.peek(), ctx.groupId, payload);
    if (!row) {
      revert();
      return;
    }

    commitTaskToggle(props, payload, guard, ctx, tasksStore$, rowObs, row);
  } catch (error) {
    revert();
    throw error;
  }
}

function commitTaskToggle(
  props: WidgetTaskHandlerProps,
  payload: ToggleTaskPayload,
  guard: { snapshot: WidgetTodaySnapshot },
  ctx: HeadlessContext,
  tasksStore$: ReturnType<typeof householdTasks$>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rowObs: any,
  row: HouseholdTask,
): void {
  const targetDone = !payload.snapshotDone;
  const { update, createNextOccurrence } = applyTaskCompletion(row, targetDone, { nextId: randomUUID() });
  rowObs.assign(update);
  if (createNextOccurrence) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tasksStore$ as any)[createNextOccurrence.id].set(createNextOccurrence);
  }

  const allTasks = Object.values(tasksStore$.peek() ?? {}).filter(
    (t): t is HouseholdTask => !!t && !t.deleted,
  );
  // Modules: rebuild the task and reminder rows under the same flags and
  // window the snapshot was written with. This task has no event or viewing
  // stores, so those rows carry over from the snapshot as they were.
  const heroItems = buildHeroItems({
    tasks: allTasks,
    appointments: [],
    apartments: [],
    today: todayISO(),
    ...widgetHeroVisibility(readWidgetModuleFlags(guard.snapshot.summary)),
    searchVisible: false,
    calendarEvents: [],
    range: 'upcoming',
    upcomingDays: guard.snapshot.summary.upcomingDays,
  });
  const items = mergeWidgetTaskRows(guard.snapshot.items, buildWidgetSnapshotItems(heroItems, ctx.currentUserId));
  const progress = widgetTodayProgress(items, todayISO());

  const nextSnapshot: WidgetTodaySnapshot = {
    version: WIDGET_SNAPSHOT_VERSION,
    updatedAt: new Date().toISOString(),
    items,
    groceries: guard.snapshot.groceries,
    summary: {
      ...guard.snapshot.summary,
      openTodoCount: progress.left,
      doneTodayCount: progress.done,
      weather: recomputeWeatherStale(guard.snapshot.summary.weather),
      // The widget's Undo line names what this tap changed, so a tap that
      // lands on the wrong row is visible and one tap away from reversed.
      lastTick: { id: row.id, title: row.title, done: targetDone, at: new Date().toISOString() },
    },
  };
  writeAndRender(props, nextSnapshot);
}

async function handleToggleGrocery(payload: ToggleGroceryPayload, props: WidgetTaskHandlerProps): Promise<void> {
  const snapshot = readWidgetSnapshot();
  const guard = checkGrocerySnapshotGuard(snapshot, payload);
  if (!guard) {
    renderFromSnapshot(props, snapshot);
    return;
  }

  writeAndRender(props, optimisticGrocerySnapshot(guard.snapshot, guard.cached));
  const revert = () => writeAndRender(props, guard.snapshot);

  try {
    const ctx = await bindHeadlessContext();
    if (!ctx) {
      revert();
      return;
    }

    const groceriesStore$ = groceryItems$(ctx.groupId);
    if (!(await pollUntilLoaded(groceriesStore$))) {
      revert();
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rowObs = (groceriesStore$ as any)[payload.id];
    const row = checkGroceryHydratedGuard(rowObs.peek(), ctx.groupId, payload);
    if (!row) {
      revert();
      return;
    }

    commitGroceryToggle(props, payload, guard, groceriesStore$, rowObs, row);
  } catch (error) {
    revert();
    throw error;
  }
}

function commitGroceryToggle(
  props: WidgetTaskHandlerProps,
  payload: ToggleGroceryPayload,
  guard: { snapshot: WidgetTodaySnapshot },
  groceriesStore$: ReturnType<typeof groceryItems$>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rowObs: any,
  row: GroceryItem,
): void {
  // HOUP-110: widget write-back is needed<->bought only (never `have` — that
  // is a deliberate in-app "already stocked" state, and un-checking a
  // widget-bought item only reverses the widget's own action).
  const targetStatus: GroceryItem['status'] = payload.snapshotStatus === 'bought' ? 'needed' : 'bought';
  const patch = applyGroceryDisposition(row, targetStatus);
  rowObs.assign(patch);

  const allGroceries = Object.values(groceriesStore$.peek() ?? {}).filter(
    (g): g is GroceryItem => !!g && !g.deleted,
  );
  const groceries = buildWidgetGrocerySnapshotItems(allGroceries);

  const nextSnapshot: WidgetTodaySnapshot = {
    version: WIDGET_SNAPSHOT_VERSION,
    updatedAt: new Date().toISOString(),
    items: guard.snapshot.items,
    groceries,
    summary: {
      ...guard.snapshot.summary,
      toBuyCount: countNeeded(allGroceries),
      weather: recomputeWeatherStale(guard.snapshot.summary.weather),
    },
  };
  writeAndRender(props, nextSnapshot);
}

// HOUP-106/HOUP-110: invoked by react-native-android-widget's own headless JS
// task — runs with the RN app possibly closed (WIDGET_UPDATE on the
// updatePeriodMillis timer, WIDGET_ADDED on placement, WIDGET_CLICK on tap).
// A tap on a row's TOGGLE_TASK/TOGGLE_GROCERY clickAction reaches this
// handler with clickActionData; a tap on an OPEN_URI clickAction (add "+",
// section headers, card background) is resolved natively by the library and
// never reaches here — those branches just re-render from the last snapshot.
export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  if (props.widgetInfo.widgetName !== 'TodaysTasks') {
    return;
  }

  switch (props.widgetAction) {
    case 'WIDGET_CLICK': {
      if (props.clickAction === 'TOGGLE_TASK' && isToggleTaskPayload(props.clickActionData)) {
        const payload = props.clickActionData;
        await runExclusive(props, () => handleToggleTask(payload, props));
        await dismissUndoLater(props);
        break;
      }
      if (props.clickAction === 'TOGGLE_GROCERY' && isToggleGroceryPayload(props.clickActionData)) {
        const payload = props.clickActionData;
        await runExclusive(props, () => handleToggleGrocery(payload, props));
        break;
      }
      renderFromSnapshot(props, readWidgetSnapshot());
      break;
    }

    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED': {
      renderFromSnapshot(props, readWidgetSnapshot());
      break;
    }

    case 'WIDGET_DELETED':
    default:
      break;
  }
}
