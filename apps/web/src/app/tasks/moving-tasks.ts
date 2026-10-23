// FLUX-60: Moving template generation + date helpers for household tasks.
//
// All dates here are handled as plain YYYY-MM-DD strings (matching the `date`
// column) rather than Date objects, so comparisons and arithmetic are timezone
// safe — `new Date("2026-06-12")` parses as UTC midnight and silently shifts a
// day in non-UTC zones, which would mis-bucket "due today" tasks as overdue.

// HOUP-67: the date helpers themselves now live in packages/core
// (date-utils.ts) since groceries.ts (also moved to core) needs them without
// depending back on this web-only module. Re-exported here so the ~8 existing
// `@/app/tasks/moving-tasks` call sites across the app (event-modal.tsx,
// task-row.tsx, etc.) don't all need to switch to `@homeup/core` just for
// these.
// HOUP-81: nextOccurrenceISO moved to packages/core/src/modules/household/household-tasks.ts
// (apps/mobile/src/app/tasks needs it too) — re-exported here unchanged so
// this file's one call site (page.tsx) doesn't need to switch imports.
// HOUP-122: generateMovingTasks/findOutOfSyncTasks/syncMovingTaskDates moved
// to packages/core/src/modules/household/moving-tasks.ts so apps/mobile can reuse them —
// re-exported here so page.tsx's import path doesn't change.
export {
  todayISO,
  toISODate,
  addDaysISO,
  daysBetweenISO,
  nextOccurrenceISO,
  generateMovingTasks,
  findOutOfSyncTasks,
  syncMovingTaskDates,
  isMovingActive,
} from '@homeup/core';
