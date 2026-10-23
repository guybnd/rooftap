'use client';

// One night of the meal plan, as a bottom sheet (M4): pick a recipe, a quick
// label (Leftovers, Out) or a few words, and who cooks. Once a night has a
// recipe, the list adds more dishes (a main plus sides and a dessert) and the
// sheet stays open; each dish's role chip cycles Main, Side, Dessert. Every
// choice applies at once, no Save. Native twin:
// apps/mobile/src/features/recipes/meal-night-sheet.tsx.

import { useMemo, useState } from 'react';
import { Check, X } from 'lucide-react';
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
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Input } from '@/components/ui/input';
import { ListGroup, ListItem, ListItemContent, ListItemLeading, ListItemMeta, ListItemTitle, ListItemTrailing } from '@/components/ui/list-item';
import { cn } from '@/lib/utils';

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
  const [query, setQuery] = useState('');
  const [other, setOther] = useState('');
  const { weekday, day } = mealNightLabel(date);
  const month = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short' });

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? recipes.filter((r) => r.title.toLowerCase().includes(q)) : recipes;
  }, [recipes, query]);

  const pick = (p: MealPick) => {
    onPick(p);
    onOpenChange(false);
    setQuery('');
    setOther('');
  };

  // Several dishes: once the night has a recipe, the list adds and removes dishes.
  const stacking = !!onAddDish && dishes.length > 0;
  const dishFor = (recipeId: string) => dishes.find((d) => d.recipeId === recipeId);
  const tapRecipe = (recipeId: string) => {
    if (!stacking) return pick({ recipeId });
    const on = dishFor(recipeId);
    if (on) onRemoveDish?.(on.id);
    else onAddDish?.(recipeId);
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      overlayClassName="bg-black/40"
      className={cn(
        'rounded-t-2xl border-t border-border bg-popover/95 text-popover-foreground shadow-2xl shadow-black/50 backdrop-blur-xl',
        'pb-[max(0.75rem,env(safe-area-inset-bottom))]',
        'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border',
      )}
      handleClassName="sm:hidden"
    >
      {(contentRef) => (
        <>
          <div className="px-4 pb-2 pt-1 sm:pt-4">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Dinner, {weekday} {day} {month}
            </p>
            {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
          </div>

          {/* Quick picks and who cooks: chips that apply at once (PC3 hit targets). */}
          <div className="flex flex-wrap gap-2 px-4 pb-2">
            {MEAL_QUICK_LABELS.map((label) => {
              const on = !current.recipeId && current.label === label;
              return (
                <button key={label} type="button" aria-pressed={on} onClick={() => pick({ label })} className={cn(CHIP, on ? CHIP_ON : CHIP_OFF)}>
                  {label}
                </button>
              );
            })}
          </div>
          {members.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-4 pb-2">
              <span className="text-xs text-muted-foreground">Who cooks</span>
              {members.map((m) => {
                const on = current.cookUserId === m.id;
                return (
                  <button key={m.id} type="button" aria-pressed={on} onClick={() => onCook(on ? null : m.id)} className={cn(CHIP, on ? CHIP_ON : CHIP_OFF)}>
                    {m.name}
                  </button>
                );
              })}
            </div>
          )}

          <form
            className="flex items-center gap-2 px-4 pb-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (other.trim()) pick({ label: other.trim() });
            }}
          >
            <Input value={other} onChange={(e) => setOther(e.target.value)} placeholder="Something else, like Dinner at Jess's" aria-label="Something else" maxLength={60} />
          </form>

          {stacking && (
            <ListGroup className="mx-4 mb-2" aria-label="Dishes">
              {dishes.map((d) => (
                <ListItem key={d.id} className="items-center">
                  <ListItemContent>
                    <ListItemTitle>
                      <span className="truncate">{d.title}</span>
                    </ListItemTitle>
                    {d.time && <ListItemMeta className="tabular-nums">{d.time}</ListItemMeta>}
                  </ListItemContent>
                  <ListItemTrailing className="gap-1">
                    <button
                      type="button"
                      onClick={() => onDishRole?.(d.id, MEAL_ROLES[(MEAL_ROLES.indexOf(d.role) + 1) % MEAL_ROLES.length])}
                      aria-label={`${d.title} is the ${MEAL_ROLE_LABEL[d.role].toLowerCase()}, change`}
                      className={cn(CHIP, CHIP_OFF)}
                    >
                      {MEAL_ROLE_LABEL[d.role]}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveDish?.(d.id)}
                      aria-label={`Take ${d.title} off this night`}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </ListItemTrailing>
                </ListItem>
              ))}
            </ListGroup>
          )}

          {stacking && (
            <p className="px-4 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Add a dish</p>
          )}

          {recipes.length > 8 && (
            <div className="px-4 pb-2">
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search recipes" aria-label="Search recipes" />
            </div>
          )}

          <div ref={contentRef} className="max-h-[45vh] overflow-y-auto px-1.5">
            <ListGroup className="border-0 bg-transparent shadow-none" role="list" aria-label="Recipes">
              {shown.map((r) => {
                const on = stacking ? !!dishFor(r.id) : current.recipeId === r.id;
                const time = formatMealMinutes(recipeMinutes(r));
                return (
                  <ListItem key={r.id} asChild className="cursor-pointer items-center rounded-lg text-left hover:bg-muted/50">
                    <button type="button" onClick={() => tapRecipe(r.id)} aria-pressed={on}>
                      <ListItemLeading className="h-8 w-8 rounded-xl bg-muted text-base">{methodMeta(r.method).emoji}</ListItemLeading>
                      <ListItemContent>
                        <ListItemTitle className={on ? 'font-semibold' : undefined}>
                          <span className="truncate">{r.title}</span>
                        </ListItemTitle>
                        {time && <ListItemMeta className="tabular-nums">{time}</ListItemMeta>}
                      </ListItemContent>
                      {on && (
                        <ListItemTrailing>
                          <Check className="text-primary" />
                        </ListItemTrailing>
                      )}
                    </button>
                  </ListItem>
                );
              })}
              {shown.length === 0 && (
                <p className="px-3 py-4 text-xs text-muted-foreground">{recipes.length === 0 ? 'No recipes yet. Add one in All recipes.' : 'No matching recipe'}</p>
              )}
            </ListGroup>
          </div>

          {onClear && (
            <div className="flex items-center justify-between px-4 pt-2">
              <button
                type="button"
                onClick={() => {
                  onClear();
                  onOpenChange(false);
                }}
                className="inline-flex min-h-11 items-center text-sm font-medium text-destructive"
              >
                Clear this night
              </button>
              {stacking && (
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-primary"
                >
                  Done
                </button>
              )}
            </div>
          )}
        </>
      )}
    </BottomSheet>
  );
}

const CHIP =
  "relative inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium transition-colors after:absolute after:-inset-y-2 after:inset-x-0 after:content-['']";
const CHIP_ON = 'border-primary bg-primary/15 text-primary';
const CHIP_OFF = 'border-border bg-muted text-muted-foreground hover:text-foreground';
