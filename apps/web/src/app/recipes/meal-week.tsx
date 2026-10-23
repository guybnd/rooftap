'use client';

// Meal plan: Recipes' "This week" tab. One row per night (Hearth §6 line
// item); tap a night to pick a recipe, Leftovers, Out or a few words, and who
// cooks, then add more dishes for the night (a main plus sides, a dessert). Draft my week (Assistant on) asks the server to plan the empty
// nights around what goes off in Groceries and busy evenings in Calendar;
// the draft shows in place of the week until it is kept or dropped. The
// missing-ingredients card adds what the week still needs to Groceries.
// Native twin: apps/mobile/src/features/recipes/meal-week.tsx. Shared logic:
// core's useMealWeek and meal-plan.ts.

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Loader2, Sparkles } from 'lucide-react';
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
import { HeroLede } from '@/components/ui/hero-lede';
import { Button } from '@/components/ui/button';
import { ListGroup, ListItem, ListItemContent, ListItemMeta, ListItemTitle, ListItemTrailing } from '@/components/ui/list-item';
import { AvatarBubble, type MemberProfiles } from '@/app/home/hub-shared';
import { cn } from '@/lib/utils';
import { MealNightSheet } from './meal-night-sheet';

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
  const [weekStart, setWeekStart] = useState(() => mealWeekStart(today));
  const week = useMealWeek({ groupId, currentUserId, weekStart, today, groceriesLinked, calendarLinked, multiDish });
  const cooks = useCooks(groupId, currentUserId);

  // null = the week itself; an array = a draft waiting to be kept or dropped.
  const [draft, setDraft] = useState<MealDraftNight[] | null>(null);
  const [drafting, setDrafting] = useState(false);
  // The night whose sheet is open; `draft` marks one picked inside the draft.
  const [picking, setPicking] = useState<{ date: string; draft: boolean } | null>(null);

  const changeWeek = (days: number) => {
    setDraft(null);
    setWeekStart((w) => addDaysISO(w, days));
  };

  const runDraft = async () => {
    setDrafting(true);
    try {
      const nights = await requestMealDraft((path, init) => fetch(path, init), weekStart);
      if (nights.length === 0) toast('Every night this week is already planned.');
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
    toast(added > 0 ? `Kept ${kept} ${kept === 1 ? 'dinner' : 'dinners'}, added ${added} to Groceries` : `Kept ${kept} ${kept === 1 ? 'dinner' : 'dinners'}`);
  };

  const addMissing = () => {
    const added = week.addMissing();
    if (added > 0) toast(`Added ${added} to Groceries`);
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
    <div className="space-y-4">
      {/* H1: the week's lede. Week paging sits with it (H5). */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
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
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => changeWeek(-7)}
            aria-label="Previous week"
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[5.5rem] text-center text-sm font-medium text-foreground">{mealWeekName(weekStart, today)}</span>
          <button
            type="button"
            onClick={() => changeWeek(7)}
            aria-label="Next week"
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {showDraftButton && (
        <button
          type="button"
          onClick={() => void runDraft()}
          disabled={drafting || !isOnline}
          title={isOnline ? undefined : 'Needs a connection'}
          className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-border bg-muted px-3.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
        >
          {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {drafting ? 'Drafting your week' : 'Draft my week'}
        </button>
      )}

      {draft ? (
        <>
          <ListGroup>
            {draft.map((n) => {
              const night = week.nights.find((x) => x.date === n.date);
              const recipe = n.recipe_id ? week.recipesById.get(n.recipe_id) : undefined;
              const title = recipe?.title ?? n.label ?? null;
              const time = formatMealMinutes(recipeMinutes(recipe));
              const meta = [time, n.reason ?? night?.hint].filter(Boolean).join(' · ');
              return (
                <ListItem key={n.date} className="items-center">
                  <NightDate date={n.date} today={n.date === today} />
                  <ListItemContent>
                    <ListItemTitle className={cn(!title && 'text-muted-foreground')}>
                      <span className="truncate">{title ?? 'Nothing drafted'}</span>
                    </ListItemTitle>
                    {meta && <ListItemMeta>{meta}</ListItemMeta>}
                  </ListItemContent>
                  <ListItemTrailing>
                    <Button variant="ghost" size="sm" className="h-11 px-3" onClick={() => setPicking({ date: n.date, draft: true })}>
                      Swap
                    </Button>
                  </ListItemTrailing>
                </ListItem>
              );
            })}
          </ListGroup>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Button variant="ghost" className="h-11" onClick={() => setDraft(null)}>
                Drop
              </Button>
              <Button variant="ghost" className="h-11" onClick={() => void runDraft()} disabled={drafting || !isOnline}>
                {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Redo
              </Button>
            </div>
            <Button className="h-11 px-4" onClick={keepDraft} disabled={draftCount === 0}>
              Keep this week
            </Button>
          </div>
          {groceriesLinked && <p className="px-1 text-xs text-muted-foreground">Keeping it adds the missing ingredients to Groceries.</p>}
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
            <div className="rounded-3xl border border-border/60 bg-card p-4 shadow-[var(--card-shadow)]">
              <p className="text-sm font-medium text-foreground">
                <span className="tabular-nums">{week.shopping.missing.length}</span>{' '}
                {week.shopping.missing.length === 1 ? 'ingredient missing' : 'ingredients missing'}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {week.shopping.onList > 0 && (
                  <>
                    <span className="tabular-nums">{week.shopping.onList}</span> already on the list ·{' '}
                  </>
                )}
                {missingPreview(week.shopping.missing.map((m) => m.key))}
              </p>
              <Button className="mt-3 h-11 w-full" onClick={addMissing}>
                Add {week.shopping.missing.length} to Groceries
              </Button>
            </div>
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
                toast(pickedNight.dishes.length > 1 ? `Cooking ${pickedNight.dishes.length} dishes` : `Cooking ${pickedNight.dishes[0].recipe.title}`);
              }
            : undefined
        }
      />
    </div>
  );
}

function missingPreview(names: string[]): string {
  const shown = names.slice(0, 4).join(', ');
  return names.length > 4 ? `${shown} and ${names.length - 4} more` : shown;
}

/** The night's date block: weekday micro label over the day number, in an inset tile. */
function NightDate({ date, today }: { date: string; today: boolean }) {
  const { weekday, day } = mealNightLabel(date);
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-[42px] w-[42px] shrink-0 flex-col items-center justify-center rounded-[13px] bg-muted leading-none',
        today ? 'text-primary' : 'text-muted-foreground',
      )}
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em]">{weekday}</span>
      <span className="mt-0.5 text-base font-semibold tabular-nums text-foreground">{day}</span>
    </span>
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
  const meta = useMemo(() => {
    if (!night.planned) return night.hint;
    const parts = mealNightMeta(night, cook);
    return parts.length ? parts.join(' · ') : null;
  }, [night, cook]);
  return (
    <ListItem asChild className={cn('cursor-pointer items-center text-left hover:bg-muted/40', night.isPast && 'opacity-70')}>
      <button type="button" onClick={onOpen} aria-label={`${night.weekday} ${night.day}: ${night.title ?? 'pick a dinner'}`}>
        <NightDate date={night.date} today={night.isToday} />
        <ListItemContent>
          <ListItemTitle className={cn(!night.planned && 'text-muted-foreground')}>
            <span className="truncate">{night.title ?? 'Pick a dinner'}</span>
          </ListItemTitle>
          {meta && <ListItemMeta>{meta}</ListItemMeta>}
        </ListItemContent>
        {night.cookUserId && (
          <ListItemTrailing>
            <AvatarBubble userId={night.cookUserId} profiles={memberProfiles} size={24} />
          </ListItemTrailing>
        )}
      </button>
    </ListItem>
  );
}
