// HOUP-93: native Recipes — all-recipes list. Faithful-but-focused port of
// apps/web/src/app/recipes/page.tsx: fuzzy search + cuisine/method/can-make-now
// filter pills + the shared create/edit sheet. Mirrors the Checklists list
// (HOUP-79).
//
// HOUP-153: "Scan a recipe" (camera + gallery) sends a photo through
// captureRecipeFromPhoto (read -> Gemini parse -> canonicalize -> draft
// recipe+ingredients+photo), then opens the same form sheet in review mode on
// the new draft. Drafts (draft=true) are hidden from the main list and
// surfaced via a small resume strip; Discard soft-deletes the draft + photo.
//
// HOUP-208: ScrollView (via SectionScreen) -> FlashList. This screen's list
// is flat (no group headers) but still gets FlashList + @homeup/ui's
// flattenGroups/groupFrameClass (a single unheaded group) to reproduce
// ListGroup's per-row frame — matching the HOUP-205/206 pattern. No longer
// uses the SectionScreen shell; the lede/drafts-strip/search/filters hoist
// into ListHeaderComponent, with ScreenBackground + safe-area padding applied
// directly (matching tasks/groceries/costs/appointments/checklists).
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import { use$ } from '@legendapp/state/react';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Plus, ChefHat, Camera, ImagePlus, WifiOff } from 'lucide-react-native';
import {
  Text,
  Button,
  EmptyState,
  HeroLede,
  Card,
  ScreenBackground,
  SectionSearchBar,
  SegmentedControl,
  cn,
  flattenGroups,
  groupFrameClass,
  toast,
  type SectionRow,
} from '@homeup/ui';
import {
  recipes$,
  recipeIngredients$,
  groceryItems$,
  useReconnectSync,
  useStoreHelpers,
  useStoreLoaded,
  useModules,
  RECIPE_METHODS,
  methodMeta,
  canBeMade,
  recipeNoteFor,
  buildNeededGroceryItem,
  groceryStatusPatch,
  recipeCuisines,
  MOTION_DURATIONS_MS,
  type GroceryItem,
  type Recipe,
  type RecipeIngredient,
} from '@homeup/core';
import { useFuzzySearch } from '@homeup/core/src/hooks/use-fuzzy-search';
import { useDataCache } from '@/lib/data-cache';
import { NoGroupScreen } from '@/components/no-group-screen';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { RecipeFormSheet } from '@/features/recipes/recipe-form-sheet';
import { RecipeRow } from '@/features/recipes/recipe-row';
import { captureRecipeFromPhoto, discardRecipeDraftPhoto, type CaptureSource } from '@/features/recipes/recipe-capture';
import { MealWeek } from '@/features/recipes/meal-week';

export default function RecipesSectionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { group, currentUserId, isOnline, loading: cacheLoading, memberProfiles, groupMembers } = useDataCache();
  const modules = useModules();
  // Meal plan: the "This week" tab (module-features.ts). ?tab=week opens it,
  // so Home's Tonight row lands on the week.
  const mealPlanOn = modules.feature('recipes.meal-plan');
  const tabParam = useLocalSearchParams<{ tab?: string }>().tab;
  const [tabPicked, setTabPicked] = React.useState<'all' | 'week'>(tabParam === 'week' ? 'week' : 'all');
  // A later ?tab=week (Home's row while this screen stays mounted) switches too.
  const [seenParam, setSeenParam] = React.useState(tabParam);
  if (tabParam !== seenParam) {
    setSeenParam(tabParam);
    if (tabParam === 'week') setTabPicked('week');
  }
  const tab = mealPlanOn ? tabPicked : 'all';
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

  const allRecipes = use$(() => Object.values(recs$.get() ?? {}).filter((r): r is Recipe => !!r && !r.deleted));
  const recipes = React.useMemo(
    () => allRecipes.filter((r) => !r.draft).sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')),
    [allRecipes]
  );
  const drafts = React.useMemo(
    () => allRecipes.filter((r) => r.draft).sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')),
    [allRecipes]
  );
  const allIngredients = use$(() =>
    Object.values(ings$.get() ?? {}).filter((i): i is RecipeIngredient => !!i && !i.deleted)
  );
  const groceryItems = use$(() =>
    Object.values(items$.get() ?? {}).filter((i): i is GroceryItem => !!i && !i.deleted)
  );

  const ingredientsByRecipe = React.useMemo(() => {
    const m = new Map<string, RecipeIngredient[]>();
    for (const ing of allIngredients) {
      const arr = m.get(ing.recipe_id) ?? [];
      arr.push(ing);
      m.set(ing.recipe_id, arr);
    }
    return m;
  }, [allIngredients]);

  // Cuisine filter options — union across all recipes.
  const cuisineOptions = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of recipes) for (const c of recipeCuisines(r)) set.add(c);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [recipes]);

  const [search, setSearch] = React.useState('');
  const [selectedCuisines, setSelectedCuisines] = React.useState<Set<string>>(new Set());
  const [selectedMethods, setSelectedMethods] = React.useState<Set<string>>(new Set());
  const [canMakeOnlyPicked, setCanMakeOnly] = React.useState(false);
  const canMakeOnly = groceriesLinked && canMakeOnlyPicked;
  // null = closed; {} = "New recipe"; {recipe} = draft review.
  const [sheetState, setSheetState] = React.useState<{ recipe?: Recipe } | null>(null);
  // HOUP-191: `open` is tracked separately from `sheetState` — the sheet is
  // keyed on `sheetState`, so clearing it in the same tick as closing would
  // remount the sheet mid-close and skip the 250ms exit animation entirely.
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [scanning, setScanning] = React.useState(false);

  const searched = useFuzzySearch(recipes, search, ['title']);

  const filtered = React.useMemo(
    () =>
      searched.filter((r) => {
        if (selectedCuisines.size && !recipeCuisines(r).some((c) => selectedCuisines.has(c))) return false;
        // Unset method filters as "other".
        if (selectedMethods.size && !selectedMethods.has(r.method ?? 'other')) return false;
        if (canMakeOnly && !canBeMade(ingredientsByRecipe.get(r.id) ?? [], groceryItems)) return false;
        return true;
      }),
    [searched, selectedCuisines, selectedMethods, canMakeOnly, ingredientsByRecipe, groceryItems]
  );

  // Hearth v2 (Pulse): the Hero caption's "can make now" fragment, from the
  // same canBeMade check the rows and the filter pill already run.
  const canMakeCount = React.useMemo(
    () =>
      groceriesLinked
        ? recipes.filter((r) => canBeMade(ingredientsByRecipe.get(r.id) ?? [], groceryItems)).length
        : 0,
    [groceriesLinked, recipes, ingredientsByRecipe, groceryItems]
  );

  // HOUP-208: this list has no group headers, but still flattens through the
  // shared helper (a single unheaded group) to get ListGroup-equivalent row
  // positions (`pos`) for `groupFrameClass` — the HOUP-205/206 pattern.
  const flatData = React.useMemo<SectionRow<Recipe>[]>(
    () => flattenGroups<Recipe>([{ rows: filtered }], (r) => r.id),
    [filtered]
  );

  const toggleIn = (set: Set<string>, setter: (s: Set<string>) => void, value: string) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  };

  const openNew = () => { setSheetState({}); setSheetOpen(true); };
  const openReview = (recipe: Recipe) => { setSheetState({ recipe }); setSheetOpen(true); };
  const closeSheet = () => {
    setSheetOpen(false);
    setTimeout(() => setSheetState(null), MOTION_DURATIONS_MS.exit);
  };

  // Persist a newly-created recipe + its ingredients, then jump straight to it
  // (mirrors the standalone new/page.tsx route's post-save navigation).
  const saveNewRecipe = (recipe: Recipe, ingredients: RecipeIngredient[]) => {
    writeRecipe(recipe);
    ingredients.forEach(writeIngredient);
    router.push(`/recipes/${recipe.id}` as Href);
  };

  // Persist edits to an existing recipe — a draft-review Save (flips `draft`
  // to false, HOUP-153), soft-deleting ingredient rows the form dropped.
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
      await discardRecipeDraftPhoto(getCurrentSupabaseClient(), recipe.id);
    } catch {
      // Best-effort: the recipe/ingredients are already tombstoned either way.
    }
  };

  // ── HOUP-231: draft-review row states — Accept/quick-editor write straight
  //    to the live store (see RecipeFormSheet's onPatchIngredient etc.), same
  //    as the recipe detail screen's per-row quick-editor. ──────────────────
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

  const handleScan = async (source: CaptureSource) => {
    if (!group || !isOnline || scanning) return;
    setScanning(true);
    try {
      const result = await captureRecipeFromPhoto({
        supabase: getCurrentSupabaseClient(),
        groupId: group.id,
        createdBy: currentUserId ?? null,
        source,
        groceryItems,
        existingIngredients: allIngredients,
      });
      if (!result) return; // user cancelled the picker
      writeRecipe(result.recipe);
      result.ingredients.forEach(writeIngredient);
      openReview(result.recipe);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not scan that photo.');
      openNew();
    } finally {
      setScanning(false);
    }
  };

  if (cacheLoading || (!storeLoaded && recipes.length === 0)) {
    return (
      <ScreenBackground className="items-center justify-center">
        <ActivityIndicator />
      </ScreenBackground>
    );
  }

  if (!group) {
    return <NoGroupScreen />;
  }

  const hasFilters = selectedCuisines.size > 0 || selectedMethods.size > 0 || canMakeOnly;

  const tabs = mealPlanOn ? (
    <SegmentedControl
      options={[
        { value: 'all', label: 'All recipes' },
        { value: 'week', label: 'This week' },
      ]}
      value={tab}
      onChange={setTabPicked}
      accessibilityLabel="Recipes view"
    />
  ) : null;

  if (tab === 'week') {
    return (
      <ScreenBackground>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 96, gap: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text numberOfLines={1} className="text-micro-label uppercase text-muted-foreground">
            Recipes
          </Text>
          {tabs}
          <MealWeek
            groupId={group.id}
            currentUserId={currentUserId ?? null}
            isOnline={isOnline}
            memberProfiles={memberProfiles}
            memberIds={groupMembers.map((m) => m.user_id)}
          />
        </ScrollView>
      </ScreenBackground>
    );
  }

  const listHeader = (
    <View className="gap-4 pb-4">
      {/* H1: one lede. Hearth v2 (Pulse): the recipe count is a Hero number
          under the section's glow; scan/gallery/new sit on the label row
          above it (§11 section screen head). Rows never restate it. */}
      <View className="flex-row items-center justify-between gap-3">
        <Text numberOfLines={1} className="shrink text-micro-label uppercase text-muted-foreground">
          Recipes
        </Text>
        <View className="shrink-0 flex-row items-center gap-1.5">
          {!isOnline && (
            <View className="flex-row items-center gap-1 pr-0.5">
              <WifiOff size={12} className="shrink-0 text-muted-foreground" />
              <Text className="text-xs text-muted-foreground">Requires connection</Text>
            </View>
          )}
          {/* HOUP-231: scan/gallery stay visible while the list is empty (web
              parity). They no longer compete with the empty state's CTA because
              that one's `secondaryAction` renders as a text link, not a button —
              so Hearth §11's one-CTA rule still holds. */}
          <Button
            variant="outline"
            size="sm"
            onPress={() => void handleScan('camera')}
            disabled={scanning || !isOnline}
            accessibilityLabel="Scan a recipe with the camera"
          >
            {scanning ? <ActivityIndicator size="small" /> : <Camera size={14} className="text-foreground" />}
            <Text className="text-sm font-medium text-foreground">Scan a recipe</Text>
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onPress={() => void handleScan('library')}
            disabled={scanning || !isOnline}
            accessibilityLabel="Scan a recipe from a photo in your gallery"
          >
            <ImagePlus size={14} className="text-foreground" />
          </Button>
          <Button size="sm" onPress={openNew}>
            <Plus size={14} className="text-primary-foreground" />
            <Text className="text-sm font-medium text-primary-foreground">New</Text>
          </Button>
        </View>
      </View>
      {tabs}
      <HeroLede
        value={recipes.length}
        label={recipes.length === 1 ? 'recipe' : 'recipes'}
        caption={canMakeCount > 0 ? `${canMakeCount} can make now` : undefined}
      />

      {/* Drafts resume strip. H2: a neutral v2 card, not a status-tinted
          callout; the chips open in place, so they stay neutral (PC5). */}
      {drafts.length > 0 && (
        <Card className="gap-2.5 rounded-3xl px-4">
          <Text className="text-micro-label uppercase text-muted-foreground">
            Scanned drafts <Text style={{ fontVariant: ['tabular-nums'] }}>{drafts.length}</Text>
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {drafts.map((d) => (
              <Pressable
                key={d.id}
                onPress={() => openReview(d)}
                accessibilityRole="button"
                hitSlop={8}
                className="h-7 justify-center rounded-full border border-border bg-muted px-3"
              >
                <Text className="text-xs font-medium text-foreground">{d.title || 'Untitled scan'}</Text>
              </Pressable>
            ))}
          </View>
        </Card>
      )}

      {recipes.length > 0 && (
        <SectionSearchBar value={search} onChange={setSearch} placeholder="Search recipes…" />
      )}

      {/* Filters: chips are chrome, so words only, no method emoji (the
          emoji is a recipe's own glyph, shown on its row). Active = coral (H2). */}
      {recipes.length > 0 && (
        <View className="flex-row flex-wrap items-center gap-2">
          {groceriesLinked && (
            <Pressable
              onPress={() => setCanMakeOnly((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ selected: canMakeOnly }}
              hitSlop={8}
              className={cn(
                'h-7 justify-center rounded-full border px-3',
                canMakeOnly ? 'border-primary bg-primary/15' : 'border-border bg-muted',
              )}
            >
              <Text className={cn('text-xs font-medium', canMakeOnly ? 'text-primary' : 'text-muted-foreground')}>
                Can make now
              </Text>
            </Pressable>
          )}
          {RECIPE_METHODS.map((m) => {
            const active = selectedMethods.has(m);
            return (
              <Pressable
                key={m}
                onPress={() => toggleIn(selectedMethods, setSelectedMethods, m)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                hitSlop={8}
                className={cn(
                  'h-7 justify-center rounded-full border px-3',
                  active ? 'border-primary bg-primary/15' : 'border-border bg-muted',
                )}
              >
                <Text className={cn('text-xs font-medium', active ? 'text-primary' : 'text-muted-foreground')}>
                  {methodMeta(m).label}
                </Text>
              </Pressable>
            );
          })}
          {cuisineOptions.map((c) => {
            const active = selectedCuisines.has(c);
            return (
              <Pressable
                key={c}
                onPress={() => toggleIn(selectedCuisines, setSelectedCuisines, c)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                hitSlop={8}
                className={cn(
                  'h-7 justify-center rounded-full border px-3',
                  active ? 'border-primary bg-primary/15' : 'border-border bg-muted',
                )}
              >
                <Text
                  className={cn('text-xs font-medium capitalize', active ? 'text-primary' : 'text-muted-foreground')}
                >
                  {c}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* HOUP-231: web always shows a "New recipe" path from the empty state
          too. The header's Scan/gallery/New buttons stay visible here (matching
          web) — `secondaryAction` renders as a text link, not a second button,
          so Hearth §11's "one CTA" still holds. Kept as two `&&` blocks rather
          than main's ternary chain: under HOUP-208 the rows come from the
          FlashList below, so this header only ever renders the empty and
          no-match states, never the list itself. */}
      {recipes.length === 0 && (
        <EmptyState
          icon={ChefHat}
          title="No recipes yet"
          description={
            groceriesLinked
              ? 'Scan a photo or create one to track its ingredients against your groceries.'
              : 'Scan a photo or create one.'
          }
          action={{
            label: 'Scan a recipe',
            onPress: () => void handleScan('camera'),
            icon: scanning ? <ActivityIndicator size="small" /> : <Camera size={14} className="text-primary-foreground" />,
            disabled: scanning || !isOnline,
          }}
          secondaryAction={{ label: 'New recipe', onPress: openNew }}
        />
      )}
      {recipes.length > 0 && filtered.length === 0 && (
        <Text className="px-1 py-8 text-center text-sm text-muted-foreground">
          {hasFilters || search.trim() ? 'No recipes match your filters.' : 'No recipes yet.'}
        </Text>
      )}
    </View>
  );

  // This screen's single flattened group never produces a 'group-header' row
  // (flattenGroups only emits one when a `header` is passed), but the shared
  // SectionRow<T> type still carries that variant — narrow it away here.
  const renderItem: ListRenderItem<SectionRow<Recipe>> = ({ item: row }) => {
    if (row.kind === 'group-header') return null;
    return (
      <View className={groupFrameClass(row.pos)}>
        <RecipeRow
          recipe={row.item}
          ingredients={ingredientsByRecipe.get(row.item.id) ?? []}
          groceryItems={groceryItems}
          groceriesLinked={groceriesLinked}
          onPress={() => router.push(`/recipes/${row.item.id}` as Href)}
        />
      </View>
    );
  };

  return (
    <ScreenBackground>
      <FlashList
        data={flatData}
        keyExtractor={(row) => row.id}
        getItemType={(row) => row.kind}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 96,
        }}
      />

      <RecipeFormSheet
        key={sheetState ? (sheetState.recipe?.id ?? 'new') : 'closed'}
        open={sheetOpen}
        onOpenChange={(next) => {
          if (!next) closeSheet();
        }}
        recipe={sheetState?.recipe}
        ingredients={sheetState?.recipe ? ingredientsByRecipe.get(sheetState.recipe.id) ?? [] : undefined}
        groupId={group.id}
        groceryItems={groceryItems}
        allIngredients={allIngredients}
        cuisineSuggestions={cuisineOptions}
        onSave={sheetState?.recipe ? saveEdit : saveNewRecipe}
        onDiscard={sheetState?.recipe?.draft ? handleDiscard : undefined}
        onPatchIngredient={sheetState?.recipe?.draft ? patchIngredient : undefined}
        onRemoveIngredientRow={sheetState?.recipe?.draft ? softDeleteIngredient : undefined}
        onToggleGroceryItemStatus={sheetState?.recipe?.draft && groceriesLinked ? toggleGroceryItemStatus : undefined}
        onCreateGroceryItemForIngredient={sheetState?.recipe?.draft && groceriesLinked ? createGroceryItemForIngredient : undefined}
      />
    </ScreenBackground>
  );
}
