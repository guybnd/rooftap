'use client';

// FLUX-189: create/edit a recipe. Built on the shared FLUX-182 sheet
// (ItemFormSheet/FormSection/FieldRow), mirroring grocery-item-modal.tsx.
//
// Ingredient rows carry the three rev-3 controls: a Name autocomplete
// (IngredientNameInput — suggestions from grocery items + prior ingredient names,
// annotated with the current have/need status), a unit-aware drag-to-adjust Qty
// (DragNumberField, step from stepForUnit), and a bounded Unit dropdown
// (SearchablePicker over UNITS). Persistence is delegated to the page via onSave.
//
// FLUX-202: instructions are edited as an ordered step-row list (add/remove/
// reorder) instead of a free textarea — for BOTH the parsed-from-photo and
// manual-entry paths — and folded to/from the `instructions` text column via
// stepsFromInstructions/instructionsFromSteps. Also adds servings/prep/cook
// time + source inputs, a clickable source-photo thumbnail (drafts and any
// recipe with a linked document), and an explicit Discard action for drafts
// (Save already exists on the sheet and flips draft -> false, i.e. publishes).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Plus, ChevronUp, ChevronDown, Check } from 'lucide-react';
import type { GroceryItem, Recipe, RecipeIngredient, RecipeMethod } from '@homeup/core';
import {
  RECIPE_METHODS,
  methodMeta,
  UNITS,
  stepForUnit,
  ingredientNameSuggestions,
  itemMatchLibrary,
  ingredientStatus,
  ingredientMatchKey,
  rankItemMatches,
  norm,
  buildRecipe,
  buildRecipeIngredient,
  recipeCuisines,
  stepsFromInstructions,
  instructionsFromSteps,
  type ScoredMatch,
} from '@homeup/core';
import { EntityPhotoThumbnail } from '@/components/documents/entity-photo-thumbnail';
import { ItemFormSheet, FormSection, FieldRow } from '@/components/ui/item-form-sheet';
import { DragNumberField } from '@/components/ui/drag-number-field';
import { SearchablePicker, type PickerOption } from '@/components/ui/searchable-picker';
import { IngredientNameInput } from '@/components/ui/ingredient-name-input';
import { TagInput } from '@/components/ui/tag-input';
import { Input } from '@/components/ui/input';
import { IngredientQuickEditorSheet } from './ingredient-quick-editor-sheet';
import { cn } from '@/lib/utils';

// ── FLUX-205 (P2): draft-review row states ──────────────────────────────────────
// During a scanned-draft review (recipe?.draft === true) only, each row's match
// state is computed LIVE from the reactive `ingredients`/`allIngredients` props —
// NOT from local `form.rows`, which only mirrors an unsaved name/qty/unit draft
// and won't reactively reflect a quick-editor's direct store write.
type ReviewState =
  | { kind: 'silent' }
  | { kind: 'suggestion'; candidate: ScoredMatch }
  | { kind: 'new' };

function computeReviewState(
  ing: RecipeIngredient,
  groceryItems: GroceryItem[],
  allIngredients: RecipeIngredient[],
): ReviewState {
  const candidates = rankItemMatches(ingredientMatchKey(ing), itemMatchLibrary(groceryItems, allIngredients));
  if (candidates.length === 0) return { kind: 'new' };
  const top = candidates[0];
  const alreadyLinked = norm(top.name) === norm(ing.item_name ?? '');
  if (top.tier === 'exact' || top.tier === 'plural' || alreadyLinked) return { kind: 'silent' };
  return { kind: 'suggestion', candidate: top };
}

interface RecipeFormSheetProps {
  isOpen: boolean;
  /** Present in edit mode. */
  recipe?: Recipe;
  /** Existing ingredients for the recipe being edited (sorted or not). */
  ingredients?: RecipeIngredient[];
  groupId: string;
  /** Active grocery items — for name suggestions + status annotation. Empty when recipes.groceries is off. */
  groceryItems: GroceryItem[];
  /** All recipe ingredients across recipes — for the name suggestion union. */
  allIngredients: RecipeIngredient[];
  /** Cuisine tags seen across existing recipes — for the tag autocomplete. */
  cuisineSuggestions: string[];
  onClose: () => void;
  /** Hand back the final recipe + its ingredient rows; the page persists + diffs. */
  onSave: (recipe: Recipe, ingredients: RecipeIngredient[]) => void;
  /** Present only for a draft recipe — renders an explicit Discard footer action. */
  onDiscard?: (recipe: Recipe) => void;
  /**
   * FLUX-205 (P2) — present only for the draft-review caller (recipes/page.tsx's
   * `openReview`). Suggestion-chip Accept and the quick-editor's descriptor/qty/
   * unit/match edits all write straight to the live store (not `form.rows`), same
   * as the recipe detail page's per-row quick-editor.
   */
  onPatchIngredient?: (id: string, patch: Partial<RecipeIngredient>) => void;
  /** Draft-review only — the quick-editor's "Remove" action (soft delete). */
  onRemoveIngredientRow?: (id: string) => void;
  /** Draft-review only — flips a linked grocery item's Have/Need status. Omitted when recipes.groceries is off. */
  onToggleGroceryItemStatus?: (match: GroceryItem) => void;
  /** Draft-review only — creates a grocery item and links it to the ingredient. Omitted when recipes.groceries is off. */
  onCreateGroceryItemForIngredient?: (
    ingredient: RecipeIngredient,
    input: { name: string; quantity: number | null; unit: string | null; status: GroceryItem['status'] },
  ) => void;
}

interface Row {
  key: string;
  id?: string;        // set for rows that already exist (edit)
  name: string;
  /** Linked canonical grocery item (FLUX-205) — round-tripped so a full-recipe
   *  edit save doesn't silently drop an existing link. Chip/re-pick UI is P2/P3. */
  itemName: string | null;
  quantity: number | null;
  unit: string;
}

interface StepRow {
  key: string;
  text: string;
}

let rowSeq = 0;
const freshRowKey = () => `row-${rowSeq++}`;

function emptyRow(): Row {
  return { key: freshRowKey(), name: '', itemName: null, quantity: null, unit: '' };
}

function emptyStep(): StepRow {
  return { key: freshRowKey(), text: '' };
}

export function RecipeFormSheet({
  isOpen,
  recipe,
  ingredients,
  groupId,
  groceryItems,
  allIngredients,
  cuisineSuggestions,
  onClose,
  onSave,
  onDiscard,
  onPatchIngredient,
  onRemoveIngredientRow,
  onToggleGroceryItemStatus,
  onCreateGroceryItemForIngredient,
}: RecipeFormSheetProps) {
  const buildInitial = useCallback(() => {
    const rows: Row[] = (ingredients ?? [])
      .filter((i) => !i.deleted)
      .sort((a, b) => a.position - b.position)
      .map((i) => ({
        key: freshRowKey(),
        id: i.id,
        name: i.name,
        itemName: i.item_name,
        quantity: i.quantity,
        unit: i.unit ?? '',
      }));
    const steps: StepRow[] = stepsFromInstructions(recipe?.instructions).map((text) => ({
      key: freshRowKey(),
      text,
    }));
    return {
      title: recipe?.title ?? '',
      cuisines: recipeCuisines(recipe),
      method: (recipe?.method ?? null) as RecipeMethod | null,
      steps: steps.length ? steps : [emptyStep()],
      servings: recipe?.servings ?? null,
      prepMinutes: recipe?.prep_minutes ?? null,
      cookMinutes: recipe?.cook_minutes ?? null,
      source: recipe?.source ?? '',
      rows: rows.length ? rows : [emptyRow()],
    };
  }, [recipe, ingredients]);

  const [form, setForm] = useState(buildInitial);
  const [saving, setSaving] = useState(false);

  // Re-seed the form every closed→open transition (the sheet instance is reused).
  const wasOpen = useRef(isOpen);
  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      setForm(buildInitial());
      setSaving(false);
    }
    wasOpen.current = isOpen;
  }, [isOpen, buildInitial]);

  const unitOptions = useMemo<PickerOption[]>(
    () => UNITS.map((u) => ({ value: u.value, primary: u.label })),
    [],
  );

  const nameSuggestions = useMemo(
    () => ingredientNameSuggestions(groceryItems, allIngredients),
    [groceryItems, allIngredients],
  );

  const statusAnnotate = useCallback(
    (name: string) => {
      const s = ingredientStatus(name, groceryItems);
      if (s === 'none') return null;
      const map = {
        have: { label: 'have', className: 'text-primary' },
        needed: { label: 'need', className: 'text-warning' },
        bought: { label: 'got', className: 'text-success' },
      } as const;
      return map[s];
    },
    [groceryItems],
  );

  const setRow = (key: string, patch: Partial<Row>) =>
    setForm((f) => ({ ...f, rows: f.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
  const addRow = () => setForm((f) => ({ ...f, rows: [...f.rows, emptyRow()] }));
  const removeRow = (key: string) =>
    setForm((f) => {
      const rows = f.rows.filter((r) => r.key !== key);
      return { ...f, rows: rows.length ? rows : [emptyRow()] };
    });

  // ── FLUX-205 (P2): draft-review suggestion chips + quick-editor ─────────────
  const isDraftReview = !!recipe?.draft;
  // Rejected suggestions, by ingredient id — session-local only (never written
  // to the store); a rejected row falls back to being treated as unmatched/new.
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());

  const [quickEditorId, setQuickEditorId] = useState<string | null>(null);
  const [quickEditorOpen, setQuickEditorOpen] = useState(false);
  const quickEditorIngredient = quickEditorId
    ? (ingredients ?? []).find((i) => i.id === quickEditorId) ?? null
    : null;
  const openQuickEditor = (id: string) => {
    setQuickEditorId(id);
    setQuickEditorOpen(true);
  };
  const closeQuickEditor = () => setQuickEditorOpen(false);

  // Patch the store AND the local row's mirror of the same fields — Save
  // (`handleSubmit`) rebuilds every ingredient from `form.rows`, so without
  // this an Accept/quick-editor edit (both direct store writes) would get
  // silently reverted by a subsequent Save using the stale local snapshot.
  const patchIngredientAndRow = (id: string, patch: Partial<RecipeIngredient>) => {
    onPatchIngredient?.(id, patch);
    const row = form.rows.find((r) => r.id === id);
    if (!row) return;
    const rowPatch: Partial<Row> = {};
    if (patch.name !== undefined) rowPatch.name = patch.name;
    if (patch.quantity !== undefined) rowPatch.quantity = patch.quantity;
    if (patch.unit !== undefined) rowPatch.unit = patch.unit ?? '';
    if (patch.item_name !== undefined) rowPatch.itemName = patch.item_name;
    if (Object.keys(rowPatch).length) setRow(row.key, rowPatch);
  };

  const acceptSuggestion = (id: string, candidateName: string) =>
    patchIngredientAndRow(id, { item_name: candidateName });
  const rejectSuggestion = (id: string) =>
    setDismissedSuggestions((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

  // Rows currently in the unconfirmed-suggestion state (not yet accepted/rejected
  // this session) — drives the "N suggested matches to review" banner. Save is
  // never blocked on these (D4: scanning 16 ingredients shouldn't force 16 taps).
  const suggestionCount = isDraftReview
    ? form.rows.filter((row) => {
        if (!row.id || dismissedSuggestions.has(row.id)) return false;
        const live = (ingredients ?? []).find((i) => i.id === row.id);
        return !!live && computeReviewState(live, groceryItems, allIngredients).kind === 'suggestion';
      }).length
    : 0;

  // ── Step rows (FLUX-202) ─────────────────────────────────────────────────────
  const setStep = (key: string, text: string) =>
    setForm((f) => ({ ...f, steps: f.steps.map((s) => (s.key === key ? { ...s, text } : s)) }));
  const addStep = () => setForm((f) => ({ ...f, steps: [...f.steps, emptyStep()] }));
  const removeStep = (key: string) =>
    setForm((f) => {
      const steps = f.steps.filter((s) => s.key !== key);
      return { ...f, steps: steps.length ? steps : [emptyStep()] };
    });
  const moveStep = (key: string, dir: -1 | 1) =>
    setForm((f) => {
      const idx = f.steps.findIndex((s) => s.key === key);
      const swapWith = idx + dir;
      if (idx < 0 || swapWith < 0 || swapWith >= f.steps.length) return f;
      const steps = [...f.steps];
      [steps[idx], steps[swapWith]] = [steps[swapWith], steps[idx]];
      return { ...f, steps };
    });

  const toggleMethod = (m: RecipeMethod) =>
    setForm((f) => ({ ...f, method: f.method === m ? null : m }));

  const handleSubmit = () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const instructions = instructionsFromSteps(form.steps.map((s) => s.text));
      const savedRecipe: Recipe = recipe
        ? {
            ...recipe,
            title: form.title.trim(),
            cuisines: form.cuisines,
            method: form.method,
            instructions,
            servings: form.servings,
            prep_minutes: form.prepMinutes,
            cook_minutes: form.cookMinutes,
            source: form.source.trim() || null,
            // Save publishes a draft (decision 2) — no-op for an already-published recipe.
            draft: false,
          }
        : buildRecipe({
            groupId,
            title: form.title,
            cuisines: form.cuisines,
            method: form.method,
            instructions,
            servings: form.servings,
            prepMinutes: form.prepMinutes,
            cookMinutes: form.cookMinutes,
            source: form.source,
            sourceType: 'manual',
          });

      const rows = form.rows.filter((r) => r.name.trim());
      const savedIngredients = rows.map((r, idx) =>
        buildRecipeIngredient({
          id: r.id,
          recipeId: savedRecipe.id,
          groupId,
          name: r.name,
          itemName: r.itemName,
          quantity: r.quantity,
          unit: r.unit || null,
          position: idx,
        }),
      );
      onSave(savedRecipe, savedIngredients);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = recipe?.draft && onDiscard ? () => { onDiscard(recipe); onClose(); } : undefined;

  return (
    <>
    <ItemFormSheet
      isOpen={isOpen}
      onClose={onClose}
      title={recipe ? (recipe.draft ? 'Review scanned recipe' : 'Edit recipe') : 'New recipe'}
      icon={form.method ? methodMeta(form.method).emoji : '🍽️'}
      onSubmit={handleSubmit}
      canSubmit={!!form.title.trim()}
      saving={saving}
      onDelete={handleDiscard}
      deleteLabel="Discard"
    >
      <FormSection>
        <FieldRow label="Title" htmlFor="recipe-title" required>
          <Input
            id="recipe-title"
            autoFocus
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="e.g. Lasagna"
          />
        </FieldRow>

        {recipe?.source_type === 'photo' && (
          <FieldRow label="Source photo">
            <EntityPhotoThumbnail entityType="recipe" entityId={recipe.id} label="View original photo" />
          </FieldRow>
        )}

        <FieldRow label="Method" hint="Optional, tap again to clear">
          <div className="grid grid-cols-4 gap-1.5">
            {RECIPE_METHODS.map((m) => {
              const meta = methodMeta(m);
              const active = form.method === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => toggleMethod(m)}
                  aria-pressed={active}
                  className={cn(
                    'flex flex-col items-center gap-0.5 rounded-lg border px-1 py-2 text-xs font-medium transition-colors',
                    active
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted/60',
                  )}
                >
                  <span className="text-base leading-none">{meta.emoji}</span>
                  {meta.label}
                </button>
              );
            })}
          </div>
        </FieldRow>

        <FieldRow label="Cuisine">
          <TagInput
            tags={form.cuisines}
            onChange={(cuisines) => setForm({ ...form, cuisines })}
            suggestions={cuisineSuggestions}
            placeholder="e.g. italian, comfort…"
          />
        </FieldRow>

        <div className="grid grid-cols-3 gap-2">
          <FieldRow label="Servings">
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              value={form.servings ?? ''}
              onChange={(e) => setForm({ ...form, servings: e.target.value === '' ? null : Number(e.target.value) })}
              placeholder="–"
            />
          </FieldRow>
          <FieldRow label="Prep (min)">
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              value={form.prepMinutes ?? ''}
              onChange={(e) => setForm({ ...form, prepMinutes: e.target.value === '' ? null : Number(e.target.value) })}
              placeholder="–"
            />
          </FieldRow>
          <FieldRow label="Cook (min)">
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              value={form.cookMinutes ?? ''}
              onChange={(e) => setForm({ ...form, cookMinutes: e.target.value === '' ? null : Number(e.target.value) })}
              placeholder="–"
            />
          </FieldRow>
        </div>

        <FieldRow label="Source" hint="Optional, where this recipe came from">
          <Input
            value={form.source}
            onChange={(e) => setForm({ ...form, source: e.target.value })}
            placeholder="e.g. Grandma's recipe card"
          />
        </FieldRow>
      </FormSection>

      <FormSection title="Ingredients">
        {/* H2: a status word, not a tinted callout. */}
        {isDraftReview && suggestionCount > 0 && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-warning">
              {suggestionCount} suggested match{suggestionCount === 1 ? '' : 'es'}
            </span>{' '}
            to review
          </p>
        )}
        {/* H4: ingredient rows are hairline-divided inside the group, not
            bordered boxes inside it. */}
        <div className="divide-y divide-border/60">
          {form.rows.map((row) => {
            const liveIngredient = isDraftReview && row.id ? (ingredients ?? []).find((i) => i.id === row.id) : undefined;
            const rejected = !!row.id && dismissedSuggestions.has(row.id);
            const rawState = liveIngredient ? computeReviewState(liveIngredient, groceryItems, allIngredients) : null;
            // A rejected suggestion falls back to being treated as new/unlinked.
            const reviewState: ReviewState | null =
              rawState?.kind === 'suggestion' && rejected ? { kind: 'new' } : rawState;

            return (
              <div key={row.key} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <IngredientNameInput
                      value={row.name}
                      onChange={(name) => setRow(row.key, { name })}
                      suggestions={nameSuggestions}
                      annotate={statusAnnotate}
                      ariaLabel="Ingredient name"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeRow(row.key)}
                    aria-label="Remove ingredient"
                    className="-mr-1.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <DragNumberField
                    value={row.quantity}
                    onChange={(quantity) => setRow(row.key, { quantity })}
                    step={stepForUnit(row.unit)}
                    min={0}
                    precision={2}
                    trimTrailingZeros
                    allowEmpty
                    suffix={row.unit || undefined}
                    placeholder="Qty"
                    ariaLabel="Quantity"
                  />
                  <SearchablePicker
                    options={unitOptions}
                    value={row.unit}
                    onChange={(unit) => setRow(row.key, { unit })}
                    placeholder="Unit"
                    searchPlaceholder="Search units…"
                    ariaLabel="Unit"
                  />
                </div>

                {reviewState?.kind === 'suggestion' && liveIngredient && (
                  <div className="mt-2 rounded-xl bg-muted/50 p-2">
                    <p className="mb-1.5 text-xs text-muted-foreground">
                      <span className="font-medium text-warning">Match?</span>{' '}
                      <span className="font-medium text-foreground">{reviewState.candidate.name}</span>
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => acceptSuggestion(liveIngredient.id, reviewState.candidate.name)}
                        className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-background text-sm font-medium text-foreground hover:bg-accent"
                      >
                        <Check className="h-4 w-4" />
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => rejectSuggestion(liveIngredient.id)}
                        className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                        Reject
                      </button>
                    </div>
                  </div>
                )}

                {/* Modules: "new item" means not on the shopping list yet, so it needs
                    recipes and groceries (module-features.ts); the caller omits the
                    grocery actions when that feature is off. */}
                {reviewState?.kind === 'new' && liveIngredient && onCreateGroceryItemForIngredient && (
                  <button
                    type="button"
                    onClick={() => openQuickEditor(liveIngredient.id)}
                    className="relative mt-2 inline-flex h-8 items-center gap-1.5 rounded-full border border-dashed border-border px-3 text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-['']"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    New item, tap to link or create
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={addRow}
          className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-dashed border-border px-4 text-sm text-muted-foreground hover:border-primary hover:text-primary"
        >
          <Plus className="h-4 w-4" />
          Add ingredient
        </button>
      </FormSection>

      <FormSection title="Steps">
        <div className="space-y-2">
          {form.steps.map((step, idx) => (
            <div key={step.key} className="flex items-start gap-2">
              <span className="mt-1.5 w-4 shrink-0 text-right text-xs font-medium tabular-nums text-muted-foreground">
                {idx + 1}.
              </span>
              <textarea
                value={step.text}
                onChange={(e) => setStep(step.key, e.target.value)}
                placeholder={`Step ${idx + 1}…`}
                rows={2}
                className="min-w-0 flex-1 resize-y rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-ring placeholder:text-muted-foreground"
              />
              {/* M2: the reorder pair splits the two-line step's height
                  between two 28px targets rather than two 14px glyphs. */}
              <div className="flex shrink-0 flex-col">
                <button
                  type="button"
                  onClick={() => moveStep(step.key, -1)}
                  disabled={idx === 0}
                  aria-label="Move step up"
                  className="inline-flex h-7 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => moveStep(step.key, 1)}
                  disabled={idx === form.steps.length - 1}
                  aria-label="Move step down"
                  className="inline-flex h-7 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
              <button
                type="button"
                onClick={() => removeStep(step.key)}
                aria-label="Remove step"
                className="-mr-1.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-destructive"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addStep}
          className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-dashed border-border px-4 text-sm text-muted-foreground hover:border-primary hover:text-primary"
        >
          <Plus className="h-4 w-4" />
          Add step
        </button>
      </FormSection>
    </ItemFormSheet>

    {isDraftReview && (
      <IngredientQuickEditorSheet
        key={quickEditorOpen ? `quick-${quickEditorId}` : 'quick-closed'}
        isOpen={quickEditorOpen}
        ingredient={quickEditorIngredient}
        recipeTitle={form.title || recipe?.title || ''}
        groceryItems={groceryItems}
        allIngredients={allIngredients}
        focusMatch
        onClose={closeQuickEditor}
        onSaveIngredient={(patch) => {
          if (quickEditorId) patchIngredientAndRow(quickEditorId, patch);
        }}
        onRemoveIngredient={(id) => {
          // Soft-delete in the store AND drop the local row — otherwise a
          // later Save (`editedIngredients.forEach(writeIngredient)`) would
          // resurrect it, since `buildRecipeIngredient` always sets `deleted:
          // false` and `form.rows` still held this row's stale data.
          onRemoveIngredientRow?.(id);
          const row = form.rows.find((r) => r.id === id);
          if (row) removeRow(row.key);
        }}
        onToggleGroceryStatus={onToggleGroceryItemStatus}
        onCreateGroceryItem={
          onCreateGroceryItemForIngredient
            ? (input) => {
                if (!quickEditorIngredient) return;
                onCreateGroceryItemForIngredient(quickEditorIngredient, input);
                // Mirrors createGroceryItemForIngredient's own item_name link (page.tsx)
                // so the local row doesn't go stale — same reasoning as patchIngredientAndRow.
                const row = form.rows.find((r) => r.id === quickEditorIngredient.id);
                if (row) setRow(row.key, { itemName: input.name.trim() });
              }
            : undefined
        }
        onEditFullRecipe={closeQuickEditor}
      />
    )}
    </>
  );
}
