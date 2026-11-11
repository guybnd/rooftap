// What a tap on a push does (use-push-notification-routing.ts): open its link,
// open the chat pop-up for an Assistant reply, or snooze it and open nothing.
// expo-notifications is mocked; the snooze path is the real one on a mocked store.
import * as React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Response = {
  actionIdentifier: string;
  notification: { request: { identifier: string; content: Record<string, unknown> } };
};

let listener: ((r: Response) => void) | null = null;
let lastResponse: Response | null = null;
const notifications = {
  setNotificationHandler: vi.fn(),
  addNotificationResponseReceivedListener: vi.fn((fn: (r: Response) => void) => {
    listener = fn;
    return { remove: () => (listener = null) };
  }),
  getLastNotificationResponseAsync: vi.fn(async () => lastResponse),
  clearLastNotificationResponseAsync: vi.fn(async () => {}),
  setNotificationCategoryAsync: vi.fn(async () => null),
  dismissNotificationAsync: vi.fn(async () => {}),
  scheduleNotificationAsync: vi.fn(async () => 'id'),
  registerTaskAsync: vi.fn(async () => {}),
  SchedulableTriggerInputTypes: { DATE: 'date' },
};
vi.mock('expo-notifications', () => notifications);
vi.mock('expo-task-manager', () => ({ defineTask: () => {} }));
vi.mock('expo-sqlite/kv-store', () => ({
  SQLiteStorage: class {
    getItemSync() {
      return null;
    }
    setItemSync() {}
  },
}));
const openRoute = vi.fn();
vi.mock('./tab-routes', () => ({ useOpenRoute: () => openRoute }));

const { usePushNotificationRouting } = await import('./use-push-notification-routing');
const { onAssistantPopup, snoozeActionId, snoozeCategoryId } = await import('@homeup/core');

const DEFAULT_ACTION = 'expo.modules.notifications.actions.DEFAULT';

function tap(url: unknown, action = DEFAULT_ACTION, extra: Record<string, unknown> = {}): Response {
  return {
    actionIdentifier: action,
    notification: {
      request: {
        identifier: 'push-1',
        content: { title: 'Task reminder', body: 'Due today', data: { url, ...extra }, categoryIdentifier: snoozeCategoryId('task') },
      },
    },
  };
}

function Probe() {
  usePushNotificationRouting();
  return null;
}

async function mount() {
  await act(async () => {
    create(<Probe />);
  });
}

async function deliver(r: Response) {
  await act(async () => {
    listener?.(r);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  vi.clearAllMocks();
  listener = null;
  lastResponse = null;
});

describe('tapping a push while the app runs', () => {
  it('opens the push’s link', async () => {
    await mount();
    await deliver(tap('/tasks?focus=t1'));
    expect(openRoute).toHaveBeenCalledWith('/tasks?focus=t1');
  });

  it('ignores a link that is not an app path', async () => {
    await mount();
    await deliver(tap('https://example.com/x'));
    await deliver(tap(undefined));
    await deliver(tap(42));
    expect(openRoute).not.toHaveBeenCalled();
  });

  it('snoozes on a snooze button and opens nothing', async () => {
    await mount();
    await deliver(tap('/tasks?focus=t1', snoozeActionId(60)));
    expect(openRoute).not.toHaveBeenCalled();
    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('opens an Assistant reply in the chat pop-up when one is listening', async () => {
    const seen: unknown[] = [];
    const off = onAssistantPopup((req) => seen.push(req));
    await mount();
    await deliver(tap('/assistant/conv-1'));
    off();
    expect(seen).toEqual([{ conversationId: 'conv-1' }]);
    expect(openRoute).not.toHaveBeenCalled();
  });

  it('opens the chat screen for an Assistant reply when no pop-up is listening', async () => {
    await mount();
    await deliver(tap('/assistant/conv-1'));
    expect(openRoute).toHaveBeenCalledWith('/assistant/conv-1');
  });
});

describe('a tap that launched the app', () => {
  it('opens its link once and clears it', async () => {
    lastResponse = tap('/calendar?date=2026-11-12');
    await mount();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(openRoute).toHaveBeenCalledWith('/calendar?date=2026-11-12');
    expect(notifications.clearLastNotificationResponseAsync).toHaveBeenCalled();
  });

  it('never opens or snoozes again for a snooze button: the background task did it', async () => {
    lastResponse = tap('/tasks?focus=t1', snoozeActionId(60));
    await mount();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(openRoute).not.toHaveBeenCalled();
    expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(notifications.clearLastNotificationResponseAsync).toHaveBeenCalled();
  });
});
