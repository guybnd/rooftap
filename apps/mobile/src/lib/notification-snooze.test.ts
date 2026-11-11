// Snooze buttons on reminder notifications (notification-snooze.ts): which
// buttons each kind of reminder gets, and what a tap does. expo-notifications,
// the task manager and the key-value store are mocked; the rules come from core.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const kv = new Map<string, string>();
const notifications = {
  setNotificationCategoryAsync: vi.fn(async (_id: string, _actions: unknown[]) => null),
  dismissNotificationAsync: vi.fn(async (_id: string) => {}),
  scheduleNotificationAsync: vi.fn(async (_req: unknown) => 'id'),
  registerTaskAsync: vi.fn(async (_name: string) => {}),
  SchedulableTriggerInputTypes: { DATE: 'date' },
};
const tasks = new Map<string, (body: { data?: unknown; error?: unknown }) => Promise<void>>();

vi.mock('expo-notifications', () => notifications);
vi.mock('expo-task-manager', () => ({
  defineTask: (name: string, fn: (body: { data?: unknown; error?: unknown }) => Promise<void>) => tasks.set(name, fn),
}));
vi.mock('expo-sqlite/kv-store', () => ({
  SQLiteStorage: class {
    getItemSync(key: string) {
      return kv.get(key) ?? null;
    }
    setItemSync(key: string, value: string) {
      kv.set(key, value);
    }
  },
}));

const snooze = await import('./notification-snooze');
const { snoozeActionId, snoozeCategoryId } = await import('@homeup/core');

const NOW = new Date('2026-11-10T09:00:00Z');

function response(over: {
  action: string;
  id?: string;
  category?: string | null;
  data?: Record<string, unknown>;
  title?: string | null;
}) {
  return {
    actionIdentifier: over.action,
    notification: {
      request: {
        identifier: over.id ?? 'push-1',
        content: {
          title: over.title === undefined ? 'Task reminder' : over.title,
          body: 'Mow the lawn is due today',
          data: over.data ?? { url: '/tasks?focus=t1' },
          categoryIdentifier: over.category === undefined ? snoozeCategoryId('task') : over.category,
        },
      },
    },
  } as never;
}

function scheduled(call = 0) {
  return notifications.scheduleNotificationAsync.mock.calls[call]?.[0] as {
    identifier: string;
    content: { title?: string; body?: string; data: Record<string, unknown>; categoryIdentifier?: string };
    trigger: { type: string; date: Date };
  };
}

beforeEach(() => {
  kv.clear();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('the snooze pick', () => {
  it('defaults to 1 hour, 1 day and 1 week on a new phone', () => {
    expect(snooze.readSnoozePick()).toEqual([60, 1440, 10080]);
  });

  it('keeps a saved pick and cleans a bad one', async () => {
    await snooze.saveSnoozePick([1440, 30]);
    expect(snooze.readSnoozePick()).toEqual([30, 1440]);
    kv.set('rooftap.snoozePick', '{not json');
    expect(snooze.readSnoozePick()).toEqual([60, 1440, 10080]);
  });

  it('gives task and event reminders the picked buttons, and leave time and bins their own', async () => {
    await snooze.registerSnoozeCategories([30, 60]);
    const byCategory = new Map(
      notifications.setNotificationCategoryAsync.mock.calls.map(([id, actions]) => [
        id,
        (actions as { identifier: string; buttonTitle: string; options: { opensAppToForeground: boolean } }[]),
      ]),
    );
    expect(byCategory.get(snoozeCategoryId('task'))?.map((a) => a.identifier)).toEqual([snoozeActionId(30), snoozeActionId(60)]);
    expect(byCategory.get(snoozeCategoryId('event'))?.map((a) => a.identifier)).toEqual([snoozeActionId(30), snoozeActionId(60)]);
    expect(byCategory.get(snoozeCategoryId('leave'))).not.toEqual(byCategory.get(snoozeCategoryId('task')));
    expect(byCategory.get(snoozeCategoryId('bins'))?.length).toBeGreaterThan(0);
    for (const actions of byCategory.values()) {
      for (const a of actions) {
        expect(a.buttonTitle).toMatch(/^Snooze /);
        // A snooze never pulls the app to the front.
        expect(a.options.opensAppToForeground).toBe(false);
      }
    }
  });

  it('survives the OS refusing a category', async () => {
    notifications.setNotificationCategoryAsync.mockRejectedValueOnce(new Error('no'));
    await expect(snooze.registerSnoozeCategories()).resolves.toBeUndefined();
  });
});

describe('a snooze tap', () => {
  it('hides the notification and shows it again later, with its buttons', async () => {
    const handled = await snooze.handleSnoozeResponse(response({ action: snoozeActionId(60) }));
    expect(handled).toBe(true);
    expect(notifications.dismissNotificationAsync).toHaveBeenCalledWith('push-1');
    const req = scheduled();
    expect(req.identifier).toBe('snoozed:push-1');
    expect(req.content).toEqual({
      title: 'Task reminder',
      body: 'Mow the lawn is due today',
      data: { url: '/tasks?focus=t1' },
      categoryIdentifier: snoozeCategoryId('task'),
    });
    expect(req.trigger.date.getTime()).toBe(NOW.getTime() + 60 * 60_000);
  });

  it('keeps one snoozed copy when it is snoozed again', async () => {
    await snooze.handleSnoozeResponse(response({ action: snoozeActionId(60), id: 'snoozed:push-1' }));
    expect(scheduled().identifier).toBe('snoozed:push-1');
  });

  it('never brings an event reminder back after the event starts', async () => {
    const startsAt = '2026-11-10T10:00:00Z';
    await snooze.handleSnoozeResponse(
      response({ action: snoozeActionId(1440), category: snoozeCategoryId('event'), data: { url: '/calendar', startsAt } }),
    );
    expect(scheduled().trigger.date.getTime()).toBeLessThan(Date.parse(startsAt));
    expect(scheduled().trigger.date.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('ignores a start time on a reminder that is not an event', async () => {
    await snooze.handleSnoozeResponse(response({ action: snoozeActionId(60), data: { url: '/x', startsAt: '2026-11-10T09:30:00Z' } }));
    expect(scheduled().trigger.date.getTime()).toBe(NOW.getTime() + 60 * 60_000);
  });

  it('copes with a push that has no title or category', async () => {
    await snooze.handleSnoozeResponse(response({ action: snoozeActionId(60), category: null, title: null }));
    expect(scheduled().content.title).toBeUndefined();
    expect(scheduled().content).not.toHaveProperty('categoryIdentifier');
  });

  it('still snoozes when the notification is already gone', async () => {
    notifications.dismissNotificationAsync.mockRejectedValueOnce(new Error('gone'));
    await expect(snooze.handleSnoozeResponse(response({ action: snoozeActionId(60) }))).resolves.toBe(true);
    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('leaves a plain tap to open the link', async () => {
    const handled = await snooze.handleSnoozeResponse(response({ action: 'expo.modules.notifications.actions.DEFAULT' }));
    expect(handled).toBe(false);
    expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('the background task', () => {
  it('snoozes a tap that arrives while the app is closed', async () => {
    const task = tasks.get(snooze.SNOOZE_TASK);
    expect(task).toBeDefined();
    await task?.({ data: response({ action: snoozeActionId(60) }) });
    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('does nothing on an error or a push with no tap in it', async () => {
    const task = tasks.get(snooze.SNOOZE_TASK);
    await task?.({ error: new Error('x') });
    await task?.({ data: { notification: {} } });
    expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('registers the task and the buttons on launch', () => {
    snooze.setUpNotificationSnooze();
    expect(notifications.registerTaskAsync).toHaveBeenCalledWith(snooze.SNOOZE_TASK);
  });
});
