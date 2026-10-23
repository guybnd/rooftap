// One night of the meal plan, as a bottom sheet (M4): pick a recipe, a quick
// label (Leftovers, Out) or a few words, and who cooks. Once a night has a
// recipe, the list adds more dishes (a main plus sides and a dessert) and the
// sheet stays open; each dish's role chip cycles Main, Side, Dessert. Every
// choice applies at once, no Save. Web twin:
// apps/web/src/app/recipes/meal-night-sheet.tsx.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Check, X } from 'lucide-react-native';
import {
  BottomSheet,
  BottomSheetScrollView,
  Input,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemLeading,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
  Text,
  cn,
  haptics,
} from '@homeup/ui';
import {
  formatMealMinutes,
  MEAL_QUICK_LABELS,
  MEAL_ROLE_LABEL,
  MEAL_ROLES,
  mealNightLabel,
  methodMeta,
  recipeMinutes,
  type MealPick,
  type MealRole,
  type Recipe,
} from '@homeup/core';

export function MealNightSheet({
  open,
  onOpenChange,
  date,
  recipes,
  current,
  hint,
  members,
  onPick,
  onCook,
  onClear,
  dishes = [],
  onAddDish,
  onRemoveDish,
  onDishRole,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  recipes: Recipe[];
  current: { recipeId: string | null; label: string | null; cookUserId: string | null };
  hint: string | null;
  /** Who can cook; empty hides the row (a draft night, or a night with nothing on it yet). */
  members: { id: string; name: string }[];
  onPick: (pick: MealPick) => void;
  onCook: (userId: string | null) => void;
  onClear?: () => void;
  /** The night's dishes; with onAddDish set, the recipe list adds to them. */
  dishes?: { id: string; recipeId: string; title: string; role: MealRole; time: string | null }[];
  onAddDish?: (recipeId: string) => void;
  onRemoveDish?: (entryId: string) => void;
  onDishRole?: (entryId: string, role: MealRole) => void;
}) {
  const [query, setQuery] = React.useState('');
  const [other, setOther] = React.useState('');
  const { weekday, day } = mealNightLabel(date);
  const [y, m, d] = date.split('-').map(Number);
  const month = new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short' });

  const shown = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? recipes.filter((r) => r.title.toLowerCase().includes(q)) : recipes;
  }, [recipes, query]);

  const pick = (p: MealPick) => {
    haptics.select();
    onPick(p);
    onOpenChange(false);
    setQuery('');
    setOther('');
  };

  // Several dishes: once the night has a recipe, the list adds and removes dishes.
  const stacking = !!onAddDish && dishes.length > 0;
  const dishFor = (recipeId: string) => dishes.find((dish) => dish.recipeId === recipeId);
  const tapRecipe = (recipeId: string) => {
    if (!stacking) return pick({ recipeId });
    const on = dishFor(recipeId);
    if (on) {
      haptics.remove();
      onRemoveDish?.(on.id);
    } else {
      haptics.commit();
      onAddDish?.(recipeId);
    }
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} className="pb-4" keyboardAware>
      <View className="gap-2 px-4 pb-2">
        <Text className="text-micro-label uppercase text-muted-foreground">
          Dinner, {weekday} {day} {month}
        </Text>
        {!!hint && <Text className="text-caption text-muted-foreground">{hint}</Text>}
        <View className="flex-row flex-wrap gap-2">
          {MEAL_QUICK_LABELS.map((label) => {
            const on = !current.recipeId && current.label === label;
            return <Chip key={label} label={label} on={on} onPress={() => pick({ label })} />;
          })}
        </View>
        {members.length > 0 && (
          <View className="flex-row flex-wrap items-center gap-2">
            <Text className="text-caption text-muted-foreground">Who cooks</Text>
            {members.map((mem) => {
              const on = current.cookUserId === mem.id;
              return (
                <Chip
                  key={mem.id}
                  label={mem.name}
                  on={on}
                  onPress={() => {
                    haptics.select();
                    onCook(on ? null : mem.id);
                  }}
                />
              );
            })}
          </View>
        )}
        <Input
          value={other}
          onChangeText={setOther}
          placeholder="Something else, like Dinner at Jess's"
          accessibilityLabel="Something else"
          maxLength={60}
          returnKeyType="done"
          onSubmitEditing={() => other.trim() && pick({ label: other.trim() })}
        />
        {stacking && (
          <ListGroup accessibilityLabel="Dishes">
            {dishes.map((dish) => (
              <ListItem key={dish.id} className="items-center">
                <ListItemContent>
                  <ListItemTitle numberOfLines={1}>{dish.title}</ListItemTitle>
                  {dish.time && (
                    <ListItemMeta>
                      <Text className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                        {dish.time}
                      </Text>
                    </ListItemMeta>
                  )}
                </ListItemContent>
                <ListItemTrailing className="flex-row items-center gap-1">
                  <Chip
                    label={MEAL_ROLE_LABEL[dish.role]}
                    on={false}
                    accessibilityLabel={`${dish.title} is the ${MEAL_ROLE_LABEL[dish.role].toLowerCase()}, change`}
                    onPress={() => {
                      haptics.select();
                      onDishRole?.(dish.id, MEAL_ROLES[(MEAL_ROLES.indexOf(dish.role) + 1) % MEAL_ROLES.length]);
                    }}
                  />
                  <Pressable
                    onPress={() => {
                      haptics.remove();
                      onRemoveDish?.(dish.id);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Take ${dish.title} off this night`}
                    className="h-11 w-11 items-center justify-center"
                  >
                    <X size={16} className="text-muted-foreground" />
                  </Pressable>
                </ListItemTrailing>
              </ListItem>
            ))}
          </ListGroup>
        )}
        {stacking && <Text className="text-micro-label uppercase text-muted-foreground">Add a dish</Text>}
        {recipes.length > 8 && (
          <Input value={query} onChangeText={setQuery} placeholder="Search recipes" accessibilityLabel="Search recipes" />
        )}
      </View>
      <BottomSheetScrollView keyboardShouldPersistTaps="handled">
        <ListGroup className="mx-3 border-0 bg-transparent">
          {shown.map((r) => {
            const on = stacking ? !!dishFor(r.id) : current.recipeId === r.id;
            const time = formatMealMinutes(recipeMinutes(r));
            return (
              <ListItem
                key={r.id}
                onPress={() => tapRecipe(r.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                className="items-center"
              >
                <ListItemLeading className="h-8 w-8 items-center justify-center rounded-xl bg-muted">
                  <Text className="text-base">{methodMeta(r.method).emoji}</Text>
                </ListItemLeading>
                <ListItemContent>
                  <ListItemTitle className={on ? 'font-semibold' : undefined}>{r.title}</ListItemTitle>
                  {time && (
                    <ListItemMeta>
                      <Text className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                        {time}
                      </Text>
                    </ListItemMeta>
                  )}
                </ListItemContent>
                {on && (
                  <ListItemTrailing>
                    <Check size={18} className="text-primary" />
                  </ListItemTrailing>
                )}
              </ListItem>
            );
          })}
          {shown.length === 0 && (
            <Text className="px-3 py-4 text-caption text-muted-foreground">
              {recipes.length === 0 ? 'No recipes yet. Add one in All recipes.' : 'No matching recipe'}
            </Text>
          )}
        </ListGroup>
        {onClear && (
          <Pressable
            onPress={() => {
              haptics.remove();
              onClear();
              onOpenChange(false);
            }}
            accessibilityRole="button"
            className="mx-4 min-h-11 justify-center"
          >
            <Text className="text-sm font-medium text-destructive">Clear this night</Text>
          </Pressable>
        )}
        {stacking && (
          <Pressable onPress={() => onOpenChange(false)} accessibilityRole="button" className="mx-4 min-h-11 items-end justify-center">
            <Text className="text-sm font-medium text-primary">Done</Text>
          </Pressable>
        )}
      </BottomSheetScrollView>
    </BottomSheet>
  );
}

function Chip({ label, on, onPress, accessibilityLabel }: { label: string; on: boolean; onPress: () => void; accessibilityLabel?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: on }}
      hitSlop={8}
      className={cn('h-7 justify-center rounded-full border px-3', on ? 'border-primary bg-primary/15' : 'border-border bg-muted')}
    >
      <Text className={cn('text-xs font-medium', on ? 'text-primary' : 'text-muted-foreground')}>{label}</Text>
    </Pressable>
  );
}
