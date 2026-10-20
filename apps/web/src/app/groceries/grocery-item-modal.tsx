'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GroceryItem, GroceryAisle, GroceryCustomAisle } from '@homeup/core';
import { AISLE_META, AISLE_ORDER, getAisleMeta, currencySymbol } from '@homeup/core';
import { clearRecipeNoteOnLeaveNeeded } from '@homeup/core';
import { getGroceryEmoji } from '@homeup/core';
import { GroceryGlyph } from '@/components/grocery-glyph';
import { resolveItemDefaults, type LibraryOverride } from '@homeup/core';
import { formatMoney } from '@homeup/core';
import { ItemFormSheet, FormSection, FieldRow, DetailsDisclosure } from '@/components/ui/item-form-sheet';
import { DragNumberField } from '@/components/ui/drag-number-field';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SearchablePicker, type PickerOption } from '@/components/ui/searchable-picker';
import { Input } from '@/components/ui/input';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

interface GroceryItemModalProps {
  isOpen: boolean;
  item?: GroceryItem;
  groupId: string;
  defaultAisle?: string;
  customAisles?: GroceryCustomAisle[];
  library?: Map<string, LibraryOverride>;
  /** FLUX-65: per-aisle default unit; prefills the unit for new items. */
  aisleUnits?: Record<string, string>;
  /** Pre-fill the name for new items (ignored when `item` is provided). */
  defaultName?: string;
  onClose: () => void;
  onSave: (item: GroceryItem) => void;
  /** FLUX-234: when provided (edit mode), an Archive button replaces the missing
   *  delete action — learns the item to the library, then removes it (same
   *  semantics as the row card's Archive, see `page.tsx`'s `handleArchive`). */
  onArchive?: (item: GroceryItem) => void;
}

// FLUX-182: display Need / Have / Got mapped onto the existing enum.
const STATUS_OPTIONS = [
  { value: 'needed' as const, label: 'Need' },
  { value: 'have' as const, label: 'Have' },
  { value: 'bought' as const, label: 'Got' },
];

export function GroceryItemModal({
  isOpen,
  item,
  groupId,
  defaultAisle = 'other',
  customAisles,
  library,
  aisleUnits,
  defaultName,
  onClose,
  onSave,
  onArchive,
}: GroceryItemModalProps) {
  const buildInitialForm = useCallback(
    () => ({
      name: item?.name ?? defaultName ?? '',
      aisle: (item?.aisle ?? defaultAisle) as string,
      status: (item?.status ?? 'needed') as GroceryItem['status'],
      quantity: item?.quantity ?? null,
      unit: item?.unit ?? (item ? '' : aisleUnits?.[defaultAisle] ?? ''),
      notes: item?.notes ?? '',
      price_dollars: item?.price_cents != null ? item.price_cents / 100 : null,
      shelf_life_days: item?.shelf_life_days ?? null,
      expiry_date: item?.expiry_date ?? '',
      // FLUX-185: pin as an essential grocery (always shows on Home when needed).
      is_essential: item?.is_essential ?? false,
    }),
    [item, defaultName, defaultAisle, aisleUnits],
  );
  const [form, setForm] = useState(buildInitialForm);
  const [saving, setSaving] = useState(false);

  // FLUX-186: the modal instance is reused across opens (its `key` is stable for
  // blank adds), so re-seed the form every time it transitions closed→open —
  // otherwise a second "add" pre-fills the item you just added.
  const wasOpen = useRef(isOpen);
  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      setForm(buildInitialForm());
      setSaving(false);
    }
    wasOpen.current = isOpen;
  }, [isOpen, buildInitialForm]);

  // Aisle picker options: built-in aisles + any custom aisles.
  const aisleOptions = useMemo<PickerOption[]>(() => {
    const builtins = AISLE_ORDER.map((a) => ({
      value: a,
      primary: AISLE_META[a as GroceryAisle].label,
    }));
    const custom = (customAisles ?? []).map((a) => ({ value: a.name, primary: a.name }));
    return [...builtins, ...custom];
  }, [customAisles]);

  const handleSubmit = () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      // Persistence is delegated to the page's Legend-State store (FLUX-149):
      // build the full item and hand it up — local-first, works offline.
      const patch = {
        name: form.name.trim(),
        aisle: form.aisle,
        status: form.status,
        quantity: form.quantity,
        unit: form.unit.trim() || null,
        notes: form.notes.trim() || null,
        price_cents: form.price_dollars != null ? Math.round(form.price_dollars * 100) : null,
        shelf_life_days: form.shelf_life_days,
        expiry_date: form.expiry_date || null,
        is_essential: form.is_essential,
      };

      let saved: GroceryItem;
      if (item) {
        saved = {
          ...item,
          ...patch,
          status_changed_at:
            patch.status !== item.status ? new Date().toISOString() : item.status_changed_at,
          // FLUX-189: leaving 'needed' clears the ephemeral recipe note (never `notes`).
          ...clearRecipeNoteOnLeaveNeeded(patch.status),
        };
      } else {
        const now = new Date().toISOString();
        saved = {
          id: crypto.randomUUID(),
          group_id: groupId,
          ...patch,
          assigned_to: null,
          private: false,
          template_key: null,
          sort_order: 0,
          created_by: null, // page stamps from the active user on create
          updated_by: null,
          created_at: now,
          updated_at: now,
          deleted: false,
          recurrence_days: null,
          status_changed_at: now,
          last_purchased_at: null,
          last_price: null,
          lowest_price: null,
          recipe_note: null,
          recipe_source_id: null,
          re_add_snoozed_until: null,
          re_add_dismissed_at: null,
        };
      }

      onSave(saved);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const emoji = form.name
    ? getGroceryEmoji(form.name, form.aisle)
    : getAisleMeta(form.aisle, customAisles).icon;
  const headerEmoji = typeof emoji === 'string' && emoji.length <= 4 ? emoji : '🛒';

  // FLUX-234: live preview header (emoji + name + price), same pattern as the
  // row card's PopMenu previewContent — plus the Essential star, relocated here
  // from the field list. Only shown editing an existing item; a brand-new item
  // keeps the plain icon/title header (nothing yet to preview).
  const previewContent = item ? (
    <>
      <GroceryGlyph emoji={headerEmoji} size={20} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        {form.name || 'Edit item'}
      </span>
      {form.price_dollars != null && (
        <span className="shrink-0 text-sm font-medium tabular-nums text-muted-foreground">
          {formatMoney(Math.round(form.price_dollars * 100))}
        </span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={form.is_essential}
        aria-label={form.is_essential ? 'Essential' : 'Mark as essential'}
        title={form.is_essential ? 'Essential' : 'Mark as essential'}
        onClick={() => setForm({ ...form, is_essential: !form.is_essential })}
        className={cn(
          'shrink-0 rounded-full p-1 transition-colors',
          form.is_essential ? 'text-warning' : 'text-muted-foreground hover:text-warning/80'
        )}
      >
        <Star className={cn('h-4 w-4', form.is_essential && 'fill-current')} />
      </button>
    </>
  ) : undefined;

  return (
    <ItemFormSheet
      isOpen={isOpen}
      onClose={onClose}
      title={item ? 'Edit item' : 'Add grocery'}
      icon={<GroceryGlyph emoji={headerEmoji} size={24} />}
      previewContent={previewContent}
      onSubmit={handleSubmit}
      canSubmit={!!form.name.trim()}
      saving={saving}
      onDelete={item && onArchive ? () => onArchive(item) : undefined}
      deleteLabel="Archive"
    >
      <FormSection>
        <FieldRow label="Name" htmlFor="grocery-name" required>
          <Input
            id="grocery-name"
            autoFocus
            value={form.name}
            onChange={(e) => {
              const name = e.target.value;
              const updates: Partial<typeof form> = { name };
              // Auto-fill shelf life + typical price from the item library if empty.
              if (name.length > 2 && (form.shelf_life_days == null || form.price_dollars == null)) {
                const { days, priceCents } = resolveItemDefaults(name, library);
                if (form.shelf_life_days == null && days) updates.shelf_life_days = days;
                if (form.price_dollars == null && priceCents != null) updates.price_dollars = priceCents / 100;
              }
              setForm({ ...form, ...updates });
            }}
            placeholder="e.g., Milk"
          />
        </FieldRow>

        {/* Stacked on phones: Need / Have / Got overflowed its half-width
            cell at 390px. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FieldRow label="Status">
            <SegmentedControl
              options={STATUS_OPTIONS}
              value={form.status}
              onChange={(status) => setForm({ ...form, status })}
              ariaLabel="Status"
            />
          </FieldRow>
          <FieldRow label="Aisle">
            <SearchablePicker
              options={aisleOptions}
              value={form.aisle}
              onChange={(aisle) => {
                // For new items, swap in the new aisle's default unit when the unit
                // is empty or still matches the previous aisle's default.
                const prevDefault = aisleUnits?.[form.aisle] ?? '';
                const nextUnit =
                  !item && (form.unit === '' || form.unit === prevDefault)
                    ? aisleUnits?.[aisle] ?? form.unit
                    : form.unit;
                setForm({ ...form, aisle, unit: nextUnit });
              }}
              placeholder="Choose an aisle…"
              searchPlaceholder="Search aisles…"
              ariaLabel="Aisle"
            />
          </FieldRow>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <FieldRow label="Qty">
            <DragNumberField
              value={form.quantity}
              onChange={(quantity) => setForm({ ...form, quantity })}
              step={1}
              min={0}
              precision={2}
              trimTrailingZeros
              placeholder="–"
              ariaLabel="Quantity"
            />
          </FieldRow>
          <FieldRow label="Price">
            <DragNumberField
              value={form.price_dollars}
              onChange={(price_dollars) => setForm({ ...form, price_dollars })}
              step={0.5}
              min={0}
              precision={2}
              prefix={currencySymbol()}
              placeholder="–"
              ariaLabel="Price"
            />
          </FieldRow>
          <FieldRow label="Shelf life">
            <DragNumberField
              value={form.shelf_life_days}
              onChange={(shelf_life_days) => setForm({ ...form, shelf_life_days })}
              step={1}
              min={0}
              precision={0}
              suffix="days"
              placeholder="–"
              ariaLabel="Estimated shelf life in days"
            />
          </FieldRow>
        </div>
      </FormSection>

      <DetailsDisclosure count={3}>
        <FieldRow label="Unit">
          <Input
            value={form.unit}
            onChange={(e) => setForm({ ...form, unit: e.target.value })}
            placeholder="kg, L, pack…"
          />
        </FieldRow>

        <FieldRow label="Actual expiry">
          <Input
            type="date"
            value={form.expiry_date}
            onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
          />
        </FieldRow>

        <FieldRow label="Notes">
          <Input
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Brand, size, any details…"
          />
        </FieldRow>
      </DetailsDisclosure>
    </ItemFormSheet>
  );
}
