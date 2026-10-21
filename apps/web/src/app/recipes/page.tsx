'use client';

// FLUX-189: Recipes section — all-recipes list.
// Group-shared, offline-synced recipe book. Each card shows a live "ingredients
// you have" fill bar (name-matched against groceries). Filter by cuisine tag(s),
// method, a "can make now" toggle, and free-text title search. The ＋ New recipe
// button opens the shared create/edit sheet. Mirrors the Checklists list (FLUX-156).
//
// FLUX-202: "Scan a recipe" (camera + gallery) sends a photo through
// captureRecipeFromPhoto (compress -> Gemini parse -> canonicalize -> draft
// recipe+ingredients+photo), then opens the same form sheet in review mode on
// the new draft. Drafts (draft=true) are hidden from the main list and
// surfaced via a small resume strip; Discard soft-deletes the draft + photo.

import { useMemo, useRef, useState } from 'react';
import { use$ } from '@legendapp/state/react';
import { toast } from 'sonner';
import { Plus, ChefHat, Camera, ImagePlus, Loader2 } from 'lucide-react';
import { useDataCache } from '@/lib/data-cache';
import { createClient } from '@/lib/supabase/client';
import { recipes$, recipeIngredients$, groceryItems$, useReconnectSync, useStoreHelpers, useStoreLoaded, useModules } from '@homeup/core';
import type { GroceryItem, Recipe, RecipeIngredient } from '@homeup/core';
import {
  RECIPE_METHODS,
  methodMeta,
  canBeMade,
  recipeNoteFor,
  buildNeededGroceryItem,
  groceryStatusPatch,
  recipeCuisines,
} from '@homeup/core';
import { captureRecipeFromPhoto, discardRecipeDraftPhoto } from '@/lib/recipe-capture';
import { HeroLede } from '@/components/ui/hero-lede';
import { SectionSearchBar } from '@/components/section-search-bar';
import { useFuzzySearch } from '@/hooks/use-fuzzy-search';
import { RecipeFormSheet } from './recipe-form-sheet';
import { RecipeRow } from './recipe-row';
import { OfflineHint } from '@/components/offline-hint';
import { cn } from '@/lib/utils';
import { useWideLayout } from '@/lib/desktop-layout';
import { WideList } from '@/components/wide-list';

export default function RecipesPage() {
  const { group, currentUserId, isOnline, loading: cacheLoading } = useDataCache();
  const modules = useModules();
  // Modules: have/need, "Can make now" and grocery writes need recipes and
  // groceries (module-features.ts). Off means the shopping list isn't read at all.
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
  const storeLoaded = useStoreLoaded(...(groceriesLinked ? [recs$, ings$, items$] : [recs$, ings$]));

  const allRecipes = use$(() =>
    Object.values(recs$.get() ?? {}).filter((r): r is Recipe => !!r && !r.deleted),
  );
  const recipes = useMemo(
    () => allRecipes.filter((r) => !r.draft).sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')),
    [allRecipes],
  );
  const drafts = useMemo(
    () => allRecipes.filter((r) => r.draft).sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')),
    [allRecipes],
  );
  const allIngredients = use$(() =>
    Object.values(ings$.get() ?? {}).filter((i): i is RecipeIngredient => !!i && !i.deleted),
  );
  const groceryItems = use$(() =>
    Object.values(items$.get() ?? {}).filter((i): i is GroceryItem => !!i && !i.deleted),
  );

  const ingredientsByRecipe = useMemo(() => {
    const m = new Map<string, RecipeIngredient[]>();
    for (const ing of allIngredients) {
      const arr = m.get(ing.recipe_id) ?? [];
      arr.push(ing);
      m.set(ing.recipe_id, arr);
    }
    return m;
  }, [allIngredients]);

  // Cuisine filter options — union across all recipes.
  const cuisineOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of recipes) for (const c of recipeCuisines(r)) set.add(c);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [recipes]);

  const [search, setSearch] = useState('');
  const wide = useWideLayout();
  const [selectedCuisines, setSelectedCuisines] = useState<Set<string>>(new Set());
  const [selectedMethods, setSelectedMethods] = useState<Set<string>>(new Set());
  const [canMakeOnlyPicked, setCanMakeOnly] = useState(false);
  const canMakeOnly = groceriesLinked && canMakeOnlyPicked;
  // null = closed; {} = "New recipe"; {recipe} = edit / draft review.
  const [sheetState, setSheetState] = useState<{ recipe?: Recipe } | null>(null);
  const [scanning, setScanning] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const searched = useFuzzySearch(recipes, search, ['title']);

  const filtered = useMemo(
    () =>
      searched.filter((r) => {
        if (selectedCuisines.size && !recipeCuisines(r).some((c) => selectedCuisines.has(c))) return false;
        // Unset method filters as "other".
        if (selectedMethods.size && !selectedMethods.has(r.method ?? 'other')) return false;
        if (canMakeOnly && !canBeMade(ingredientsByRecipe.get(r.id) ?? [], groceryItems)) return false;
        return true;
      }),
    [searched, selectedCuisines, selectedMethods, canMakeOnly, ingredientsByRecipe, groceryItems],
  );

  // Hearth v2 (Pulse): the Hero caption's "can make now" fragment, from the
  // same canBeMade check the rows and the filter pill already run.
  const canMakeCount = useMemo(
    () =>
      groceriesLinked
        ? recipes.filter((r) => canBeMade(ingredientsByRecipe.get(r.id) ?? [], groceryItems)).length
        : 0,
    [groceriesLinked, recipes, ingredientsByRecipe, groceryItems],
  );

  const toggleIn = (set: Set<string>, setter: (s: Set<string>) => void, value: string) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  };

  const openNew = () => setSheetState({});
  const openReview = (recipe: Recipe) => setSheetState({ recipe });
  const closeSheet = () => setSheetState(null);

  // Persist a newly-created recipe + its ingredients (new manual recipe, or a
  // scan's draft — the sheet flips `draft` to false on Save either way).
  const saveNewRecipe = (recipe: Recipe, ingredients: RecipeIngredient[]) => {
    writeRecipe(recipe);
    ingredients.forEach(writeIngredient);
  };

  // Persist edits to an existing recipe (manual edit, or Save on a draft
  // review), soft-deleting ingredient rows the form dropped.
  const saveEdit = (edited: Recipe, editedIngredients: RecipeIngredient[]) => {
    writeRecipe(edited);
    const prevIngredients = ingredientsByRecipe.get(edited.id) ?? [];
    const keptIds = new Set(editedIngredients.map((i) => i.id));
    editedIngredients.forEach(writeIngredient);
    for (const prev of prevIngredients) {
      if (!keptIds.has(prev.id)) softDeleteIngredient(prev.id);
    }
  };

  // Discard a draft: soft-delete the recipe + its ingredients and remove the
  // linked source photo. Leaving/closing the sheet without Discard or Save
  // keeps the draft (resumable from the strip below).
  const handleDiscard = async (recipe: Recipe) => {
    for (const ing of ingredientsByRecipe.get(recipe.id) ?? []) softDeleteIngredient(ing.id);
    softDeleteRecipe(recipe.id);
    try {
      await discardRecipeDraftPhoto(createClient(), recipe.id);
    } catch {
      // Best-effort: the recipe/ingredients are already tombstoned either way.
    }
  };

  // ── FLUX-205 (P2): draft-review row states — Accept/quick-editor write straight
  //    to the live store (see RecipeFormSheet's onPatchIngredient etc.), same as
  //    the recipe detail page's per-row quick-editor. ───────────────────────────
  const toggleGroceryItemStatus = (match: GroceryItem) => {
    patchGrocery(match.id, groceryStatusPatch(match.status === 'have' ? 'needed' : 'have'));
  };

  const createGroceryItemForIngredient = (
    ingredient: RecipeIngredient,
    input: { name: string; quantity: number | null; unit: string | null; status: GroceryItem['status'] },
  ) => {
    const recipe = sheetState?.recipe;
    if (!group?.id || !recipe) return;
    const trimmedName = input.name.trim();
    if (!trimmedName) return;
    writeGrocery(
      buildNeededGroceryItem({
        groupId: group.id,
        name: trimmedName,
        recipeNote: recipeNoteFor(ingredient, recipe.title),
        recipeSourceId: recipe.id,
        createdBy: currentUserId ?? null,
        quantity: input.quantity,
        unit: input.unit,
        status: input.status,
      }),
    );
    patchIngredient(ingredient.id, { item_name: trimmedName });
  };

  const handleFilePicked = async (file: File | undefined) => {
    if (!file || !group || !isOnline) return;
    setScanning(true);
    try {
      const { recipe, ingredients } = await captureRecipeFromPhoto({
        supabase: createClient(),
        groupId: group.id,
        createdBy: currentUserId ?? null,
        file,
        groceryItems,
        existingIngredients: allIngredients,
      });
      writeRecipe(recipe);
      ingredients.forEach(writeIngredient);
      openReview(recipe);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not scan that photo.');
      openNew();
    } finally {
      setScanning(false);
    }
  };

  if (cacheLoading || (!storeLoaded && recipes.length === 0)) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!group) return <div className="p-6 text-muted-foreground">No group selected</div>;

  const hasFilters = selectedCuisines.size > 0 || selectedMethods.size > 0 || canMakeOnly;

  return (
    <div className={cn('mx-auto space-y-4 p-4 md:p-6 pb-24', wide ? 'max-w-[1400px] lg:px-8' : 'max-w-3xl')}>
      {/* Hearth v2 (Pulse, H1): the recipe count is the page's Hero lede;
          Scan + New recipe sit beside it. Mirrors mobile's grammar. */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <HeroLede
          value={recipes.length}
          label={recipes.length === 1 ? 'recipe' : 'recipes'}
          caption={canMakeCount > 0 ? `${canMakeCount} can make now` : undefined}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          {!isOnline && <OfflineHint />}
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            disabled={scanning || !isOnline}
            aria-label="Scan a recipe with the camera"
            title={isOnline ? 'Scan a recipe with the camera' : 'Scan a recipe with the camera (requires connection)'}
            className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-border bg-muted px-3 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
          >
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            Scan a recipe
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={scanning || !isOnline}
            aria-label="Scan a recipe from a photo in your gallery"
            title={isOnline ? 'Scan a recipe from your gallery' : 'Scan a recipe from your gallery (requires connection)'}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-muted text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
          >
            <ImagePlus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={openNew}
            className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/80"
          >
            <Plus className="h-4 w-4" />
            New recipe
          </button>
        </div>
      </div>

      {/* Drafts resume strip. H2: a neutral v2 card, not a status-tinted
          callout; the chips open in place, so they stay neutral (PC5). */}
      {drafts.length > 0 && (
        <div className="rounded-3xl border border-border/60 bg-card p-4 shadow-[var(--card-shadow)]">
          <p className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Scanned drafts <span className="tabular-nums">{drafts.length}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {drafts.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => openReview(d)}
                className={cn(CHIP, 'border-border bg-muted text-foreground hover:bg-accent')}
              >
                {d.title || 'Untitled scan'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      {recipes.length > 0 && (
        <SectionSearchBar value={search} onChange={setSearch} placeholder="Search recipes…" className="max-w-none" />
      )}

      {/* Filters */}
      {recipes.length > 0 && (
        // Filter chips are chrome: words only, no method emoji (the emoji is
        // a recipe's own glyph, shown on its row). Active = coral (H2).
        <div className="flex flex-wrap items-center gap-2">
          {groceriesLinked && (
            <button
              type="button"
              aria-pressed={canMakeOnly}
              onClick={() => setCanMakeOnly((v) => !v)}
              className={cn(CHIP, canMakeOnly ? CHIP_ON : CHIP_OFF)}
            >
              Can make now
            </button>
          )}
          {RECIPE_METHODS.map((m) => {
            const active = selectedMethods.has(m);
            return (
              <button
                key={m}
                type="button"
                aria-pressed={active}
                onClick={() => toggleIn(selectedMethods, setSelectedMethods, m)}
                className={cn(CHIP, active ? CHIP_ON : CHIP_OFF)}
              >
                {methodMeta(m).label}
              </button>
            );
          })}
          {cuisineOptions.map((c) => {
            const active = selectedCuisines.has(c);
            return (
              <button
                key={c}
                type="button"
                aria-pressed={active}
                onClick={() => toggleIn(selectedCuisines, setSelectedCuisines, c)}
                className={cn(CHIP, 'capitalize', active ? CHIP_ON : CHIP_OFF)}
              >
                {c}
              </button>
            );
          })}
        </div>
      )}

      {/* List */}
      {recipes.length === 0 ? (
        // Hearth §11 empty state, mirroring mobile's EmptyState: one headline,
        // one line, one CTA (scan) plus New recipe as a quiet text link.
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <div className="rounded-2xl bg-primary/10 p-5">
            <ChefHat className="h-7 w-7 text-primary" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-foreground">No recipes yet</h2>
            <p className="max-w-[280px] text-sm text-muted-foreground">
              {groceriesLinked
                ? 'Scan a photo or create one to track its ingredients against your groceries.'
                : 'Scan a photo or create one.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            disabled={scanning || !isOnline}
            className="mt-1 inline-flex h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
          >
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            Scan a recipe
          </button>
          <button
            type="button"
            onClick={openNew}
            className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-2 hover:text-primary/80"
          >
            New recipe
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="px-1 py-8 text-center text-sm text-muted-foreground">
          {hasFilters || search.trim() ? 'No recipes match your filters.' : 'No recipes yet.'}
        </p>
      ) : (
        <WideList>
          {filtered.map((r) => (
            <RecipeRow
              key={r.id}
              recipe={r}
              ingredients={ingredientsByRecipe.get(r.id) ?? []}
              groceryItems={groceryItems}
              groceriesLinked={groceriesLinked}
            />
          ))}
        </WideList>
      )}

      <RecipeFormSheet
        key={sheetState ? (sheetState.recipe?.id ?? 'new') : 'closed'}
        isOpen={!!sheetState}
        recipe={sheetState?.recipe}
        ingredients={sheetState?.recipe ? ingredientsByRecipe.get(sheetState.recipe.id) ?? [] : undefined}
        groupId={group.id}
        groceryItems={groceryItems}
        allIngredients={allIngredients}
        cuisineSuggestions={cuisineOptions}
        onClose={closeSheet}
        onSave={sheetState?.recipe ? saveEdit : saveNewRecipe}
        onDiscard={sheetState?.recipe?.draft ? handleDiscard : undefined}
        onPatchIngredient={sheetState?.recipe?.draft ? patchIngredient : undefined}
        onRemoveIngredientRow={sheetState?.recipe?.draft ? softDeleteIngredient : undefined}
        onToggleGroceryItemStatus={sheetState?.recipe?.draft && groceriesLinked ? toggleGroceryItemStatus : undefined}
        onCreateGroceryItemForIngredient={sheetState?.recipe?.draft && groceriesLinked ? createGroceryItemForIngredient : undefined}
      />

      {/* Hidden file inputs for "Scan a recipe" — camera uses the rear camera on mobile. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { void handleFilePicked(e.target.files?.[0]); e.target.value = ''; }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { void handleFilePicked(e.target.files?.[0]); e.target.value = ''; }}
      />
    </div>
  );
}

// Filter + draft chips: ~28px visual, padded to a 44px hit target (PC3).
const CHIP =
  "relative inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium transition-colors after:absolute after:-inset-y-2 after:inset-x-0 after:content-['']";
const CHIP_ON = 'border-primary bg-primary/15 text-primary';
const CHIP_OFF = 'border-border bg-muted text-muted-foreground hover:text-foreground';
