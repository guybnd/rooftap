import { describe, expect, it } from 'vitest';
import { buildHeroItems } from './hero';
import {
  buildWidgetGrocerySnapshotItems,
  buildWidgetSnapshotItems,
  mergeWidgetTaskRows,
  widgetFeedGroups,
  widgetRowWhen,
  widgetTodayProgress,
  widgetUndoTarget,
  WIDGET_UNDO_WINDOW_MS,
  readWidgetModuleFlags,
  widgetHeroVisibility,
  widgetModuleFlags,
  widgetSections,
  type WidgetSummary,
} from './widget-snapshot';
import { ALL_MODULE_IDS, type ModuleId } from './modules';
import { reminderKey } from './reminders';
import type { GroceryItem, GroupEvent, HouseholdTask } from './types';

const TODAY = '2026-07-31';
const ME = 'user-me';

function task(overrides: Partial<HouseholdTask> = {}): HouseholdTask {
  return {
    id: 't1',
    group_id: 'g1',
    title: 'Take out bins',
    due_date: TODAY,
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
    created_at: TODAY,
    updated_at: TODAY,
    deleted: false,
    ...overrides,
  };
}

// Exercises the exact call shape use-widget-sync.ts uses in production
// (packages/core/src/hero.ts's buildHeroItems, feeding buildWidgetSnapshotItems)
// so a regression that drops `householdVisible: true` — which silently
// returns [] (hero.ts gates its whole task loop on it) — fails this test.
function snapshotFor(tasks: HouseholdTask[], currentUserId: string | null = ME) {
  const heroItems = buildHeroItems({
    tasks,
    appointments: [],
    apartments: [],
    today: TODAY,
    householdVisible: true,
    searchVisible: false,
    calendarEvents: [],
    range: 'today',
  });
  return buildWidgetSnapshotItems(heroItems, currentUserId);
}

describe('buildWidgetSnapshotItems', () => {
  it("carries another module's feed item (bin night) as a row that opens its screen", () => {
    const [row] = buildWidgetSnapshotItems(
      [
        {
          id: 'bins-x',
          type: 'module',
          ownerSection: 'bins',
          title: 'Bins out tonight',
          dueDate: TODAY,
          dueTime: '19:00',
          overdue: false,
          done: false,
          assignedTo: null,
          sourceLabel: 'Red and yellow',
          module: { id: 'bins', href: '/bins', completable: true },
        },
      ],
      null,
    );
    expect(row).toMatchObject({ type: 'module', section: 'bins', toggleable: false, openPath: '/bins' });
  });

  it('maps a due-today task to the snapshot shape with raw due_date/done (not precomputed labels)', () => {
    const items = snapshotFor([task({ id: 'due-today', priority: 'high' })]);
    expect(items).toEqual([
      {
        id: 'due-today',
        title: 'Take out bins',
        done: false,
        due_date: TODAY,
        due_time: null,
        priority: 'high',
        assignedToMe: false,
        assigned: false,
        sourceUpdatedAt: TODAY,
        type: 'task',
        section: 'household',
        sourceLabel: expect.any(String),
        toggleable: true,
        openPath: null,
      },
    ]);
  });

  it('would return no items if the production call ever dropped householdVisible', () => {
    const heroItems = buildHeroItems({
      tasks: [task()],
      appointments: [],
      apartments: [],
      today: TODAY,
      householdVisible: false,
      searchVisible: false,
    });
    expect(buildWidgetSnapshotItems(heroItems, ME)).toHaveLength(0);
  });

  it('sets assignedToMe only when assigned_to matches the current user, and assigned whenever there is any assignee', () => {
    const items = snapshotFor([
      task({ id: 'mine', assigned_to: ME }),
      task({ id: 'someone-else', assigned_to: 'user-other' }),
      task({ id: 'unassigned', assigned_to: null }),
    ]);
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId.mine).toMatchObject({ assignedToMe: true, assigned: true });
    expect(byId['someone-else']).toMatchObject({ assignedToMe: false, assigned: true });
    expect(byId.unassigned).toMatchObject({ assignedToMe: false, assigned: false });
  });

  it('keeps a task completed today but drops one completed on an earlier day (delegates to buildHeroItems)', () => {
    const items = snapshotFor([
      task({ id: 'done-today', done: true, completed_at: `${TODAY}T09:00:00` }),
      task({ id: 'done-yesterday', done: true, completed_at: '2026-07-30T09:00:00' }),
    ]);
    expect(items.map((i) => i.id)).toEqual(['done-today']);
  });

  it('orders open-and-overdue before due-today before done, undated tasks last within their bucket', () => {
    const items = snapshotFor([
      task({ id: 'done', done: true, completed_at: `${TODAY}T09:00:00` }),
      task({ id: 'due-today' }),
      task({ id: 'overdue', due_date: '2026-07-20' }),
      task({ id: 'undated', due_date: null }),
    ]);
    expect(items.map((i) => i.id)).toEqual(['overdue', 'due-today', 'undated', 'done']);
  });
});

function groceryItem(overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    id: 'gi1',
    group_id: 'g1',
    name: 'Milk',
    aisle: 'Dairy',
    quantity: null,
    unit: null,
    status: 'needed',
    notes: null,
    assigned_to: null,
    private: false,
    template_key: null,
    sort_order: 0,
    created_by: null,
    updated_by: null,
    created_at: TODAY,
    updated_at: TODAY,
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

describe('buildWidgetGrocerySnapshotItems', () => {
  it('includes only non-deleted, needed items, sorted by name', () => {
    const items = buildWidgetGrocerySnapshotItems([
      groceryItem({ id: 'z', name: 'Zucchini' }),
      groceryItem({ id: 'bought', name: 'Bread', status: 'bought' }),
      groceryItem({ id: 'deleted', name: 'Apples', deleted: true }),
      groceryItem({ id: 'a', name: 'Almonds' }),
    ]);
    expect(items.map((i) => i.id)).toEqual(['a', 'z']);
  });

  it('maps the snapshot shape with the source updated_at discriminator', () => {
    const [item] = buildWidgetGrocerySnapshotItems([
      groceryItem({ id: 'gi1', name: 'Milk', quantity: 2, unit: 'L', aisle: 'Dairy', updated_at: '2026-08-01T00:00:00.000Z' }),
    ]);
    expect(item).toEqual({
      id: 'gi1',
      name: 'Milk',
      status: 'needed',
      quantity: 2,
      unit: 'L',
      aisle: 'Dairy',
      sourceUpdatedAt: '2026-08-01T00:00:00.000Z',
    });
  });
});

// Modules (.docs/modules.md, section 7): the widget shows nothing of a
// switched-off module. Each widget-facing module off in turn, the rest on.
describe('widget module gating', () => {
  const WIDGET_MODULES = ['household', 'groceries', 'costs', 'documents'] as const;
  const allOn = new Set<string>(ALL_MODULE_IDS);
  const allOnBut = (...off: ModuleId[]) => new Set<string>(ALL_MODULE_IDS.filter((m) => !off.includes(m)));

  const TASKS = [
    task({ id: 'plain' }),
    task({ id: 'moving', template_key: 'moving:book-movers' }),
    task({ id: 'bill', template_key: reminderKey('cost', 'cost-1', 'contract') }),
    task({ id: 'doc', template_key: reminderKey('document', 'doc-1') }),
    task({ id: 'tracked', template_key: reminderKey('tracked_item', 'item-1') }),
  ];
  // Which module each row above belongs to (task-modules.ts).
  const OWNER: Record<string, ModuleId> = {
    plain: 'household',
    moving: 'household',
    bill: 'costs',
    doc: 'documents',
    tracked: 'household',
  };

  function rowsFor(enabled: ReadonlySet<string>): string[] {
    const heroItems = buildHeroItems({
      tasks: TASKS,
      appointments: [],
      apartments: [],
      today: TODAY,
      ...widgetHeroVisibility(widgetModuleFlags(enabled)),
      searchVisible: false,
      calendarEvents: [],
      range: 'today',
    });
    return buildWidgetSnapshotItems(heroItems, ME)
      .map((i) => i.id)
      .sort();
  }

  function summary(overrides: Partial<WidgetSummary> = {}): WidgetSummary {
    return {
      openTodoCount: 0,
      toBuyCount: 0,
      doneTodayCount: 0,
      budget: null,
      bills: [],
      weather: null,
      ...overrides,
    };
  }

  it('maps the enabled modules to the snapshot flags', () => {
    expect(widgetModuleFlags(allOn)).toEqual({ tasksOn: true, groceriesOn: true, costsOn: true, documentsOn: true });
    expect(widgetModuleFlags(new Set())).toEqual({ tasksOn: false, groceriesOn: false, costsOn: false, documentsOn: false });
  });

  it('reads a snapshot without flags (an older app) as every module on, and keeps explicit ones', () => {
    expect(readWidgetModuleFlags(summary())).toEqual({ tasksOn: true, groceriesOn: true, costsOn: true, documentsOn: true });
    expect(readWidgetModuleFlags(null)).toEqual({ tasksOn: true, groceriesOn: true, costsOn: true, documentsOn: true });
    expect(readWidgetModuleFlags(summary({ groceriesOn: false }))).toEqual({
      tasksOn: true,
      groceriesOn: false,
      costsOn: true,
      documentsOn: true,
    });
  });

  it('renders an older snapshot exactly as before modules', () => {
    expect(widgetSections(summary(), 0)).toEqual({
      tasks: 'tasks',
      groceries: true,
      taskCounts: true,
      toBuyCount: true,
      costs: true,
      nothingToShow: false,
    });
  });

  it('with every module on, every task and reminder is a row', () => {
    expect(rowsFor(allOn)).toEqual(['bill', 'doc', 'moving', 'plain', 'tracked']);
  });

  it.each(WIDGET_MODULES)('with %s off, only its own rows and sections go', (off) => {
    const enabled = allOnBut(off);
    const flags = widgetModuleFlags(enabled);
    expect(rowsFor(enabled)).toEqual(
      TASKS.map((t) => t.id)
        .filter((id) => OWNER[id] !== off)
        .sort(),
    );

    const rows = rowsFor(enabled).length;
    const sections = widgetSections(summary(flags), rows);
    expect(sections).toEqual({
      // With Tasks off the bill and document reminders stay, under "Reminders".
      tasks: off === 'household' ? 'reminders' : 'tasks',
      groceries: off !== 'groceries',
      taskCounts: true,
      toBuyCount: off !== 'groceries',
      costs: off !== 'costs',
      nothingToShow: false,
    });
  });

  it('with Tasks, Costs and Documents off, there are no rows and no task section', () => {
    const enabled = allOnBut('household', 'costs', 'documents');
    expect(rowsFor(enabled)).toEqual([]);
    expect(widgetSections(summary(widgetModuleFlags(enabled)), 0)).toMatchObject({
      tasks: null,
      taskCounts: false,
      groceries: true,
      nothingToShow: false,
    });
  });

  it('with Tasks off and no reminders due, the task section goes but Groceries stays', () => {
    const flags = widgetModuleFlags(allOnBut('household'));
    expect(widgetSections(summary(flags), 0)).toMatchObject({ tasks: null, taskCounts: false, groceries: true, nothingToShow: false });
  });

  it('with Tasks and Groceries off and no reminders, the widget has nothing to show', () => {
    const flags = widgetModuleFlags(allOnBut('household', 'groceries'));
    expect(widgetSections(summary(flags), 0)).toEqual({
      tasks: null,
      groceries: false,
      taskCounts: false,
      toBuyCount: false,
      costs: true,
      nothingToShow: true,
    });
  });

  it('with Tasks and Groceries off but a reminder due, the reminders still show', () => {
    const enabled = allOnBut('household', 'groceries');
    const rows = rowsFor(enabled);
    expect(rows).toEqual(['bill', 'doc']);
    expect(widgetSections(summary(widgetModuleFlags(enabled)), rows.length)).toMatchObject({
      tasks: 'reminders',
      taskCounts: true,
      groceries: false,
      nothingToShow: false,
    });
  });
});

describe('the Upcoming feed (Hearth v2 widget)', () => {
  function event(overrides: Partial<GroupEvent> = {}): GroupEvent {
    return {
      id: 'e1',
      group_id: 'g1',
      title: 'Dinner at Maya and Tom',
      category: 'social',
      starts_at: '2026-08-01T19:00:00',
      ends_at: null,
      is_all_day: false,
      notes: null,
      location: null,
      private: false,
      created_by: ME,
      created_at: TODAY,
      updated_at: TODAY,
      deleted: false,
      ...overrides,
    } as unknown as GroupEvent;
  }

  function upcoming(tasks: HouseholdTask[], events: GroupEvent[] = []) {
    const heroItems = buildHeroItems({
      tasks,
      appointments: [],
      apartments: [],
      today: TODAY,
      householdVisible: true,
      searchVisible: false,
      groupEvents: events,
      viewerId: ME,
      range: 'upcoming',
    });
    return buildWidgetSnapshotItems(heroItems, ME);
  }

  it('carries events beside tasks, in Home order, with where each opens', () => {
    const items = upcoming(
      [task({ id: 'overdue', due_date: '2026-07-29' }), task({ id: 'later', due_date: '2026-08-05' }), task({ id: 'today' })],
      [event()],
    );
    expect(items.map((i) => i.id)).toEqual(['overdue', 'today', expect.stringContaining('e1'), 'later']);
    const ev = items.find((i) => i.type === 'event')!;
    expect(ev).toMatchObject({ section: 'calendar', toggleable: false, openPath: '/calendar?date=2026-08-01', due_time: '19:00' });
  });

  it('groups by day with the same labels as the feed, and says how late an overdue task is', () => {
    const items = upcoming([task({ id: 'overdue', due_date: '2026-07-29' }), task({ id: 'today' }), task({ id: 'undated', due_date: null })]);
    expect(widgetFeedGroups(items, TODAY).map((g) => g.label)).toEqual(['Earlier', 'Today', 'No date']);
    expect(widgetRowWhen(items[0], TODAY)).toEqual({ kind: 'overdue', text: '2d overdue' });
  });

  it('counts the lede from rows due today, earlier or undated, as Home does', () => {
    const items = upcoming([
      task({ id: 'overdue', due_date: '2026-07-29' }),
      task({ id: 'done', done: true, completed_at: `${TODAY}T09:00:00` }),
      task({ id: 'undated', due_date: null }),
      task({ id: 'later', due_date: '2026-08-05' }),
    ]);
    expect(widgetTodayProgress(items, TODAY)).toEqual({ left: 2, done: 1, total: 3 });
  });

  it('a tick keeps the rows it cannot rebuild and refreshes the task rows', () => {
    const before = upcoming([task({ id: 'a' })], [event()]);
    const rebuilt = upcoming([task({ id: 'a', done: true, completed_at: `${TODAY}T10:00:00` })]);
    const merged = mergeWidgetTaskRows(before, rebuilt);
    expect(merged.map((i) => [i.type, i.done])).toEqual([
      ['event', false],
      ['task', true],
    ]);
  });
});

describe('widgetUndoTarget', () => {
  const base: WidgetSummary = { openTodoCount: 0, toBuyCount: 0, doneTodayCount: 1, budget: null, bills: [], weather: null };
  const now = new Date('2026-07-31T09:00:00.000Z');
  const ticked = (at: string, done = true): WidgetSummary => ({ ...base, lastTick: { id: 't1', title: 'Take out bins', done, at } });
  const rows = (done: boolean) => buildWidgetSnapshotItems(
    buildHeroItems({
      tasks: [task({ done, completed_at: done ? '2026-07-31T08:59:00' : null })],
      appointments: [],
      apartments: [],
      today: TODAY,
      householdVisible: true,
      searchVisible: false,
      viewerId: ME,
      range: 'upcoming',
    }),
    ME,
  );

  it('offers the task the widget just ticked', () => {
    expect(widgetUndoTarget(ticked('2026-07-31T08:59:55.000Z'), rows(true), now)?.id).toBe('t1');
  });

  it('drops it once the window has passed', () => {
    const at = new Date(now.getTime() - WIDGET_UNDO_WINDOW_MS - 1).toISOString();
    expect(widgetUndoTarget(ticked(at), rows(true), now)).toBeNull();
  });

  it('drops it when the task has changed since, or there was no tick', () => {
    expect(widgetUndoTarget(ticked('2026-07-31T08:59:55.000Z'), rows(false), now)).toBeNull();
    expect(widgetUndoTarget(base, rows(true), now)).toBeNull();
  });
});
