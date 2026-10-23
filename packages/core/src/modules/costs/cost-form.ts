// The cost editor's form and the rows the Costs screen adds, shared by both
// apps (web app/costs/cost-modal.tsx + page.tsx, mobile features/costs/
// cost-modal.tsx + the costs tab). Each app keeps its own fields and sheet;
// these turn an item into the form, and the form back into the row it saves.

import type { CostCadence, CostCategory, CostItem } from '../../types';
import { todayISO } from '../../date-utils';
import { withPriceChange } from './cost-month';

export interface CostForm {
  name: string;
  category: CostCategory;
  /** Dollars as typed, or null while empty. */
  amount: number | null;
  cadence: CostCadence;
  is_estimate: boolean;
  provider: string;
  start_date: string;
  end_date: string;
  discount_end_date: string;
  notes: string;
}

/** The form for an item, or for a new cost (a one-off Purchase unless the screen says otherwise, FLUX-182). */
export function costFormFrom(
  item: CostItem | undefined,
  defaults: { name?: string; category?: CostCategory; startDate?: string } = {}
): CostForm {
  return {
    name: item?.name ?? defaults.name ?? '',
    category: item?.category ?? defaults.category ?? 'purchase',
    amount: item ? item.amount / 100 : null,
    cadence: item?.cadence ?? 'one_off',
    is_estimate: item?.is_estimate ?? false,
    provider: item?.provider ?? '',
    start_date: item?.start_date ?? defaults.startDate ?? '',
    end_date: item?.end_date ?? '',
    discount_end_date: item?.discount_end_date ?? '',
    notes: item?.notes ?? '',
  };
}

/**
 * The row the editor saves: the item with the form's changes, or a new row.
 * A one-off clears the contract-only dates (FLUX-184): a renewal reminder
 * must not outlive the recurrence. `start_date` and `provider` stay, since a
 * one-off's date anchors it in the month and a grocery line's provider is the
 * shop. A new cost with no date is dated today (FLUX-1575), so it shows in
 * this month. `priceChange` (recurring only) adds "the price changes from".
 */
export function costRowFromForm(
  form: CostForm,
  opts: {
    item: CostItem | undefined;
    groupId: string;
    priceChange?: { from: string; dollars: number | null };
    /** For a new row: its id, who made it and its stamp (null lets the store stamp it). */
    fresh: { id: string; createdBy: string | null; stamp: string | null };
    today?: string;
  }
): CostItem {
  const { item, priceChange } = opts;
  const recurring = form.cadence !== 'one_off';
  const payload = {
    group_id: opts.groupId,
    name: form.name.trim(),
    category: form.category,
    amount: Math.round((form.amount ?? 0) * 100),
    cadence: form.cadence,
    is_estimate: form.is_estimate,
    provider: form.provider.trim() || null,
    start_date: form.start_date || (item?.id ? null : opts.today ?? todayISO()),
    end_date: recurring ? form.end_date || null : null,
    discount_end_date: recurring ? form.discount_end_date || null : null,
    notes: form.notes.trim() || null,
    ...(recurring && priceChange?.from && priceChange.dollars != null && Number.isFinite(priceChange.dollars)
      ? { price_changes: withPriceChange(item?.price_changes ?? [], priceChange.from, Math.round(priceChange.dollars * 100)) }
      : {}),
  };
  if (item?.id) return { ...item, ...payload };
  return {
    id: opts.fresh.id,
    ...payload,
    assigned_to: null,
    linked_section: null,
    sort_order: 0,
    created_by: opts.fresh.createdBy,
    created_at: opts.fresh.stamp as string,
    updated_at: opts.fresh.stamp as string,
    deleted: false,
  };
}

/**
 * Whether a save should sync the Tasks inbox's expiry reminders: the row
 * has an expiry date, or had one before (switching to one-off just cleared
 * it, and the stale reminder has to go).
 */
export function costNeedsReminderSync(saved: CostItem, before: CostItem | undefined): boolean {
  return !!(saved.end_date || saved.discount_end_date || before?.end_date || before?.discount_end_date);
}

export type NewCostLine = Partial<CostItem> & Pick<CostItem, 'name' | 'category' | 'amount' | 'cadence'>;

/**
 * A line the Costs screen adds in one tap (from Home Search's rent, Home
 * Setup's total, or a suggestion). Only a genuine one-off actual gets an
 * occurrence date; recurring anchors (rent) and estimates (setup) have none.
 */
export function newCostLine(
  line: NewCostLine,
  opts: { id: string; groupId: string; createdBy: string | null; today?: string }
): CostItem {
  const oneOffActual = line.cadence === 'one_off' && !(line.is_estimate ?? false);
  return {
    id: opts.id,
    group_id: opts.groupId,
    is_estimate: false,
    start_date: oneOffActual ? opts.today ?? todayISO() : null,
    end_date: null,
    discount_end_date: null,
    provider: null,
    assigned_to: null,
    linked_section: null,
    notes: null,
    sort_order: 0,
    created_by: opts.createdBy,
    deleted: false,
    created_at: null as unknown as string,
    updated_at: null as unknown as string,
    ...line,
  };
}

/** The rent line from Home Search's weekly rent. */
export function rentCostLine(weeklyCents: number): NewCostLine {
  return { name: 'Rent', category: 'rent', amount: weeklyCents, cadence: 'weekly', linked_section: 'home_search' };
}

/** The Home Setup estimate from its total. */
export function setupCostLine(totalCents: number): NewCostLine {
  return { name: 'Home setup', category: 'moving', amount: totalCents, cadence: 'one_off', is_estimate: true, linked_section: 'home_setup' };
}
