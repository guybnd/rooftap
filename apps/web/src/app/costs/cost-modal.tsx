'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { CostItem, CostCategory } from '@homeup/core';
import { dialog } from '@homeup/core';
import { CATEGORY_META, costFormFrom, costNeedsReminderSync, costRowFromForm, currencySymbol, formatMoney } from '@homeup/core';
import { syncCostReminders, useCostCategoryChoices, useModules } from '@homeup/core';
import { ItemFormSheet, FormSection, FieldRow, DetailsDisclosure } from '@/components/ui/item-form-sheet';
import { DragNumberField } from '@/components/ui/drag-number-field';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SearchablePicker, type PickerOption } from '@/components/ui/searchable-picker';
import { Input } from '@/components/ui/input';
import { CostDocuments } from '@/app/costs/cost-documents';
import { sectionIconFor } from '@/lib/section-icons';
import { CategoryGlyph } from './category-glyph';
import { CostBankLink } from './cost-bank-link';

// Hearth v2 (E1): the sheet header wears the section's identity tile.
const COSTS_SECTION = { id: 'costs', Icon: sectionIconFor('costs') };

interface CostModalProps {
  isOpen: boolean;
  item?: CostItem;
  groupId: string;
  defaultCategory?: CostCategory;
  /** Pre-fill the name for new costs (ignored when `item` is provided). */
  defaultName?: string;
  /** Pre-fill the date for new costs, YYYY-MM-DD (ignored when `item` is provided). */
  defaultStartDate?: string;
  onClose: () => void;
  onSave: (item: CostItem) => void;
  /** When provided, a Delete button is shown (edit mode only). */
  onDelete?: (itemId: string) => void;
  /** Archive or bring back the cost; absent on servers without 'costs.redesign'. */
  onArchive?: (item: CostItem, archived: boolean) => void;
}

const CADENCE_OPTIONS = [
  { value: 'one_off' as const, label: 'One-off' },
  { value: 'weekly' as const, label: 'Weekly' },
  { value: 'fortnightly' as const, label: 'Fortnightly' },
  { value: 'monthly' as const, label: 'Monthly' },
  { value: 'quarterly' as const, label: 'Quarterly' },
  { value: 'yearly' as const, label: 'Yearly' },
];

export function CostModal({ isOpen, item, groupId, defaultCategory, defaultName, defaultStartDate, onClose, onSave, onDelete, onArchive }: CostModalProps) {
  const buildInitialForm = useCallback(
    () => costFormFrom(item, { name: defaultName, category: defaultCategory, startDate: defaultStartDate }),
    [item, defaultCategory, defaultName, defaultStartDate],
  );
  const [form, setForm] = useState(buildInitialForm);
  // A new price from a date on, for a recurring cost (core costPriceOn).
  const [priceFrom, setPriceFrom] = useState('');
  const [newPrice, setNewPrice] = useState<number | null>(null);

  // FLUX-186: instance is reused across opens (stable `key` for blank adds), so
  // re-seed the form on every closed→open transition — otherwise adding a second
  // cost pre-fills the one you just added.
  const wasOpen = useRef(isOpen);
  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      setForm(buildInitialForm());
      setPriceFrom('');
      setNewPrice(null);
    }
    wasOpen.current = isOpen;
  }, [isOpen, buildInitialForm]);

  const categoryChoices = useCostCategoryChoices(form.category);
  const categoryOptions = useMemo<PickerOption[]>(
    () => categoryChoices.map((c) => ({ value: c, primary: CATEGORY_META[c].label })),
    [categoryChoices]
  );

  // FLUX-182: the Contract group (provider + renewal/discount dates + reminders)
  // is only meaningful for a recurring cost — hidden for a one-off.
  const isRecurring = form.cadence !== 'one_off';

  const modules = useModules();
  // Modules: naming Tasks as where the reminder lands needs household and costs;
  // the reminder itself is created either way (module-features.ts).
  const reminderInTasks = modules.feature('tasks.from-cost');

  const handleSubmit = () => {
    if (!form.name.trim()) return;
    // Offline-safe: build the row and hand it to onSave (→ writeRow), which
    // writes to IndexedDB and syncs. No direct Supabase here, so it works
    // offline. writeRow stamps created_by/timestamps for new rows.
    const saved = costRowFromForm(form, {
      item,
      groupId,
      priceChange: { from: priceFrom, dollars: newPrice },
      fresh: { id: crypto.randomUUID(), createdBy: null, stamp: new Date().toISOString() },
    });

    onSave(saved);
    onClose();

    // Keep expiry reminders in the Tasks inbox in sync. Fire-and-forget and
    // online-only — offline it throws (caught); a reminder usually reconciles
    // on a later online edit, though an offline-missed *deletion* can slip
    // through if a subsequent save no longer trips this guard. The core cost
    // is already saved locally regardless.
    // FLUX-184: also fire when the cost *previously* had expiry dates (e.g.
    // switching to one-off just cleared them) — syncCostReminders deletes the
    // stale reminder when a date is now null, but only if it actually runs.
    if (costNeedsReminderSync(saved, item)) {
      void syncCostReminders(saved, createClient()).catch(() => {});
    }
  };

  const handleDelete = async () => {
    if (!item?.id || !onDelete) return;
    if (!(await dialog.confirm({ title: `Delete "${item.name}"?`, message: 'This cannot be undone.', destructive: true }))) return;
    onDelete(item.id);
    onClose();
  };

  const detailsCount = isRecurring ? 5 : 1; // Provider, Contract start/end, Discount ends, Attachments

  return (
    <ItemFormSheet
      section={COSTS_SECTION}
      isOpen={isOpen}
      onClose={onClose}
      title={item ? 'Edit cost' : 'Add cost'}
      previewContent={
        item ? (
          <>
            <CategoryGlyph category={form.category} />
            <span className="min-w-0 flex-1 truncate font-heading text-base font-semibold text-foreground">
              {form.name || 'Edit cost'}
            </span>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
              {form.is_estimate ? '≈' : ''}${(form.amount ?? 0).toFixed(2)}
            </span>
          </>
        ) : undefined
      }
      onSubmit={handleSubmit}
      canSubmit={!!form.name.trim()}
      onDelete={item && onDelete ? handleDelete : undefined}
    >
      <FormSection>
        <div className="grid grid-cols-[3fr_1fr] gap-3">
          <FieldRow label="Name" htmlFor="cost-name" required>
            <Input
              id="cost-name"
              autoFocus
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g., Electricity"
            />
          </FieldRow>
          <FieldRow
            label="Amount"
            action={
              <button
                type="button"
                role="switch"
                aria-checked={form.is_estimate}
                aria-label="Estimate"
                onClick={() => setForm({ ...form, is_estimate: !form.is_estimate })}
                className="text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                {form.is_estimate ? '≈' : 'Exact'}
              </button>
            }
          >
            <DragNumberField
              value={form.amount}
              onChange={(amount) => setForm({ ...form, amount })}
              step={1}
              min={0}
              precision={2}
              prefix={currencySymbol()}
              placeholder="0.00"
              ariaLabel="Amount"
            />
          </FieldRow>
        </div>

        {/* Category then cadence, each a full row: six cadence segments in a
            half-width column wrapped to three lines on a phone. */}
        <div className="grid gap-3">
          <FieldRow label="Category">
            <SearchablePicker
              options={categoryOptions}
              value={form.category}
              onChange={(category) => setForm({ ...form, category: category as CostCategory })}
              placeholder="Category…"
              searchPlaceholder="Search…"
              ariaLabel="Category"
            />
          </FieldRow>
          <FieldRow label="Cadence">
            <SegmentedControl
              options={CADENCE_OPTIONS}
              value={form.cadence}
              onChange={(cadence) => setForm({ ...form, cadence })}
              wrap
              size="sm"
              ariaLabel="Cadence"
            />
          </FieldRow>
        </div>

        <FieldRow label="Notes">
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 placeholder:text-muted-foreground"
            rows={2}
            placeholder="Any details…"
          />
        </FieldRow>
      </FormSection>

      {item?.id && (
        <CostBankLink
          costItemId={item.id}
          category={form.category}
          amountCents={Math.round((form.amount ?? 0) * 100)}
          estimate={form.is_estimate}
          onAmount={(cents) => setForm((f) => ({ ...f, amount: cents / 100 }))}
          line={item}
          onMerged={onClose}
        />
      )}

      {isRecurring && item?.id && onArchive && (
        <FormSection title="Price from a date">
          {(item.price_changes ?? []).map((c) => (
            <p key={c.from} className="text-xs tabular-nums text-muted-foreground">
              {formatMoney(c.amount)} from {c.from}
            </p>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="New price starts" hint="Earlier months keep the old price.">
              <Input type="date" value={priceFrom} onChange={(e) => setPriceFrom(e.target.value)} />
            </FieldRow>
            {priceFrom && (
              <FieldRow label="New price">
                <DragNumberField value={newPrice} onChange={setNewPrice} step={1} min={0} precision={2} prefix={currencySymbol()} placeholder="0.00" ariaLabel="New price" />
              </FieldRow>
            )}
          </div>
        </FormSection>
      )}

      {item?.id && onArchive && (
        <FormSection>
          <button
            type="button"
            onClick={() => onArchive(item, !item.archived)}
            className="h-10 w-full rounded-xl border border-border bg-muted text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {item.archived ? 'Bring back' : 'Archive'}
          </button>
          {!item.archived && <p className="text-xs text-muted-foreground">Archived costs still catch their bank payments, but leave every total.</p>}
        </FormSection>
      )}

      <DetailsDisclosure count={detailsCount}>
        {isRecurring && (
          <FormSection title="Contract">
            <FieldRow label="Provider">
              <Input
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value })}
                placeholder="e.g., AGL, Telstra"
              />
            </FieldRow>
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Contract start">
                <Input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                />
              </FieldRow>
              <FieldRow label="Contract end">
                <Input
                  type="date"
                  value={form.end_date}
                  onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                />
              </FieldRow>
            </div>
            <FieldRow
              label="Discount / intro-rate ends"
              hint={reminderInTasks ? 'A reminder will appear in Tasks before this date.' : "You'll get a reminder before this date."}
            >
              <Input
                type="date"
                value={form.discount_end_date}
                onChange={(e) => setForm({ ...form, discount_end_date: e.target.value })}
              />
            </FieldRow>
          </FormSection>
        )}

        {/* Attachments (bills / receipts / contracts). CostDocuments uploads
            immediately keyed by a saved cost id, so it's only available in edit
            mode; a new cost prompts the user to save first (FLUX-182). */}
        <FormSection>
          <FieldRow label="Attachments">
            {item?.id ? (
              <CostDocuments costItemId={item.id} groupId={groupId} />
            ) : (
              <p className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
                Save this cost first, then reopen it to attach a bill, receipt or contract.
              </p>
            )}
          </FieldRow>
        </FormSection>
      </DetailsDisclosure>
    </ItemFormSheet>
  );
}
