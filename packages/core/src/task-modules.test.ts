import { describe, expect, it } from 'vitest';
import {
  hasVisibleReminders,
  isGoogleCalendarPushEnabled,
  isTaskOwnerEnabled,
  taskOpenHref,
  taskOwnerModule,
} from './task-modules';
import { ALL_MODULE_IDS, MODULES, parseModuleList, resolveEnabledModules, type ModuleId } from './modules';
import { reminderKey } from './reminders';
// The notify-* edge functions' Deno twin of these rules (pure, import-free).
import * as twin from '../../../supabase/functions/_shared/module-rules';

const TASKS = [
  { id: 'plain', template_key: null, owner: 'household' },
  { id: 'moving', template_key: 'moving:book-movers', owner: 'household' },
  { id: 'bill', template_key: reminderKey('cost', 'cost-1', 'contract'), owner: 'costs' },
  { id: 'doc', template_key: reminderKey('document', 'doc-1'), owner: 'documents' },
  { id: 'tracked', template_key: reminderKey('tracked_item', 'item-1'), owner: 'household' },
  { id: 'lease', template_key: reminderKey('lease', 'group-1', 'notice'), owner: 'household' },
  { id: 'colon-id', template_key: reminderKey('cost', 'a:b'), owner: 'costs' },
  { id: 'care', template_key: reminderKey('care', 'job-1', '2026-11-01'), owner: 'home-care' },
] as const;

const allOn = new Set<string>(ALL_MODULE_IDS);
const allOnBut = (off: ModuleId) => new Set<string>(ALL_MODULE_IDS.filter((m) => m !== off));

describe('taskOwnerModule', () => {
  it.each(TASKS)('$id belongs to $owner', (t) => {
    expect(taskOwnerModule(t)).toBe(t.owner);
  });
});

describe('isTaskOwnerEnabled and taskOpenHref', () => {
  it('with every module on, every task exists and opens itself in Tasks', () => {
    for (const t of TASKS) {
      expect(isTaskOwnerEnabled(t, allOn)).toBe(true);
      expect(taskOpenHref(t, allOn)).toBe(`/tasks?focus=${t.id}`);
    }
  });

  it.each(ALL_MODULE_IDS)('with %s off, only the tasks it owns go', (off) => {
    const enabled = allOnBut(off);
    for (const t of TASKS) expect([t.id, isTaskOwnerEnabled(t, enabled)]).toEqual([t.id, t.owner !== off]);
  });

  it('with Tasks off, reminders open their bill or document side and plain tasks open nothing', () => {
    const enabled = allOnBut('household');
    expect(taskOpenHref(TASKS[0], enabled)).toBeNull();
    expect(taskOpenHref(TASKS[1], enabled)).toBeNull();
    expect(taskOpenHref(TASKS[2], enabled)).toBe('/costs');
    expect(taskOpenHref(TASKS[3], enabled)).toBe('/documents');
    expect(taskOpenHref(TASKS[4], enabled)).toBeNull();
    expect(taskOpenHref(TASKS[5], enabled)).toBeNull();
  });

  it('with Tasks and Costs off, a bill reminder opens nothing', () => {
    const enabled = new Set<string>(ALL_MODULE_IDS.filter((m) => m !== 'household' && m !== 'costs'));
    expect(taskOpenHref(TASKS[2], enabled)).toBeNull();
  });
});

describe('hasVisibleReminders', () => {
  const [plain, , bill, doc] = TASKS;

  it('is true only when a reminder exists for an owner that shows', () => {
    expect(hasVisibleReminders([plain, bill], { costs: true })).toBe(true);
    expect(hasVisibleReminders([plain, bill], { documents: true })).toBe(false);
    expect(hasVisibleReminders([doc], { documents: true, costs: false })).toBe(true);
    expect(hasVisibleReminders([plain], { costs: true, documents: true })).toBe(false);
    expect(hasVisibleReminders([], { costs: true, documents: true })).toBe(false);
  });

  it('ignores deleted reminders', () => {
    expect(hasVisibleReminders([{ ...bill, deleted: true }], { costs: true })).toBe(false);
  });
});

describe('isGoogleCalendarPushEnabled', () => {
  const [plain, , bill] = TASKS;

  it('with every module on, pushes tasks and viewings', () => {
    expect(isGoogleCalendarPushEnabled('task', plain, allOn)).toBe(true);
    expect(isGoogleCalendarPushEnabled('appointment', null, allOn)).toBe(true);
  });

  it('with Google Calendar off, pushes nothing', () => {
    const enabled = allOnBut('google-calendar');
    expect(isGoogleCalendarPushEnabled('task', plain, enabled)).toBe(false);
    expect(isGoogleCalendarPushEnabled('task', bill, enabled)).toBe(false);
    expect(isGoogleCalendarPushEnabled('appointment', null, enabled)).toBe(false);
  });

  it('follows the item module: task owners and Home Search for viewings', () => {
    expect(isGoogleCalendarPushEnabled('task', plain, allOnBut('household'))).toBe(false);
    expect(isGoogleCalendarPushEnabled('task', bill, allOnBut('household'))).toBe(true);
    expect(isGoogleCalendarPushEnabled('task', bill, allOnBut('costs'))).toBe(false);
    expect(isGoogleCalendarPushEnabled('appointment', null, allOnBut('search'))).toBe(false);
    expect(isGoogleCalendarPushEnabled('appointment', null, allOnBut('household'))).toBe(true);
  });
});

// The edge functions can't import core, so they carry a twin. Every module
// combination and every kind of task must resolve the same on both sides.
describe('the edge-function twin (supabase/functions/_shared/module-rules.ts)', () => {
  it('lists the same modules, defaults and requirements as core', () => {
    expect(twin.MODULE_DEFAULTS).toEqual(
      MODULES.map((m) => ({ id: m.id, defaultEnabled: m.defaultEnabled, requires: m.requires ?? [] })),
    );
  });

  it.each([undefined, '', ' ', 'household,costs', 'costs, nope ,documents,costs'])(
    'parses HOMEUP_MODULES=%j the same way',
    (raw) => {
      expect(twin.parseModuleList(raw)).toEqual(parseModuleList(raw));
    },
  );

  it('resolves every on/off combination the same way, with and without a server limit', () => {
    // Every combination of the modules the rules read (requirements, task
    // owners, Google Calendar), crossed with the other modules all off and
    // all on; each other module alone is crossed with the ruled ones all off
    // and all on. Every module at once would be 2^modules runs, which
    // doubles with each new module and outgrew the test's time limit.
    const ruled = ALL_MODULE_IDS.filter(
      (id) =>
        ['household', 'costs', 'documents', 'calendar', 'search'].includes(id) ||
        MODULES.some((m) => m.id === id && m.requires?.length) ||
        MODULES.some((m) => m.requires?.includes(id)),
    );
    const others = ALL_MODULE_IDS.filter((id) => !ruled.includes(id));
    const full = (1 << ruled.length) - 1;
    for (let mask = 0; mask <= full; mask++) {
      const otherSets: string[][] =
        mask === 0 || mask === full ? [[], others, ...others.map((id) => [id])] : [[], others];
      for (const otherOn of otherSets) {
        const rows = ALL_MODULE_IDS.map((id) => ({
          module_id: id,
          enabled: ruled.includes(id) ? (mask & (1 << ruled.indexOf(id))) !== 0 : otherOn.includes(id),
        }));
        for (const available of [null, ['household', 'costs', 'documents']]) {
          const core = resolveEnabledModules({ available, rows });
          const deno = twin.resolveEnabledModules({ available, rows });
          expect([...deno].sort()).toEqual([...core].sort());
          for (const t of TASKS) {
            expect(twin.taskOwnerModule(t)).toBe(taskOwnerModule(t));
            expect(twin.taskOpenHref(t, deno)).toBe(taskOpenHref(t, core));
            expect(twin.isGoogleCalendarPushEnabled('task', t, deno)).toBe(isGoogleCalendarPushEnabled('task', t, core));
          }
          expect(twin.isGoogleCalendarPushEnabled('appointment', null, deno)).toBe(
            isGoogleCalendarPushEnabled('appointment', null, core),
          );
        }
      }
    }
  });

  it('falls back to each module default when a household has no rows', () => {
    expect([...twin.resolveEnabledModules({ available: null, rows: [] })].sort()).toEqual(
      [...resolveEnabledModules({ available: null, rows: [] })].sort(),
    );
  });
});
