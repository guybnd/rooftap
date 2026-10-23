// HOUP-93: native Recipes — create/edit form sheet. Faithful-but-focused port
// of apps/web/src/app/recipes/recipe-form-sheet.tsx: title/method/cuisine/
// servings/prep/cook/source + ingredient rows (name/qty/unit) + ordered step
// rows.
//
// HOUP-153: adds the FLUX-205 draft-review machinery web already has — a
// draft recipe now reaches native via the camera-scan pipeline
// (recipe-capture.ts). Per-row Accept/Reject suggestion chips (computeReviewState,
// pure core rankItemMatches) and the source-photo thumbnail port over.
//
// HOUP-231: wires in the full ingredient quick-editor sheet (the "new item"
// create/link flow) for the draft-review case too — mirrors web
// recipe-form-sheet.tsx:227-261,522-660. `IngredientQuickEditorSheet` was
// already fully ported (native-only, wired on the detail screen); this just
// mounts it here as well.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { X, Plus, ChevronUp, ChevronDown, Check, Timer } from 'lucide-react-native';
import { IngredientQuickEditorSheet } from './ingredient-quick-editor-sheet';
import {
  Text,
  ItemFormSheet,
  FormSection,
  FieldRow,
  DragNumberField,
  Input,
  SearchablePicker,
  IngredientNameInput,
  TagInput,
  cn,
  haptics,
  type PickerOption,
} from '@homeup/ui';
import {
  RECIPE_METHODS,
  methodMeta,
  UNITS,
  ingredientNameSuggestions,
  ingredientStatus,
  ingredientMatchKey,
  itemMatchLibrary,
  ingredientScanMatch,
  stapleKeys,
  buildRecipe,
  buildRecipeIngredient,
  recipeCuisines,
  stepForUnit,
  emptyStepRow,
  stepRowsFromRecipe,
  stepsFromRows,
  methodFields,
  suggestedTimer,
  useModules,
  type StepFormRow,
  type RecipeStepTimer,
  type GroceryItem,
  type Recipe,
  type RecipeIngredient,
  type RecipeMethod,
} from '@homeup/core';
import { EntityPhotoThumbnail } from '@/components/documents/entity-photo-thumbnail';

// ── FLUX-205 (P2) / HOUP-153: draft-review row states ───────────────────────
// During a scanned-draft review (recipe?.draft === true) only, each row's match
// state is computed LIVE from the reactive `ingredients`/`allIngredients` props —
// NOT from local `form.rows`, which only mirrors an unsaved name/qty/unit draft
// and won't reactively reflect a direct store write (Accept).
type ReviewState =
  | { kind: 'silent' }
  | { kind: 'suggestion'; candidate: { name: string } }
  | { kind: 'new' }
  | { kind: 'staple' };

function computeReviewState(
  ing: RecipeIngredient,
  groceryItems: GroceryItem[],
  allIngredients: RecipeIngredient[],
  staples: ReadonlySet<string>,
  aliases: ReadonlyMap<string, string>,
): ReviewState {
  // Recipes v2 R5: the same classifier as the match step, so staples and
  // taught names agree with it.
  const m = ingredientScanMatch(ing, { library: itemMatchLibrary(groceryItems, allIngredients), staples, aliases });
  if (m.kind === 'staple') return { kind: 'staple' };
  if (m.kind === 'matched') return { kind: 'silent' };
  if (m.kind === 'check') return { kind: 'suggestion', candidate: { name: m.item } };
  return { kind: 'new' };
}

const DEFAULT_STAPLE_KEYS = stapleKeys([]);
const NO_ALIASES: ReadonlyMap<string, string> = new Map();

interface RecipeFormSheetProps {
  /** Household staples and taught names (useRecipeMatch). Defaults when omitted. */
  staples?: ReadonlySet<string>;
  aliases?: ReadonlyMap<string, string>;
  /** Draft review: Accept or Reject teaches future scans (alias, item). */
  onRemember?: (alias: string, itemName: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present in edit mode. */
  recipe?: Recipe;
  /** Existing ingredients for the recipe being edited. */
  ingredients?: RecipeIngredient[];
  groupId: string;
  /** Active grocery items — for name suggestions + status annotation. Empty when recipes.groceries is off. */
  groceryItems: GroceryItem[];
  /** All recipe ingredients across recipes — for the name suggestion union. */
  allIngredients: RecipeIngredient[];
  /** Cuisine tags seen across existing recipes — for the tag autocomplete. */
  cuisineSuggestions: string[];
  /** Hand back the final recipe + its ingredient rows; the caller persists + diffs. */
  onSave: (recipe: Recipe, ingredients: RecipeIngredient[]) => void;
  /** Present only for a draft recipe — renders an explicit Discard footer action. */
  onDiscard?: (recipe: Recipe) => void;
  /** Draft-review only — Accept and any future direct-store edits write here. */
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
  id?: string; // set for rows that already exist (edit)
  name: string;
  /** Linked canonical grocery item — round-tripped so a full-recipe edit save
   *  doesn't silently drop an existing link. Re-pick/unlink lives in the
   *  ingredient quick-editor, not this form. */
  itemName: string | null;
  quantity: number | null;
  unit: string;
}

let rowSeq = 0;
const freshRowKey = () => `row-${rowSeq++}`;

function emptyRow(): Row {
  return { key: freshRowKey(), name: '', itemName: null, quantity: null, unit: '' };
}

export function RecipeFormSheet({
  open,
  onOpenChange,
  recipe,
  ingredients,
  groupId,
  groceryItems,
  allIngredients,
  cuisineSuggestions,
  onSave,
  onDiscard,
  onPatchIngredient,
  onRemoveIngredientRow,
  onToggleGroceryItemStatus,
  onCreateGroceryItemForIngredient,
  staples = DEFAULT_STAPLE_KEYS,
  aliases = NO_ALIASES,
  onRemember,
}: RecipeFormSheetProps) {
  const buildInitial = React.useCallback(() => {
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
    const steps = stepRowsFromRecipe(recipe);
    return {
      title: recipe?.title ?? '',
      cuisines: recipeCuisines(recipe),
      method: (recipe?.method ?? null) as RecipeMethod | null,
      steps,
      servings: recipe?.servings ?? null,
      prepMinutes: recipe?.prep_minutes ?? null,
      cookMinutes: recipe?.cook_minutes ?? null,
      source: recipe?.source ?? '',
      rows: rows.length ? rows : [emptyRow()],
    };
  }, [recipe, ingredients]);

  const [form, setForm] = React.useState(buildInitial);
  // Recipes v2: timers are kept only where the server stores structured steps.
  const withSteps = useModules().server('recipes.steps');
  const [saving, setSaving] = React.useState(false);

  // Re-seed the form every closed->open transition (the sheet instance is reused).
  const wasOpen = React.useRef(open);
  React.useEffect(() => {
    if (open && !wasOpen.current) {
      setForm(buildInitial());
      setSaving(false);
    }
    wasOpen.current = open;
  }, [open, buildInitial]);

  const unitOptions = React.useMemo<PickerOption[]>(
    () => UNITS.map((u) => ({ value: u.value, primary: u.label })),
    [],
  );

  const nameSuggestions = React.useMemo(
    () => ingredientNameSuggestions(groceryItems, allIngredients),
    [groceryItems, allIngredients],
  );

  const statusAnnotate = React.useCallback(
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

  // ── Draft-review suggestion chips + quick-editor (HOUP-153/HOUP-231) ────
  const isDraftReview = !!recipe?.draft;
  // Rejected suggestions, by ingredient id — session-local only (never written
  // to the store); a rejected row falls back to being treated as unmatched/new.
  const [dismissedSuggestions, setDismissedSuggestions] = React.useState<Set<string>>(new Set());

  const [quickEditorId, setQuickEditorId] = React.useState<string | null>(null);
  const [quickEditorOpen, setQuickEditorOpen] = React.useState(false);
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

  const liveKey = (id: string) => {
    const live = (ingredients ?? []).find((i) => i.id === id);
    return live ? ingredientMatchKey(live) : null;
  };
  const acceptSuggestion = (id: string, candidateName: string) => {
    haptics.tick();
    const key = liveKey(id);
    if (key) onRemember?.(key, candidateName);
    patchIngredientAndRow(id, { item_name: candidateName });
  };
  const rejectSuggestion = (id: string) => {
    haptics.tick();
    const key = liveKey(id);
    if (key) onRemember?.(key, key);
    setDismissedSuggestions((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  // Rows currently in the unconfirmed-suggestion state (not yet accepted/
  // rejected this session) — drives the "N suggested matches" banner. Save is
  // never blocked on these (scanning 16 ingredients shouldn't force 16 taps).
  const suggestionCount = isDraftReview
    ? form.rows.filter((row) => {
        if (!row.id || dismissedSuggestions.has(row.id)) return false;
        const live = (ingredients ?? []).find((i) => i.id === row.id);
        return !!live && computeReviewState(live, groceryItems, allIngredients, staples, aliases).kind === 'suggestion';
      }).length
    : 0;

  const setStep = (key: string, patch: Partial<StepFormRow>) =>
    setForm((f) => ({ ...f, steps: f.steps.map((s) => (s.key === key ? { ...s, ...patch } : s)) }));
  const addStep = () => setForm((f) => ({ ...f, steps: [...f.steps, emptyStepRow()] }));
  const removeStep = (key: string) =>
    setForm((f) => {
      const steps = f.steps.filter((s) => s.key !== key);
      return { ...f, steps: steps.length ? steps : [emptyStepRow()] };
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

  const toggleMethod = (m: RecipeMethod) => setForm((f) => ({ ...f, method: f.method === m ? null : m }));

  const handleSubmit = () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const method = methodFields(stepsFromRows(form.steps), withSteps);
      const instructions = method.instructions;
      const savedRecipe: Recipe = recipe
        ? {
            ...recipe,
            title: form.title.trim(),
            cuisines: form.cuisines,
            method: form.method,
            ...method,
            servings: form.servings,
            prep_minutes: form.prepMinutes,
            cook_minutes: form.cookMinutes,
            source: form.source.trim() || null,
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
      if (!recipe && method.steps !== undefined) savedRecipe.steps = method.steps;

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
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard =
    recipe?.draft && onDiscard
      ? () => {
          onDiscard(recipe);
          onOpenChange(false);
        }
      : undefined;

  return (
    <>
    <ItemFormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={recipe ? (recipe.draft ? 'Review scanned recipe' : 'Edit recipe') : 'New recipe'}
      icon={form.method ? methodMeta(form.method).emoji : '🍽️'}
      onSubmit={handleSubmit}
      canSubmit={!!form.title.trim()}
      saving={saving}
      onDelete={handleDiscard}
      deleteLabel="Discard"
      deleteConfirmMessage="This discards the scanned recipe."
    >
      <FormSection>
        <FieldRow label="Title" required>
          <Input
            autoFocus
            value={form.title}
            onChangeText={(title) => setForm((f) => ({ ...f, title }))}
            placeholder="e.g. Lasagna"
          />
        </FieldRow>

        {recipe?.source_type === 'photo' && (
          <FieldRow label="Source photo">
            <EntityPhotoThumbnail entityType="recipe" entityId={recipe.id} label="View original photo" />
          </FieldRow>
        )}

        <FieldRow label="Method" hint="Optional, tap again to clear">
          <View className="flex-row flex-wrap gap-1.5">
            {RECIPE_METHODS.map((m) => {
              const meta = methodMeta(m);
              const active = form.method === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => toggleMethod(m)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  className={cn(
                    'basis-[23%] items-center gap-0.5 rounded-lg border px-1 py-2',
                    active ? 'border-primary bg-primary/10' : 'border-border bg-muted/40',
                  )}
                >
                  <Text className="text-base leading-none">{meta.emoji}</Text>
                  <Text className="text-xs font-medium text-foreground">{meta.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </FieldRow>

        <FieldRow label="Cuisine">
          <TagInput
            tags={form.cuisines}
            onChange={(cuisines) => setForm((f) => ({ ...f, cuisines }))}
            suggestions={cuisineSuggestions}
            placeholder="e.g. italian, comfort…"
          />
        </FieldRow>

        <View className="flex-row gap-2">
          <FieldRow label="Servings" className="flex-1">
            <Input
              keyboardType="number-pad"
              value={form.servings != null ? String(form.servings) : ''}
              onChangeText={(v) => setForm((f) => ({ ...f, servings: v.trim() === '' ? null : Number(v) }))}
              placeholder="–"
            />
          </FieldRow>
          <FieldRow label="Prep (min)" className="flex-1">
            <Input
              keyboardType="number-pad"
              value={form.prepMinutes != null ? String(form.prepMinutes) : ''}
              onChangeText={(v) => setForm((f) => ({ ...f, prepMinutes: v.trim() === '' ? null : Number(v) }))}
              placeholder="–"
            />
          </FieldRow>
          <FieldRow label="Cook (min)" className="flex-1">
            <Input
              keyboardType="number-pad"
              value={form.cookMinutes != null ? String(form.cookMinutes) : ''}
              onChangeText={(v) => setForm((f) => ({ ...f, cookMinutes: v.trim() === '' ? null : Number(v) }))}
              placeholder="–"
            />
          </FieldRow>
        </View>

        <FieldRow label="Source" hint="Optional, where this recipe came from">
          <Input
            value={form.source}
            onChangeText={(source) => setForm((f) => ({ ...f, source }))}
            placeholder="e.g. Grandma's recipe card"
          />
        </FieldRow>
      </FormSection>

      <FormSection title="Ingredients">
        {/* H2: a status word, not a tinted callout. */}
        {isDraftReview && suggestionCount > 0 && (
          <Text className="text-xs text-muted-foreground">
            <Text className="font-medium text-warning">
              {suggestionCount} suggested match{suggestionCount === 1 ? '' : 'es'}
            </Text>{' '}
            to review
          </Text>
        )}
        {/* H4: ingredient rows are hairline-divided inside the group, not
            bordered boxes inside it. */}
        <View>
          {form.rows.map((row, rowIdx) => {
            const liveIngredient = isDraftReview && row.id ? (ingredients ?? []).find((i) => i.id === row.id) : undefined;
            const rejected = !!row.id && dismissedSuggestions.has(row.id);
            const rawState = liveIngredient ? computeReviewState(liveIngredient, groceryItems, allIngredients, staples, aliases) : null;
            // A rejected suggestion falls back to being treated as new/unlinked.
            const reviewState: ReviewState | null =
              rawState?.kind === 'suggestion' && rejected ? { kind: 'new' } : rawState;

            return (
              <View
                key={row.key}
                className={cn(rowIdx > 0 && 'border-t border-border/60', rowIdx > 0 ? 'pt-2.5' : '', rowIdx < form.rows.length - 1 ? 'pb-2.5' : '')}
              >
                <View className="flex-row items-start gap-2">
                  <View className="min-w-0 flex-1">
                    <IngredientNameInput
                      value={row.name}
                      onChange={(name) => setRow(row.key, { name })}
                      suggestions={nameSuggestions}
                      annotate={statusAnnotate}
                    />
                  </View>
                  <Pressable
                    onPress={() => removeRow(row.key)}
                    hitSlop={4}
                    accessibilityLabel="Remove ingredient"
                    className="-mr-1.5 h-9 w-9 items-center justify-center rounded-lg"
                  >
                    <X size={16} className="text-muted-foreground" />
                  </Pressable>
                </View>
                <View className="mt-2 flex-row gap-2">
                  <DragNumberField
                    className="flex-1"
                    value={row.quantity}
                    onChange={(quantity) => setRow(row.key, { quantity })}
                    step={stepForUnit(row.unit)}
                    min={0}
                    precision={2}
                    trimTrailingZeros
                    allowEmpty
                    suffix={row.unit || undefined}
                    placeholder="Qty"
                    accessibilityLabel="Quantity"
                  />
                  <SearchablePicker
                    className="flex-1"
                    options={unitOptions}
                    value={row.unit}
                    onChange={(unit) => setRow(row.key, { unit })}
                    placeholder="Unit"
                    searchPlaceholder="Search units…"
                    ariaLabel="Unit"
                  />
                </View>

                {reviewState?.kind === 'suggestion' && liveIngredient && (
                  <View className="mt-2 rounded-xl bg-muted/50 p-2">
                    <Text className="mb-1.5 text-xs text-muted-foreground">
                      <Text className="font-medium text-warning">Match?</Text>{' '}
                      <Text className="font-medium text-foreground">{reviewState.candidate.name}</Text>
                    </Text>
                    <View className="flex-row gap-2">
                      <Pressable
                        onPress={() => acceptSuggestion(liveIngredient.id, reviewState.candidate.name)}
                        accessibilityRole="button"
                        className="h-11 flex-1 flex-row items-center justify-center gap-1.5 rounded-lg border border-border bg-background"
                      >
                        <Check size={16} className="text-foreground" />
                        <Text className="text-sm font-medium text-foreground">Accept</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => rejectSuggestion(liveIngredient.id)}
                        accessibilityRole="button"
                        className="h-11 flex-1 flex-row items-center justify-center gap-1.5 rounded-lg"
                      >
                        <X size={16} className="text-muted-foreground" />
                        <Text className="text-sm font-medium text-muted-foreground">Reject</Text>
                      </Pressable>
                    </View>
                  </View>
                )}

                {reviewState?.kind === 'staple' && onCreateGroceryItemForIngredient && (
                  <Text className="mt-2 text-xs text-muted-foreground">Staple, never added to the list</Text>
                )}

                {/* Modules: "new item" means not on the shopping list yet, so it needs
                    recipes and groceries (module-features.ts); the caller omits the
                    grocery actions when that feature is off. */}
                {reviewState?.kind === 'new' && liveIngredient && onCreateGroceryItemForIngredient && (
                  <Pressable
                    onPress={() => openQuickEditor(liveIngredient.id)}
                    accessibilityRole="button"
                    hitSlop={{ top: 6, bottom: 6 }}
                    className="mt-2 h-8 flex-row items-center gap-1.5 self-start rounded-full border border-dashed border-border px-3"
                  >
                    <Plus size={14} className="text-muted-foreground" />
                    <Text className="text-xs font-medium text-muted-foreground">New item, tap to link or create</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
        <Pressable
          onPress={addRow}
          className="h-11 flex-row items-center gap-1.5 self-start rounded-lg border border-dashed border-border px-4"
        >
          <Plus size={14} className="text-muted-foreground" />
          <Text className="text-sm text-muted-foreground">Add ingredient</Text>
        </Pressable>
      </FormSection>

      <FormSection title="Steps">
        <View className="gap-2">
          {form.steps.map((step, idx) => (
            <View key={step.key} className="flex-row items-start gap-2">
              <Text className="mt-2.5 w-4 shrink-0 text-right text-xs font-medium text-muted-foreground">
                {idx + 1}.
              </Text>
              <View className="min-w-0 flex-1 gap-1.5">
                <Input
                  value={step.text}
                  onChangeText={(text) => setStep(step.key, { text })}
                  placeholder={`Step ${idx + 1}…`}
                  multiline
                  numberOfLines={2}
                />
                {withSteps && (
                  <StepTimersEditor
                    timers={step.timers}
                    stepText={step.text}
                    onChange={(timers) => setStep(step.key, { timers })}
                  />
                )}
              </View>
              {/* M2: the reorder pair splits the step's height between two
                  28px targets rather than two 15px glyphs. */}
              <View className="shrink-0">
                <Pressable
                  onPress={() => moveStep(step.key, -1)}
                  disabled={idx === 0}
                  hitSlop={{ left: 4, right: 4 }}
                  accessibilityLabel="Move step up"
                  className="h-7 w-9 items-center justify-center"
                >
                  <ChevronUp size={15} className={idx === 0 ? 'text-muted-foreground/30' : 'text-muted-foreground'} />
                </Pressable>
                <Pressable
                  onPress={() => moveStep(step.key, 1)}
                  disabled={idx === form.steps.length - 1}
                  hitSlop={{ left: 4, right: 4 }}
                  accessibilityLabel="Move step down"
                  className="h-7 w-9 items-center justify-center"
                >
                  <ChevronDown
                    size={15}
                    className={idx === form.steps.length - 1 ? 'text-muted-foreground/30' : 'text-muted-foreground'}
                  />
                </Pressable>
              </View>
              <Pressable
                onPress={() => removeStep(step.key)}
                hitSlop={4}
                accessibilityLabel="Remove step"
                className="-mr-1.5 h-9 w-9 items-center justify-center rounded-lg"
              >
                <X size={15} className="text-muted-foreground" />
              </Pressable>
            </View>
          ))}
        </View>
        <Pressable
          onPress={addStep}
          className="h-11 flex-row items-center gap-1.5 self-start rounded-lg border border-dashed border-border px-4"
        >
          <Plus size={14} className="text-muted-foreground" />
          <Text className="text-sm text-muted-foreground">Add step</Text>
        </Pressable>
      </FormSection>
    </ItemFormSheet>

    {isDraftReview && (
      <IngredientQuickEditorSheet
        key={quickEditorOpen ? `quick-${quickEditorId}` : 'quick-closed'}
        open={quickEditorOpen}
        onOpenChange={setQuickEditorOpen}
        ingredient={quickEditorIngredient}
        recipeTitle={form.title || recipe?.title || ''}
        groceryItems={groceryItems}
        allIngredients={allIngredients}
        focusMatch
        onSaveIngredient={(patch) => {
          if (quickEditorId) patchIngredientAndRow(quickEditorId, patch);
        }}
        onRemoveIngredient={(id) => {
          // Soft-delete in the store AND drop the local row — otherwise a
          // later Save (handleSubmit rebuilds every ingredient from
          // form.rows) would resurrect it, since buildRecipeIngredient
          // always sets deleted: false and form.rows still held this row's
          // stale data.
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
                // Mirrors createGroceryItemForIngredient's own item_name link
                // (recipes/index.tsx) so the local row doesn't go stale — same
                // reasoning as patchIngredientAndRow.
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

/**
 * Recipes v2: a step's timers in the form. Each timer is a name and minutes;
 * "Add timer" starts from the time the step's text names, if any.
 */
function StepTimersEditor({
  timers,
  stepText,
  onChange,
}: {
  timers: RecipeStepTimer[];
  stepText: string;
  onChange: (timers: RecipeStepTimer[]) => void;
}) {
  const patch = (i: number, p: Partial<RecipeStepTimer>) =>
    onChange(timers.map((t, j) => (j === i ? { ...t, ...p } : t)));
  const add = () => onChange([...timers, suggestedTimer(stepText) ?? { label: 'Timer', seconds: 300 }]);
  return (
    <View className="gap-1.5">
      {timers.map((t, i) => (
        <View key={i} className="flex-row items-center gap-2">
          <Timer size={14} className="text-muted-foreground" />
          <Input
            className="h-9 min-w-0 flex-1"
            value={t.label}
            onChangeText={(label) => patch(i, { label })}
            accessibilityLabel="Timer name"
          />
          <MinutesInput seconds={t.seconds} onChange={(seconds) => patch(i, { seconds })} />
          <Text className="text-xs text-muted-foreground">min</Text>
          <Pressable
            onPress={() => onChange(timers.filter((_, j) => j !== i))}
            hitSlop={4}
            accessibilityLabel="Remove timer"
            className="-mr-1 h-9 w-9 items-center justify-center rounded-lg"
          >
            <X size={14} className="text-muted-foreground" />
          </Pressable>
        </View>
      ))}
      <Pressable
        onPress={add}
        accessibilityRole="button"
        className="h-9 flex-row items-center gap-1.5 self-start rounded-lg px-2"
      >
        <Plus size={13} className="text-muted-foreground" />
        <Text className="text-xs text-muted-foreground">Add timer</Text>
      </Pressable>
    </View>
  );
}

/** Minutes as typed text, so "1." and an empty field survive while typing. */
function MinutesInput({ seconds, onChange }: { seconds: number; onChange: (seconds: number) => void }) {
  const [text, setText] = React.useState(String(Math.round((seconds / 60) * 10) / 10));
  return (
    <Input
      className="h-9 w-16 text-right"
      style={{ fontVariant: ['tabular-nums'] }}
      keyboardType="decimal-pad"
      value={text}
      onChangeText={(next) => {
        setText(next);
        const minutes = Number(next.replace(',', '.'));
        if (Number.isFinite(minutes) && minutes > 0) onChange(Math.round(minutes * 60));
      }}
      accessibilityLabel="Timer minutes"
    />
  );
}
