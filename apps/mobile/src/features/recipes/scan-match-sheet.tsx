// Recipes v2 R5: the match step after a scan. "9 of 12 matched to Groceries"
// as the lede, then only what needs you: close names to confirm (Same / New),
// new items with an add-to-list switch, the matched ones collapsed into chips,
// and the household's staples, which never go on the list. "Same" and "New"
// apply at once and teach future scans (an alias row); the switches apply on
// the footer button, which then opens the review sheet.
// Web twin: apps/web/src/app/recipes/scan-match-sheet.tsx.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { X } from 'lucide-react-native';
import {
  BottomSheet,
  BottomSheetScrollView,
  Button,
  HeroLede,
  Input,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
  Switch,
  Text,
  cn,
  haptics,
} from '@homeup/ui';
import {
  ingredientMatchKey,
  itemMatchLibrary,
  summarizeScanMatch,
  type GroceryItem,
  type MatchContext,
  type RecipeIngredient,
  type ScanMatchRow,
} from '@homeup/core';

const MATCHED_SHOWN = 6;

export function ScanMatchSheet({
  open,
  onDone,
  ingredients,
  groceryItems,
  allIngredients,
  context,
  canRemember,
  staplesShown,
  onSame,
  onNew,
  onSetStaple,
  onAddToList,
}: {
  open: boolean;
  /** Closing or the footer button: the caller opens the review sheet next. */
  onDone: () => void;
  /** The scanned draft's ingredient rows (live from the store). */
  ingredients: RecipeIngredient[];
  groceryItems: GroceryItem[];
  allIngredients: RecipeIngredient[];
  context: (library: readonly string[]) => MatchContext;
  /** The household's answers are stored (else staples are the defaults and answers last this scan). */
  canRemember: boolean;
  staplesShown: string[];
  /** "Same": link the row to `itemName` and remember it. */
  onSame: (ingredient: RecipeIngredient, itemName: string) => void;
  /** "New": keep the row as its own item and stop asking. */
  onNew: (ingredient: RecipeIngredient) => void;
  onSetStaple: (name: string, staple: boolean) => void;
  onAddToList: (ingredient: RecipeIngredient, name: string) => void;
}) {
  const [saidNew, setSaidNew] = React.useState<Set<string>>(new Set());
  const [toList, setToList] = React.useState<Set<string>>(new Set());
  const [showAll, setShowAll] = React.useState(false);
  const [editStaples, setEditStaples] = React.useState(false);
  const [newStaple, setNewStaple] = React.useState('');

  const ctx = React.useMemo(() => context(itemMatchLibrary(groceryItems, allIngredients)), [context, groceryItems, allIngredients]);
  const summary = React.useMemo(() => {
    const s = summarizeScanMatch(ingredients, groceryItems, ctx);
    // A "New" answer that couldn't be stored still moves the row this scan.
    const answered = s.check.filter((r) => saidNew.has(r.ingredient.id));
    return {
      ...s,
      check: s.check.filter((r) => !saidNew.has(r.ingredient.id)),
      fresh: [...s.fresh, ...answered].sort((a, b) => a.ingredient.position - b.ingredient.position),
    };
  }, [ingredients, groceryItems, ctx, saidNew]);

  const counted = summary.check.length + summary.fresh.length + summary.matched.length;
  const adding = summary.fresh.filter((r) => toList.has(r.ingredient.id));
  const matchedShown = showAll ? summary.matched : summary.matched.slice(0, MATCHED_SHOWN);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    setter(next);
  };

  const finish = () => {
    if (adding.length > 0) haptics.commit();
    for (const r of adding) onAddToList(r.ingredient, freshName(r));
    setToList(new Set());
    onDone();
  };

  const addStaple = () => {
    const name = newStaple.trim();
    if (!name) return;
    haptics.tick();
    onSetStaple(name, true);
    setNewStaple('');
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onDone();
      }}
      className="pb-4"
      keyboardAware
    >
      <View className="gap-2 px-4 pb-3">
        <Text className="text-micro-label uppercase text-muted-foreground">Match to Groceries</Text>
        <HeroLede
          value={summary.matched.length}
          label={`of ${counted} matched to Groceries`}
          meter={counted > 0 ? { done: summary.matched.length, total: counted } : undefined}
          tone={summary.check.length === 0 ? 'success' : 'neutral'}
        />
      </View>

      <BottomSheetScrollView keyboardShouldPersistTaps="handled">
        <View className="gap-4 px-4 pb-2">
          {summary.check.length > 0 && (
            <Section label={`Check ${summary.check.length === 1 ? 'this one' : `these ${summary.check.length}`}`}>
              {summary.check.map((r) => (
                <ListItem key={r.ingredient.id} className="items-center">
                  <ListItemContent>
                    <ListItemTitle numberOfLines={1}>{ingredientMatchKey(r.ingredient)}</ListItemTitle>
                    <ListItemMeta>
                      <Text className="text-caption text-muted-foreground">
                        is it your <Text className="text-caption font-medium text-warning">{r.match.kind === 'check' ? r.match.item : ''}</Text>?
                      </Text>
                    </ListItemMeta>
                  </ListItemContent>
                  <ListItemTrailing className="flex-row gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onPress={() => {
                        haptics.tick();
                        toggle(saidNew, setSaidNew, r.ingredient.id, true);
                        onNew(r.ingredient);
                      }}
                    >
                      <Text className="text-sm font-medium text-muted-foreground">New</Text>
                    </Button>
                    <Button
                      size="sm"
                      onPress={() => {
                        haptics.tick();
                        if (r.match.kind === 'check') onSame(r.ingredient, r.match.item);
                      }}
                    >
                      <Text className="text-sm font-medium text-primary-foreground">Same</Text>
                    </Button>
                  </ListItemTrailing>
                </ListItem>
              ))}
            </Section>
          )}

          {summary.fresh.length > 0 && (
            <Section label={`New to Groceries · ${summary.fresh.length}`}>
              {summary.fresh.map((r) => (
                <ListItem key={r.ingredient.id} className="items-center">
                  <ListItemContent>
                    <ListItemTitle numberOfLines={1}>{freshName(r)}</ListItemTitle>
                    <ListItemMeta>
                      <Text numberOfLines={1} className="text-caption text-muted-foreground">
                        {r.ingredient.name}
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
                          onSetStaple(freshName(r), true);
                        }}
                      >
                        <Text className="text-xs font-medium text-muted-foreground">Staple</Text>
                      </Button>
                    )}
                    <Switch
                      checked={toList.has(r.ingredient.id)}
                      onChange={(on) => toggle(toList, setToList, r.ingredient.id, on)}
                      label={`Add ${freshName(r)} to the list`}
                    />
                  </ListItemTrailing>
                </ListItem>
              ))}
            </Section>
          )}

          {summary.matched.length > 0 && (
            <Section label={`Matched · ${summary.matched.length}`}>
              <View className="flex-row flex-wrap gap-1.5 p-3">
                {matchedShown.map((r) => (
                  <View
                    key={r.ingredient.id}
                    accessible
                    accessibilityLabel={`${r.match.kind === 'matched' ? r.match.item : ''}${statusWord(r)}`}
                    className="h-7 flex-row items-center gap-1.5 rounded-full bg-muted px-2.5"
                  >
                    <View className={cn('h-1.5 w-1.5 rounded-full', dotClass(r))} />
                    <Text className="text-xs font-medium text-foreground">{r.match.kind === 'matched' ? r.match.item : ''}</Text>
                  </View>
                ))}
                {summary.matched.length > MATCHED_SHOWN && (
                  <Pressable onPress={() => setShowAll((v) => !v)} accessibilityRole="button" hitSlop={8} className="h-7 justify-center px-2.5">
                    <Text className="text-xs font-medium text-muted-foreground">
                      {showAll ? 'Show less' : `+${summary.matched.length - MATCHED_SHOWN} more`}
                    </Text>
                  </Pressable>
                )}
              </View>
            </Section>
          )}

          {(summary.staples.length > 0 || editStaples) && (
            <Section label={`Staples · ${summary.staples.length}`}>
              <View className="flex-row flex-wrap gap-1.5 p-3">
                {summary.staples.map((r) => (
                  <View key={r.ingredient.id} className="h-7 justify-center rounded-full bg-muted px-2.5">
                    <Text className="text-xs font-medium text-muted-foreground">{ingredientMatchKey(r.ingredient)}</Text>
                  </View>
                ))}
                {summary.staples.length === 0 && <Text className="text-xs text-muted-foreground">None in this recipe</Text>}
              </View>
            </Section>
          )}

          {editStaples && canRemember && (
            <Section label="Your staples">
              <View className="flex-row flex-wrap gap-1.5 p-3">
                {staplesShown.map((name) => (
                  <View key={name} className="h-7 flex-row items-center gap-1 rounded-full bg-muted pl-2.5 pr-1">
                    <Text className="text-xs font-medium text-foreground">{name}</Text>
                    <Pressable
                      onPress={() => {
                        haptics.tick();
                        onSetStaple(name, false);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`${name} is not a staple`}
                      hitSlop={10}
                      className="h-5 w-5 items-center justify-center rounded-full"
                    >
                      <X size={12} className="text-muted-foreground" />
                    </Pressable>
                  </View>
                ))}
              </View>
              <View className="px-3 pb-3">
                <Input
                  value={newStaple}
                  onChangeText={setNewStaple}
                  placeholder="Add a staple, like Rice"
                  accessibilityLabel="Add a staple"
                  maxLength={60}
                  returnKeyType="done"
                  onSubmitEditing={addStaple}
                />
              </View>
            </Section>
          )}

          <View className="flex-row flex-wrap items-center px-1">
            <Text className="text-caption text-muted-foreground">
              Staples never go on the list.{canRemember ? ' Your answers teach future scans. ' : ''}
            </Text>
            {canRemember && (
              <Pressable onPress={() => setEditStaples((v) => !v)} accessibilityRole="button" hitSlop={10}>
                <Text className="text-caption font-medium text-primary">{editStaples ? 'Done with staples' : 'Edit staples'}</Text>
              </Pressable>
            )}
          </View>
        </View>
      </BottomSheetScrollView>

      <View className="px-4 pt-2">
        <Button onPress={finish} className="h-11 w-full rounded-xl">
          <Text className="text-sm font-semibold text-primary-foreground">
            {adding.length > 0 ? `Add ${adding.length} to Groceries` : 'Looks right'}
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

/** A new row's item name: what to buy, not the whole line. */
function freshName(r: ScanMatchRow): string {
  return r.match.kind === 'new' ? r.match.item : ingredientMatchKey(r.ingredient);
}

function dotClass(r: ScanMatchRow): string {
  if (r.grocery?.status === 'have') return 'bg-success';
  if (r.grocery?.status === 'needed') return 'bg-warning';
  return 'bg-muted-foreground/40';
}

function statusWord(r: ScanMatchRow): string {
  if (r.grocery?.status === 'have') return ', have it';
  if (r.grocery?.status === 'needed') return ', on the list';
  return '';
}
