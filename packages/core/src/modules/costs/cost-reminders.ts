// FLUX-66: Sync cost-item expiry dates into the household_tasks reminders inbox.
// A cost's contract-end and discount-end dates each get a reminder task keyed by
// a stable template_key, so we can create/update/delete them idempotently.
// FLUX-116: the create/update/delete mechanics now live in the shared reminder
// engine (src/lib/reminders.ts); this module keeps the cost-specific specs.

import type { CostItem } from '../../types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { reminderKey, syncReminder, deleteReminders } from '../../reminders';

/** Create/update/remove reminder tasks to match a cost's expiry dates. */
export async function syncCostReminders(cost: CostItem, supabase: SupabaseClient): Promise<void> {
  const specs: { sub: 'contract' | 'discount'; date: string | null; label: string }[] = [
    { sub: 'contract', date: cost.end_date, label: 'contract ends' },
    { sub: 'discount', date: cost.discount_end_date, label: 'discount ends' },
  ];

  for (const spec of specs) {
    await syncReminder(supabase, {
      groupId: cost.group_id,
      templateKey: reminderKey('cost', cost.id, spec.sub),
      date: spec.date,
      title: `${cost.name} ${spec.label}`,
      assignedTo: cost.assigned_to,
      notes: spec.date ? `Auto-reminder from Costs. Expiry: ${spec.date}.` : undefined,
    });
  }
}

/** Remove both reminders for a cost (call when the cost is deleted). */
export async function deleteCostReminders(cost: CostItem, supabase: SupabaseClient): Promise<void> {
  await deleteReminders(supabase, cost.group_id, [
    reminderKey('cost', cost.id, 'contract'),
    reminderKey('cost', cost.id, 'discount'),
  ]);
}
