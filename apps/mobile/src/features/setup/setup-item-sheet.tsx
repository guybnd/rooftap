// HOUP-88: native add/edit sheet for a setup item. Port of
// apps/web/src/app/setup/setup-item-modal.tsx onto the native ItemFormSheet
// (already shared — this is largely an import swap). One web-only widget
// still has no native port: PrioritySlider -> SegmentedControl over
// low/medium/high. HOUP-192: est./actual price now use the native
// `DragNumberField` port (pointer-drag scrub + tap-to-type), matching web.
import * as React from 'react';
import { Pressable, TextInput, View } from 'react-native';
import {
  Text,
  ItemFormSheet,
  FormSection,
  FieldRow,
  DetailsDisclosure,
  Input,
  SegmentedControl,
  SearchablePicker,
  DragNumberField,
  cn,
  type PickerOption,
} from '@homeup/ui';
import { STATUS_TEXT } from './setup-status';
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
import { StoreSelect } from './store-select';
import { sectionIconFor } from '@/lib/section-icons';

// Hearth v2 (E1): the sheet header wears the section's identity tile.
const SETUP_SECTION = { id: 'setup', Icon: sectionIconFor('setup') };

interface SetupItemSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: SetupItem;
  groupId: string;
  existingRooms?: string[];
  stores?: SetupStore[];
  defaultRoom?: string;
  onSave: (item: SetupItem) => void;
  onDelete?: (itemId: string) => void;
  onStoreCreated?: (store: SetupStore) => void;
}


const STATUS_OPTIONS = [
  { value: 'needed' as const, label: 'Needed' },
  { value: 'installed' as const, label: 'Got it' },
];

const PRIORITY_OPTIONS = [
  { value: 'low' as const, label: 'Low' },
  { value: 'medium' as const, label: 'Medium' },
  { value: 'high' as const, label: 'High' },
];

export function SetupItemSheet({
  open,
  onOpenChange,
  item,
  groupId,
  existingRooms = [],
  stores = [],
  defaultRoom = '',
  onSave,
  onDelete,
  onStoreCreated,
}: SetupItemSheetProps) {
  const [form, setForm] = React.useState(() => setupItemForm(item, defaultRoom));

  const roomOptions = React.useMemo<PickerOption[]>(() => {
    return setupRoomOptions(existingRooms).map((r) => ({ value: r, primary: r }));
  }, [existingRooms]);

  const [addingNewRoom, setAddingNewRoom] = React.useState(() => isNewSetupRoom(item?.room, setupRoomOptions(existingRooms)));

  // Instance is reused across opens (stable `key` for blank adds) — re-seed
  // on every closed->open transition (FLUX-186 idiom, mirrors web).
  const wasOpen = React.useRef(open);
  React.useEffect(() => {
    if (open && !wasOpen.current) {
      setForm(setupItemForm(item, defaultRoom));
      setAddingNewRoom(isNewSetupRoom(item?.room, roomOptions.map((o) => o.value)));
    }
    wasOpen.current = open;
  }, [open, item, defaultRoom, roomOptions]);

  const canSubmit = canSaveSetupItemForm(form);

  const handleSubmit = () => {
    if (!canSubmit) return;
    // Offline-safe: build the row and hand it to onSave (-> writeRow), which
    // writes to the local store and syncs. No direct Supabase call here.
    const saved = setupItemFromForm(form, item, groupId);
    onSave(saved);
    onOpenChange(false);
  };

  const handleDelete = () => {
    if (!item?.id || !onDelete) return;
    onDelete(item.id);
    onOpenChange(false);
  };

  return (
    <ItemFormSheet
      section={SETUP_SECTION}
      open={open}
      onOpenChange={onOpenChange}
      title={item ? 'Edit item' : 'Add setup item'}
      onSubmit={handleSubmit}
      canSubmit={canSubmit}
      onDelete={item && onDelete ? handleDelete : undefined}
      deleteConfirmTitle={item ? `Delete "${item.name}"?` : undefined}
      previewContent={
        item ? (
          <>
            <Text numberOfLines={1} className="min-w-0 flex-1 font-heading text-title font-semibold text-foreground">
              {form.name || 'Untitled item'}
            </Text>
            {/* E1: one caption of facts, room · status. H2: the status is a
                tinted word, not a filled resting-state pill (mirrors web). */}
            <Text numberOfLines={1} className="shrink-0 max-w-40 text-caption text-muted-foreground">
              {form.room ? `${form.room} · ` : ''}
              <Text className={cn('text-caption font-medium', STATUS_TEXT[form.status])}>{SETUP_STATUS_LABEL[form.status]}</Text>
            </Text>
          </>
        ) : undefined
      }
    >
      <FormSection>
        <FieldRow label="Name" required>
          <Input autoFocus value={form.name} onChangeText={(name) => setForm((f) => ({ ...f, name }))} placeholder="e.g., King bed frame" />
        </FieldRow>

        <FieldRow
          label="Room"
          required
          action={
            addingNewRoom ? (
              <Pressable
                onPress={() => {
                  setAddingNewRoom(false);
                  setForm((f) => ({ ...f, room: '' }));
                }}
                hitSlop={6}
              >
                <Text className="text-xs font-medium text-muted-foreground">Choose existing</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => {
                  setAddingNewRoom(true);
                  setForm((f) => ({ ...f, room: '' }));
                }}
                hitSlop={6}
              >
                <Text className="text-xs font-medium text-primary">+ New room</Text>
              </Pressable>
            )
          }
        >
          {addingNewRoom ? (
            <Input
              autoFocus
              value={form.room}
              onChangeText={(room) => setForm((f) => ({ ...f, room }))}
              placeholder="New room name"
            />
          ) : (
            <SearchablePicker
              options={roomOptions}
              value={form.room || null}
              onChange={(room) => setForm((f) => ({ ...f, room }))}
              placeholder="Select a room…"
              searchPlaceholder="Search rooms…"
              ariaLabel="Room"
            />
          )}
        </FieldRow>

        <FieldRow label="Status">
          <SegmentedControl options={STATUS_OPTIONS} value={form.status} onChange={(status) => setForm((f) => ({ ...f, status }))} wrap size="sm" accessibilityLabel="Status" />
        </FieldRow>

        <FieldRow label="Priority">
          <SegmentedControl options={PRIORITY_OPTIONS} value={form.priority} onChange={(priority) => setForm((f) => ({ ...f, priority }))} wrap size="sm" accessibilityLabel="Priority" />
        </FieldRow>
      </FormSection>

      <DetailsDisclosure count={5}>
        <FormSection title="Purchase">
          <View className="flex-row gap-3">
            <FieldRow label="Est. price" className="flex-1">
              <DragNumberField
                value={form.est_price}
                onChange={(est_price) => setForm((f) => ({ ...f, est_price }))}
                step={1}
                min={0}
                precision={2}
                prefix={currencySymbol()}
                placeholder="0.00"
                accessibilityLabel="Estimated price"
              />
            </FieldRow>
            <FieldRow label="Actual price" className="flex-1">
              <DragNumberField
                value={form.actual_price}
                onChange={(actual_price) => setForm((f) => ({ ...f, actual_price }))}
                step={1}
                min={0}
                precision={2}
                prefix={currencySymbol()}
                placeholder="0.00"
                accessibilityLabel="Actual price"
              />
            </FieldRow>
          </View>

          <FieldRow label="Store">
            <StoreSelect groupId={groupId} value={form.store_id} stores={stores} onChange={(store_id) => setForm((f) => ({ ...f, store_id }))} onStoreCreated={onStoreCreated} />
          </FieldRow>

          <FieldRow label="URL">
            <Input
              value={form.url}
              onChangeText={(url) => setForm((f) => ({ ...f, url }))}
              placeholder="https://..."
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </FieldRow>
        </FormSection>

        <FormSection>
          <FieldRow label="Notes">
            <TextInput
              value={form.notes}
              onChangeText={(notes) => setForm((f) => ({ ...f, notes }))}
              placeholder="Any additional details..."
              multiline
              numberOfLines={3}
              className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-body text-foreground placeholder:text-muted-foreground"
            />
          </FieldRow>
        </FormSection>
      </DetailsDisclosure>
    </ItemFormSheet>
  );
}
