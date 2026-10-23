// Meal plan: Recipes' "This week" tab on the phone. One row per night (Hearth
// §6 line item); tap a night to pick a recipe, Leftovers, Out or a few words,
// and who cooks, then add more dishes for the night (a main plus sides). Draft my week (Assistant on) asks the server to plan the
// empty nights around what goes off in Groceries and busy evenings in
// Calendar; the draft shows in place of the week until it is kept or
// dropped. Web twin: apps/web/src/app/recipes/meal-week.tsx. Shared logic:
// core's useMealWeek and meal-plan.ts.
import * as React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react-native';
import {
  Avatar,
  Button,
  Card,
  HeroLede,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
  Text,
  cn,
  haptics,
  toast,
} from '@homeup/ui';
import {
  addDaysISO,
  cookName,
  formatMealMinutes,
  mealNightLabel,
  mealNightMeta,
  mealWeekName,
  mealWeekRangeLabel,
  mealWeekStart,
  recipeMinutes,
  requestMealDraft,
  todayISO,
  useCooks,
  useMealWeek,
  useModules,
  type MealDraftNight,
  type MealNight,
  type MealPick,
} from '@homeup/core';
import { authedFetch } from './parse-recipe-api';
import { MealNightSheet } from './meal-night-sheet';

type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

export function MealWeek({
  groupId,
  currentUserId,
  isOnline,
  memberProfiles,
  memberIds,
}: {
  groupId: string;
  currentUserId: string | null;
  isOnline: boolean;
  memberProfiles: MemberProfiles;
  memberIds: string[];
}) {
  const modules = useModules();
  const groceriesLinked = modules.feature('meals.groceries');
  const calendarLinked = modules.feature('meals.calendar');
  const canDraft = modules.feature('meals.assistant-draft');
  const multiDish = modules.server('meals.multi-dish');

  const today = todayISO();
  const [weekStart, setWeekStart] = React.useState(() => mealWeekStart(today));
  const week = useMealWeek({ groupId, currentUserId, weekStart, today, groceriesLinked, calendarLinked, multiDish });
  const cooks = useCooks(groupId, currentUserId);

  const [draft, setDraft] = React.useState<MealDraftNight[] | null>(null);
  const [drafting, setDrafting] = React.useState(false);
  const [picking, setPicking] = React.useState<{ date: string; draft: boolean } | null>(null);

  const changeWeek = (days: number) => {
    haptics.select();
    setDraft(null);
    setWeekStart((w) => addDaysISO(w, days));
  };

  const runDraft = async () => {
    setDrafting(true);
    try {
      const nights = await requestMealDraft((path, init) => authedFetch(path, init), weekStart);
      if (nights.length === 0) toast.message('Every night this week is already planned.');
      else setDraft(nights);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not draft the week.');
    } finally {
      setDrafting(false);
    }
  };

  const keepDraft = () => {
    if (!draft) return;
    const { kept, added } = week.keepDraft(draft);
    setDraft(null);
    haptics.success();
    const dinners = `${kept} ${kept === 1 ? 'dinner' : 'dinners'}`;
    toast.success(added > 0 ? `Kept ${dinners}, added ${added} to Groceries` : `Kept ${dinners}`);
  };

  const addMissing = () => {
    const added = week.addMissing();
    if (added > 0) {
      haptics.commit();
      toast.success(`Added ${added} to Groceries`);
    }
  };

  const pickedNight = picking ? week.nights.find((n) => n.date === picking.date) ?? null : null;
  const pickedDraft = picking?.draft ? draft?.find((d) => d.date === picking.date) ?? null : null;

  const onPick = (pick: MealPick) => {
    if (!picking) return;
    if (picking.draft) {
      setDraft((d) =>
        d?.map((n) =>
          n.date === picking.date
            ? { ...n, recipe_id: 'recipeId' in pick ? pick.recipeId : null, label: 'label' in pick ? pick.label : null, reason: null }
            : n,
        ) ?? null,
      );
    } else {
      week.setNight(picking.date, pick);
    }
  };

  const draftCount = draft?.filter((n) => n.recipe_id || n.label).length ?? 0;
  const showDraftButton = canDraft && !draft && week.draftable.length > 0 && week.recipes.length > 0;

  return (
    <View className="gap-4">
      <View className="flex-row items-end justify-between gap-3">
        <View className="shrink">
          {draft ? (
            <HeroLede value={draftCount} label={draftCount === 1 ? 'dinner drafted' : 'dinners drafted'} caption="Keep it, or swap any night" />
          ) : (
            <HeroLede
              value={`${week.plannedCount} of 7`}
              label="dinners planned"
              caption={mealWeekRangeLabel(weekStart)}
              meter={{ done: week.plannedCount, total: 7 }}
            />
          )}
        </View>
        <View className="flex-row items-center">
          <Pressable onPress={() => changeWeek(-7)} accessibilityRole="button" accessibilityLabel="Previous week" className="h-11 w-11 items-center justify-center">
            <ChevronLeft size={18} className="text-muted-foreground" />
          </Pressable>
          <Pressable onPress={() => changeWeek(7)} accessibilityRole="button" accessibilityLabel="Next week" className="h-11 w-11 items-center justify-center">
            <ChevronRight size={18} className="text-muted-foreground" />
          </Pressable>
        </View>
      </View>
      <Text className="-mt-2 text-caption text-muted-foreground">{mealWeekName(weekStart, today)}</Text>

      {showDraftButton && (
        <Button variant="outline" onPress={() => void runDraft()} disabled={drafting || !isOnline} className="self-start" accessibilityLabel="Draft my week">
          {drafting ? <ActivityIndicator size="small" /> : <Sparkles size={14} className="text-foreground" />}
          <Text className="text-sm font-medium text-foreground">{drafting ? 'Drafting your week' : isOnline ? 'Draft my week' : 'Draft my week (needs a connection)'}</Text>
        </Button>
      )}

      {draft ? (
        <>
          <ListGroup>
            {draft.map((n) => {
              const night = week.nights.find((x) => x.date === n.date);
              const recipe = n.recipe_id ? week.recipesById.get(n.recipe_id) : undefined;
              const title = recipe?.title ?? n.label ?? null;
              const meta = [formatMealMinutes(recipeMinutes(recipe)), n.reason ?? night?.hint].filter((m): m is string => !!m);
              return (
                <ListItem key={n.date} className="items-center" onPress={() => setPicking({ date: n.date, draft: true })} accessibilityLabel={`${title ?? 'Nothing drafted'}, swap`}>
                  <NightDate date={n.date} today={n.date === today} />
                  <ListItemContent>
                    <ListItemTitle className={cn(!title && 'text-muted-foreground')} numberOfLines={1}>
                      {title ?? 'Nothing drafted'}
                    </ListItemTitle>
                    <Meta parts={meta} />
                  </ListItemContent>
                  <ListItemTrailing>
                    <Text className="text-sm font-medium text-primary">Swap</Text>
                  </ListItemTrailing>
                </ListItem>
              );
            })}
          </ListGroup>
          <View className="flex-row items-center justify-between gap-2">
            <View className="flex-row items-center gap-1">
              <Button variant="ghost" onPress={() => setDraft(null)}>
                <Text className="text-sm font-medium text-foreground">Drop</Text>
              </Button>
              <Button variant="ghost" onPress={() => void runDraft()} disabled={drafting || !isOnline}>
                <Text className="text-sm font-medium text-foreground">Redo</Text>
              </Button>
            </View>
            <Button onPress={keepDraft} disabled={draftCount === 0}>
              <Text className="text-sm font-medium text-primary-foreground">Keep this week</Text>
            </Button>
          </View>
          {groceriesLinked && <Text className="px-1 text-caption text-muted-foreground">Keeping it adds the missing ingredients to Groceries.</Text>}
        </>
      ) : (
        <>
          <ListGroup>
            {week.nights.map((night) => (
              <NightRow
                key={night.date}
                night={night}
                cook={cookName(night.cookUserId, memberProfiles)}
                memberProfiles={memberProfiles}
                onOpen={() => setPicking({ date: night.date, draft: false })}
              />
            ))}
          </ListGroup>

          {week.shopping && week.shopping.missing.length > 0 && (
            <Card className="gap-1 rounded-3xl px-4">
              <Text className="text-sm font-medium text-foreground">
                <Text style={{ fontVariant: ['tabular-nums'] }}>{week.shopping.missing.length}</Text>{' '}
                {week.shopping.missing.length === 1 ? 'ingredient missing' : 'ingredients missing'}
              </Text>
              <Text className="text-caption text-muted-foreground">
                {week.shopping.onList > 0 ? `${week.shopping.onList} already on the list · ` : ''}
                {missingPreview(week.shopping.missing.map((m) => m.key))}
              </Text>
              <Button className="mt-2" onPress={addMissing}>
                <Text className="text-sm font-medium text-primary-foreground">Add {week.shopping.missing.length} to Groceries</Text>
              </Button>
            </Card>
          )}
        </>
      )}

      <MealNightSheet
        open={!!picking}
        onOpenChange={(open) => !open && setPicking(null)}
        date={picking?.date ?? today}
        recipes={week.recipes}
        current={
          picking?.draft
            ? { recipeId: pickedDraft?.recipe_id ?? null, label: pickedDraft?.label ?? null, cookUserId: null }
            : { recipeId: pickedNight?.entry?.recipe_id ?? null, label: pickedNight?.entry?.label ?? null, cookUserId: pickedNight?.cookUserId ?? null }
        }
        hint={pickedNight?.hint ?? null}
        members={picking?.draft || !pickedNight?.entry ? [] : memberIds.map((id) => ({ id, name: cookName(id, memberProfiles) ?? 'Member' }))}
        onPick={onPick}
        onCook={(userId) => picking && week.setCook(picking.date, userId)}
        onClear={!picking?.draft && pickedNight?.entry ? () => picking && week.clearNight(picking.date) : undefined}
        dishes={
          picking?.draft
            ? []
            : (pickedNight?.dishes ?? []).map((d) => ({ id: d.entry.id, recipeId: d.recipe.id, title: d.recipe.title, role: d.role, time: d.time }))
        }
        onAddDish={!picking?.draft && multiDish ? (recipeId) => picking && week.addDish(picking.date, recipeId) : undefined}
        onRemoveDish={week.removeDish}
        onDishRole={week.setDishRole}
        onStartCooking={
          cooks.enabled && !picking?.draft && pickedNight?.dishes.length
            ? () => {
                // One cook per dish; the cooking heads show them all.
                for (const d of pickedNight.dishes) cooks.start(d.recipe.id);
                toast.success(pickedNight.dishes.length > 1 ? `Cooking ${pickedNight.dishes.length} dishes` : `Cooking ${pickedNight.dishes[0].recipe.title}`);
              }
            : undefined
        }
      />
    </View>
  );
}

function missingPreview(names: string[]): string {
  const shown = names.slice(0, 4).join(', ');
  return names.length > 4 ? `${shown} and ${names.length - 4} more` : shown;
}

/** A row's meta line; ListItemMeta puts the dots between the parts. */
function Meta({ parts }: { parts: string[] }) {
  if (parts.length === 0) return null;
  return (
    <ListItemMeta>
      {parts.map((p) => (
        <Text key={p} numberOfLines={1} className="text-caption text-muted-foreground">
          {p}
        </Text>
      ))}
    </ListItemMeta>
  );
}

/** The night's date block: weekday micro label over the day number, in an inset tile. */
function NightDate({ date, today }: { date: string; today: boolean }) {
  const { weekday, day } = mealNightLabel(date);
  return (
    <View className="h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[13px] bg-muted">
      <Text className={cn('text-[10px] font-semibold uppercase', today ? 'text-primary' : 'text-muted-foreground')}>{weekday}</Text>
      <Text className="text-base font-semibold text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
        {day}
      </Text>
    </View>
  );
}

function NightRow({
  night,
  cook,
  memberProfiles,
  onOpen,
}: {
  night: MealNight;
  cook: string | null;
  memberProfiles: MemberProfiles;
  onOpen: () => void;
}) {
  const meta = night.planned ? mealNightMeta(night, cook) : night.hint ? [night.hint] : [];
  return (
    <ListItem
      onPress={onOpen}
      className={cn('items-center', night.isPast && 'opacity-70')}
      accessibilityRole="button"
      accessibilityLabel={`${night.weekday} ${night.day}: ${night.title ?? 'pick a dinner'}`}
    >
      <NightDate date={night.date} today={night.isToday} />
      <ListItemContent>
        <ListItemTitle className={cn(!night.planned && 'text-muted-foreground')} numberOfLines={1}>
          {night.title ?? 'Pick a dinner'}
        </ListItemTitle>
        <Meta parts={meta} />
      </ListItemContent>
      {night.cookUserId && (
        <ListItemTrailing>
          <Avatar userId={night.cookUserId} profiles={memberProfiles} size={24} />
        </ListItemTrailing>
      )}
    </ListItem>
  );
}
