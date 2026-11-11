// Deno twin of packages/core/src/notification-snooze.ts: the notification
// category a reminder push names, so the phone shows that kind's snooze
// buttons. Pure and import-free; core's notification-snooze.test.ts checks the
// two agree.

export const SNOOZE_KINDS = ["task", "event", "leave", "bins"] as const;
export type SnoozeKind = (typeof SNOOZE_KINDS)[number];

export function snoozeCategoryId(kind: SnoozeKind): string {
  return `snooze-${kind}`;
}
