'use client';

// Recipes v2 R5: the match step after a scan. "9 of 12 matched to Groceries"
// as the lede, then only what needs you: close names to confirm (Same / New),
// new items with an add-to-list switch, the matched ones collapsed into chips,
// and the household's staples, which never go on the list. "Same" and "New"
// apply at once and teach future scans (an alias row); the switches apply on
// the footer button, which then opens the review sheet.
// Native twin: apps/mobile/src/features/recipes/scan-match-sheet.tsx.

import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
  ingredientMatchKey,
  itemMatchLibrary,
  summarizeScanMatch,
  type GroceryItem,
  type MatchContext,
  type RecipeIngredient,
  type ScanMatchRow,
} from '@homeup/core';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { HeroLede } from '@/components/ui/hero-lede';
import { Input } from '@/components/ui/input';
import { ListGroup, ListItem, ListItemContent, ListItemMeta, ListItemTitle, ListItemTrailing } from '@/components/ui/list-item';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

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
  const [saidNew, setSaidNew] = useState<Set<string>>(new Set());
  const [toList, setToList] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [editStaples, setEditStaples] = useState(false);
  const [newStaple, setNewStaple] = useState('');

  const ctx = useMemo(() => context(itemMatchLibrary(groceryItems, allIngredients)), [context, groceryItems, allIngredients]);
  const summary = useMemo(() => {
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
    for (const r of adding) onAddToList(r.ingredient, freshName(r));
    setToList(new Set());
    onDone();
  };

  const addStaple = () => {
    const name = newStaple.trim();
    if (!name) return;
    onSetStaple(name, true);
    setNewStaple('');
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onDone();
      }}
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
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Match to Groceries</p>
            <HeroLede
              value={<span className="tabular-nums">{summary.matched.length}</span>}
              label={<span className="tabular-nums">of {counted} matched to Groceries</span>}
              meter={counted > 0 ? { done: summary.matched.length, total: counted } : undefined}
              tone={summary.check.length === 0 ? 'success' : 'neutral'}
            />
          </div>

          <div ref={contentRef} className="max-h-[55vh] space-y-4 overflow-y-auto px-4 pb-2">
            {summary.check.length > 0 && (
              <Section label={`Check ${summary.check.length === 1 ? 'this one' : `these ${summary.check.length}`}`}>
                {summary.check.map((r) => (
                  <ListItem key={r.ingredient.id} className="items-center">
                    <ListItemContent>
                      <ListItemTitle>
                        <span className="truncate">{ingredientMatchKey(r.ingredient)}</span>
                      </ListItemTitle>
                      <ListItemMeta>
                        is it your <span className="font-medium text-warning">{r.match.kind === 'check' ? r.match.item : ''}</span>?
                      </ListItemMeta>
                    </ListItemContent>
                    <ListItemTrailing className="gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          toggle(saidNew, setSaidNew, r.ingredient.id, true);
                          onNew(r.ingredient);
                        }}
                        className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        New
                      </button>
                      <button
                        type="button"
                        onClick={() => r.match.kind === 'check' && onSame(r.ingredient, r.match.item)}
                        className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                      >
                        Same
                      </button>
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
                      <ListItemTitle>
                        <span className="truncate">{freshName(r)}</span>
                      </ListItemTitle>
                      <ListItemMeta>
                        <span className="truncate">{r.ingredient.name}</span>
                      </ListItemMeta>
                    </ListItemContent>
                    <ListItemTrailing className="gap-2">
                      {canRemember && (
                        <button
                          type="button"
                          onClick={() => onSetStaple(freshName(r), true)}
                          className="inline-flex h-9 items-center rounded-lg px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          Staple
                        </button>
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
                <div className="flex flex-wrap gap-1.5 p-3">
                  {matchedShown.map((r) => (
                    <span key={r.ingredient.id} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-muted px-2.5 text-xs font-medium text-foreground">
                      <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', dotClass(r))} />
                      {r.match.kind === 'matched' ? r.match.item : ''}
                      <span className="sr-only">{statusWord(r)}</span>
                    </span>
                  ))}
                  {summary.matched.length > MATCHED_SHOWN && (
                    <button
                      type="button"
                      onClick={() => setShowAll((v) => !v)}
                      className="relative inline-flex h-7 items-center rounded-full px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground after:absolute after:-inset-y-2 after:inset-x-0 after:content-['']"
                    >
                      {showAll ? 'Show less' : `+${summary.matched.length - MATCHED_SHOWN} more`}
                    </button>
                  )}
                </div>
              </Section>
            )}

            {(summary.staples.length > 0 || editStaples) && (
              <Section label={`Staples · ${summary.staples.length}`}>
                <div className="flex flex-wrap gap-1.5 p-3">
                  {summary.staples.map((r) => (
                    <span key={r.ingredient.id} className="inline-flex h-7 items-center rounded-full bg-muted px-2.5 text-xs font-medium text-muted-foreground">
                      {ingredientMatchKey(r.ingredient)}
                    </span>
                  ))}
                  {summary.staples.length === 0 && <span className="text-xs text-muted-foreground">None in this recipe</span>}
                </div>
              </Section>
            )}

            {editStaples && canRemember && (
              <Section label="Your staples">
                <div className="flex flex-wrap gap-1.5 p-3">
                  {staplesShown.map((name) => (
                    <span key={name} className="inline-flex h-7 items-center gap-1 rounded-full bg-muted pl-2.5 pr-1 text-xs font-medium text-foreground">
                      {name}
                      <button
                        type="button"
                        onClick={() => onSetStaple(name, false)}
                        aria-label={`${name} is not a staple`}
                        className="relative inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground after:absolute after:-inset-2.5 after:content-['']"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <form
                  className="px-3 pb-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addStaple();
                  }}
                >
                  <Input value={newStaple} onChange={(e) => setNewStaple(e.target.value)} placeholder="Add a staple, like Rice" aria-label="Add a staple" maxLength={60} />
                </form>
              </Section>
            )}

            <p className="px-1 text-xs text-muted-foreground">
              Staples never go on the list.{canRemember ? ' Your answers teach future scans.' : ''}
              {canRemember && (
                <>
                  {' '}
                  <button type="button" onClick={() => setEditStaples((v) => !v)} className="font-medium text-primary hover:text-primary/80">
                    {editStaples ? 'Done with staples' : 'Edit staples'}
                  </button>
                </>
              )}
            </p>
          </div>

          <div className="px-4 pt-2">
            <button
              type="button"
              onClick={finish}
              className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              {adding.length > 0 ? `Add ${adding.length} to Groceries` : 'Looks right'}
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
