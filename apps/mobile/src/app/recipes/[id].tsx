// HOUP-93: native Recipes — recipe detail (the cross-section nexus). Faithful
// port of apps/web/src/app/recipes/[id]/page.tsx: the live ingredient<->grocery
// status view, inline per-ingredient status toggle + "+ Add to list", bulk
// "Add missing to groceries", hold-to-edit -> quick-editor sheet, full edit via
// the shared form sheet, and delete. Grocery writes go through the grocery
// store's useStoreHelpers so a status flip here re-renders the groceries
// screen live (Legend-State cross-section reactivity).
//
// Deferred vs. the web page (named, not dropped): the Hearth §8.1 portal-jump
// view-transition-name claim (groceries -> recipe) has no native equivalent —
// expo-router transitions are a plain descend here; the source-photo
// thumbnail is scan-only (Phase 3, out of scope).
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { use$ } from '@legendapp/state/react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Pencil, Trash2, Plus, Check, RotateCcw, ShoppingCart, Users, Timer, Flame, ChefHat } from 'lucide-react-native';
import {
  Text,
  Button,
  BottomSheet,
  Card,
  HoldFillOverlay,
  ListGroup,
  ProgressBar,
  ScreenBackground,
  SegmentedControl,
  haptics,
  useHoldFill,
  cn,
} from '@homeup/ui';
import {
  recipes$,
  recipeIngredients$,
  groceryItems$,
  useReconnectSync,
  useStoreHelpers,
  useStoreLoaded,
  useModules,
  methodMeta,
  matchIngredientToGrocery,
  ingredientMatchKey,
  recipeHaveCount,
  canBeMade,
  recipeNoteFor,
  buildNeededGroceryItem,
  groceryStatusPatch,
  recipeCuisines,
  recipeSteps,
  stepTimerStates,
  useCookClock,
  useCooks,
  trimQty,
  type GroceryItem,
  type Recipe,
  type RecipeIngredient,
  dialog,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { NoGroupScreen } from '@/components/no-group-screen';
import { RecipeFormSheet } from '@/features/recipes/recipe-form-sheet';
import { IngredientQuickEditorSheet } from '@/features/recipes/ingredient-quick-editor-sheet';
import { RecipeSteps } from '@/features/recipes/recipe-steps';
import { CookCard } from '@/features/cook/cook-card';
import { StepTimerChip } from '@/features/cook/step-timer-chip';
import { askTimerNotificationPermission } from '@/features/cook/cook-alarms';
import { useOpenRoute } from '@/lib/tab-routes';

function nowISO(): string {
  return new Date().toISOString();
}

export default function RecipeDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const openRoute = useOpenRoute();
  const { id: recipeId } = useLocalSearchParams<{ id: string }>();
  const { group, currentUserId, loading: cacheLoading } = useDataCache();
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
  const storeLoaded = useStoreLoaded(...(groceriesLinked ? [recs$, ings$, items$] : [recs$, ings$]));

  const recipe = use$(() => {
    const rec = (recs$.get() ?? {}) as Record<string, Recipe>;
    const r = rec[recipeId];
    return r && !r.deleted ? r : null;
  });
  const allRecipes = use$(() =>
    Object.values(recs$.get() ?? {}).filter((r): r is Recipe => !!r && !r.deleted)
  );
  const allIngredients = use$(() =>
    Object.values(ings$.get() ?? {}).filter((i): i is RecipeIngredient => !!i && !i.deleted)
  );
  const groceryItems = use$(() =>
    Object.values(items$.get() ?? {}).filter((i): i is GroceryItem => !!i && !i.deleted)
  );

  const ingredients = React.useMemo(
    () => allIngredients.filter((i) => i.recipe_id === recipeId).sort((a, b) => a.position - b.position),
    [allIngredients, recipeId]
  );

  const cuisineSuggestions = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of allRecipes) for (const c of recipeCuisines(r)) set.add(c);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [allRecipes]);

  const [isEditOpen, setIsEditOpen] = React.useState(false);
  // Recipes v2: ingredients and steps are two tabs.
  const [pane, setPane] = React.useState<'ingredients' | 'steps'>('ingredients');
  const steps = React.useMemo(() => (recipe ? recipeSteps(recipe) : []), [recipe]);
  // Recipes v2 R2: this recipe's running cook, if any, and a clock that ticks
  // while it has timers.
  const cooks = useCooks(group?.id, currentUserId);
  const cook = cooks.cookForRecipe(recipeId);
  const now = useCookClock(!!cook && cook.session.timers.length > 0);
  const startCooking = () => {
    haptics.commit();
    cooks.start(recipeId);
    setPane('steps');
  };

  const [quickEditorId, setQuickEditorId] = React.useState<string | null>(null);
  const [quickEditorOpen, setQuickEditorOpen] = React.useState(false);
  const [quickEditorFocusMatch, setQuickEditorFocusMatch] = React.useState(false);
  const quickEditorIngredient = quickEditorId ? ingredients.find((i) => i.id === quickEditorId) ?? null : null;

  const openQuickEditor = (ing: RecipeIngredient, focusMatch = false) => {
    setQuickEditorId(ing.id);
    setQuickEditorFocusMatch(focusMatch);
    setQuickEditorOpen(true);
  };

  // ── Grocery mutations ──────────────────────────────────────────────────────
  const addIngredientToList = (ing: RecipeIngredient) => {
    if (!group?.id || !recipe || !groceriesLinked) return;
    const match = matchIngredientToGrocery(ingredientMatchKey(ing), groceryItems);
    const note = recipeNoteFor(ing, recipe.title);
    if (match) {
      patchGrocery(match.id, {
        status: 'needed',
        status_changed_at: nowISO(),
        recipe_note: note,
        recipe_source_id: recipe.id,
      });
    } else {
      writeGrocery(
        buildNeededGroceryItem({
          groupId: group.id,
          name: ingredientMatchKey(ing),
          recipeNote: note,
          recipeSourceId: recipe.id,
          createdBy: currentUserId ?? null,
        })
      );
    }
  };

  // Bulk: add every ingredient not already `have` (creating or note-attaching).
  const addMissing = () => {
    for (const ing of ingredients) {
      const match = matchIngredientToGrocery(ingredientMatchKey(ing), groceryItems);
      if (match?.status === 'have') continue;
      addIngredientToList(ing);
    }
  };

  // Inline per-ingredient status flip (Have <-> Need) on the matched grocery item.
  const toggleIngredientStatus = (match: GroceryItem) => {
    if (match.status === 'have') haptics.select();
    else haptics.tick();
    patchGrocery(match.id, groceryStatusPatch(match.status === 'have' ? 'needed' : 'have'));
  };

  // ── Edit / delete ────────────────────────────────────────────────────────
  const saveEdit = (edited: Recipe, editedIngredients: RecipeIngredient[]) => {
    writeRecipe(edited);
    const keptIds = new Set(editedIngredients.map((i) => i.id));
    editedIngredients.forEach(writeIngredient);
    for (const prev of ingredients) {
      if (!keptIds.has(prev.id)) softDeleteIngredient(prev.id);
    }
  };

  const deleteRecipe = () => {
    if (!recipe) return;
    ingredients.forEach((i) => softDeleteIngredient(i.id));
    softDeleteRecipe(recipe.id);
    openRoute('/recipes');
  };

  // E4: a destructive action confirms first (the themed dialog, as on web).
  const confirmDeleteRecipe = () => {
    if (!recipe) return;
    dialog.alert(`Delete "${recipe.title}"?`, 'This removes the recipe and its ingredients.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: deleteRecipe },
    ]);
  };

  if (cacheLoading || (!storeLoaded && !recipe)) {
    return (
      <ScreenBackground className="items-center justify-center">
        <ActivityIndicator />
      </ScreenBackground>
    );
  }

  if (!group) {
    return <NoGroupScreen />;
  }

  if (!recipe) {
    return (
      <ScreenBackground className="items-center justify-center gap-3 p-6">
        <Text className="text-body text-muted-foreground">Recipe not found.</Text>
        <Button variant="outline" size="sm" onPress={() => openRoute('/recipes')}>
          Back to all recipes
        </Button>
      </ScreenBackground>
    );
  }

  const meta = methodMeta(recipe.method);
  const { have, total } = recipeHaveCount(ingredients, groceryItems);
  const ready = groceriesLinked && canBeMade(ingredients, groceryItems);
  const missingCount = groceriesLinked
    ? ingredients.filter((ing) => matchIngredientToGrocery(ingredientMatchKey(ing), groceryItems)?.status !== 'have').length
    : 0;

  const kind = [...(recipe.method ? [meta.label] : []), ...recipeCuisines(recipe).map(capitalize)].join(', ');
  const hasStats = recipe.servings != null || recipe.prep_minutes != null || recipe.cook_minutes != null;

  return (
    <ScreenBackground>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 p-4"
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 96 }}
      >
        {/* Header */}
        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            className="-ml-2 h-11 w-11 items-center justify-center rounded-lg"
          >
            <ArrowLeft size={20} className="text-muted-foreground" />
          </Pressable>
          {/* The recipe's own glyph (content), in the same tile its row wears. */}
          <View className="h-9 w-9 items-center justify-center rounded-xl bg-muted">
            <Text className="text-lg">{meta.emoji}</Text>
          </View>
          <Text numberOfLines={2} className="min-w-0 flex-1 font-heading text-display font-bold text-foreground">
            {recipe.title}
          </Text>
          <Pressable
            onPress={() => setIsEditOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Edit recipe"
            className="h-11 w-11 items-center justify-center rounded-lg"
          >
            <Pencil size={18} className="text-muted-foreground" />
          </Pressable>
          <Pressable
            onPress={confirmDeleteRecipe}
            accessibilityRole="button"
            accessibilityLabel="Delete recipe"
            className="h-11 w-11 items-center justify-center rounded-lg"
          >
            <Trash2 size={18} className="text-muted-foreground" />
          </Pressable>
        </View>

        {/* Facts + fill bar: one v2 card. Meta words are plain text (pill
            shape means tappable, PC1); servings and times use Lucide. */}
        {(!!kind || hasStats || groceriesLinked) && (
          <Card className="gap-3 rounded-3xl px-4">
            {(!!kind || groceriesLinked) && (
              <View className="flex-row flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <Text className="text-caption text-muted-foreground">{kind}</Text>
                {ready ? (
                  <Text className="text-caption font-medium text-success">Can make now</Text>
                ) : groceriesLinked && total > 0 ? (
                  <Text className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                    {have} of {total} have
                  </Text>
                ) : null}
              </View>
            )}
            {groceriesLinked && total > 0 && <ProgressBar value={have} total={total} className="h-[3px]" />}
            {hasStats && (
              <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1">
                {recipe.servings != null && (
                  <View className="flex-row items-center gap-1.5">
                    <Users size={13} className="text-muted-foreground" />
                    <Text className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                      {recipe.servings} servings
                    </Text>
                  </View>
                )}
                {recipe.prep_minutes != null && (
                  <View className="flex-row items-center gap-1.5">
                    <Timer size={13} className="text-muted-foreground" />
                    <Text className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                      {recipe.prep_minutes} min prep
                    </Text>
                  </View>
                )}
                {recipe.cook_minutes != null && (
                  <View className="flex-row items-center gap-1.5">
                    <Flame size={13} className="text-muted-foreground" />
                    <Text className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                      {recipe.cook_minutes} min cook
                    </Text>
                  </View>
                )}
              </View>
            )}
            {missingCount > 0 &&
              // H5: one primary action per layer; Start cooking takes it when offered.
              (cooks.enabled && steps.length > 0 && !cook ? (
                <Button variant="outline" onPress={addMissing} className="h-11 self-start">
                  <ShoppingCart size={14} className="text-foreground" />
                  <Text className="text-sm font-medium text-foreground">Add {missingCount} missing to groceries</Text>
                </Button>
              ) : (
                <Button onPress={addMissing} className="h-11 self-start">
                  <ShoppingCart size={14} className="text-primary-foreground" />
                  <Text className="text-sm font-medium text-primary-foreground">
                    Add {missingCount} missing to groceries
                  </Text>
                </Button>
              ))}
          </Card>
        )}

        {cooks.enabled && steps.length > 0 && !cook && (
          <Button onPress={startCooking} className="h-12 rounded-xl">
            <ChefHat size={16} className="text-primary-foreground" />
            <Text className="text-sm font-medium text-primary-foreground">Start cooking</Text>
          </Button>
        )}
        {cook && <CookCard cook={cook} cooks={cooks} now={now} />}

        {steps.length > 0 && (
          <SegmentedControl
            options={[
              { value: 'ingredients', label: 'Ingredients' },
              { value: 'steps', label: `Steps · ${steps.length}` },
            ]}
            value={pane}
            onChange={setPane}
            accessibilityLabel="Recipe view"
          />
        )}

        {/* Ingredients: one list card with hairline rows (H4), not a card per row. */}
        {(pane === 'ingredients' || steps.length === 0) && (
        <View className="gap-2">
          <Text className="px-1 text-micro-label uppercase text-muted-foreground">Ingredients</Text>
          {ingredients.length === 0 ? (
            <Text className="px-1 text-sm text-muted-foreground">No ingredients yet. Edit the recipe to add some.</Text>
          ) : (
            <ListGroup>
              {ingredients.map((ing) => (
                <IngredientRow
                  key={ing.id}
                  ingredient={ing}
                  groceriesLinked={groceriesLinked}
                  match={matchIngredientToGrocery(ingredientMatchKey(ing), groceryItems)}
                  onAdd={() => openQuickEditor(ing, true)}
                  onToggle={toggleIngredientStatus}
                  onEdit={() => openQuickEditor(ing)}
                />
              ))}
            </ListGroup>
          )}
        </View>
        )}

        {pane === 'steps' && steps.length > 0 && (
          <RecipeSteps
            steps={steps}
            ingredients={ingredients}
            onOpenIngredient={(ing) => openQuickEditor(ing)}
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

        <RecipeFormSheet
          key={isEditOpen ? 'edit-open' : 'edit-closed'}
          open={isEditOpen}
          onOpenChange={setIsEditOpen}
          recipe={recipe}
          ingredients={ingredients}
          groupId={group.id}
          groceryItems={groceryItems}
          allIngredients={allIngredients}
          cuisineSuggestions={cuisineSuggestions}
          onSave={saveEdit}
        />
  
        <IngredientQuickEditorSheet
          key={quickEditorOpen ? `quick-${quickEditorId}` : 'quick-closed'}
          open={quickEditorOpen}
          onOpenChange={setQuickEditorOpen}
          ingredient={quickEditorIngredient}
          recipeTitle={recipe.title}
          groceryItems={groceryItems}
          allIngredients={allIngredients}
          focusMatch={quickEditorFocusMatch}
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
                    })
                  );
                  patchIngredient(quickEditorIngredient.id, { item_name: trimmedName });
                }
              : undefined
          }
          onEditFullRecipe={() => {
            setQuickEditorOpen(false);
            setIsEditOpen(true);
          }}
        />
      </ScrollView>
    </ScreenBackground>
  );
}

const STATUS_LABEL: Record<GroceryItem['status'], { label: string; className: string }> = {
  have: { label: 'Have', className: 'text-primary' },
  needed: { label: 'Need', className: 'text-warning' },
  bought: { label: 'Got', className: 'text-success' },
};

const LONG_PRESS_MS = 500;

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
  /** Long-press -> hold-menu -> Edit opens the quick-editor sheet. */
  onEdit: () => void;
}) {
  const amount =
    ingredient.quantity != null
      ? `${trimQty(ingredient.quantity)}${ingredient.unit ? ` ${ingredient.unit}` : ''}`
      : ingredient.unit ?? '';

  const [holdMenuOpen, setHoldMenuOpen] = React.useState(false);
  const holdFill = useHoldFill(LONG_PRESS_MS);

  return (
    <View className="relative overflow-hidden">
      <HoldFillOverlay progress={holdFill.progress} />
      <View className="min-h-[55px] flex-row items-center gap-3 px-3 py-2.5">
        {/* The gesture zone covers the name/amount area only — the trailing
            status/add button stays a plain sibling Pressable so its own tap
            never has to fight the row's long-press gesture arbitration. */}
        <Pressable
          delayLongPress={LONG_PRESS_MS}
          onPressIn={holdFill.start}
          onPressOut={holdFill.stop}
          onLongPress={() => {
            haptics.commit();
            setHoldMenuOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Open actions for ${ingredient.name}`}
          className="min-w-0 flex-1 active:opacity-80"
        >
          <Text numberOfLines={1} className="text-sm text-foreground">
            {ingredient.name}
          </Text>
          <View className="mt-0.5 flex-row flex-wrap items-center gap-x-2.5 gap-y-0.5">
            {!!amount && (
              <Text className="text-xs text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                {amount}
              </Text>
            )}
            {/* Display-only linked grocery (D6): plain meta, not a chip,
                since it is not a tap target (PC1). */}
            {ingredient.item_name && (
              <View className="min-w-0 shrink flex-row items-center gap-1">
                <ShoppingCart size={11} className="text-muted-foreground" />
                <Text numberOfLines={1} className="shrink text-xs text-muted-foreground">
                  {ingredient.item_name}
                </Text>
              </View>
            )}
          </View>
        </Pressable>

        {!groceriesLinked ? null : match ? (
          <Pressable
            onPress={() => onToggle(match)}
            accessibilityLabel="Flip between Have and Need"
            hitSlop={6}
            className={cn(
              'h-8 shrink-0 flex-row items-center gap-1 rounded-full border px-3',
              match.status === 'have' ? 'border-primary/40 bg-primary/10' : 'border-border bg-muted',
            )}
          >
            {match.status === 'have' ? (
              <Check size={13} className="text-primary" />
            ) : (
              <RotateCcw size={13} className="text-foreground" />
            )}
            <Text className={cn('text-xs font-medium', STATUS_LABEL[match.status].className)}>
              {STATUS_LABEL[match.status].label}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={onAdd}
            accessibilityLabel="Add to shopping list"
            hitSlop={6}
            className="h-8 shrink-0 flex-row items-center gap-1 rounded-full border border-border bg-muted px-3"
          >
            <Plus size={13} className="text-muted-foreground" />
            <Text className="text-xs font-medium text-muted-foreground">Add to list</Text>
          </Pressable>
        )}
      </View>

      {/* Hold-menu (Hearth E1-E4) — long-press the row content to edit. */}
      <BottomSheet open={holdMenuOpen} onOpenChange={setHoldMenuOpen}>
        <Pressable
          onPress={() => {
            setHoldMenuOpen(false);
            onEdit();
          }}
          className="flex-row items-center gap-2 px-4 py-3"
        >
          <Pencil size={15} className="text-foreground" />
          <Text className="text-sm font-medium text-foreground">Edit</Text>
        </Pressable>
      </BottomSheet>
    </View>
  );
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
