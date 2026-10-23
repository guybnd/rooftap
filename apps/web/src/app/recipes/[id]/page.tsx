'use client';

// FLUX-189: Recipes — recipe detail (the cross-section nexus).
//
// Owns: the live ingredient↔grocery status view, the inline per-ingredient status
// toggle + "＋ Add to list", the bulk "Add missing to groceries", editing via the
// shared form sheet, and delete. Grocery writes go through the grocery store's
// useStoreHelpers so a status flip here re-renders the groceries page live
// (Legend-State cross-section reactivity). Matching + note rules come from
// @/lib/recipes so every surface agrees.

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { use$ } from '@legendapp/state/react';
import { ArrowLeft, Pencil, Trash2, Plus, Check, RotateCcw, ShoppingCart, Users, Timer, Flame, ChefHat, Play } from 'lucide-react';
import { useDataCache } from '@/lib/data-cache';
import { recipes$, recipeIngredients$, groceryItems$, useReconnectSync, useStoreHelpers, useStoreLoaded, useModules } from '@homeup/core';
import { dialog } from '@homeup/core';
import type { GroceryItem, Recipe, RecipeIngredient, RecipeShoppingLine } from '@homeup/core';
import {
  methodMeta,
  matchIngredientToGrocery,
  ingredientMatchKey,
  recipeHaveCount,
  useRecipeMatch,
  canBeMade,
  recipeNoteFor,
  recipeLineWrite,
  recipeShoppingLines,
  buildNeededGroceryItem,
  groceryStatusPatch,
  recipeCuisines,
  recipeSteps,
  stepTimerStates,
  useCookClock,
  useCooks,
  cookModeHref,
  trimQty,
} from '@homeup/core';
import { ProgressBar } from '@/components/ui/progress-bar';
import { ListGroup } from '@/components/ui/list-item';
import { navLinkClickHandler, clearPortalMorphOnSettle } from '@/lib/view-transitions';
import { EntityPhotoThumbnail } from '@/components/documents/entity-photo-thumbnail';
import { RecipeFormSheet } from '../recipe-form-sheet';
import { RecipeSteps } from '../recipe-steps';
import { CookCard } from '@/components/cook/cook-card';
import { StepTimerChip } from '@/components/cook/step-timer-chip';
import { askTimerNotificationPermission } from '@/components/cook/cook-alarms';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { IngredientQuickEditorSheet } from '../ingredient-quick-editor-sheet';
import { AddMissingSheet } from '../add-missing-sheet';
import { useLongPress } from '@/hooks/use-long-press';
import { PopMenu, MenuItem } from '@/app/setup/pop-menu';
import { cn } from '@/lib/utils';
import { useWideLayout } from '@/lib/desktop-layout';

function nowISO(): string {
  return new Date().toISOString();
}

export default function RecipeDetailPage() {
  const router = useRouter();
  const wide = useWideLayout();
  const params = useParams<{ id: string }>();
  const recipeId = params.id;
  const { group, currentUserId, loading: cacheLoading } = useDataCache();

  // Hearth §8.1 portal jump: only claim the shared `portal-recipe-<id>`
  // view-transition-name when this page was actually reached via a portal
  // tap (grocery-item-card.tsx sets `data-nav-transition="portal"` on <html>
  // before navigating) — otherwise a plain descend/direct load would also
  // pop this title in on its own, fighting the whole-page slide.
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (titleRef.current && document.documentElement.dataset.navTransition === 'portal') {
      const name = `portal-recipe-${recipeId}`;
      titleRef.current.style.viewTransitionName = name;
      // FLUX-1553 review: clear the name once this transition settles —
      // otherwise it stays on the title forever, detaching it from the
      // page-level slide group on the *next* navigation (e.g. Back).
      clearPortalMorphOnSettle(titleRef.current, name);
    }
  }, [recipeId]);

  const modules = useModules();
  // Modules: have/need, "Add missing", "Add to list" and every grocery write need
  // recipes and groceries (module-features.ts). Off means the shopping list isn't read.
  const groceriesLinked = modules.feature('recipes.groceries');

  const recs$ = recipes$(group?.id);
  const ings$ = recipeIngredients$(group?.id);
  const items$ = groceryItems$(groceriesLinked ? group?.id : undefined);
  useReconnectSync(recs$);
  useReconnectSync(ings$);
  useReconnectSync(items$);

  const { writeRow: writeRecipe, softDeleteRow: softDeleteRecipe } = useStoreHelpers(recs$, currentUserId);
  const { writeRow: writeIngredient, patchRow: patchIngredient, softDeleteRow: softDeleteIngredient } =
    useStoreHelpers(ings$, currentUserId);
  const { writeRow: writeGrocery, patchRow: patchGrocery } = useStoreHelpers(items$, currentUserId);
  // Recipes v2 R5: staples are always in stock and never go on the list.
  const { staples, canRemember, setStaple } = useRecipeMatch(group?.id, currentUserId);
  const storeLoaded = useStoreLoaded(...(groceriesLinked ? [recs$, ings$, items$] : [recs$, ings$]));

  const recipe = use$(() => {
    const rec = (recs$.get() ?? {}) as Record<string, Recipe>;
    const r = rec[recipeId];
    return r && !r.deleted ? r : null;
  });
  const allRecipes = use$(() =>
    Object.values(recs$.get() ?? {}).filter((r): r is Recipe => !!r && !r.deleted),
  );
  const allIngredients = use$(() =>
    Object.values(ings$.get() ?? {}).filter((i): i is RecipeIngredient => !!i && !i.deleted),
  );
  const groceryItems = use$(() =>
    Object.values(items$.get() ?? {}).filter((i): i is GroceryItem => !!i && !i.deleted),
  );

  const ingredients = useMemo(
    () => allIngredients.filter((i) => i.recipe_id === recipeId).sort((a, b) => a.position - b.position),
    [allIngredients, recipeId],
  );

  const cuisineSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRecipes) for (const c of recipeCuisines(r)) set.add(c);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [allRecipes]);

  const [isEditOpen, setIsEditOpen] = useState(false);
  // Recipes v2: on a narrow screen ingredients and steps are two tabs; wide
  // screens show both side by side.
  const [pane, setPane] = useState<'ingredients' | 'steps'>('ingredients');
  const steps = useMemo(() => (recipe ? recipeSteps(recipe) : []), [recipe]);
  // Recipes v2 R2: this recipe's running cook, if any, and a clock that ticks
  // while it has timers.
  const cooks = useCooks(group?.id, currentUserId);
  const cook = cooks.cookForRecipe(recipeId);
  const now = useCookClock(!!cook && cook.session.timers.length > 0);
  const startCooking = () => {
    cooks.start(recipeId);
    setPane('steps');
  };

  // ── Quick-editor sheet (FLUX-205 D5) — per-row descriptor/qty/unit edit +
  //    match picker. Same key-remount convention as RecipeFormSheet below: the
  //    sheet key changes on every open (forcing a fresh instance per row), and
  //    `quickEditorId` stays set while closing so a reopen of the same row still
  //    reads its current data instead of a stale/undefined ingredient. ─────────
  const [quickEditorId, setQuickEditorId] = useState<string | null>(null);
  const [quickEditorOpen, setQuickEditorOpen] = useState(false);
  const [quickEditorFocusMatch, setQuickEditorFocusMatch] = useState(false);
  const quickEditorIngredient = quickEditorId
    ? ingredients.find((i) => i.id === quickEditorId) ?? null
    : null;

  const openQuickEditor = (ing: RecipeIngredient, focusMatch = false) => {
    setQuickEditorId(ing.id);
    setQuickEditorFocusMatch(focusMatch);
    setQuickEditorOpen(true);
  };
  const closeQuickEditor = () => {
    setQuickEditorOpen(false);
    if (backToMissing.current) {
      backToMissing.current = false;
      setMissingOpen(true);
    }
  };

  // ── Grocery mutations ────────────────────────────────────────────────────────
  // One write per grocery item: lines that buy the same item fold into one
  // row with both amounts in its note (recipeShoppingLines), so two blood
  // orange lines never make two rows.
  const addLines = (lines: RecipeShoppingLine[]) => {
    if (!group?.id || !recipe || !groceriesLinked || lines.length === 0) return;
    for (const line of lines) {
      const w = recipeLineWrite(line, { groupId: group.id, recipeId: recipe.id, createdBy: currentUserId ?? null });
      if (w.kind === 'patch') patchGrocery(w.id, w.patch);
      else writeGrocery(w.item);
    }
    toast.success(lines.length === 1 ? `Added ${lines[0].name} to Groceries` : `Added ${lines.length} to Groceries`);
  };

  // "Add to list" on one row: straight onto the list, no editor in the way.
  const addIngredientToList = (ing: RecipeIngredient) => {
    if (!recipe) return;
    addLines(recipeShoppingLines([ing], groceryItems, recipe.title).filter((l) => !l.onList));
  };

  // "Add missing" opens a review sheet; clicking a row there edits that
  // ingredient and comes back to the sheet when the editor closes.
  const [missingOpen, setMissingOpen] = useState(false);
  const backToMissing = useRef(false);
  const editFromMissing = (ing: RecipeIngredient) => {
    backToMissing.current = true;
    setMissingOpen(false);
    openQuickEditor(ing);
  };

  // Inline per-ingredient status flip (Have ↔ Need) on the matched grocery item.
  const toggleIngredientStatus = (match: GroceryItem) => {
    patchGrocery(match.id, groceryStatusPatch(match.status === 'have' ? 'needed' : 'have'));
  };

  // ── Edit / delete ──────────────────────────────────────────────────────────────
  const saveEdit = (edited: Recipe, editedIngredients: RecipeIngredient[]) => {
    writeRecipe(edited);
    const keptIds = new Set(editedIngredients.map((i) => i.id));
    editedIngredients.forEach(writeIngredient);
    // Soft-delete rows that were removed in the form.
    for (const prev of ingredients) {
      if (!keptIds.has(prev.id)) softDeleteIngredient(prev.id);
    }
  };

  const deleteRecipe = async () => {
    if (!recipe) return;
    // E4: a destructive action confirms first (same themed dialog as the
    // checklist detail's Delete list).
    const confirmed = await dialog.confirm({
      title: `Delete "${recipe.title}"?`,
      message: 'This removes the recipe and its ingredients.',
      destructive: true,
    });
    if (!confirmed) return;
    ingredients.forEach((i) => softDeleteIngredient(i.id));
    softDeleteRecipe(recipe.id);
    router.push('/recipes');
  };

  if (cacheLoading || (!storeLoaded && !recipe)) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!group) return <div className="p-6 text-muted-foreground">No group selected</div>;
  if (!recipe)
    return (
      <div className="p-6 text-muted-foreground">
        Recipe not found.{' '}
        <Link href="/recipes" className="text-primary hover:text-primary/80">
          Back to all recipes
        </Link>
      </div>
    );

  const meta = methodMeta(recipe.method);
  const { have, total } = recipeHaveCount(ingredients, groceryItems, staples);
  const ready = groceriesLinked && canBeMade(ingredients, groceryItems, staples);
  const shoppingLines = groceriesLinked ? recipeShoppingLines(ingredients, groceryItems, recipe.title, staples) : [];
  const missingCount = shoppingLines.filter((l) => !l.onList).length;

  const kind = [...(recipe.method ? [meta.label] : []), ...recipeCuisines(recipe).map(capitalize)].join(', ');
  const hasStats = recipe.servings != null || recipe.prep_minutes != null || recipe.cook_minutes != null;

  return (
    <div className={cn('mx-auto space-y-4 p-4 md:p-6 pb-24', wide ? 'max-w-6xl lg:px-8' : 'max-w-2xl')}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <Link
          href="/recipes"
          aria-label="Back to recipes"
          className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={navLinkClickHandler('back', router, '/recipes')}
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        {/* The recipe's own glyph (content), in the same tile its row wears. */}
        <span aria-hidden className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-lg">
          {meta.emoji}
        </span>
        {/* Wraps to a second line rather than truncating beside the actions. */}
        <h1 ref={titleRef} className="line-clamp-2 min-w-0 flex-1 text-2xl font-bold leading-tight text-foreground">
          {recipe.title}
        </h1>
        {steps.length > 0 && (
          <Link
            href={cookModeHref(recipe.id)}
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-primary hover:bg-muted"
          >
            <Play className="h-4 w-4" />
            Cook mode
          </Link>
        )}
        <button
          type="button"
          onClick={() => setIsEditOpen(true)}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Edit recipe"
        >
          <Pencil className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={deleteRecipe}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive"
          aria-label="Delete recipe"
        >
          <Trash2 className="h-5 w-5" />
        </button>
      </div>

      {/* Facts + fill bar: one v2 card. Meta words are plain text (pill shape
          means tappable, PC1); servings and times use Lucide, not emoji. */}
      {(kind || hasStats || groceriesLinked) && (
        <div className="space-y-3 rounded-3xl border border-border/60 bg-card p-4 shadow-[var(--card-shadow)]">
          {(kind || groceriesLinked) && (
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{kind}</span>
              {ready ? (
                <span className="font-medium text-success">Can make now</span>
              ) : groceriesLinked && total > 0 ? (
                <span className="tabular-nums">
                  {have} of {total} have
                </span>
              ) : null}
            </div>
          )}
          {groceriesLinked && total > 0 && <ProgressBar value={have} total={total} className="h-[3px]" />}
          {hasStats && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {recipe.servings != null && (
                <span className="inline-flex items-center gap-1.5 tabular-nums">
                  <Users className="h-3.5 w-3.5" />
                  {recipe.servings} servings
                </span>
              )}
              {recipe.prep_minutes != null && (
                <span className="inline-flex items-center gap-1.5 tabular-nums">
                  <Timer className="h-3.5 w-3.5" />
                  {recipe.prep_minutes} min prep
                </span>
              )}
              {recipe.cook_minutes != null && (
                <span className="inline-flex items-center gap-1.5 tabular-nums">
                  <Flame className="h-3.5 w-3.5" />
                  {recipe.cook_minutes} min cook
                </span>
              )}
            </div>
          )}
          {missingCount > 0 && (
            <button
              type="button"
              onClick={() => setMissingOpen(true)}
              className={cn(
                'inline-flex h-11 items-center gap-1.5 rounded-lg px-4 text-sm font-medium',
                // H5: one primary action per layer; Start cooking takes it when offered.
                cooks.enabled && steps.length > 0 && !cook
                  ? 'border border-border bg-muted text-foreground hover:bg-accent'
                  : 'bg-primary text-primary-foreground hover:bg-primary/80',
              )}
            >
              <ShoppingCart className="h-4 w-4" />
              Add {missingCount} missing to groceries
            </button>
          )}
        </div>
      )}

      {/* Hearth §13.7 "Desktop shell": on a wide screen the ingredients and
          the method sit side by side, the method holding still as you scroll. */}
      <div className={wide ? 'grid grid-cols-2 items-start gap-6' : 'space-y-4'}>
      {cooks.enabled && steps.length > 0 && !cook && (
        <button
          type="button"
          onClick={startCooking}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/85"
        >
          <ChefHat className="h-4 w-4" />
          Start cooking
        </button>
      )}
      {cook && <CookCard cook={cook} cooks={cooks} now={now} />}

      {!wide && steps.length > 0 && (
        <SegmentedControl
          options={[
            { value: 'ingredients', label: 'Ingredients' },
            { value: 'steps', label: `Steps · ${steps.length}` },
          ]}
          value={pane}
          onChange={setPane}
          ariaLabel="Recipe view"
          className="w-full"
        />
      )}
      {/* Ingredients: one list card with hairline rows (H4), not a card per row. */}
      {(wide || pane === 'ingredients' || steps.length === 0) && (
      <div className="space-y-2">
        <h2 className="px-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Ingredients
        </h2>
        {ingredients.length === 0 ? (
          <p className="px-1 text-sm text-muted-foreground">No ingredients yet. Edit the recipe to add some.</p>
        ) : (
          <ListGroup>
            {ingredients.map((ing) => (
              <IngredientRow
                key={ing.id}
                ingredient={ing}
                groceriesLinked={groceriesLinked}
                match={matchIngredientToGrocery(ingredientMatchKey(ing), groceryItems)}
                onAdd={() => addIngredientToList(ing)}
                onToggle={toggleIngredientStatus}
                onEdit={() => openQuickEditor(ing, false)}
              />
            ))}
          </ListGroup>
        )}
      </div>
      )}

      {(wide || pane === 'steps' || steps.length === 0) && (
      <div className={cn('space-y-4', wide && 'sticky top-4')}>
      {steps.length > 0 && (
        <RecipeSteps
          steps={steps}
          ingredients={ingredients}
          onOpenIngredient={(ing) => openQuickEditor(ing, false)}
          currentStep={cook?.step ?? null}
          renderTimer={
            cooks.enabled
              ? (t, stepIndex, timerIndex) => {
                  const state = stepTimerStates(cook?.session ?? null, steps[stepIndex], stepIndex, now)[timerIndex];
                  const timerId = state?.running?.timer.id;
                  return (
                    <StepTimerChip
                      label={t.label}
                      seconds={t.seconds}
                      running={state?.running ?? null}
                      onStart={() => {
                        askTimerNotificationPermission();
                        cooks.start(recipeId, { step: stepIndex, index: timerIndex });
                      }}
                      onPause={() => cook && timerId && cooks.pause(cook.session.id, timerId)}
                      onResume={() => cook && timerId && cooks.resume(cook.session.id, timerId)}
                      onDismiss={() => cook && timerId && cooks.stopTimer(cook.session.id, timerId)}
                    />
                  );
                }
              : undefined
          }
        />
      )}

      {/* Source photo (FLUX-202) */}
      {recipe.source_type === 'photo' && (
        <EntityPhotoThumbnail entityType="recipe" entityId={recipe.id} label="View original photo" />
      )}
      </div>
      )}
      </div>

      <RecipeFormSheet
        key={isEditOpen ? 'edit-open' : 'edit-closed'}
        isOpen={isEditOpen}
        recipe={recipe}
        ingredients={ingredients}
        groupId={group.id}
        groceryItems={groceryItems}
        allIngredients={allIngredients}
        cuisineSuggestions={cuisineSuggestions}
        onClose={() => setIsEditOpen(false)}
        onSave={saveEdit}
      />

      <AddMissingSheet
        open={missingOpen}
        onOpenChange={setMissingOpen}
        recipeTitle={recipe.title}
        lines={shoppingLines}
        canRemember={canRemember}
        onSetStaple={(name) => setStaple(name, true)}
        onEdit={editFromMissing}
        onAdd={addLines}
      />

      <IngredientQuickEditorSheet
        key={quickEditorOpen ? `quick-${quickEditorId}` : 'quick-closed'}
        isOpen={quickEditorOpen}
        ingredient={quickEditorIngredient}
        recipeTitle={recipe.title}
        groceryItems={groceryItems}
        allIngredients={allIngredients}
        focusMatch={quickEditorFocusMatch}
        onClose={closeQuickEditor}
        onSaveIngredient={(patch) => {
          if (quickEditorId) patchIngredient(quickEditorId, patch);
        }}
        onRemoveIngredient={softDeleteIngredient}
        onToggleGroceryStatus={groceriesLinked ? toggleIngredientStatus : undefined}
        onCreateGroceryItem={
          groceriesLinked
            ? (input) => {
                if (!group?.id || !quickEditorIngredient) return;
                const trimmedName = input.name.trim();
                if (!trimmedName) return;
                writeGrocery(
                  buildNeededGroceryItem({
                    groupId: group.id,
                    name: trimmedName,
                    recipeNote: recipeNoteFor(quickEditorIngredient, recipe.title),
                    recipeSourceId: recipe.id,
                    createdBy: currentUserId ?? null,
                    quantity: input.quantity,
                    unit: input.unit,
                    status: input.status,
                  }),
                );
                patchIngredient(quickEditorIngredient.id, { item_name: trimmedName });
              }
            : undefined
        }
        onEditFullRecipe={() => {
          backToMissing.current = false;
          closeQuickEditor();
          setIsEditOpen(true);
        }}
      />
    </div>
  );
}

const STATUS_LABEL: Record<GroceryItem['status'], { label: string; className: string }> = {
  have: { label: 'Have', className: 'text-primary' },
  needed: { label: 'Need', className: 'text-warning' },
  bought: { label: 'Got', className: 'text-success' },
};

function IngredientRow({
  ingredient,
  groceriesLinked,
  match,
  onAdd,
  onToggle,
  onEdit,
}: {
  ingredient: RecipeIngredient;
  /** recipes.groceries: the Have/Need toggle and "Add to list" only show while it's on. */
  groceriesLinked: boolean;
  match: GroceryItem | null;
  onAdd: () => void;
  onToggle: (match: GroceryItem) => void;
  /** Long-press → hold-menu → Edit opens the quick-editor sheet (FLUX-205 D5/D6). */
  onEdit: () => void;
}) {
  const amount =
    ingredient.quantity != null
      ? `${trimQty(ingredient.quantity)}${ingredient.unit ? ` ${ingredient.unit}` : ''}`
      : ingredient.unit ?? '';

  const [holdMenuOpen, setHoldMenuOpen] = useState(false);
  const longPress = useLongPress(() => setHoldMenuOpen(true));

  return (
    <div
      {...longPress.handlers}
      className="relative flex min-h-[55px] select-none items-center gap-3 px-3 py-2.5 [-webkit-touch-callout:none]"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-foreground">{ingredient.name}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
          {amount && <span className="tabular-nums">{amount}</span>}
          {/* Display-only linked grocery (D6): plain meta, not a chip, since
              it is not a tap target (PC1); re-pick/unlink go through the
              hold-menu, same as descriptor/qty/unit. */}
          {ingredient.item_name && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <ShoppingCart className="h-3 w-3 shrink-0" />
              <span className="truncate">{ingredient.item_name}</span>
            </span>
          )}
        </div>
      </div>
      {!groceriesLinked ? null : match ? (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onToggle(match)}
          title="Flip between Have and Need"
          className={cn(
            "relative inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-xs font-medium transition-colors after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-['']",
            match.status === 'have'
              ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20'
              : 'border-border bg-muted text-foreground hover:bg-accent',
          )}
        >
          {match.status === 'have' ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <RotateCcw className="h-3.5 w-3.5" />
          )}
          <span className={STATUS_LABEL[match.status].className}>{STATUS_LABEL[match.status].label}</span>
        </button>
      ) : (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onAdd}
          title="Add to shopping list"
          className="relative inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-border bg-muted px-3 text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-['']"
        >
          <Plus className="h-3.5 w-3.5" />
          Add to list
        </button>
      )}

      {/* Hold-menu (FLUX-205 D5) — long-press anywhere on the row opens this as a
          bottom sheet (mobileSheet); the invisible trigger only exists so the
          floating-panel desktop layout has a real anchor rect. No visible pencil
          icon on the row itself (Guy: long-press only, not tap-anywhere). */}
      <PopMenu
        open={holdMenuOpen}
        onOpenChange={setHoldMenuOpen}
        mobileSheet
        align="right"
        width="w-40"
        trigger={null}
        triggerLabel="Ingredient actions"
        triggerClassName="absolute inset-0 opacity-0 pointer-events-none"
      >
        {(close) => (
          <MenuItem
            icon={<Pencil className="h-3.5 w-3.5" />}
            onClick={() => {
              onEdit();
              close();
            }}
          >
            Edit
          </MenuItem>
        )}
      </PopMenu>
    </div>
  );
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
