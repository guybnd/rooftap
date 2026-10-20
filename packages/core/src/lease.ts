// Lease notice period for rented homes. The lease end date lives in the home
// profile on `groups` (platform, always on) next to the move-in date, and is
// the switch for the whole feature the same way the move-in date switches on
// moving: no date, no lease UI beyond the empty field. The notice period is
// how many days before the end the household has to say whether it renews or
// leaves. One reminder to-do (a Tasks to-do, see task-modules.ts) lands ahead
// of that deadline. Web and mobile both caption the settings fields with
// describeLease and save through syncLeaseReminder, so they can't drift.
import type { SupabaseClient } from '@supabase/supabase-js';
import { addDaysISO, daysBetweenISO, todayISO } from './date-utils';
import { REMINDER_LEAD_DAYS, reminderKey } from './reminders';

export const LEASE_REMINDER_TITLE = 'Renew the lease or give notice';

/** Longest notice period the field accepts (two years), matching the column's check. */
export const MAX_LEASE_NOTICE_DAYS = 730;

export interface LeaseTerms {
  leaseEndDate: string | null | undefined;
  noticeDays: number | null | undefined;
}

/** Where a lease stands today. */
export type LeasePhase =
  | 'none'          // no lease end date: not rented, or not tracked
  | 'notice-ahead'  // the notice deadline is today or later
  | 'notice-passed' // the deadline passed but the lease is still running
  | 'ended';        // the lease end date is behind us

export interface LeaseStatus {
  phase: LeasePhase;
  /** The last day to give notice (lease end minus the notice period). */
  noticeDeadline: string | null;
  /** Whole days from today to the notice deadline (negative once passed). */
  daysToNotice: number | null;
  /** Whole days from today to the lease end (negative once ended). */
  daysToEnd: number | null;
}

/** Parse the notice field: a whole number of days in range, else null. */
export function parseNoticeDays(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n <= MAX_LEASE_NOTICE_DAYS ? n : null;
}

export function getLeaseStatus({ leaseEndDate, noticeDays }: LeaseTerms, today = todayISO()): LeaseStatus {
  if (!leaseEndDate) return { phase: 'none', noticeDeadline: null, daysToNotice: null, daysToEnd: null };
  const noticeDeadline = addDaysISO(leaseEndDate, -(noticeDays ?? 0));
  const daysToNotice = daysBetweenISO(today, noticeDeadline);
  const daysToEnd = daysBetweenISO(today, leaseEndDate);
  const phase: LeasePhase = daysToEnd < 0 ? 'ended' : daysToNotice < 0 ? 'notice-passed' : 'notice-ahead';
  return { phase, noticeDeadline, daysToNotice, daysToEnd };
}

/**
 * When the reminder to-do is due: REMINDER_LEAD_DAYS before the notice
 * deadline, or today once that is past. Null when there is nothing to remind
 * about (no lease, or it already ended).
 */
export function leaseReminderDueDate(terms: LeaseTerms, today = todayISO()): string | null {
  const status = getLeaseStatus(terms, today);
  if (status.phase === 'none' || status.phase === 'ended') return null;
  const lead = addDaysISO(status.noticeDeadline as string, -REMINDER_LEAD_DAYS);
  return lead < today ? today : lead;
}

function shortDate(iso: string, today: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const sameYear = y === Number(today.slice(0, 4));
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

function inDays(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

/**
 * The caption under the lease fields: how much time is left and what happens
 * next. `tasksOn` says whether the Tasks module is on, since the reminder
 * to-do only exists for households that use Tasks (.docs/modules.md).
 */
export function describeLease(terms: LeaseTerms, opts: { tasksOn: boolean; today?: string }): string {
  const today = opts.today ?? todayISO();
  const status = getLeaseStatus(terms, today);
  const { leaseEndDate, noticeDays } = terms;

  if (status.phase === 'none') {
    return opts.tasksOn
      ? 'Renting? Set when the lease ends to track the notice period and get a reminder in Tasks.'
      : 'Renting? Set when the lease ends to track how long you have to give notice.';
  }
  const end = shortDate(leaseEndDate as string, today);
  if (status.phase === 'ended') {
    return `The lease ended on ${end}. Set the new end date if you renewed.`;
  }

  const daysToEnd = status.daysToEnd as number;
  const daysToNotice = status.daysToNotice as number;
  let text: string;
  if (status.phase === 'notice-passed') {
    const ago = -daysToNotice;
    text = `The notice deadline passed ${ago} ${ago === 1 ? 'day' : 'days'} ago. The lease ends ${end}, ${inDays(daysToEnd)}.`;
  } else if (!noticeDays) {
    text = `The lease ends ${end}, ${inDays(daysToEnd)}.`;
  } else {
    const deadline = shortDate(status.noticeDeadline as string, today);
    text = `Give notice by ${deadline}, ${inDays(daysToNotice)}. The lease ends ${end}.`;
  }

  if (opts.tasksOn) {
    const due = leaseReminderDueDate(terms, today) as string;
    text += due === today ? ' The reminder is in Tasks now.' : ` A reminder lands in Tasks on ${shortDate(due, today)}.`;
  }
  return text;
}

/** The reminder to-do's notes: the dates it is about, in words. */
export function leaseReminderNotes(terms: LeaseTerms, today = todayISO()): string {
  const status = getLeaseStatus(terms, today);
  const end = shortDate(terms.leaseEndDate as string, today);
  if (!terms.noticeDays) return `The lease ends ${end}. From the home profile in Settings.`;
  const deadline = shortDate(status.noticeDeadline as string, today);
  return `Notice is due by ${deadline}, ${terms.noticeDays} days before the lease ends on ${end}. From the home profile in Settings.`;
}

/** The reminder's stable template_key: one per household. */
export function leaseReminderKey(groupId: string): string {
  return reminderKey('lease', groupId, 'notice');
}

/**
 * Create, move or remove the household's lease reminder to match its lease
 * terms. Idempotent via the template_key. A changed lease end date is a new
 * lease term, so `reopen` brings back a reminder that was already ticked off.
 * Returns the task id, or null when there is no reminder.
 */
export async function syncLeaseReminder(
  supabase: SupabaseClient,
  { groupId, terms, reopen = false, today = todayISO() }: { groupId: string; terms: LeaseTerms; reopen?: boolean; today?: string },
): Promise<string | null> {
  const templateKey = leaseReminderKey(groupId);
  const { data: existing, error: readError } = await supabase
    .from('household_tasks')
    .select('id')
    .eq('group_id', groupId)
    .eq('template_key', templateKey)
    .maybeSingle();
  if (readError) throw readError;

  const due = leaseReminderDueDate(terms, today);
  if (!due) {
    if (existing) {
      const { error } = await supabase.from('household_tasks').delete().eq('id', existing.id);
      if (error) throw error;
    }
    return null;
  }

  const fields = { title: LEASE_REMINDER_TITLE, due_date: due, notes: leaseReminderNotes(terms, today) };
  if (existing) {
    const patch = reopen ? { ...fields, done: false, completed_at: null } : fields;
    const { error } = await supabase.from('household_tasks').update(patch).eq('id', existing.id);
    if (error) throw error;
    return existing.id as string;
  }

  const { data: inserted, error } = await supabase
    .from('household_tasks')
    .insert({
      group_id: groupId,
      ...fields,
      recurrence_days: null,
      done: false,
      assigned_to: null,
      private: false,
      template_key: templateKey,
      sort_order: 0,
    })
    .select('id')
    .single();
  if (error) throw error;
  return (inserted?.id as string) ?? null;
}
