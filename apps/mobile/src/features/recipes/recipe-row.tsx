// The Recipes list row, shared by the Recipes screen and the capture sheet's
// search results (so a recipe hit is the same line item, not a lookalike).
// Moved verbatim from apps/mobile/src/app/(tabs)/recipes/index.tsx.
// Web twin: apps/web/src/app/recipes/recipe-row.tsx.
import { View } from 'react-native';
import {
  Text,
  ListItem,
  ListItemLeading,
  ListItemContent,
  ListItemTitle,
  ListItemMeta,
} from '@homeup/ui';
import {
  methodMeta,
  recipeHaveCount,
  canBeMade,
  recipeCuisines,
  type GroceryItem,
  type Recipe,
  type RecipeIngredient,
} from '@homeup/core';

/** H3: ingredients-you-have progress, scoped to the row (~52px x 3px). */
function HaveMeter({ have, total }: { have: number; total: number }) {
  const pct = total > 0 ? Math.round((Math.min(have, total) / total) * 100) : 0;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: total, now: have }}
      className="h-[3px] w-[52px] overflow-hidden rounded-full bg-muted"
    >
      <View className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
    </View>
  );
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function RecipeRow({
  recipe,
  ingredients,
  groceryItems,
  groceriesLinked,
  staples,
  onPress,
}: {
  recipe: Recipe;
  ingredients: RecipeIngredient[];
  groceryItems: GroceryItem[];
  /** recipes.groceries: the have/need fill and "Can make now" only show while it's on. */
  groceriesLinked: boolean;
  /** Household staples (useRecipeMatch): count as have. */
  staples?: ReadonlySet<string>;
  onPress: () => void;
}) {
  const meta = methodMeta(recipe.method);
  const { have, total } = recipeHaveCount(ingredients, groceryItems, staples);
  const ready = groceriesLinked && canBeMade(ingredients, groceryItems, staples);
  // Plain meta words (pill shape is reserved for tappable chips, PC1): the
  // method when one is set, then the cuisines. Same line on web.
  const kind = [...(recipe.method ? [meta.label] : []), ...recipeCuisines(recipe).map(capitalize)].join(', ');

  return (
    <ListItem onPress={onPress}>
      {/* The method glyph is the recipe's own content glyph (Hearth tenants). */}
      <ListItemLeading className="h-9 w-9 rounded-xl bg-muted">
        <Text className="text-lg">{meta.emoji}</Text>
      </ListItemLeading>
      <ListItemContent>
        <ListItemTitle>{recipe.title}</ListItemTitle>
        <ListItemMeta>
          <View className="flex-row flex-wrap items-center gap-x-2.5 gap-y-0.5">
            {!!kind && (
              <Text numberOfLines={1} className="shrink text-caption text-muted-foreground">
                {kind}
              </Text>
            )}
            {ready ? (
              <Text className="text-caption font-medium text-success">Can make now</Text>
            ) : groceriesLinked && total > 0 ? (
              <View className="flex-row items-center gap-1.5">
                <Text className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                  {have}/{total} have
                </Text>
                <HaveMeter have={have} total={total} />
              </View>
            ) : null}
          </View>
        </ListItemMeta>
      </ListItemContent>
    </ListItem>
  );
}
