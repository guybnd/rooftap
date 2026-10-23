'use client';

// "Add missing to groceries" from a recipe: a review sheet in the scan match
// step's layout (scan-match-sheet.tsx) instead of a blind bulk write. One row
// per grocery item (two lines for blood orange are one row), each with a
// switch that starts on, a Staple button, and a click to edit the ingredient.
// What is already on the list sits below as chips. The footer adds the rows
// that are on. Native twin: apps/mobile/src/features/recipes/add-missing-sheet.tsx.

import { useEffect, useState } from 'react';
import { trimQty, type RecipeIngredient, type RecipeShoppingLine } from '@homeup/core';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { HeroLede } from '@/components/ui/hero-lede';
import { ListGroup, ListItem, ListItemContent, ListItemMeta, ListItemTitle, ListItemTrailing } from '@/components/ui/list-item';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

function lineKey(line: RecipeShoppingLine): string {
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
  const [off, setOff] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (open) setOff(new Set());
  }, [open]);

  const toBuy = lines.filter((l) => !l.onList);
  const onList = lines.filter((l) => l.onList);
  const adding = toBuy.filter((l) => !off.has(lineKey(l)));

  const setOn = (line: RecipeShoppingLine, on: boolean) => {
    const next = new Set(off);
    if (on) next.delete(lineKey(line));
    else next.add(lineKey(line));
    setOff(next);
  };

  const finish = () => {
    if (adding.length > 0) onAdd(adding);
    onOpenChange(false);
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
          <div className="space-y-2 px-4 pb-3 pt-1 sm:pt-4">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Add to Groceries</p>
            <HeroLede
              value={<span className="tabular-nums">{toBuy.length}</span>}
              label={<span>to buy for {recipeTitle}</span>}
            />
          </div>

          <div ref={contentRef} className="max-h-[55vh] space-y-4 overflow-y-auto px-4 pb-2">
            {toBuy.length > 0 && (
              <Section label={`To buy · ${toBuy.length}`}>
                {toBuy.map((line) => (
                  <ListItem key={lineKey(line)} className="items-center">
                    <button
                      type="button"
                      onClick={() => onEdit(line.ingredients[0])}
                      aria-label={`Edit ${line.name}`}
                      className="min-w-0 flex-1 text-left"
                    >
                      <ListItemContent>
                        <ListItemTitle>
                          <span className="truncate">{line.name}</span>
                        </ListItemTitle>
                        <ListItemMeta>
                          <span className="line-clamp-2">{lineDetail(line)}</span>
                        </ListItemMeta>
                      </ListItemContent>
                    </button>
                    <ListItemTrailing className="gap-2">
                      {canRemember && (
                        <button
                          type="button"
                          onClick={() => onSetStaple(line.name)}
                          className="inline-flex h-9 items-center rounded-lg px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          Staple
                        </button>
                      )}
                      <Switch
                        checked={!off.has(lineKey(line))}
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
                <div className="flex flex-wrap gap-1.5 p-3">
                  {onList.map((line) => (
                    <span key={lineKey(line)} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-muted px-2.5 text-xs font-medium text-foreground">
                      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-warning" />
                      {line.name}
                    </span>
                  ))}
                </div>
              </Section>
            )}

            <p className="px-1 text-xs text-muted-foreground">Click an item to change what it matches. Staples never go on the list.</p>
          </div>

          <div className="px-4 pt-2">
            <button
              type="button"
              onClick={finish}
              className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              {adding.length > 0 ? `Add ${adding.length} to Groceries` : 'Done'}
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <p className="px-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <ListGroup role="list" aria-label={label}>
        {children}
      </ListGroup>
    </section>
  );
}

/** "2 count blood orange, 9 tbsp blood orange juice": each recipe line behind the row. */
function lineDetail(line: RecipeShoppingLine): string {
  return line.ingredients
    .map((i) => [i.quantity != null ? trimQty(i.quantity) : null, i.unit, i.name].filter(Boolean).join(' '))
    .join(', ');
}
