// "Add missing to groceries" from a recipe: a review sheet in the scan match
// step's layout (scan-match-sheet.tsx) instead of a blind bulk write. One row
// per grocery item (two lines for blood orange are one row), each with a
// switch that starts on, a Staple button, and a tap to edit the ingredient.
// What is already on the list sits below as chips. The footer adds the rows
// that are on. Web twin: apps/web/src/app/recipes/add-missing-sheet.tsx.
import * as React from 'react';
import { View } from 'react-native';
import {
  BottomSheet,
  BottomSheetScrollView,
  Button,
  HeroLede,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
  Switch,
  Text,
  haptics,
} from '@homeup/ui';
import { trimQty, type RecipeIngredient, type RecipeShoppingLine } from '@homeup/core';

export function shoppingLineKey(line: RecipeShoppingLine): string {
  return line.match ? `item:${line.match.id}` : `name:${line.name.toLowerCase()}`;
}

export function AddMissingSheet({
  open,
  onOpenChange,
  recipeTitle,
  lines,
  canRemember,
  onSetStaple,
  onEdit,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipeTitle: string;
  /** recipeShoppingLines(): what the recipe still needs, on the list or not. */
  lines: RecipeShoppingLine[];
  canRemember: boolean;
  onSetStaple: (name: string) => void;
  /** Edit the ingredient behind a row (its match, amount, or name). */
  onEdit: (ingredient: RecipeIngredient) => void;
  onAdd: (lines: RecipeShoppingLine[]) => void;
}) {
  const [off, setOff] = React.useState<Set<string>>(new Set());
  React.useEffect(() => {
    if (open) setOff(new Set());
  }, [open]);

  const toBuy = lines.filter((l) => !l.onList);
  const onList = lines.filter((l) => l.onList);
  const adding = toBuy.filter((l) => !off.has(shoppingLineKey(l)));

  const setOn = (line: RecipeShoppingLine, on: boolean) => {
    const next = new Set(off);
    if (on) next.delete(shoppingLineKey(line));
    else next.add(shoppingLineKey(line));
    setOff(next);
  };

  const finish = () => {
    if (adding.length > 0) onAdd(adding);
    onOpenChange(false);
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} className="pb-4">
      <View className="gap-2 px-4 pb-3">
        <Text className="text-micro-label uppercase text-muted-foreground">Add to Groceries</Text>
        <HeroLede value={toBuy.length} label={`to buy for ${recipeTitle}`} />
      </View>

      <BottomSheetScrollView>
        <View className="gap-4 px-4 pb-2">
          {toBuy.length > 0 && (
            <Section label={`To buy · ${toBuy.length}`}>
              {toBuy.map((line) => (
                <ListItem
                  key={shoppingLineKey(line)}
                  className="items-center"
                  onPress={() => onEdit(line.ingredients[0])}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${line.name}`}
                >
                  <ListItemContent>
                    <ListItemTitle numberOfLines={1}>{line.name}</ListItemTitle>
                    <ListItemMeta>
                      <Text numberOfLines={2} className="text-caption text-muted-foreground">
                        {lineDetail(line)}
                      </Text>
                    </ListItemMeta>
                  </ListItemContent>
                  <ListItemTrailing className="flex-row items-center gap-2">
                    {canRemember && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onPress={() => {
                          haptics.tick();
                          onSetStaple(line.name);
                        }}
                      >
                        <Text className="text-xs font-medium text-muted-foreground">Staple</Text>
                      </Button>
                    )}
                    <Switch
                      checked={!off.has(shoppingLineKey(line))}
                      onChange={(on) => setOn(line, on)}
                      label={`Add ${line.name} to the list`}
                    />
                  </ListItemTrailing>
                </ListItem>
              ))}
            </Section>
          )}

          {onList.length > 0 && (
            <Section label={`On the list · ${onList.length}`}>
              <View className="flex-row flex-wrap gap-1.5 p-3">
                {onList.map((line) => (
                  <View key={shoppingLineKey(line)} className="h-7 flex-row items-center gap-1.5 rounded-full bg-muted px-2.5">
                    <View className="h-1.5 w-1.5 rounded-full bg-warning" />
                    <Text className="text-xs font-medium text-foreground">{line.name}</Text>
                  </View>
                ))}
              </View>
            </Section>
          )}

          <Text className="px-1 text-caption text-muted-foreground">
            Tap an item to change what it matches. Staples never go on the list.
          </Text>
        </View>
      </BottomSheetScrollView>

      <View className="px-4 pt-2">
        <Button onPress={finish} className="h-11 w-full rounded-xl">
          <Text className="text-sm font-semibold text-primary-foreground">
            {adding.length > 0 ? `Add ${adding.length} to Groceries` : 'Done'}
          </Text>
        </Button>
      </View>
    </BottomSheet>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="gap-1.5">
      <Text className="px-1 text-micro-label uppercase text-muted-foreground">{label}</Text>
      <ListGroup>{children}</ListGroup>
    </View>
  );
}

/** "2 count blood orange, 9 tbsp blood orange juice": each recipe line behind the row. */
function lineDetail(line: RecipeShoppingLine): string {
  return line.ingredients
    .map((i) => [i.quantity != null ? trimQty(i.quantity) : null, i.unit, i.name].filter(Boolean).join(' '))
    .join(', ');
}
