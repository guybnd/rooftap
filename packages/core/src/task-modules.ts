// Which module a household task belongs to (.docs/modules.md, section 9).
// Bill and document reminders are stored as household_tasks but belong to
// Costs and Documents: with Tasks off they still show on the hub and still
// notify, opening the bill or document side instead of /tasks; with their own
// module off they go, even while Tasks is on. Every other task belongs to
// Tasks. The notify-* edge functions apply the same rules through their Deno
// twin, supabase/functions/_shared/module-rules.ts (task-modules.test.ts keeps
// the two in step).

import { parseReminderKey, type ReminderOriginKind } from './reminders';
import type { ModuleId } from './modules';

const REMINDER_OWNER: Record<ReminderOriginKind, ModuleId> = {
  cost: 'costs',
  document: 'documents',
  // Tracked-item reminders have no screen of their own yet, so Tasks keeps them.
  tracked_item: 'household',
  // The lease lives in the home profile (platform), so its to-do is a Tasks to-do.
  lease: 'household',
  // Home care jobs live in Home Setup's Care view.
  care: 'home-care',
};

/** Where a reminder opens when Tasks is off: its owning module's screen. */
const OWNER_HREF: Partial<Record<ModuleId, string>> = {
  costs: '/costs',
  documents: '/documents',
  'home-care': '/setup?view=care',
};

/** Modules whose reminders show on the hub on their own, without Tasks. */
export type ReminderOwner = 'costs' | 'documents' | 'home-care';

export function isReminderOwner(id: string): id is ReminderOwner {
  return id === 'costs' || id === 'documents' || id === 'home-care';
}

/** The section a reminder owner's rows wear (Home care lives in Home Setup). */
export function reminderOwnerSection(owner: ReminderOwner): string {
  return owner === 'home-care' ? 'setup' : owner;
}

/** The screen a reminder's owning module opens to (Costs, Documents), or null. */
export function ownerScreenHref(owner: ModuleId): string | null {
  return OWNER_HREF[owner] ?? null;
}

/** The module a task belongs to. */
export function taskOwnerModule(task: { template_key: string | null }): ModuleId {
  const parsed = parseReminderKey(task.template_key);
  return parsed ? REMINDER_OWNER[parsed.kind] : 'household';
}

/** Whether a task exists for this household: its owning module is on. */
export function isTaskOwnerEnabled(task: { template_key: string | null }, enabled: ReadonlySet<string>): boolean {
  return enabled.has(taskOwnerModule(task));
}

/**
 * Where a task opens from outside the Tasks list (a push, the hub): the task
 * itself while Tasks is on, otherwise its owning module's screen. Null when
 * the task has nowhere to open (its owner is off).
 */
export function taskOpenHref(
  task: { id: string; template_key: string | null },
  enabled: ReadonlySet<string>,
): string | null {
  if (enabled.has('household')) return `/tasks?focus=${task.id}`;
  const owner = taskOwnerModule(task);
  if (!enabled.has(owner)) return null;
  return ownerScreenHref(owner);
}

/**
 * Whether any bill or document reminder can show for owners that are visible:
 * the hub agenda stays up for these with Tasks hidden, and goes when there
 * are none rather than sitting empty.
 */
export function hasVisibleReminders(
  tasks: readonly { template_key: string | null; deleted?: boolean }[],
  visible: Partial<Record<ReminderOwner, boolean>>,
): boolean {
  return tasks.some((t) => {
    if (t.deleted) return false;
    const owner = taskOwnerModule(t);
    return isReminderOwner(owner) && visible[owner] === true;
  });
}

/**
 * Whether Google Calendar push may carry this item for a household: the
 * Google Calendar module is on, and the item's own module is (a task's owner,
 * Home Search for a viewing). calendar-push and calendar-sync apply the same
 * rule through the Deno twin, so switching a module off also takes its items
 * back out of members' Rooftap calendars on the next push or reconcile.
 */
export function isGoogleCalendarPushEnabled(
  entityType: 'task' | 'appointment',
  task: { template_key: string | null } | null,
  enabled: ReadonlySet<string>,
): boolean {
  if (!enabled.has('google-calendar')) return false;
  if (entityType === 'appointment') return enabled.has('search');
  return task ? isTaskOwnerEnabled(task, enabled) : false;
}
