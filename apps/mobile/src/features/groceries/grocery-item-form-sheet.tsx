// HOUP-80: native add/edit sheet for a grocery item. Faithful-but-focused
// port of apps/web/src/app/groceries/grocery-item-modal.tsx — built on the
// same ItemFormSheet + SearchablePicker primitives the web modal already
// uses (packages/ui's native ports have matching prop shapes). HOUP-192:
// qty/price now use the native `DragNumberField` port (pointer-drag scrub +
// tap-to-type), matching web and the task/recipe modals. The web modal's
// `<input type="date">` becomes `DateScrollField` (the shared in-sheet date
// picker apps/mobile already uses elsewhere, e.g. document-edit-sheet.tsx)
// since this sheet is itself a BottomSheet and can't nest another one.
import * as React from 'react';
import { View } from 'react-native';
import { Star } from 'lucide-react-native';
import {
  Text,
  ItemFormSheet,
  FormSection,
  FieldRow,
  DetailsDisclosure,
  Input,
  SearchablePicker,
  SegmentedControl,
  DateScrollField,
  DragNumberField,
  Button,
  cn,
  type PickerOption,
  GroceryGlyph,
} from '@homeup/ui';
import {
  AISLE_ORDER,
  clearRecipeNoteOnLeaveNeeded,
  formatMoney,
  getAisleMeta,
  getGroceryEmoji,
  resolveItemDefaults,
  type GroceryCustomAisle,
  type GroceryItem,
  type LibraryOverride,
  currencySymbol,
} from '@homeup/core';
import { randomUUID } from '@/lib/uuid';

// FLUX-182/HOUP-227: display Need / Have / Got mapped onto the existing enum.
const STATUS_OPTIONS = [
  { value: 'needed' as const, label: 'Need' },
  { value: 'have' as const, label: 'Have' },
  { value: 'bought' as const, label: 'Got' },
];

interface GroceryItemFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: GroceryItem;
  groupId: string;
  currentUserId: string | null;
  /** HOUP-147: pre-fill a new item's name (global search "Add as…"). Ignored when `item` is set (editing). */
  defaultName?: string;
  defaultAisle?: string;
  customAisles?: GroceryCustomAisle[];
  /** HOUP-227: per-aisle default unit; swaps the unit when the aisle changes on a new item. */
  aisleUnits?: Record<string, string>;
  libMap?: Map<string, LibraryOverride>;
  memberProfiles?: Record<string, { email: string; name: string | null; avatar: string | null }>;
  onSave: (item: GroceryItem) => void;
  onDelete?: (item: GroceryItem) => void;
}

export function GroceryItemFormSheet({
  open,
  onOpenChange,
  item,
  groupId,
  currentUserId,
  defaultName,
  defaultAisle,
  customAisles,
  aisleUnits,
  libMap,
  memberProfiles,
  onSave,
  onDelete,
}: GroceryItemFormSheetProps) {
  const [name, setName] = React.useState(item?.name ?? defaultName ?? '');
  const [aisle, setAisle] = React.useState(item?.aisle ?? defaultAisle ?? 'other');
  const [status, setStatus] = React.useState<GroceryItem['status']>(item?.status ?? 'needed');
  const [quantity, setQuantity] = React.useState<number | null>(item?.quantity ?? null);
  const [unit, setUnit] = React.useState(item?.unit ?? (item ? '' : aisleUnits?.[defaultAisle ?? 'other'] ?? ''));
  const [priceDollars, setPriceDollars] = React.useState<number | null>(item?.price_cents != null ? item.price_cents / 100 : null);
  const [shelfLifeDays, setShelfLifeDays] = React.useState(item?.shelf_life_days != null ? String(item.shelf_life_days) : '');
  const [expiryDate, setExpiryDate] = React.useState(item?.expiry_date ?? '');
  const [notes, setNotes] = React.useState(item?.notes ?? '');
  const [assignedTo, setAssignedTo] = React.useState<string | null>(item?.assigned_to ?? null);
  const [essential, setEssential] = React.useState(item?.is_essential ?? false);

  const wasOpen = React.useRef(open);
  React.useEffect(() => {
    if (open && !wasOpen.current) {
      setName(item?.name ?? '');
      setAisle(item?.aisle ?? defaultAisle ?? 'other');
      setStatus(item?.status ?? 'needed');
      setQuantity(item?.quantity ?? null);
      setUnit(item?.unit ?? (item ? '' : aisleUnits?.[defaultAisle ?? 'other'] ?? ''));
      setPriceDollars(item?.price_cents != null ? item.price_cents / 100 : null);
      setShelfLifeDays(item?.shelf_life_days != null ? String(item.shelf_life_days) : '');
      setExpiryDate(item?.expiry_date ?? '');
      setNotes(item?.notes ?? '');
      setAssignedTo(item?.assigned_to ?? null);
      setEssential(item?.is_essential ?? false);
    }
    wasOpen.current = open;
  }, [open, item, defaultAisle, aisleUnits]);

  const aisleOptions = React.useMemo<PickerOption[]>(
    () => [
      ...AISLE_ORDER.map((a) => ({ value: a, primary: getAisleMeta(a).label })),
      ...(customAisles ?? []).map((a) => ({ value: a.name, primary: a.name })),
    ],
    [customAisles]
  );

  const assigneeOptions = React.useMemo<PickerOption[]>(
    () =>
      Object.entries(memberProfiles ?? {}).map(([id, p]) => ({
        value: id,
        primary: p.name || p.email || 'Member',
      })),
    [memberProfiles]
  );

  const canSubmit = name.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const trimmedName = name.trim();
    const defaults = resolveItemDefaults(trimmedName, libMap);
    const cents = priceDollars != null ? Math.round(priceDollars * 100) : (item?.price_cents ?? defaults.priceCents);
    const now = new Date().toISOString();
    const saved: GroceryItem = {
      id: item?.id ?? randomUUID(),
      group_id: groupId,
      name: trimmedName,
      aisle,
      quantity,
      unit: unit.trim() || null,
      status,
      notes: notes.trim() || null,
      assigned_to: assignedTo,
      private: item?.private ?? false,
      template_key: item?.template_key ?? null,
      sort_order: item?.sort_order ?? 0,
      created_by: item?.created_by ?? currentUserId,
      updated_by: currentUserId,
      created_at: item?.created_at ?? (null as unknown as string),
      updated_at: item?.updated_at ?? (null as unknown as string),
      deleted: false,
      recurrence_days: item?.recurrence_days ?? null,
      status_changed_at: item && status !== item.status ? now : (item?.status_changed_at ?? now),
      last_purchased_at: item?.last_purchased_at ?? null,
      last_price: item?.last_price ?? null,
      lowest_price: item?.lowest_price ?? null,
      expiry_date: expiryDate || null,
      shelf_life_days: shelfLifeDays.trim() === '' ? null : Number(shelfLifeDays),
      price_cents: cents ?? null,
      is_essential: essential,
      recipe_note: item?.recipe_note ?? null,
      recipe_source_id: item?.recipe_source_id ?? null,
      re_add_snoozed_until: item?.re_add_snoozed_until ?? null,
      re_add_dismissed_at: item?.re_add_dismissed_at ?? null,
      // FLUX-189: leaving 'needed' clears the ephemeral recipe note (never `notes`).
      ...clearRecipeNoteOnLeaveNeeded(status),
    };
    onSave(saved);
    onOpenChange(false);
  };

  const headerEmoji = getGroceryEmoji(name || 'item', aisle);

  // HOUP-227: live preview header (emoji + name + price + Essential star),
  // matching web grocery-item-modal.tsx:169-195. Only shown editing an
  // existing item — a brand-new item keeps the plain icon/title header
  // (nothing yet to preview), and its Essential toggle stays as a regular
  // field row below (web drops that ability entirely for new items; mobile
  // keeps it rather than regressing an existing capability).
  const previewContent = item ? (
    <>
      <GroceryGlyph emoji={headerEmoji} size={20} />
      <Text numberOfLines={1} className="min-w-0 flex-1 text-sm font-medium text-foreground">
        {name || 'Edit item'}
      </Text>
      {priceDollars != null && (
        <Text className="shrink-0 text-sm font-medium text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
          {formatMoney(Math.round(priceDollars * 100))}
        </Text>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        accessibilityRole="switch"
        accessibilityState={{ checked: essential }}
        accessibilityLabel={essential ? 'Essential' : 'Mark as essential'}
        onPress={() => setEssential((e) => !e)}
        className="shrink-0"
      >
        <Star size={16} className={cn(essential ? 'text-warning fill-current' : 'text-muted-foreground')} />
      </Button>
    </>
  ) : undefined;

  return (
    <ItemFormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={item ? 'Edit item' : 'Add item'}
      icon={<GroceryGlyph emoji={headerEmoji} size={24} />}
      previewContent={previewContent}
      onSubmit={handleSubmit}
      canSubmit={canSubmit}
      onDelete={item && onDelete ? () => onDelete(item) : undefined}
      deleteLabel="Archive"
      deleteConfirmTitle={item ? `Archive "${item.name}"?` : undefined}
      deleteConfirmMessage="Removes it from the list. You can undo from the toast that appears."
    >
      <FormSection>
        <FieldRow label="Name" required>
          <Input
            autoFocus
            value={name}
            onChangeText={(text) => {
              setName(text);
              // HOUP-227: auto-fill shelf life + typical price from the item
              // library while typing, not just at submit — matches web
              // grocery-item-modal.tsx:216-224.
              if (text.length > 2 && (shelfLifeDays.trim() === '' || priceDollars == null)) {
                const { days, priceCents } = resolveItemDefaults(text, libMap);
                if (shelfLifeDays.trim() === '' && days) setShelfLifeDays(String(days));
                if (priceDollars == null && priceCents != null) setPriceDollars(priceCents / 100);
              }
            }}
            placeholder="e.g. Milk"
          />
        </FieldRow>
        {/* Stacked (web parity): Need / Have / Got overflowed a half-width
            cell at 390px. */}
        <FieldRow label="Status">
          <SegmentedControl options={STATUS_OPTIONS} value={status} onChange={setStatus} accessibilityLabel="Status" />
        </FieldRow>
        <FieldRow label="Aisle">
          <SearchablePicker
            options={aisleOptions}
            value={aisle}
            onChange={(nextAisle) => {
              // HOUP-227: for new items, swap in the new aisle's default
              // unit when the unit is empty or still matches the previous
              // aisle's default — verbatim web grocery-item-modal.tsx:244-252.
              const prevDefault = aisleUnits?.[aisle] ?? '';
              if (!item && (unit === '' || unit === prevDefault)) {
                setUnit(aisleUnits?.[nextAisle] ?? unit);
              }
              setAisle(nextAisle);
            }}
            placeholder="Aisle"
            searchPlaceholder="Search aisles…"
            ariaLabel="Aisle"
          />
        </FieldRow>
        <View className="flex-row gap-2">
          <FieldRow label="Quantity" className="flex-1">
            <DragNumberField
              value={quantity}
              onChange={setQuantity}
              step={1}
              min={0}
              precision={2}
              trimTrailingZeros
              placeholder="1"
              accessibilityLabel="Quantity"
            />
          </FieldRow>
          <FieldRow label="Est. price" className="flex-1" hint="Used for the total estimate">
            <DragNumberField
              value={priceDollars}
              onChange={setPriceDollars}
              step={0.5}
              min={0}
              precision={2}
              prefix={currencySymbol()}
              placeholder="0.00"
              accessibilityLabel="Estimated price"
            />
          </FieldRow>
          <FieldRow label="Shelf life" className="flex-1" hint="Days">
            <Input keyboardType="number-pad" value={shelfLifeDays} onChangeText={setShelfLifeDays} placeholder="–" />
          </FieldRow>
        </View>
        {assigneeOptions.length > 0 && (
          <FieldRow label="Assigned to" action={assignedTo && <Button size="sm" variant="ghost" onPress={() => setAssignedTo(null)}>Clear</Button>}>
            <SearchablePicker
              options={assigneeOptions}
              value={assignedTo}
              onChange={setAssignedTo}
              placeholder="Unassigned"
              searchPlaceholder="Search members…"
              ariaLabel="Assigned to"
            />
          </FieldRow>
        )}
        {!item && (
          <FieldRow label="Essential" hint="Pinned to the Home hub while needed">
            <Button size="sm" variant={essential ? 'default' : 'outline'} onPress={() => setEssential((e) => !e)}>
              {essential ? 'Yes' : 'No'}
            </Button>
          </FieldRow>
        )}
      </FormSection>

      <DetailsDisclosure count={3}>
        <FieldRow label="Unit">
          <Input value={unit} onChangeText={setUnit} placeholder="e.g. kg" />
        </FieldRow>
        <FieldRow
          label="Actual expiry"
          action={expiryDate !== '' && <Button size="xs" variant="ghost" onPress={() => setExpiryDate('')}>Clear</Button>}
        >
          <DateScrollField value={expiryDate} onChange={setExpiryDate} />
        </FieldRow>
        <FieldRow label="Notes">
          <Input value={notes} onChangeText={setNotes} placeholder="Optional" multiline numberOfLines={2} />
        </FieldRow>
      </DetailsDisclosure>
    </ItemFormSheet>
  );
}
