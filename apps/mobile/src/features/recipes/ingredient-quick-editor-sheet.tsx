// HOUP-93: native Recipes — per-ingredient quick-editor sheet. Faithful port
// of apps/web/src/app/recipes/ingredient-quick-editor-sheet.tsx: edit one
// RecipeIngredient's descriptor/qty/unit, flip its linked grocery item's
// Have/Need status, re-pick or unlink the canonical `item_name` match, or
// create a new grocery item and link it. Two entry points share this on
// native: the detail screen's hold-menu and "Add to list" (the web page's
// third entry point, FLUX-205's draft-review chips, is Phase-3-only).
//
// Linking is name-string based (this app's whole recipe<->grocery match is
// name-based) — "picking a match" or "creating a new item" is just writing
// `item_name` to that candidate's display name.
//
// Modules: the grocery actions (Have / Need, Create new item) need recipes and
// groceries (module-features.ts); callers omit them when that feature is off and
// the sheet keeps only the ingredient's own fields and its name match.
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Unlink } from 'lucide-react-native';
import {
  Text,
  ItemFormSheet,
  FormSection,
  FieldRow,
  DetailsDisclosure,
  DragNumberField,
  Input,
  SearchablePicker,
  cn,
  type PickerOption,
} from '@homeup/ui';
import {
  ingredientMatchKey,
  matchIngredientToGrocery,
  ingredientStatus,
  itemMatchLibrary,
  rankItemMatches,
  norm,
  stepForUnit,
  UNITS,
  type GroceryItem,
  type RecipeIngredient,
} from '@homeup/core';

const STATUS_META: Record<GroceryItem['status'], { label: string; className: string }> = {
  have: { label: 'Have', className: 'text-primary' },
  needed: { label: 'Need', className: 'text-warning' },
  bought: { label: 'Got', className: 'text-success' },
};

const UNIT_OPTIONS: PickerOption[] = UNITS.map((u) => ({ value: u.value, primary: u.label }));

interface IngredientQuickEditorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The row being edited. May be briefly null (row deleted elsewhere) while closing. */
  ingredient: RecipeIngredient | null;
  recipeTitle: string;
  /** Active grocery items — for match candidates + live have/need status. */
  groceryItems: GroceryItem[];
  /** All recipe ingredients across recipes — for the match candidate library. */
  allIngredients: RecipeIngredient[];
  /** Opened via "Add to list" for an unmatched ingredient — scrolls to the Match section. */
  focusMatch?: boolean;
  /** Patches ONLY this ingredient row (name/quantity/unit/item_name). */
  onSaveIngredient: (patch: Partial<RecipeIngredient>) => void;
  onRemoveIngredient: (id: string) => void;
  /** Flips the linked grocery item's Have/Need status. Omitted when recipes.groceries is off. */
  onToggleGroceryStatus?: (match: GroceryItem) => void;
  /** Creates a new grocery item and links it (`item_name`) to this ingredient. Omitted when recipes.groceries is off. */
  onCreateGroceryItem?: (input: {
    name: string;
    quantity: number | null;
    unit: string | null;
    status: GroceryItem['status'];
  }) => void;
  /** Closes this sheet and opens the full RecipeFormSheet edit mode instead. */
  onEditFullRecipe: () => void;
}

export function IngredientQuickEditorSheet({
  open,
  onOpenChange,
  ingredient,
  recipeTitle,
  groceryItems,
  allIngredients,
  focusMatch,
  onSaveIngredient,
  onRemoveIngredient,
  onToggleGroceryStatus,
  onCreateGroceryItem,
  onEditFullRecipe,
}: IngredientQuickEditorSheetProps) {
  // Descriptor / qty / unit — local draft, committed on Save (the sheet is
  // remounted per open via the caller's `key`, so seeding from `ingredient`
  // once at mount is safe).
  const [name, setName] = React.useState(ingredient?.name ?? '');
  const [quantity, setQuantity] = React.useState<number | null>(ingredient?.quantity ?? null);
  const [unit, setUnit] = React.useState(ingredient?.unit ?? '');

  // Create-new-item fallback — its own local draft.
  const [newItemName, setNewItemName] = React.useState(ingredient ? ingredientMatchKey(ingredient) : '');
  const [newItemQuantity, setNewItemQuantity] = React.useState<number | null>(null);
  const [newItemUnit, setNewItemUnit] = React.useState('');
  const [newItemStatus, setNewItemStatus] = React.useState<GroceryItem['status']>('needed');

  const scrollRef = React.useRef<ScrollView>(null);
  const matchSectionY = React.useRef(0);
  React.useEffect(() => {
    if (open && focusMatch) scrollRef.current?.scrollTo({ y: matchSectionY.current, animated: true });
  }, [open, focusMatch]);

  if (!ingredient) return null;

  const groceryLinked = !!onToggleGroceryStatus && !!onCreateGroceryItem;
  const matchKey = ingredientMatchKey(ingredient);
  const match = groceryLinked ? matchIngredientToGrocery(matchKey, groceryItems) : null;
  const candidates = rankItemMatches(matchKey, itemMatchLibrary(groceryItems, allIngredients));

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSaveIngredient({ name: trimmed, quantity, unit: unit || null });
    onOpenChange(false);
  };

  const handleRemove = () => {
    onRemoveIngredient(ingredient.id);
    onOpenChange(false);
  };

  const handleCreateNewItem = () => {
    const trimmed = newItemName.trim();
    if (!trimmed || !onCreateGroceryItem) return;
    onCreateGroceryItem({
      name: trimmed,
      quantity: newItemQuantity,
      unit: newItemUnit || null,
      status: newItemStatus,
    });
  };

  const previewStatusMeta = match ? STATUS_META[match.status] : null;

  return (
    <ItemFormSheet
      ref={scrollRef}
      open={open}
      onOpenChange={onOpenChange}
      title="Edit ingredient"
      previewContent={
        <>
          <Text numberOfLines={1} className="min-w-0 flex-1 font-heading text-base font-semibold text-foreground">
            {name.trim() || 'Edit ingredient'}
          </Text>
          {previewStatusMeta && (
            <Text className={cn('shrink-0 text-xs font-medium', previewStatusMeta.className)}>
              {previewStatusMeta.label}
            </Text>
          )}
        </>
      }
      onSubmit={handleSubmit}
      canSubmit={!!name.trim()}
      onDelete={handleRemove}
      deleteLabel="Remove"
      deleteConfirmTitle={`Remove "${ingredient.name}"?`}
    >
      <Text className="text-xs text-muted-foreground">
        Editing this ingredient only, in <Text className="font-medium text-foreground">{recipeTitle}</Text>.
      </Text>

      <FormSection>
        <FieldRow label="Descriptor" required>
          <Input
            autoFocus
            value={name}
            onChangeText={setName}
            placeholder="e.g. thinly sliced blood oranges, peeled"
          />
        </FieldRow>
      </FormSection>

      {groceryLinked && (
        <FormSection>
          <FieldRow label="Have / Need">
            {match ? (
              <Pressable
                onPress={() => onToggleGroceryStatus?.(match)}
                className={cn(
                  'flex-row items-center self-start gap-1 rounded-full border px-3 py-1.5',
                  match.status === 'have' ? 'border-primary/40 bg-primary/10' : 'border-border bg-muted',
                )}
              >
                <Text className={cn('text-sm font-medium', STATUS_META[match.status].className)}>
                  {STATUS_META[match.status].label}
                </Text>
              </Pressable>
            ) : (
              <Text className="text-sm text-muted-foreground">No linked item yet. Pick or create one below.</Text>
            )}
          </FieldRow>
        </FormSection>
      )}

      {/* Wrapped so `focusMatch` can scroll this section into view via its layout y. */}
      <View onLayout={(e) => { matchSectionY.current = e.nativeEvent.layout.y; }}>
        <FormSection title="Match">
          <View className="gap-1.5">
            {candidates.length === 0 && (
              <Text className="text-xs text-muted-foreground">
                {groceryLinked ? 'No close matches. Create a new item below.' : 'No close matches.'}
              </Text>
            )}
            {candidates.map((c) => {
              const status = groceryLinked ? ingredientStatus(c.name, groceryItems) : 'none';
              const linked = norm(c.name) === norm(ingredient.item_name ?? '');
              return (
                <Pressable
                  key={c.name}
                  onPress={() => onSaveIngredient({ item_name: c.name })}
                  className={cn(
                    'flex-row items-center justify-between gap-2 rounded-lg border px-3 py-2',
                    linked ? 'border-primary bg-primary/10' : 'border-border bg-muted/20',
                  )}
                >
                  <Text numberOfLines={1} className="flex-1 text-sm text-foreground">
                    {c.name}
                  </Text>
                  {status !== 'none' && (
                    <Text className={cn('shrink-0 text-xs font-medium', STATUS_META[status].className)}>
                      {STATUS_META[status].label}
                    </Text>
                  )}
                </Pressable>
              );
            })}
            {ingredient.item_name && (
              <Pressable
                onPress={() => onSaveIngredient({ item_name: null })}
                className="mt-1 flex-row items-center gap-1.5 self-start"
              >
                <Unlink size={14} className="text-muted-foreground" />
                <Text className="text-sm text-muted-foreground">Unlink item</Text>
              </Pressable>
            )}
          </View>
        </FormSection>
      </View>

      <DetailsDisclosure count={groceryLinked ? 2 : 1}>
        <FormSection>
          <View className="flex-row gap-2">
            <DragNumberField
              className="flex-1"
              value={quantity}
              onChange={setQuantity}
              step={stepForUnit(unit)}
              min={0}
              precision={2}
              trimTrailingZeros
              allowEmpty
              suffix={unit || undefined}
              placeholder="Qty"
              accessibilityLabel="Quantity"
            />
            <SearchablePicker
              className="flex-1"
              options={UNIT_OPTIONS}
              value={unit}
              onChange={setUnit}
              placeholder="Unit"
              searchPlaceholder="Search units…"
              ariaLabel="Unit"
            />
          </View>
        </FormSection>

        {groceryLinked && (
          <FormSection title="Create new item">
            <FieldRow label="Name">
              <Input value={newItemName} onChangeText={setNewItemName} placeholder="Canonical item name" />
            </FieldRow>
            <View className="flex-row gap-2">
              <DragNumberField
                className="flex-1"
                value={newItemQuantity}
                onChange={setNewItemQuantity}
                step={stepForUnit(newItemUnit)}
                min={0}
                precision={2}
                trimTrailingZeros
                allowEmpty
                suffix={newItemUnit || undefined}
                placeholder="Qty"
                accessibilityLabel="New item quantity"
              />
              <SearchablePicker
                className="flex-1"
                options={UNIT_OPTIONS}
                value={newItemUnit}
                onChange={setNewItemUnit}
                placeholder="Unit"
                searchPlaceholder="Search units…"
                ariaLabel="New item unit"
              />
            </View>
            <FieldRow label="Add as">
              <View className="flex-row gap-1.5">
                <Pressable
                  onPress={() => setNewItemStatus('have')}
                  accessibilityRole="button"
                  accessibilityState={{ selected: newItemStatus === 'have' }}
                  className={cn(
                    'flex-1 items-center rounded-lg border px-3 py-1.5',
                    newItemStatus === 'have' ? 'border-primary/40 bg-primary/10' : 'border-border bg-muted/20',
                  )}
                >
                  <Text
                    className={cn(
                      'text-sm font-medium',
                      newItemStatus === 'have' ? 'text-primary' : 'text-muted-foreground',
                    )}
                  >
                    Have
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setNewItemStatus('needed')}
                  accessibilityRole="button"
                  accessibilityState={{ selected: newItemStatus === 'needed' }}
                  className={cn(
                    'flex-1 items-center rounded-lg border px-3 py-1.5',
                    newItemStatus === 'needed' ? 'border-primary/40 bg-primary/10' : 'border-border bg-muted/20',
                  )}
                >
                  <Text
                    className={cn(
                      'text-sm font-medium',
                      newItemStatus === 'needed' ? 'text-primary' : 'text-muted-foreground',
                    )}
                  >
                    Need
                  </Text>
                </Pressable>
              </View>
            </FieldRow>
            <Pressable
              onPress={handleCreateNewItem}
              disabled={!newItemName.trim()}
              className="items-center rounded-lg border border-dashed border-border px-3 py-1.5 disabled:opacity-40"
            >
              <Text className="text-sm text-muted-foreground">Create &amp; link</Text>
            </Pressable>
          </FormSection>
        )}
      </DetailsDisclosure>

      <Pressable onPress={onEditFullRecipe} className="items-center pt-1">
        <Text className="text-xs text-muted-foreground underline">Edit full recipe</Text>
      </Pressable>
    </ItemFormSheet>
  );
}
