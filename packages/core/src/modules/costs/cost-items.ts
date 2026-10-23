// FLUX-104: shared cost-item helpers used by the global capture flow (and
// reusable by the Costs modal). Keeps cost-line creation in one place so the
// capture "Invoice" path and the Costs UI stay consistent.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CostCadence, CostCategory, CostItem } from '../../types';
import type { PickerOption } from '../../types';
import { CATEGORY_META, CATEGORY_COLOR } from './costs';
import { formatMoney } from '../../money-format';

/**
 * Map cost lines into SearchablePicker options — grouped by category (coloured
 * dot from the cost palette), secondary line = provider · amount. Shared by the
 * capture "attach to cost" picker and the documents-page link picker (FLUX-115).
 */
export function costItemsToOptions(items: CostItem[]): PickerOption[] {
  return items.map((c) => {
    const meta = CATEGORY_META[c.category];
    const secondary = [c.provider, c.amount ? formatMoney(c.amount) : null]
      .filter(Boolean)
      .join(' · ');
    return {
      value: c.id,
      primary: c.name,
      secondary: secondary || null,
      group: { key: c.category, label: meta?.label ?? c.category, color: CATEGORY_COLOR[c.category]?.dot },
      searchText: c.provider ?? '',
    };
  });
}

export interface CreateOneOffCostItemFields {
  name: string;
  amount?: number;                 // minor units (cents)
  category?: CostCategory;
  provider?: string | null;
  start_date?: string | null;      // YYYY-MM-DD
  notes?: string | null;
}

/**
 * Create a one-off (non-recurring, actual) cost line. Defaults mirror the
 * Costs "add one-off" path: `cadence:'one_off'`, `is_estimate:false`,
 * category `other`. Returns the inserted row.
 */
export async function createOneOffCostItem(
  supabase: SupabaseClient,
  groupId: string,
  fields: CreateOneOffCostItemFields
): Promise<CostItem> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const cadence: CostCadence = 'one_off';
  const { data, error } = await supabase
    .from('cost_items')
    .insert({
      group_id: groupId,
      name: fields.name.trim() || 'Untitled',
      category: fields.category ?? 'other',
      amount: fields.amount ?? 0,
      cadence,
      is_estimate: false,
      start_date: fields.start_date ?? null,
      provider: fields.provider ?? null,
      notes: fields.notes ?? null,
      created_by: user.id,
    })
    .select()
    .single();

  if (error || !data) throw new Error('Could not create the cost item.');
  return data as CostItem;
}

/** List a group's cost lines, newest first — for the "attach to existing" picker. */
export async function listCostItems(
  supabase: SupabaseClient,
  groupId: string
): Promise<CostItem[]> {
  const { data } = await supabase
    .from('cost_items')
    .select('*')
    .eq('group_id', groupId)
    .eq('deleted', false)
    .order('created_at', { ascending: false });
  return (data ?? []) as CostItem[];
}
