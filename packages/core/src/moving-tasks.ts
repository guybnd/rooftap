// HOUP-122: moving-template generation + out-of-sync date sync, promoted from
// apps/web/src/app/tasks/moving-tasks.ts so the native Tasks screen can reuse
// them (previously web-only). generateMovingTasks/syncMovingTaskDates are NOT
// pure — they take an injected SupabaseClient and mutate `household_tasks` —
// core's first supabase-mutating helpers (costs.ts/groceries.ts are pure
// logic). The client is always injected by the caller, never constructed
// here: web passes its `createClient()` singleton, mobile passes
// `getCurrentSupabaseClient()`.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { HouseholdTask } from './types';
import { getRegionProvider } from './region';
import { addDaysISO, daysBetweenISO, todayISO } from './date-utils';

/**
 * How long after move-in day the moving affordances stay on screen before the
 * household is treated as settled. Long enough to cover the tail of the
 * checklist (the AU and DE templates both run to +14), short enough that a
 * house you moved into last year isn't still offering to plan the move.
 */
export const SETTLED_AFTER_DAYS = 45;

/**
 * Where a household is in its move, derived from the move-in date alone.
 *
 * The move-in date is the switch for the whole moving feature: before this,
 * "Generate moving tasks" sat on the Tasks screen unconditionally, offering to
 * plan a move for households who moved in years ago or were never moving. The
 * date was an inert field in settings and the button had no idea whether it
 * was relevant. Both problems are the same missing piece.
 *
 * - `inactive`: no date set. No moving UI anywhere.
 * - `preparing`: move-in day is ahead. Countdown and the checklist offer.
 * - `settling`: moved in within SETTLED_AFTER_DAYS. The +N tasks are still due.
 * - `settled`: the move is history. The moving UI retires itself.
 */
export type MovingPhase = 'inactive' | 'preparing' | 'settling' | 'settled';

export function getMovingPhase(moveInDate: string | null | undefined, today = todayISO()): MovingPhase {
  if (!moveInDate) return 'inactive';
  const daysUntil = daysBetweenISO(today, moveInDate);
  if (daysUntil >= 0) return 'preparing';
  return -daysUntil <= SETTLED_AFTER_DAYS ? 'settling' : 'settled';
}

/**
 * Whether to offer the moving checklist at all. The single predicate every
 * moving affordance gates on, so web and mobile can't drift on the rule.
 */
export function isMovingActive(moveInDate: string | null | undefined, today = todayISO()): boolean {
  const phase = getMovingPhase(moveInDate, today);
  return phase === 'preparing' || phase === 'settling';
}

/**
 * The caption under the move-in date field. Lives here rather than in each
 * app's copy so the two platforms can't describe the same state differently.
 *
 * The field used to read "Used for moving timeline templates", which says what
 * it feeds but not that it is the on switch. Each phase states what is
 * currently true and what changes if you edit it.
 */
export function describeMovingPhase(moveInDate: string | null | undefined, today = todayISO()): string {
  const phase = getMovingPhase(moveInDate, today);
  if (phase === 'inactive') {
    return 'Set a date to turn on the moving checklist and countdown.';
  }

  const days = Math.abs(daysBetweenISO(today, moveInDate as string));
  const dayWord = days === 1 ? 'day' : 'days';

  if (phase === 'preparing') {
    return days === 0
      ? 'Move-in day is today. The moving checklist is on.'
      : `${days} ${dayWord} until move-in. The moving checklist is on.`;
  }
  if (phase === 'settling') {
    const left = SETTLED_AFTER_DAYS - days;
    return `Moved in ${days} ${dayWord} ago. The moving checklist retires in ${left} ${left === 1 ? 'day' : 'days'}.`;
  }
  return 'The move is done, so the moving checklist is off. Set a new date to turn it back on.';
}

/**
 * Generate moving-template tasks for a group. Idempotent: any template_key that
 * already exists is skipped, so regenerating only fills in what's missing.
 * If no move-in date is set, tasks are created with a null due_date (offset is
 * still stored so dates can be filled in later via syncMovingTaskDates).
 */
export async function generateMovingTasks(params: {
  groupId: string;
  region: string | null | undefined;
  moveInDate: string | null;
  existingTemplateKeys: Set<string>;
  supabase: SupabaseClient;
}): Promise<number> {
  const { groupId, region, moveInDate, existingTemplateKeys, supabase } = params;
  const provider = getRegionProvider(region ?? undefined);

  const toInsert = provider.movingTasks
    .filter((t) => !existingTemplateKeys.has(t.template_key))
    .map((t) => ({
      group_id: groupId,
      title: t.title,
      due_date: moveInDate ? addDaysISO(moveInDate, t.offset_days) : null,
      offset_days: t.offset_days,
      recurrence_days: null,
      done: false,
      notes: t.notes ?? null,
      template_key: t.template_key,
      sort_order: t.offset_days, // keep the checklist in chronological order
    }));

  if (toInsert.length === 0) return 0;

  const { error } = await supabase.from('household_tasks').insert(toInsert);
  if (error) throw error;
  return toInsert.length;
}

/**
 * Pending, template-generated tasks whose due_date no longer matches
 * (moveInDate + offset_days). Manual tasks (no template_key) and completed tasks
 * are never included. Used to "offer to shift" after the move-in date changes.
 */
export function findOutOfSyncTasks(
  tasks: HouseholdTask[],
  moveInDate: string | null
): HouseholdTask[] {
  if (!moveInDate) return [];
  return tasks.filter(
    (t) =>
      !!t.template_key &&
      t.offset_days != null &&
      !t.done &&
      t.due_date !== addDaysISO(moveInDate, t.offset_days)
  );
}

/**
 * Shift the due_date of every out-of-sync template task to match the current
 * move-in date. Returns the number of tasks updated. Manual tasks untouched.
 */
export async function syncMovingTaskDates(params: {
  tasks: HouseholdTask[];
  moveInDate: string | null;
  supabase: SupabaseClient;
}): Promise<number> {
  const { tasks, moveInDate, supabase } = params;
  if (!moveInDate) return 0;
  const outOfSync = findOutOfSyncTasks(tasks, moveInDate);
  if (outOfSync.length === 0) return 0;

  await Promise.all(
    outOfSync.map((t) =>
      supabase
        .from('household_tasks')
        .update({ due_date: addDaysISO(moveInDate, t.offset_days as number) })
        .eq('id', t.id)
    )
  );
  return outOfSync.length;
}
