// HOUP-219: native rich add/edit sheet for cost items. Mirrors web's
// apps/web/src/app/costs/cost-modal.tsx field set while keeping writes
// offline-safe through the caller's Legend `writeRow` path.
import * as React from 'react';
import { Pressable } from 'react-native';
import {
  Text,
  Button,
  DateScrollField,
  DetailsDisclosure,
  DragNumberField,
  FieldRow,
  FormSection,
  Input,
  ItemFormSheet,
  SearchablePicker,
  SegmentedControl,
  cn,
  type PickerOption,
} from '@homeup/ui';
import {
  CADENCE_LABEL,
  CATEGORY_META,
  formatMoney,
  costFormFrom,
  costNeedsReminderSync,
  costRowFromForm,
  useCostCategoryChoices,
  syncCostReminders,
  useModules,
  type CostCadence,
  type CostCategory,
  type CostItem,
  currencySymbol,
} from '@homeup/core';
import { randomUUID } from '@/lib/uuid';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { CostDocuments } from './cost-documents';
import { CostBankLink } from './cost-bank-link';
import { CategoryChip } from './cost-card';
import { sectionIconFor } from '@/lib/section-icons';

// Hearth v2 (E1): the sheet header wears the section's identity tile.
const COSTS_SECTION = { id: 'costs', Icon: sectionIconFor('costs') };

const CADENCE_OPTIONS: CostCadence[] = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly', 'one_off'];


const CADENCE_SEGMENTS = CADENCE_OPTIONS.map((c) => ({ value: c, label: CADENCE_LABEL[c] }));

interface CostModalProps {
  open: boolean;
  item?: CostItem;
  groupId: string;
  currentUserId: string | null;
  /** HOUP-147: pre-fill a new item's name (global search "Add as..."). Ignored when `item` is set (editing). */
  defaultName?: string;
  /** Pre-fill a new item's date, YYYY-MM-DD (Home's "add to this day"). */
  defaultStartDate?: string;
  /** Pre-fill a new item's category (a category's "Add a cost"). */
  defaultCategory?: CostCategory;
  /** Archive or bring back the cost; absent on servers without 'costs.redesign'. */
  onArchive?: (item: CostItem, archived: boolean) => void;
  onClose: () => void;
  onSave: (item: CostItem) => void;
}


export function CostModal({ open, item, groupId, currentUserId, defaultName, defaultStartDate, defaultCategory, onArchive, onClose, onSave }: CostModalProps) {
  const [form, setForm] = React.useState(() => costFormFrom(item, { name: defaultName, category: defaultCategory, startDate: defaultStartDate }));
  // A new price from a date on, for a recurring cost (core costPriceOn).
  const [priceFrom, setPriceFrom] = React.useState('');
  const [newPrice, setNewPrice] = React.useState<number | null>(null);
  const categoryChoices = useCostCategoryChoices(form.category);
  const categoryPickerOptions = React.useMemo<PickerOption[]>(
    () => categoryChoices.map((c) => ({ value: c, primary: CATEGORY_META[c].label })),
    [categoryChoices]
  );

  const isRecurring = form.cadence !== 'one_off';
  const modules = useModules();
  // Modules: naming Tasks as where the reminder lands needs household and costs;
  // the reminder itself is created either way (module-features.ts).
  const reminderInTasks = modules.feature('tasks.from-cost');
  // Modules: attachments need documents and costs (module-features.ts).
  const docsLinked = modules.feature('documents.costs');
  // Provider, Contract start/end, Discount ends, Attachments
  const detailsCount = (isRecurring ? 4 : 0) + (docsLinked ? 1 : 0);
  const canSave = form.name.trim().length > 0 && form.amount != null && Number.isFinite(form.amount);

  const save = () => {
    if (!canSave) return;

    const saved = costRowFromForm(form, {
      item,
      groupId,
      priceChange: { from: priceFrom, dollars: newPrice },
      fresh: { id: randomUUID(), createdBy: currentUserId, stamp: null },
    });

    onSave(saved);
    onClose();

    // Hearth E1-E4/M3: reminder sync is a side-effect of the committed save,
    // and remains fire-and-forget so the local write is never blocked offline.
    if (costNeedsReminderSync(saved, item)) {
      try {
        void syncCostReminders(saved, getCurrentSupabaseClient()).catch(() => {});
      } catch {
        // Client may not be bound during cold boot; the local cost save stands.
      }
    }
  };

  const previewContent = item ? (
    <>
      <CategoryChip category={form.category} />
      <Text numberOfLines={1} className="min-w-0 flex-1 font-heading text-title font-semibold text-foreground">
        {form.name || 'Edit cost'}
      </Text>
      <Text className="shrink-0 text-sm font-semibold text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
        {form.is_estimate ? '~' : ''}
        {form.amount != null ? `${currencySymbol()}${form.amount.toFixed(2)}` : `${currencySymbol()}0.00`}
      </Text>
    </>
  ) : undefined;

  return (
    <ItemFormSheet
      section={COSTS_SECTION}
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={item ? 'Edit cost' : 'Add cost'}
      previewContent={previewContent}
      onSubmit={save}
      canSubmit={canSave}
    >
      <FormSection>
        <FieldRow label="Name" required>
          <Input value={form.name} onChangeText={(name) => setForm((f) => ({ ...f, name }))} placeholder="e.g. Rent, Netflix, Internet" autoFocus />
        </FieldRow>

        <FieldRow
          label="Amount"
          action={
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: form.is_estimate }}
              accessibilityLabel="Estimate"
              onPress={() => setForm((f) => ({ ...f, is_estimate: !f.is_estimate }))}
              hitSlop={8}
            >
              <Text className={cn('text-xs font-medium', form.is_estimate ? 'text-primary' : 'text-muted-foreground')}>
                {form.is_estimate ? 'Estimate' : 'Exact'}
              </Text>
            </Pressable>
          }
        >
          <DragNumberField
            value={form.amount}
            onChange={(amount) => setForm((f) => ({ ...f, amount }))}
            step={1}
            min={0}
            precision={2}
            prefix={currencySymbol()}
            placeholder="0.00"
            accessibilityLabel="Amount"
          />
        </FieldRow>

        <FieldRow label="Category">
          <SearchablePicker
            options={categoryPickerOptions}
            value={form.category}
            onChange={(category) => setForm((f) => ({ ...f, category: category as CostCategory }))}
            placeholder="Category..."
            searchPlaceholder="Search..."
            ariaLabel="Category"
          />
        </FieldRow>

        <FieldRow label="Frequency">
          <SegmentedControl
            options={CADENCE_SEGMENTS}
            value={form.cadence}
            onChange={(cadence) => setForm((f) => ({ ...f, cadence }))}
            wrap
            size="sm"
            accessibilityLabel="Frequency"
          />
        </FieldRow>

        <FieldRow label="Notes">
          <Input
            value={form.notes}
            onChangeText={(notes) => setForm((f) => ({ ...f, notes }))}
            placeholder="Any details..."
            multiline
            className="h-20 text-top"
          />
        </FieldRow>
      </FormSection>

      {item?.id ? (
        <CostBankLink
          costItemId={item.id}
          category={form.category as CostCategory}
          amountCents={Math.round((form.amount ?? 0) * 100)}
          estimate={form.is_estimate}
          onAmount={(cents) => setForm((f) => ({ ...f, amount: cents / 100 }))}
          line={item}
          onMerged={onClose}
        />
      ) : null}

      {isRecurring && item?.id && onArchive ? (
        <FormSection title="Price from a date">
          {(item.price_changes ?? []).map((c) => (
            <Text key={c.from} className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
              {formatMoney(c.amount)} from {c.from}
            </Text>
          ))}
          <FieldRow label="New price starts" hint="Earlier months keep the old price.">
            <DateScrollField value={priceFrom} onChange={setPriceFrom} />
          </FieldRow>
          {priceFrom ? (
            <FieldRow label="New price">
              <DragNumberField value={newPrice} onChange={setNewPrice} step={1} min={0} precision={2} prefix={currencySymbol()} placeholder="0.00" accessibilityLabel="New price" />
            </FieldRow>
          ) : null}
        </FormSection>
      ) : null}

      {item?.id && onArchive ? (
        <FormSection>
          <Button
            variant="outline"
            onPress={() => {
              onArchive(item, !item.archived);
              onClose();
            }}
          >
            {item.archived ? 'Bring back' : 'Archive'}
          </Button>
          {!item.archived ? (
            <Text className="text-caption text-muted-foreground">Archived costs still catch their bank payments, but leave every total.</Text>
          ) : null}
        </FormSection>
      ) : null}

      {detailsCount > 0 && (
        <DetailsDisclosure count={detailsCount}>
          {isRecurring && (
            <FormSection title="Contract">
              <FieldRow label="Provider">
                <Input value={form.provider} onChangeText={(provider) => setForm((f) => ({ ...f, provider }))} placeholder="e.g. AGL, Telstra" />
              </FieldRow>

              <FieldRow
                label="Contract start"
                action={
                  form.start_date ? (
                    <Button size="xs" variant="ghost" onPress={() => setForm((f) => ({ ...f, start_date: '' }))}>
                      Clear
                    </Button>
                  ) : undefined
                }
              >
                <DateScrollField value={form.start_date} onChange={(v) => setForm((f) => ({ ...f, start_date: v }))} />
              </FieldRow>

              <FieldRow
                label="Contract end"
                action={
                  form.end_date ? (
                    <Button size="xs" variant="ghost" onPress={() => setForm((f) => ({ ...f, end_date: '' }))}>
                      Clear
                    </Button>
                  ) : undefined
                }
              >
                <DateScrollField value={form.end_date} onChange={(v) => setForm((f) => ({ ...f, end_date: v }))} />
              </FieldRow>

              <FieldRow
                label="Discount / intro-rate ends"
                hint={reminderInTasks ? 'A reminder will appear in Tasks before this date.' : "You'll get a reminder before this date."}
                action={
                  form.discount_end_date ? (
                    <Button size="xs" variant="ghost" onPress={() => setForm((f) => ({ ...f, discount_end_date: '' }))}>
                      Clear
                    </Button>
                  ) : undefined
                }
              >
                <DateScrollField value={form.discount_end_date} onChange={(v) => setForm((f) => ({ ...f, discount_end_date: v }))} />
              </FieldRow>
            </FormSection>
          )}

          {docsLinked && (
            <FormSection>
              <FieldRow label="Attachments">
                {item?.id ? (
                  <CostDocuments costItemId={item.id} groupId={groupId} />
                ) : (
                  <Text className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
                    Save this cost first, then reopen it to attach a bill, receipt or contract.
                  </Text>
                )}
              </FieldRow>
            </FormSection>
          )}
        </DetailsDisclosure>
      )}
    </ItemFormSheet>
  );
}
