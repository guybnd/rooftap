'use client';

// FLUX-205 (P3): per-row quick-editor sheet — doubles as the match picker (D5).
// Edits ONE RecipeIngredient row (descriptor/qty/unit/remove), flips its linked
// grocery item's Have/Need status, re-picks or unlinks the canonical `item_name`
// match, and offers a "create new item" fallback — all without a full
// RecipeFormSheet round-trip. Three entry points share this one component:
// the detail-page row's hold-menu, "Add to list", and (later) review-sheet chips.
//
// Linking is name-string based, not a foreign key (this app's whole recipe↔
// grocery match is name-based) — "picking a match" or "creating a new item" is
// just writing `item_name` to that candidate's display name.
//
// Modules: the grocery actions (Have / Need, Create new item) need recipes and
// groceries (module-features.ts); callers omit them when that feature is off and
// the sheet keeps only the ingredient's own fields and its name match.

import { useEffect, useRef, useState } from 'react';
import { Unlink } from 'lucide-react';
import type { GroceryItem, RecipeIngredient } from '@homeup/core';
import {
  ingredientMatchKey,
  matchIngredientToGrocery,
  ingredientStatus,
  itemMatchLibrary,
  rankItemMatches,
  norm,
  stepForUnit,
  UNITS,
} from '@homeup/core';
import { ItemFormSheet, FormSection, FieldRow, DetailsDisclosure } from '@/components/ui/item-form-sheet';
import { DragNumberField } from '@/components/ui/drag-number-field';
import { SearchablePicker, type PickerOption } from '@/components/ui/searchable-picker';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const STATUS_META: Record<GroceryItem['status'], { label: string; className: string }> = {
  have: { label: 'Have', className: 'text-primary' },
  needed: { label: 'Need', className: 'text-warning' },
  bought: { label: 'Got', className: 'text-success' },
};

const UNIT_OPTIONS: PickerOption[] = UNITS.map((u) => ({ value: u.value, primary: u.label }));

interface IngredientQuickEditorSheetProps {
  isOpen: boolean;
  /** The row being edited. May be briefly null (row deleted elsewhere) while closing. */
  ingredient: RecipeIngredient | null;
  recipeTitle: string;
  /** Active grocery items — for match candidates + live have/need status. */
  groceryItems: GroceryItem[];
  /** All recipe ingredients across recipes — for the match candidate library. */
  allIngredients: RecipeIngredient[];
  /** Opened via "Add to list" for an unmatched ingredient — scrolls to the Match section. */
  focusMatch?: boolean;
  onClose: () => void;
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
  isOpen,
  ingredient,
  recipeTitle,
  groceryItems,
  allIngredients,
  focusMatch,
  onClose,
  onSaveIngredient,
  onRemoveIngredient,
  onToggleGroceryStatus,
  onCreateGroceryItem,
  onEditFullRecipe,
}: IngredientQuickEditorSheetProps) {
  // ── Descriptor / qty / unit — local draft, committed on Save (mirrors
  //    RecipeFormSheet's row editing; the sheet is remounted per open via the
  //    caller's `key`, so seeding from `ingredient` once at mount is safe). ──────
  const [name, setName] = useState(ingredient?.name ?? '');
  const [quantity, setQuantity] = useState<number | null>(ingredient?.quantity ?? null);
  const [unit, setUnit] = useState(ingredient?.unit ?? '');

  // ── Create-new-item fallback — its own local draft ──────────────────────────
  const [newItemName, setNewItemName] = useState(ingredient ? ingredientMatchKey(ingredient) : '');
  const [newItemQuantity, setNewItemQuantity] = useState<number | null>(null);
  const [newItemUnit, setNewItemUnit] = useState('');
  const [newItemStatus, setNewItemStatus] = useState<GroceryItem['status']>('needed');

  const matchSectionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isOpen && focusMatch) matchSectionRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, focusMatch]);

  if (!ingredient) return null;

  const groceryLinked = !!onToggleGroceryStatus && !!onCreateGroceryItem;
  const matchKey = ingredientMatchKey(ingredient);
  const match = groceryLinked ? matchIngredientToGrocery(matchKey, groceryItems) : null;
  const candidates = rankItemMatches(matchKey, itemMatchLibrary(groceryItems, allIngredients));

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSaveIngredient({ name: trimmed, quantity, unit: unit || null });
    onClose();
  };

  const handleRemove = () => {
    onRemoveIngredient(ingredient.id);
    onClose();
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
      isOpen={isOpen}
      onClose={onClose}
      title="Edit ingredient"
      previewContent={
        <>
          <span className="min-w-0 flex-1 truncate font-heading text-base font-semibold text-foreground">
            {name.trim() || 'Edit ingredient'}
          </span>
          {previewStatusMeta && (
            <span className={cn('shrink-0 text-xs font-medium', previewStatusMeta.className)}>
              {previewStatusMeta.label}
            </span>
          )}
        </>
      }
      onSubmit={handleSubmit}
      canSubmit={!!name.trim()}
      onDelete={handleRemove}
      deleteLabel="Remove"
    >
      <p className="text-xs text-muted-foreground">
        Editing this ingredient only, in <span className="font-medium">{recipeTitle}</span>.
      </p>

      <FormSection>
        <FieldRow label="Descriptor" htmlFor="ingredient-descriptor" required>
          <Input
            id="ingredient-descriptor"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. thinly sliced blood oranges, peeled"
          />
        </FieldRow>
      </FormSection>

      {groceryLinked && (
        <FormSection>
          <FieldRow label="Have / Need">
            {match ? (
              <button
                type="button"
                onClick={() => onToggleGroceryStatus?.(match)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                  match.status === 'have'
                    ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20'
                    : 'border-border bg-muted text-foreground hover:bg-accent',
                )}
              >
                {STATUS_META[match.status].label}
              </button>
            ) : (
              <span className="text-sm text-muted-foreground">No linked item yet. Pick or create one below.</span>
            )}
          </FieldRow>
        </FormSection>
      )}

      <FormSection title="Match" className="scroll-mt-4">
        <div ref={matchSectionRef} className="space-y-1.5">
          {candidates.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {groceryLinked ? 'No close matches. Create a new item below.' : 'No close matches.'}
            </p>
          )}
          {candidates.map((c) => {
            const status = groceryLinked ? ingredientStatus(c.name, groceryItems) : 'none';
            const linked = norm(c.name) === norm(ingredient.item_name ?? '');
            return (
              <button
                key={c.name}
                type="button"
                onClick={() => onSaveIngredient({ item_name: c.name })}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                  linked
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border bg-muted/20 text-foreground hover:bg-muted/40',
                )}
              >
                <span className="truncate">{c.name}</span>
                {status !== 'none' && (
                  <span className={cn('shrink-0 text-xs font-medium', STATUS_META[status].className)}>
                    {STATUS_META[status].label}
                  </span>
                )}
              </button>
            );
          })}
          {ingredient.item_name && (
            <button
              type="button"
              onClick={() => onSaveIngredient({ item_name: null })}
              className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-destructive"
            >
              <Unlink className="h-3.5 w-3.5" />
              Unlink item
            </button>
          )}
        </div>
      </FormSection>

      <DetailsDisclosure count={groceryLinked ? 2 : 1}>
        <FormSection>
          <div className="grid grid-cols-2 gap-2">
            <DragNumberField
              value={quantity}
              onChange={setQuantity}
              step={stepForUnit(unit)}
              min={0}
              precision={2}
              trimTrailingZeros
              allowEmpty
              suffix={unit || undefined}
              placeholder="Qty"
              ariaLabel="Quantity"
            />
            <SearchablePicker
              options={UNIT_OPTIONS}
              value={unit}
              onChange={setUnit}
              placeholder="Unit"
              searchPlaceholder="Search units…"
              ariaLabel="Unit"
            />
          </div>
        </FormSection>

        {groceryLinked && (
          <FormSection title="Create new item">
            <FieldRow label="Name">
              <Input
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                placeholder="Canonical item name"
              />
            </FieldRow>
            <div className="grid grid-cols-2 gap-2">
              <DragNumberField
                value={newItemQuantity}
                onChange={setNewItemQuantity}
                step={stepForUnit(newItemUnit)}
                min={0}
                precision={2}
                trimTrailingZeros
                allowEmpty
                suffix={newItemUnit || undefined}
                placeholder="Qty"
                ariaLabel="New item quantity"
              />
              <SearchablePicker
                options={UNIT_OPTIONS}
                value={newItemUnit}
                onChange={setNewItemUnit}
                placeholder="Unit"
                searchPlaceholder="Search units…"
                ariaLabel="New item unit"
              />
            </div>
            <FieldRow label="Add as">
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setNewItemStatus('have')}
                  aria-pressed={newItemStatus === 'have'}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                    newItemStatus === 'have'
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border bg-muted/20 text-muted-foreground hover:bg-muted/40',
                  )}
                >
                  Have
                </button>
                <button
                  type="button"
                  onClick={() => setNewItemStatus('needed')}
                  aria-pressed={newItemStatus === 'needed'}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                    newItemStatus === 'needed'
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border bg-muted/20 text-muted-foreground hover:bg-muted/40',
                  )}
                >
                  Need
                </button>
              </div>
            </FieldRow>
            <button
              type="button"
              onClick={handleCreateNewItem}
              disabled={!newItemName.trim()}
              className="w-full rounded-lg border border-dashed border-border px-3 py-1.5 text-sm text-muted-foreground hover:border-primary hover:text-primary disabled:pointer-events-none disabled:opacity-40"
            >
              Create &amp; link
            </button>
          </FormSection>
        )}
      </DetailsDisclosure>

      <div className="pt-1 text-center">
        <button
          type="button"
          onClick={onEditFullRecipe}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Edit full recipe
        </button>
      </div>
    </ItemFormSheet>
  );
}
