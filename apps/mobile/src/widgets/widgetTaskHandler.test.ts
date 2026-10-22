// HOUP-110 review follow-up: the headless stale-render guard is the
// ticket's core correctness promise ("a stale render is rejected, never
// inverted") and shipped with zero coverage. This file tests it two ways:
// (1) the extracted pure guard functions directly — no mocking needed,
// covers every reject branch cheaply and precisely; (2) a mocked
// end-to-end run through `widgetTaskHandler()` for the happy path, proving
// the guard's "allow" decision actually reaches a store mutation + a
// repainted snapshot, not just that the guard function returns non-null.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroceryItem, HouseholdTask, WidgetGrocerySnapshotItem, WidgetTaskSnapshotItem, WidgetTodaySnapshot } from '@homeup/core';

// react-native-android-widget fails to import under plain node (no
// jest-expo/Metro preset wired for apps/mobile — see vitest.config.ts) —
// TasksWidget.tsx is the only runtime importer of it reachable from
// widgetTaskHandler.ts, so stub it out rather than pull the real widget
// tree through this suite. `renderFromSnapshot` only asks it for the
// light/dark pair and hands that to the mocked `renderWidget` below, so the
// stub returns the props and theme preference each side would draw with.
vi.mock('./TasksWidget', () => ({
  tasksWidgetRepresentation: (props: unknown, preference: string) => ({ light: { props, preference }, dark: { props, preference } }),
}));

// weather-cache.ts (imported by widgetTaskHandler.ts for isWeatherStale, used
// by recomputeWeatherStale) opens its own SQLiteStorage handle at module
// load — not reachable under plain node without this mock (see
// weather-cache.test.ts for the same shim). No test here reads/writes
// through it directly, so an empty store is fine.
vi.mock('expo-sqlite/kv-store', () => ({
  SQLiteStorage: class {
    getItemSync() {
      return null;
    }
    setItemSync() {}
  },
}));

let storeLoaded = true;
vi.mock('@legendapp/state', async () => {
  const actual = await vi.importActual<typeof import('@legendapp/state')>('@legendapp/state');
  return { ...actual, syncState: vi.fn(() => ({ peek: () => ({ isLoaded: storeLoaded }) })) };
});

const getStoredServer = vi.fn();
vi.mock('../lib/server-config', () => ({ getStoredServer }));

const getSupabaseClient = vi.fn();
vi.mock('../lib/supabase-client', () => ({ getSupabaseClient }));

const readDataCacheSnapshot = vi.fn();
vi.mock('../lib/legend/data-cache-snapshot', () => ({ readDataCacheSnapshot }));

vi.mock('../lib/uuid', () => ({ randomUUID: vi.fn(() => 'next-occurrence-id') }));

vi.mock('../lib/legend/environment', () => ({}));

const readWidgetSnapshot = vi.fn();
const writeWidgetSnapshot = vi.fn();
const readWidgetThemePreference = vi.fn(() => 'ember:auto');
vi.mock('./widget-snapshot', () => ({ readWidgetSnapshot, readWidgetThemePreference, writeWidgetSnapshot }));

const householdTasks$ = vi.fn();
const groceryItems$ = vi.fn();
vi.mock('@homeup/core', async () => {
  const actual = await vi.importActual<typeof import('@homeup/core')>('@homeup/core');
  return { ...actual, householdTasks$, groceryItems$ };
});

// Bare in-memory store double: `store$.peek()` returns the whole rows map
// (as `Object.values(store$.peek() ?? {})` in the handler expects), and
// `store$[id]` returns a per-row handle with the `.peek()/.assign()/.set()`
// surface the handler actually calls — the same operations
// `useStoreHelpers.patchRow` makes on the real Legend-State observable
// (packages/core/src/data/create-group-store.ts), just backed by a plain
// object instead of an observable.
interface RowHandle<T> {
  peek: () => T | undefined;
  assign: (patch: Partial<T>) => void;
  set: (value: T) => void;
}

type FakeStore<T> = { peek: () => Record<string, T> } & Record<string, RowHandle<T>>;

function fakeStore<T extends { id: string }>(rows: Record<string, T>): FakeStore<T> {
  const data: Record<string, T> = { ...rows };
  const target = { peek: () => data };
  return new Proxy(target, {
    get(obj, prop: string, receiver) {
      if (prop in obj) return Reflect.get(obj, prop, receiver);
      const handle: RowHandle<T> = {
        peek: () => data[prop],
        assign: (patch) => {
          data[prop] = { ...data[prop], ...patch };
        },
        set: (value) => {
          data[prop] = value;
        },
      };
      return handle;
    },
  }) as FakeStore<T>;
}

function task(overrides: Partial<HouseholdTask> = {}): HouseholdTask {
  return {
    id: 'task-1',
    group_id: 'group-1',
    title: 'Book movers',
    due_date: '2026-08-03',
    due_time: null,
    offset_days: null,
    recurrence_days: null,
    done: false,
    completed_at: null,
    assigned_to: null,
    private: false,
    template_key: null,
    notes: null,
    sort_order: 0,
    priority: 'medium',
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    deleted: false,
    ...overrides,
  };
}

function groceryItem(overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    id: 'grocery-1',
    group_id: 'group-1',
    name: 'Milk',
    aisle: 'dairy',
    quantity: 1,
    unit: null,
    status: 'needed',
    notes: null,
    assigned_to: null,
    private: false,
    template_key: null,
    sort_order: 0,
    created_by: null,
    updated_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    deleted: false,
    recurrence_days: null,
    status_changed_at: null,
    last_purchased_at: null,
    last_price: null,
    lowest_price: null,
    expiry_date: null,
    shelf_life_days: null,
    price_cents: null,
    is_essential: false,
    recipe_note: null,
    recipe_source_id: null,
    re_add_snoozed_until: null,
    re_add_dismissed_at: null,
    ...overrides,
  };
}

function taskSnapshotItem(overrides: Partial<WidgetTaskSnapshotItem> = {}): WidgetTaskSnapshotItem {
  return {
    id: 'task-1',
    title: 'Book movers',
    done: false,
    due_date: '2026-08-03',
    due_time: null,
    priority: 'medium',
    assignedToMe: false,
    assigned: false,
    sourceUpdatedAt: '2026-08-01T00:00:00.000Z',
    type: 'task',
    section: 'household',
    sourceLabel: 'Task',
    toggleable: true,
    openPath: null,
    ...overrides,
  };
}

function grocerySnapshotItem(overrides: Partial<WidgetGrocerySnapshotItem> = {}): WidgetGrocerySnapshotItem {
  return {
    id: 'grocery-1',
    name: 'Milk',
    status: 'needed',
    quantity: 1,
    unit: null,
    aisle: 'dairy',
    sourceUpdatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function snapshot(overrides: Partial<WidgetTodaySnapshot> = {}): WidgetTodaySnapshot {
  return {
    version: 4,
    updatedAt: '2026-08-01T00:00:00.000Z',
    items: [taskSnapshotItem()],
    groceries: [grocerySnapshotItem()],
    summary: {
      openTodoCount: 1,
      toBuyCount: 1,
      doneTodayCount: 0,
      budget: null,
      bills: [],
      weather: null,
    },
    ...overrides,
  };
}

describe('pure guard decisions', () => {
  let mod: typeof import('./widgetTaskHandler');
  beforeEach(async () => {
    vi.resetModules();
    mod = await import('./widgetTaskHandler');
  });

  const taskPayload = { id: 'task-1', snapshotVersion: 4, snapshotDone: false, snapshotSourceUpdatedAt: '2026-08-01T00:00:00.000Z' };
  const groceryPayload = { id: 'grocery-1', snapshotVersion: 4, snapshotStatus: 'needed' as const, snapshotSourceUpdatedAt: '2026-08-01T00:00:00.000Z' };

  describe('checkTaskSnapshotGuard', () => {
    it('rejects a null snapshot', () => {
      expect(mod.checkTaskSnapshotGuard(null, taskPayload)).toBeNull();
    });

    it('rejects a version mismatch', () => {
      expect(mod.checkTaskSnapshotGuard(snapshot(), { ...taskPayload, snapshotVersion: 2 })).toBeNull();
    });

    it('rejects when the cached row is missing', () => {
      expect(mod.checkTaskSnapshotGuard(snapshot({ items: [] }), taskPayload)).toBeNull();
    });

    it('rejects a done mismatch between cache and payload', () => {
      const s = snapshot({ items: [taskSnapshotItem({ done: true })] });
      expect(mod.checkTaskSnapshotGuard(s, taskPayload)).toBeNull();
    });

    it('rejects a sourceUpdatedAt mismatch between cache and payload', () => {
      const s = snapshot({ items: [taskSnapshotItem({ sourceUpdatedAt: '2026-08-02T00:00:00.000Z' })] });
      expect(mod.checkTaskSnapshotGuard(s, taskPayload)).toBeNull();
    });

    it('rejects a row that is not a task (an event or viewing only opens)', () => {
      const s = snapshot({ items: [taskSnapshotItem({ type: 'event', section: 'calendar', toggleable: false })] });
      expect(mod.checkTaskSnapshotGuard(s, taskPayload)).toBeNull();
    });

    it('accepts a matching cached row (happy path)', () => {
      const s = snapshot();
      const result = mod.checkTaskSnapshotGuard(s, taskPayload);
      expect(result).toEqual({ snapshot: s, cached: s.items[0] });
    });
  });

  describe('checkTaskHydratedGuard', () => {
    it('rejects a missing row', () => {
      expect(mod.checkTaskHydratedGuard(undefined, 'group-1', taskPayload)).toBeNull();
    });

    it('rejects a deleted row', () => {
      expect(mod.checkTaskHydratedGuard(task({ deleted: true }), 'group-1', taskPayload)).toBeNull();
    });

    it('rejects a row from another group', () => {
      expect(mod.checkTaskHydratedGuard(task({ group_id: 'group-2' }), 'group-1', taskPayload)).toBeNull();
    });

    it('rejects a row whose done state has drifted since the snapshot', () => {
      expect(mod.checkTaskHydratedGuard(task({ done: true }), 'group-1', taskPayload)).toBeNull();
    });

    it('rejects a row whose updated_at has drifted since the snapshot', () => {
      expect(
        mod.checkTaskHydratedGuard(task({ updated_at: '2026-08-02T00:00:00.000Z' }), 'group-1', taskPayload),
      ).toBeNull();
    });

    it('accepts a matching hydrated row (happy path)', () => {
      const row = task();
      expect(mod.checkTaskHydratedGuard(row, 'group-1', taskPayload)).toBe(row);
    });
  });

  describe('checkGrocerySnapshotGuard', () => {
    it('rejects a null snapshot', () => {
      expect(mod.checkGrocerySnapshotGuard(null, groceryPayload)).toBeNull();
    });

    it('rejects a version mismatch', () => {
      expect(mod.checkGrocerySnapshotGuard(snapshot(), { ...groceryPayload, snapshotVersion: 1 })).toBeNull();
    });

    it('rejects when the cached row is missing', () => {
      expect(mod.checkGrocerySnapshotGuard(snapshot({ groceries: [] }), groceryPayload)).toBeNull();
    });

    it('rejects a status mismatch between cache and payload', () => {
      const s = snapshot({ groceries: [grocerySnapshotItem({ status: 'bought' })] });
      expect(mod.checkGrocerySnapshotGuard(s, groceryPayload)).toBeNull();
    });

    it('rejects a sourceUpdatedAt mismatch between cache and payload', () => {
      const s = snapshot({ groceries: [grocerySnapshotItem({ sourceUpdatedAt: '2026-08-02T00:00:00.000Z' })] });
      expect(mod.checkGrocerySnapshotGuard(s, groceryPayload)).toBeNull();
    });

    it('accepts a matching cached row (happy path)', () => {
      const s = snapshot();
      expect(mod.checkGrocerySnapshotGuard(s, groceryPayload)).toEqual({ snapshot: s, cached: s.groceries[0] });
    });

    it('rejects a snapshot written with Groceries off (Modules), even when the row is still cached', () => {
      const s = snapshot({ summary: { ...snapshot().summary, groceriesOn: false } });
      expect(mod.checkGrocerySnapshotGuard(s, groceryPayload)).toBeNull();
    });
  });

  describe('checkGroceryHydratedGuard', () => {
    it('rejects a missing row', () => {
      expect(mod.checkGroceryHydratedGuard(undefined, 'group-1', groceryPayload)).toBeNull();
    });

    it('rejects a deleted row', () => {
      expect(mod.checkGroceryHydratedGuard(groceryItem({ deleted: true }), 'group-1', groceryPayload)).toBeNull();
    });

    it('rejects a row from another group', () => {
      expect(mod.checkGroceryHydratedGuard(groceryItem({ group_id: 'group-2' }), 'group-1', groceryPayload)).toBeNull();
    });

    it('rejects a row whose status has drifted since the snapshot', () => {
      expect(mod.checkGroceryHydratedGuard(groceryItem({ status: 'bought' }), 'group-1', groceryPayload)).toBeNull();
    });

    it('rejects a row whose updated_at has drifted since the snapshot', () => {
      expect(
        mod.checkGroceryHydratedGuard(groceryItem({ updated_at: '2026-08-02T00:00:00.000Z' }), 'group-1', groceryPayload),
      ).toBeNull();
    });

    it('accepts a matching hydrated row (happy path)', () => {
      const row = groceryItem();
      expect(mod.checkGroceryHydratedGuard(row, 'group-1', groceryPayload)).toBe(row);
    });
  });

  describe('recomputeWeatherStale', () => {
    it('passes through null', () => {
      expect(mod.recomputeWeatherStale(null)).toBeNull();
    });

    it('flips stale=false to true once the 3h threshold has passed', () => {
      const weather = { tempC: 20, condition: 'Clear', iconKey: 'clear', updatedAt: '2026-08-01T00:00:00.000Z', stale: false };
      const now = new Date('2026-08-01T04:00:00.000Z');
      expect(mod.recomputeWeatherStale(weather, now)).toEqual({ ...weather, stale: true });
    });

    it('keeps stale=false within the 3h threshold', () => {
      const weather = { tempC: 20, condition: 'Clear', iconKey: 'clear', updatedAt: '2026-08-01T00:00:00.000Z', stale: false };
      const now = new Date('2026-08-01T01:00:00.000Z');
      expect(mod.recomputeWeatherStale(weather, now)).toEqual({ ...weather, stale: false });
    });
  });

  describe('payload validators', () => {
    it('isToggleTaskPayload accepts a well-shaped payload and rejects malformed ones', () => {
      expect(mod.isToggleTaskPayload(taskPayload)).toBe(true);
      expect(mod.isToggleTaskPayload({ ...taskPayload, id: 5 })).toBe(false);
      expect(mod.isToggleTaskPayload({ ...taskPayload, snapshotDone: 'yes' })).toBe(false);
      expect(mod.isToggleTaskPayload(null)).toBe(false);
    });

    it('isToggleGroceryPayload accepts a well-shaped payload and rejects an invalid status', () => {
      expect(mod.isToggleGroceryPayload(groceryPayload)).toBe(true);
      expect(mod.isToggleGroceryPayload({ ...groceryPayload, snapshotStatus: 'discarded' })).toBe(false);
    });
  });
});

describe('widgetTaskHandler end-to-end (mocked store + headless context)', () => {
  beforeEach(() => {
    vi.resetModules();
    storeLoaded = true;
    getStoredServer.mockReset().mockResolvedValue({
      origin: 'https://example.test',
      isOfficial: false,
      config: { supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' },
    });
    getSupabaseClient.mockReset();
    readDataCacheSnapshot.mockReset().mockReturnValue({ group: { id: 'group-1' }, currentUserId: 'user-1' });
    readWidgetSnapshot.mockReset();
    writeWidgetSnapshot.mockReset();
    householdTasks$.mockReset();
    groceryItems$.mockReset();
  });

  function widgetInfo() {
    return { widgetName: 'TodaysTasks' } as never;
  }

  it('TOGGLE_TASK happy path: applies the mutation and repaints from the updated snapshot', async () => {
    const { widgetTaskHandler } = await import('./widgetTaskHandler');
    const s = snapshot();
    readWidgetSnapshot.mockReturnValue(s);
    const store = fakeStore<HouseholdTask>({ 'task-1': task() });
    householdTasks$.mockReturnValue(store);
    const renderWidget = vi.fn();

    await widgetTaskHandler({
      widgetInfo: widgetInfo(),
      widgetAction: 'WIDGET_CLICK',
      clickAction: 'TOGGLE_TASK',
      clickActionData: { id: 'task-1', snapshotVersion: 4, snapshotDone: false, snapshotSourceUpdatedAt: '2026-08-01T00:00:00.000Z' },
      renderWidget,
    } as never);

    expect(store['task-1'].peek()!.done).toBe(true);
    expect(writeWidgetSnapshot).toHaveBeenCalledTimes(1);
    const [writtenItems] = writeWidgetSnapshot.mock.calls[0];
    expect(writtenItems.find((i: WidgetTaskSnapshotItem) => i.id === 'task-1')?.done).toBe(true);
    expect(renderWidget).toHaveBeenCalledTimes(1);
  });

  it('repaints in the theme picked in the app', async () => {
    const { widgetTaskHandler } = await import('./widgetTaskHandler');
    readWidgetSnapshot.mockReturnValue(snapshot());
    householdTasks$.mockReturnValue(fakeStore<HouseholdTask>({ 'task-1': task() }));
    readWidgetThemePreference.mockReturnValueOnce('lavender:dark');
    const renderWidget = vi.fn();

    await widgetTaskHandler({
      widgetInfo: widgetInfo(),
      widgetAction: 'WIDGET_CLICK',
      clickAction: 'TOGGLE_TASK',
      clickActionData: { id: 'task-1', snapshotVersion: 4, snapshotDone: false, snapshotSourceUpdatedAt: '2026-08-01T00:00:00.000Z' },
      renderWidget,
    } as never);

    expect(renderWidget.mock.calls[0][0].light.preference).toBe('lavender:dark');
    expect(renderWidget.mock.calls[0][0].dark.preference).toBe('lavender:dark');
  });

  it('TOGGLE_TASK keeps the snapshot\'s event rows, which the headless task cannot rebuild', async () => {
    const { widgetTaskHandler } = await import('./widgetTaskHandler');
    const event = taskSnapshotItem({
      id: 'event-1',
      title: 'Dinner',
      type: 'event',
      section: 'calendar',
      sourceLabel: 'Event',
      toggleable: false,
      openPath: '/calendar?date=2026-08-04',
      sourceUpdatedAt: null,
      due_date: '2026-08-04',
    });
    readWidgetSnapshot.mockReturnValue(snapshot({ items: [taskSnapshotItem(), event] }));
    householdTasks$.mockReturnValue(fakeStore<HouseholdTask>({ 'task-1': task() }));
    const renderWidget = vi.fn();

    await widgetTaskHandler({
      widgetInfo: widgetInfo(),
      widgetAction: 'WIDGET_CLICK',
      clickAction: 'TOGGLE_TASK',
      clickActionData: { id: 'task-1', snapshotVersion: 4, snapshotDone: false, snapshotSourceUpdatedAt: '2026-08-01T00:00:00.000Z' },
      renderWidget,
    } as never);

    const [writtenItems] = writeWidgetSnapshot.mock.calls[0];
    expect(writtenItems.map((i: WidgetTaskSnapshotItem) => i.id)).toEqual(['event-1', 'task-1']);
    expect(renderWidget.mock.calls[0][0].dark).toBeTruthy();
  });

  it('TOGGLE_TASK rejects a stale render (payload done disagrees with the cached snapshot) without touching the store', async () => {
    const { widgetTaskHandler } = await import('./widgetTaskHandler');
    readWidgetSnapshot.mockReturnValue(snapshot());
    const renderWidget = vi.fn();

    await widgetTaskHandler({
      widgetInfo: widgetInfo(),
      widgetAction: 'WIDGET_CLICK',
      clickAction: 'TOGGLE_TASK',
      // snapshotDone: true disagrees with the cached item's done: false.
      clickActionData: { id: 'task-1', snapshotVersion: 4, snapshotDone: true, snapshotSourceUpdatedAt: '2026-08-01T00:00:00.000Z' },
      renderWidget,
    } as never);

    expect(getStoredServer).not.toHaveBeenCalled();
    expect(householdTasks$).not.toHaveBeenCalled();
    expect(writeWidgetSnapshot).not.toHaveBeenCalled();
    expect(renderWidget).toHaveBeenCalledTimes(1);
  });

  it('TOGGLE_TASK rejects when the hydrated row has drifted (done changed since the snapshot was written), applying no mutation', async () => {
    const { widgetTaskHandler } = await import('./widgetTaskHandler');
    readWidgetSnapshot.mockReturnValue(snapshot());
    const store = fakeStore<HouseholdTask>({ 'task-1': task({ done: true }) });
    householdTasks$.mockReturnValue(store);
    const renderWidget = vi.fn();

    await widgetTaskHandler({
      widgetInfo: widgetInfo(),
      widgetAction: 'WIDGET_CLICK',
      clickAction: 'TOGGLE_TASK',
      clickActionData: { id: 'task-1', snapshotVersion: 4, snapshotDone: false, snapshotSourceUpdatedAt: '2026-08-01T00:00:00.000Z' },
      renderWidget,
    } as never);

    expect(store['task-1'].peek()!.done).toBe(true);
    expect(writeWidgetSnapshot).not.toHaveBeenCalled();
    expect(renderWidget).toHaveBeenCalledTimes(1);
  });

  it('TOGGLE_TASK rejects when no headless context can be bound (no server configured), applying no mutation', async () => {
    const { widgetTaskHandler } = await import('./widgetTaskHandler');
    readWidgetSnapshot.mockReturnValue(snapshot());
    getStoredServer.mockResolvedValue(null);
    const renderWidget = vi.fn();

    await widgetTaskHandler({
      widgetInfo: widgetInfo(),
      widgetAction: 'WIDGET_CLICK',
      clickAction: 'TOGGLE_TASK',
      clickActionData: { id: 'task-1', snapshotVersion: 4, snapshotDone: false, snapshotSourceUpdatedAt: '2026-08-01T00:00:00.000Z' },
      renderWidget,
    } as never);

    expect(householdTasks$).not.toHaveBeenCalled();
    expect(writeWidgetSnapshot).not.toHaveBeenCalled();
    expect(renderWidget).toHaveBeenCalledTimes(1);
  });

  it('TOGGLE_GROCERY happy path: flips needed->bought and repaints from the updated snapshot', async () => {
    const { widgetTaskHandler } = await import('./widgetTaskHandler');
    const s = snapshot();
    readWidgetSnapshot.mockReturnValue(s);
    const store = fakeStore<GroceryItem>({ 'grocery-1': groceryItem() });
    groceryItems$.mockReturnValue(store);
    const renderWidget = vi.fn();

    await widgetTaskHandler({
      widgetInfo: widgetInfo(),
      widgetAction: 'WIDGET_CLICK',
      clickAction: 'TOGGLE_GROCERY',
      clickActionData: { id: 'grocery-1', snapshotVersion: 4, snapshotStatus: 'needed', snapshotSourceUpdatedAt: '2026-08-01T00:00:00.000Z' },
      renderWidget,
    } as never);

    expect(store['grocery-1'].peek()!.status).toBe('bought');
    expect(writeWidgetSnapshot).toHaveBeenCalledTimes(1);
    // buildWidgetGrocerySnapshotItems only carries `status==='needed'` rows
    // (the widget's read-mostly scope) — a bought item drops out of the
    // written snapshot entirely rather than appearing with status: 'bought'.
    const [, writtenGroceries, writtenSummary] = writeWidgetSnapshot.mock.calls[0];
    expect(writtenGroceries.find((g: WidgetGrocerySnapshotItem) => g.id === 'grocery-1')).toBeUndefined();
    expect(writtenSummary.toBuyCount).toBe(0);
    expect(renderWidget).toHaveBeenCalledTimes(1);
  });

  it('TOGGLE_GROCERY rejects a version mismatch without binding a headless context', async () => {
    const { widgetTaskHandler } = await import('./widgetTaskHandler');
    readWidgetSnapshot.mockReturnValue(snapshot());
    const renderWidget = vi.fn();

    await widgetTaskHandler({
      widgetInfo: widgetInfo(),
      widgetAction: 'WIDGET_CLICK',
      clickAction: 'TOGGLE_GROCERY',
      clickActionData: { id: 'grocery-1', snapshotVersion: 1, snapshotStatus: 'needed', snapshotSourceUpdatedAt: '2026-08-01T00:00:00.000Z' },
      renderWidget,
    } as never);

    expect(getStoredServer).not.toHaveBeenCalled();
    expect(groceryItems$).not.toHaveBeenCalled();
    expect(writeWidgetSnapshot).not.toHaveBeenCalled();
    expect(renderWidget).toHaveBeenCalledTimes(1);
  });

  // Modules (.docs/modules.md, section 7): the snapshot carries which modules
  // the widget may show; the headless side renders and rebuilds under those
  // flags, and an older snapshot without them behaves as every module on.
  describe('module flags', () => {
    const billKey = 'cost-reminder:cost-1:contract';

    it('renders from the stored snapshot with its flags intact', async () => {
      const { widgetTaskHandler } = await import('./widgetTaskHandler');
      const flags = { tasksOn: false, groceriesOn: false, costsOn: true, documentsOn: true };
      readWidgetSnapshot.mockReturnValue(snapshot({ items: [], groceries: [], summary: { ...snapshot().summary, ...flags } }));
      const renderWidget = vi.fn();

      await widgetTaskHandler({ widgetInfo: widgetInfo(), widgetAction: 'WIDGET_UPDATE', renderWidget } as never);

      expect(renderWidget).toHaveBeenCalledTimes(1);
      expect(renderWidget.mock.calls[0][0].light.props.summary).toMatchObject(flags);
    });

    it('renders with no snapshot at all (no flags: every module on, as before)', async () => {
      const { widgetTaskHandler } = await import('./widgetTaskHandler');
      readWidgetSnapshot.mockReturnValue(null);
      const renderWidget = vi.fn();

      await widgetTaskHandler({ widgetInfo: widgetInfo(), widgetAction: 'WIDGET_UPDATE', renderWidget } as never);

      expect(renderWidget).toHaveBeenCalledTimes(1);
      const { summary } = renderWidget.mock.calls[0][0].light.props;
      expect(summary.tasksOn).toBeUndefined();
      expect(summary.groceriesOn).toBeUndefined();
    });

    it('TOGGLE_TASK with Tasks off ticks a bill reminder and rebuilds reminder rows only, keeping the flags', async () => {
      const { widgetTaskHandler } = await import('./widgetTaskHandler');
      const flags = { tasksOn: false, groceriesOn: true, costsOn: true, documentsOn: true };
      const s = snapshot({
        items: [taskSnapshotItem({ id: 'bill-1', title: 'Pay rent' })],
        summary: { ...snapshot().summary, ...flags },
      });
      readWidgetSnapshot.mockReturnValue(s);
      const store = fakeStore<HouseholdTask>({
        'bill-1': task({ id: 'bill-1', title: 'Pay rent', template_key: billKey, due_date: null }),
        'plain-1': task({ id: 'plain-1', title: 'Take out bins', due_date: null }),
      });
      householdTasks$.mockReturnValue(store);
      const renderWidget = vi.fn();

      await widgetTaskHandler({
        widgetInfo: widgetInfo(),
        widgetAction: 'WIDGET_CLICK',
        clickAction: 'TOGGLE_TASK',
        clickActionData: { id: 'bill-1', snapshotVersion: 4, snapshotDone: false, snapshotSourceUpdatedAt: '2026-08-01T00:00:00.000Z' },
        renderWidget,
      } as never);

      expect(store['bill-1'].peek()!.done).toBe(true);
      expect(writeWidgetSnapshot).toHaveBeenCalledTimes(1);
      const [writtenItems, , writtenSummary] = writeWidgetSnapshot.mock.calls[0];
      expect(writtenItems.map((i: WidgetTaskSnapshotItem) => i.id)).toEqual(['bill-1']);
      expect(writtenSummary).toMatchObject({ ...flags, openTodoCount: 0, doneTodayCount: 1 });
      expect(renderWidget.mock.calls[0][0].light.props.summary).toMatchObject(flags);
    });

    it('TOGGLE_TASK with Tasks on but Costs off drops bill reminders from the rebuilt rows', async () => {
      const { widgetTaskHandler } = await import('./widgetTaskHandler');
      const s = snapshot({ summary: { ...snapshot().summary, tasksOn: true, costsOn: false } });
      readWidgetSnapshot.mockReturnValue(s);
      const store = fakeStore<HouseholdTask>({
        'task-1': task(),
        'bill-1': task({ id: 'bill-1', title: 'Pay rent', template_key: billKey, due_date: null }),
      });
      householdTasks$.mockReturnValue(store);
      const renderWidget = vi.fn();

      await widgetTaskHandler({
        widgetInfo: widgetInfo(),
        widgetAction: 'WIDGET_CLICK',
        clickAction: 'TOGGLE_TASK',
        clickActionData: { id: 'task-1', snapshotVersion: 4, snapshotDone: false, snapshotSourceUpdatedAt: '2026-08-01T00:00:00.000Z' },
        renderWidget,
      } as never);

      const [writtenItems] = writeWidgetSnapshot.mock.calls[0];
      expect(writtenItems.map((i: WidgetTaskSnapshotItem) => i.id)).toEqual(['task-1']);
    });

    it('TOGGLE_TASK on an older snapshot (no flags) still shows plain tasks', async () => {
      const { widgetTaskHandler } = await import('./widgetTaskHandler');
      readWidgetSnapshot.mockReturnValue(snapshot());
      const store = fakeStore<HouseholdTask>({
        'task-1': task(),
        'bill-1': task({ id: 'bill-1', title: 'Pay rent', template_key: billKey, due_date: null }),
      });
      householdTasks$.mockReturnValue(store);
      const renderWidget = vi.fn();

      await widgetTaskHandler({
        widgetInfo: widgetInfo(),
        widgetAction: 'WIDGET_CLICK',
        clickAction: 'TOGGLE_TASK',
        clickActionData: { id: 'task-1', snapshotVersion: 4, snapshotDone: false, snapshotSourceUpdatedAt: '2026-08-01T00:00:00.000Z' },
        renderWidget,
      } as never);

      const [writtenItems, , writtenSummary] = writeWidgetSnapshot.mock.calls[0];
      expect(writtenItems.map((i: WidgetTaskSnapshotItem) => i.id).sort()).toEqual(['bill-1', 'task-1']);
      expect(writtenSummary.tasksOn).toBeUndefined();
    });

    it('TOGGLE_GROCERY from a render made before Groceries went off applies no mutation', async () => {
      const { widgetTaskHandler } = await import('./widgetTaskHandler');
      readWidgetSnapshot.mockReturnValue(snapshot({ summary: { ...snapshot().summary, groceriesOn: false } }));
      const renderWidget = vi.fn();

      await widgetTaskHandler({
        widgetInfo: widgetInfo(),
        widgetAction: 'WIDGET_CLICK',
        clickAction: 'TOGGLE_GROCERY',
        clickActionData: { id: 'grocery-1', snapshotVersion: 4, snapshotStatus: 'needed', snapshotSourceUpdatedAt: '2026-08-01T00:00:00.000Z' },
        renderWidget,
      } as never);

      expect(getStoredServer).not.toHaveBeenCalled();
      expect(groceryItems$).not.toHaveBeenCalled();
      expect(writeWidgetSnapshot).not.toHaveBeenCalled();
      expect(renderWidget).toHaveBeenCalledTimes(1);
    });
  });
});
