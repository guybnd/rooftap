// FLUX-116: unified expiry-reminder engine. One place that maps an "origin"
// (a cost, a document, a tracked item) to a household_task via a stable
// template_key, so reminders are created/updated/removed idempotently and can be
// found again to surface an "Open reminder" link on the origin. Generalised from
// the original cost-only cost-reminders.ts (which now delegates here).

import type { SupabaseClient } from '@supabase/supabase-js';

export const REMINDER_LEAD_DAYS = 14;

export type ReminderOriginKind = 'cost' | 'document' | 'tracked_item' | 'lease' | 'care';

const PREFIX: Record<ReminderOriginKind, string> = {
  cost: 'cost-reminder',
  document: 'doc-reminder',
  tracked_item: 'tracked-item-reminder',
  lease: 'lease-reminder',
  // Home care jobs: the database keeps these in step (20261023120000_home_care.sql).
  care: 'care-reminder',
};

const KIND_BY_PREFIX: Record<string, ReminderOriginKind> = {
  'cost-reminder': 'cost',
  'doc-reminder': 'document',
  'tracked-item-reminder': 'tracked_item',
  'lease-reminder': 'lease',
  'care-reminder': 'care',
};

/** Stable template_key for a reminder: `<prefix>:<originId>:<sub>` (sub e.g. expiry|contract|discount). */
export function reminderKey(kind: ReminderOriginKind, originId: string, sub = 'expiry'): string {
  return `${PREFIX[kind]}:${originId}:${sub}`;
}

/** Reverse a template_key into its origin, or null if it isn't a reminder key. */
export function parseReminderKey(
  templateKey: string | null
): { kind: ReminderOriginKind; originId: string; sub: string } | null {
  if (!templateKey) return null;
  const idx = templateKey.indexOf(':');
  if (idx < 0) return null;
  const prefix = templateKey.slice(0, idx);
  const kind = KIND_BY_PREFIX[prefix];
  if (!kind) return null;
  const rest = templateKey.slice(idx + 1);
  const lastColon = rest.lastIndexOf(':');
  if (lastColon < 0) return null;
  return { kind, originId: rest.slice(0, lastColon), sub: rest.slice(lastColon + 1) };
}

/** The reminder due date: REMINDER_LEAD_DAYS before expiry, or today if that's past. */
export function reminderLeadDate(expiryISO: string): string {
  const d = new Date(expiryISO);
  d.setDate(d.getDate() - REMINDER_LEAD_DAYS);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return (d < today ? today : d).toISOString().slice(0, 10);
}

export interface SyncReminderArgs {
  groupId: string;
  templateKey: string;
  /** Expiry date (YYYY-MM-DD). Null/empty removes the reminder. */
  date: string | null;
  title: string;
  assignedTo?: string | null;
  notes?: string;
  /** When true, use `date` as the due date directly (manual reminder), not lead-adjusted. */
  dueOnDate?: boolean;
}

/**
 * Create / update / remove a single reminder task to match an origin's date.
 * Idempotent via `templateKey`. Returns the task id (or null when removed).
 */
export async function syncReminder(
  supabase: SupabaseClient,
  { groupId, templateKey, date, title, assignedTo = null, notes, dueOnDate = false }: SyncReminderArgs
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('household_tasks')
    .select('id')
    .eq('group_id', groupId)
    .eq('template_key', templateKey)
    .maybeSingle();

  if (!date) {
    if (existing) await supabase.from('household_tasks').delete().eq('id', existing.id);
    return null;
  }

  const due_date = dueOnDate ? date : reminderLeadDate(date);

  if (existing) {
    await supabase
      .from('household_tasks')
      .update({ title, due_date, assigned_to: assignedTo, notes: notes ?? null })
      .eq('id', existing.id);
    return existing.id as string;
  }

  const { data: inserted } = await supabase
    .from('household_tasks')
    .insert({
      group_id: groupId,
      title,
      due_date,
      recurrence_days: null,
      done: false,
      assigned_to: assignedTo,
      private: false,
      template_key: templateKey,
      notes: notes ?? null,
      sort_order: 0,
    })
    .select('id')
    .single();
  return (inserted?.id as string) ?? null;
}

/** Manually create a reminder if one doesn't already exist (fallback for items without an expiry). */
export async function createManualReminder(
  supabase: SupabaseClient,
  { groupId, templateKey, title, dueDate = null, assignedTo = null, notes }: {
    groupId: string; templateKey: string; title: string;
    dueDate?: string | null; assignedTo?: string | null; notes?: string;
  }
): Promise<string | null> {
  const existing = await findReminderTaskId(supabase, groupId, templateKey);
  if (existing) return existing;
  const { data } = await supabase
    .from('household_tasks')
    .insert({
      group_id: groupId, title, due_date: dueDate, recurrence_days: null, done: false,
      assigned_to: assignedTo, private: false, template_key: templateKey, notes: notes ?? null, sort_order: 0,
    })
    .select('id')
    .single();
  return (data?.id as string) ?? null;
}

/** Find the id of the reminder task for a template_key, or null if none exists. */
export async function findReminderTaskId(
  supabase: SupabaseClient,
  groupId: string,
  templateKey: string
): Promise<string | null> {
  const { data } = await supabase
    .from('household_tasks')
    .select('id')
    .eq('group_id', groupId)
    .eq('template_key', templateKey)
    .maybeSingle();
  return (data?.id as string) ?? null;
}

/** Delete reminders by template_key (e.g. when the origin is deleted). */
export async function deleteReminders(
  supabase: SupabaseClient,
  groupId: string,
  templateKeys: string[]
): Promise<void> {
  if (templateKeys.length === 0) return;
  await supabase
    .from('household_tasks')
    .delete()
    .eq('group_id', groupId)
    .in('template_key', templateKeys);
}

// ── Document reminders ───────────────────────────────────────────────────────

/** Auto-sync a document's expiry reminder. Removes it when expiry is cleared. */
export async function syncDocumentReminder(
  supabase: SupabaseClient,
  doc: { id: string; groupId: string; name: string; expiryDate: string | null; assignedTo?: string | null }
): Promise<string | null> {
  return syncReminder(supabase, {
    groupId: doc.groupId,
    templateKey: reminderKey('document', doc.id, 'expiry'),
    date: doc.expiryDate,
    title: `Renew ${doc.name}`,
    assignedTo: doc.assignedTo ?? null,
    notes: doc.expiryDate ? `Auto-reminder from Documents. Expires: ${doc.expiryDate}.` : undefined,
  });
}

/** Remove a document's reminder (call when the document is deleted). */
export async function deleteDocumentReminder(
  supabase: SupabaseClient,
  groupId: string,
  documentId: string
): Promise<void> {
  await deleteReminders(supabase, groupId, [reminderKey('document', documentId, 'expiry')]);
}
