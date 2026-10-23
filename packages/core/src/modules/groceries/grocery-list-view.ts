// What the Groceries list shows, shared by the web page and the mobile tab:
// each item's price, the list estimate, today's trip totals, search that also
// lists a named aisle, and the Undo-pill actions. Each app keeps its own
// rendering and its own toast; use-grocery-search.ts, use-grocery-aux.ts and
// use-suggest-dismiss.ts hold the state on top of these.

import type { GroceryItem } from '../../types';
import { GROCERY_UNDO_LABELS, groceryNeedAgainPatch } from './groceries';
import { isBoughtToday } from './grocery-sessions';

/** Typical price (cents) for an item name, from the library or code defaults. */
export type GroceryPriceFor = (name: string) => number | null;

/** The item's own price, else the library's typical price for its name. */
export function groceryPriceCents(item: Pick<GroceryItem, 'name' | 'price_cents'>, priceFor: GroceryPriceFor): number | null {
  return item.price_cents ?? priceFor(item.name);
}

/** Items you'll actually buy (Needed + Got it). "Have it" stays out of totals and progress. */
export function groceryBuyableItems<T extends Pick<GroceryItem, 'status'>>(items: T[]): T[] {
  return items.filter((i) => i.status !== 'have');
}

/**
 * The list estimate: unit prices summed once per item (no quantity multiply,
 * the session convention), and how many items have no price at all.
 */
export function groceryEstimate(
  list: Pick<GroceryItem, 'name' | 'price_cents'>[],
  priceFor: GroceryPriceFor
): { cents: number; unpriced: number } {
  let cents = 0;
  let unpriced = 0;
  for (const i of list) {
    const p = groceryPriceCents(i, priceFor);
    if (p == null) unpriced += 1;
    else cents += p;
  }
  return { cents, unpriced };
}

/**
 * Today's trip: the items marked Got it today, what they came to (the price
 * paid, else the expected price) and how many have no price either way.
 */
export function groceryTripTotals(
  items: GroceryItem[],
  priceFor: GroceryPriceFor,
  date?: string
): { items: GroceryItem[]; cents: number; unpriced: number } {
  const bought = items.filter((i) => isBoughtToday(i, date));
  let cents = 0;
  let unpriced = 0;
  for (const i of bought) {
    const p = i.last_price ?? groceryPriceCents(i, priceFor);
    if (p == null) unpriced += 1;
    else cents += p;
  }
  return { items: bought, cents, unpriced };
}

/**
 * Search results plus everything in the aisles the query names ("dairy"),
 * after the name matches and without repeats.
 */
export function groceriesWithAisleMatches<T extends Pick<GroceryItem, 'id' | 'aisle'>>(
  matches: T[],
  items: T[],
  aisles: string[]
): T[] {
  if (aisles.length === 0) return matches;
  const seen = new Set(matches.map((i) => i.id));
  return [...matches, ...items.filter((i) => aisles.includes(i.aisle) && !seen.has(i.id))];
}

/** The part of each app's undo-toast presenter these actions use. */
export type GroceryUndoPresenterFactory = (options: {
  message: (count: number, latest: GroceryItem) => string;
  apply: (id: string, patch: Partial<GroceryItem>) => void;
}) => { run(rows: GroceryItem | GroceryItem[], patch: Partial<GroceryItem>): void };

/**
 * Single-tap grocery actions with an Undo pill: Buy again chips, re-add
 * suggestions' Add / Add all / Snooze / Not now, and Reset bought. One
 * presenter per action kind, so rapid taps of the same kind coalesce into one
 * pill ("3 items added to list") without mixing kinds.
 */
export function createGroceryUndoActions(
  createPresenter: GroceryUndoPresenterFactory,
  apply: (id: string, patch: Partial<GroceryItem>) => void
) {
  const added = createPresenter({ message: (n, item) => GROCERY_UNDO_LABELS.added(n, item.name), apply });
  const snoozed = createPresenter({ message: (n, item) => GROCERY_UNDO_LABELS.snoozed(n, item.name), apply });
  const hidden = createPresenter({ message: (n, item) => GROCERY_UNDO_LABELS.hidden(n, item.name), apply });
  const reset = createPresenter({ message: (count) => GROCERY_UNDO_LABELS.reset(count), apply });
  return {
    /** Back to Needed: a Buy again chip, a suggestion's Add, or Add all. */
    needAgain: (items: GroceryItem | GroceryItem[]) => added.run(items, groceryNeedAgainPatch()),
    snooze: (item: GroceryItem, untilISO: string) => snoozed.run(item, { re_add_snoozed_until: untilISO }),
    /** The X's "Not now": hide the suggestion until the item is next bought. */
    hide: (item: GroceryItem) => hidden.run(item, { re_add_dismissed_at: new Date().toISOString() }),
    resetBought: (items: GroceryItem[]) =>
      reset.run(items, { status: 'needed', last_purchased_at: null, status_changed_at: new Date().toISOString() }),
  };
}

export type GroceryUndoActions = ReturnType<typeof createGroceryUndoActions>;
