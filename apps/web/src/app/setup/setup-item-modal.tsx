'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type SetupItem,
  type SetupStore,
  SETUP_STATUS_LABEL,
  canSaveSetupItemForm,
  currencySymbol,
  isNewSetupRoom,
  setupItemForm,
  setupItemFromForm,
  setupRoomOptions,
} from '@homeup/core';
import { StoreSelect } from '@/components/store-select';
import { ItemFormSheet, FormSection, FieldRow, DetailsDisclosure } from '@/components/ui/item-form-sheet';
import { DragNumberField } from '@/components/ui/drag-number-field';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { PrioritySlider, type Priority } from '@/components/ui/priority-slider';
import { SearchablePicker, type PickerOption } from '@/components/ui/searchable-picker';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { STATUS_TEXT } from './setup-status';
import { sectionIconFor } from '@/lib/section-icons';

// Hearth v2 (E1): the sheet header wears the section's identity tile.
const SETUP_SECTION = { id: 'setup', Icon: sectionIconFor('setup') };

interface SetupItemModalProps {
  isOpen: boolean;
  item?: SetupItem;
  groupId: string;
  existingRooms?: string[];
  stores?: SetupStore[];
  defaultRoom?: string;
  onClose: () => void;
  onSave: (item: SetupItem) => void;
  onDelete?: (itemId: string) => void;
  onStoreCreated?: (store: SetupStore) => void;
}


const STATUS_OPTIONS = [
  { value: 'needed' as const, label: 'Needed' },
  { value: 'installed' as const, label: 'Got it' },
];

export function SetupItemModal({ isOpen, item, groupId, existingRooms = [], stores = [], defaultRoom = '', onClose, onSave, onDelete, onStoreCreated }: SetupItemModalProps) {
  const buildInitialForm = useCallback(() => setupItemForm(item, defaultRoom), [item, defaultRoom]);
  const [formData, setFormData] = useState(buildInitialForm);

  // Merge default rooms with any custom rooms already in use (single room per item).
  const roomOptions = useMemo<PickerOption[]>(() => {
    return setupRoomOptions(existingRooms).map((r) => ({ value: r, primary: r }));
  }, [existingRooms]);

  // Track whether the user is entering a brand-new room name.
  const [addingNewRoom, setAddingNewRoom] = useState(() => isNewSetupRoom(item?.room, setupRoomOptions(existingRooms)));

  // FLUX-186: instance is reused across opens (stable `key` for blank adds), so
  // re-seed the form on every closed→open transition — otherwise adding a second
  // item pre-fills the one you just added.
  const wasOpen = useRef(isOpen);
  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      setFormData(buildInitialForm());
      setAddingNewRoom(isNewSetupRoom(item?.room, roomOptions.map((o) => o.value)));
    }
    wasOpen.current = isOpen;
  }, [isOpen, buildInitialForm, item, roomOptions]);

  const handleSubmit = () => {
    if (!canSaveSetupItemForm(formData)) return;
    // Offline-safe: build the row and hand it to onSave (→ writeRow), which
    // writes to IndexedDB and syncs. No direct Supabase here. writeRow stamps
    // created_by/timestamps for new rows.
    onSave(setupItemFromForm(formData, item, groupId));
    onClose();
  };

  const handleDelete = () => {
    if (!item?.id || !onDelete) return;
    // Offline-safe soft delete via the store (onDelete → softDeleteRow).
    onDelete(item.id);
    onClose();
  };

  return (
    <ItemFormSheet
      section={SETUP_SECTION}
      isOpen={isOpen}
      onClose={onClose}
      title={item ? 'Edit item' : 'Add setup item'}
      previewContent={
        item ? (
          <>
            <span className="min-w-0 flex-1 truncate font-heading text-base font-semibold text-foreground">
              {formData.name || 'Untitled item'}
            </span>
            {/* E1: one caption of facts, room · status. H2: the status is a
                tinted word, not a filled resting-state pill. */}
            <span className="flex min-w-0 shrink-0 items-center text-xs text-muted-foreground">
              {formData.room && (
                <>
                  <span className="max-w-24 truncate">{formData.room}</span>
                  <span aria-hidden className="px-1">·</span>
                </>
              )}
              <span className={cn('font-medium', STATUS_TEXT[formData.status])}>{SETUP_STATUS_LABEL[formData.status]}</span>
            </span>
          </>
        ) : undefined
      }
      onSubmit={handleSubmit}
      canSubmit={!!formData.name.trim() && !!formData.room.trim()}
      onDelete={item && onDelete ? handleDelete : undefined}
      deleteConfirmTitle="Delete this item?"
    >
      <FormSection>
        <FieldRow label="Name" htmlFor="setup-name" required>
          <Input
            id="setup-name"
            autoFocus
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g., King bed frame"
          />
        </FieldRow>

        {/* Room — a single room per item; a new room can be created inline. */}
        <FieldRow
          label="Room"
          required
          action={
            addingNewRoom ? (
              <button
                type="button"
                onClick={() => {
                  setAddingNewRoom(false);
                  setFormData({ ...formData, room: '' });
                }}
                className="text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Choose existing
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAddingNewRoom(true);
                  setFormData({ ...formData, room: '' });
                }}
                className="text-xs font-medium text-primary hover:underline"
              >
                + New room
              </button>
            )
          }
        >
          {addingNewRoom ? (
            <Input
              autoFocus
              value={formData.room}
              onChange={(e) => setFormData({ ...formData, room: e.target.value })}
              placeholder="New room name"
            />
          ) : (
            <SearchablePicker
              options={roomOptions}
              value={formData.room || null}
              onChange={(room) => setFormData({ ...formData, room })}
              placeholder="Select a room…"
              searchPlaceholder="Search rooms…"
              ariaLabel="Room"
            />
          )}
        </FieldRow>

        <FieldRow label="Status">
          <SegmentedControl
            options={STATUS_OPTIONS}
            value={formData.status}
            onChange={(status) => setFormData({ ...formData, status })}
            wrap
            size="sm"
            ariaLabel="Status"
          />
        </FieldRow>

        <FieldRow label="Priority">
          <PrioritySlider
            value={formData.priority}
            onChange={(priority) => setFormData({ ...formData, priority })}
            ariaLabel="Priority"
          />
        </FieldRow>
      </FormSection>

      <DetailsDisclosure count={5}>
        <FormSection title="Purchase">
          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Est. price">
              <DragNumberField
                value={formData.est_price}
                onChange={(est_price) => setFormData({ ...formData, est_price })}
                step={1}
                min={0}
                precision={2}
                prefix={currencySymbol()}
                placeholder="0.00"
                ariaLabel="Estimated price"
              />
            </FieldRow>
            <FieldRow label="Actual price">
              <DragNumberField
                value={formData.actual_price}
                onChange={(actual_price) => setFormData({ ...formData, actual_price })}
                step={1}
                min={0}
                precision={2}
                prefix={currencySymbol()}
                placeholder="0.00"
                ariaLabel="Actual price"
              />
            </FieldRow>
          </div>

          <FieldRow label="Store">
            <StoreSelect
              groupId={groupId}
              value={formData.store_id}
              stores={stores}
              variant="full"
              onChange={(storeId) => setFormData({ ...formData, store_id: storeId })}
              onStoreCreated={onStoreCreated}
            />
          </FieldRow>

          <FieldRow label="URL">
            <Input
              type="url"
              value={formData.url}
              onChange={(e) => setFormData({ ...formData, url: e.target.value })}
              placeholder="https://..."
            />
          </FieldRow>
        </FormSection>

        <FormSection>
          <FieldRow label="Notes">
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 placeholder:text-muted-foreground"
              placeholder="Any additional details..."
              rows={3}
            />
          </FieldRow>
        </FormSection>
      </DetailsDisclosure>
    </ItemFormSheet>
  );
}
