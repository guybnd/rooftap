// Snooze buttons on reminder pushes (core notification-snooze.ts). The phone
// registers one notification category per kind of reminder; a push names its
// category, so Android draws that kind's buttons. Tapping one hides the
// notification and shows it again later as a local notification, with the
// same buttons, so it can be snoozed again.
//
// A button tap reaches JS in two ways: the response listener while the app is
// running (use-push-notification-routing.ts), and the background task below
// when it isn't. Both can fire for one tap; the snoozed copy has a fixed id per
// original notification, so the second schedule replaces the first.
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { SQLiteStorage } from 'expo-sqlite/kv-store';
import {
  SNOOZE_KINDS,
  normalizeSnoozePick,
  snoozeActionId,
  snoozeCategoryId,
  snoozeKindFromCategory,
  snoozeMinutesFor,
  snoozeMinutesFromAction,
  snoozeShortLabel,
  snoozeUntil,
} from '@homeup/core';

const PICK_KEY = 'rooftap.snoozePick';
const SNOOZED_PREFIX = 'snoozed:';
export const SNOOZE_TASK = 'rooftap-notification-snooze';

const storage = new SQLiteStorage('HomeUp.db');

/** The person's snooze choices for task and event reminders, on this phone. */
export function readSnoozePick(): number[] {
  try {
    const raw = storage.getItemSync(PICK_KEY);
    return normalizeSnoozePick(raw ? JSON.parse(raw) : undefined);
  } catch {
    return normalizeSnoozePick(undefined);
  }
}

export async function saveSnoozePick(pick: readonly number[]): Promise<void> {
  const clean = normalizeSnoozePick(pick);
  try {
    storage.setItemSync(PICK_KEY, JSON.stringify(clean));
  } catch {
    // The buttons still change below; the choice resets to the defaults on the next launch.
  }
  await registerSnoozeCategories(clean);
}

/** (Re)register every kind's buttons. The OS keeps them across restarts. */
export async function registerSnoozeCategories(pick: readonly number[] = readSnoozePick()): Promise<void> {
  await Promise.all(
    SNOOZE_KINDS.map((kind) =>
      Notifications.setNotificationCategoryAsync(
        snoozeCategoryId(kind),
        snoozeMinutesFor(kind, pick).map((minutes) => ({
          identifier: snoozeActionId(minutes),
          buttonTitle: `Snooze ${snoozeShortLabel(minutes)}`,
          options: { opensAppToForeground: false },
        }))
      )
    )
  ).catch(() => {
    // No buttons this time; the next launch tries again.
  });
}

/**
 * Snooze the notification a button belongs to. Returns true when the response
 * was a snooze button, so the caller doesn't also open the notification's link.
 */
export async function handleSnoozeResponse(response: Notifications.NotificationResponse): Promise<boolean> {
  const minutes = snoozeMinutesFromAction(response.actionIdentifier);
  if (minutes === null) return false;

  const { request } = response.notification;
  const content = request.content;
  const categoryId = content.categoryIdentifier ?? null;
  const kind = snoozeKindFromCategory(categoryId);
  const data = (content.data ?? {}) as Record<string, unknown>;
  const startsAt = kind === 'event' && typeof data.startsAt === 'string' ? data.startsAt : null;
  const original = request.identifier.startsWith(SNOOZED_PREFIX) ? request.identifier : `${SNOOZED_PREFIX}${request.identifier}`;

  await Notifications.dismissNotificationAsync(request.identifier).catch(() => {});
  await Notifications.scheduleNotificationAsync({
    identifier: original,
    content: {
      title: content.title ?? undefined,
      body: content.body ?? undefined,
      data,
      ...(categoryId ? { categoryIdentifier: categoryId } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: snoozeUntil(new Date(), minutes, startsAt),
    },
  });
  return true;
}

// Runs when a button is tapped while the app isn't running. Defined at module
// scope and imported from index.js, so it exists before any screen mounts.
TaskManager.defineTask<Notifications.NotificationTaskPayload>(SNOOZE_TASK, async ({ data, error }) => {
  if (error || !data || !('actionIdentifier' in data)) return;
  await handleSnoozeResponse(data).catch(() => {});
});

/** Register the background task and the buttons once per launch. */
export function setUpNotificationSnooze(): void {
  void Notifications.registerTaskAsync(SNOOZE_TASK).catch(() => {});
  void registerSnoozeCategories();
}
