// Home's Groceries card, shared by both apps: which rows it shows and what
// quick add does with a name already on the list. Each app keeps its own row
// rendering, haptics and (web) the fade a just-ticked row lingers through.

import type { GroceryItem } from '../types';
import { compareStrings } from '../sort';

/** Needed-item count at or above which the card shows only the essentials. */
export const HOME_GROCERY_EXPAND_THRESHOLD = 10;

export interface HomeGroceryRows {
  /** Every needed item shows (a short list, or Home filtered to Groceries). */
  showFullList: boolean;
  /** The whole card: needed, bought today and lingering rows, in card order. */
  fullItems: GroceryItem[];
  /** What shows now: the whole card, or only essentials (and lingering rows) on a long list. */
  cardItems: GroceryItem[];
  /** Needed items left out of `cardItems`, by name, for the chip summary. */
  overflowNames: string[];
}

/**
 * The card's rows. A short list (or `expanded`) shows every needed item plus
 * what was bought today (its Undo window); a long one shows the needed
 * essentials and sums up the rest as chips. A `lingering` row (just ticked
 * to Have on web, mid fade-out) always shows. Needed essentials come first,
 * then other needed items, then the rest, by name within each.
 */
export function homeGroceryRows(
  items: GroceryItem[],
  opts: { expanded: boolean; today: string; lingering?: ReadonlySet<string> }
): HomeGroceryRows {
  const lingering = opts.lingering ?? new Set<string>();
  const needed = items.filter((i) => i.status === 'needed').length;
  const showFullList = opts.expanded || needed < HOME_GROCERY_EXPAND_THRESHOLD;
  const rank = (i: GroceryItem) => (i.status === 'needed' ? (i.is_essential ? 0 : 1) : 2);
  const fullItems = items
    .filter(
      (i) =>
        lingering.has(i.id) || i.status === 'needed' || (i.status === 'bought' && i.last_purchased_at === opts.today)
    )
    .sort((a, b) => rank(a) - rank(b) || compareStrings(a.name, b.name));
  const cardItems = showFullList
    ? fullItems
    : fullItems.filter((i) => lingering.has(i.id) || (i.status === 'needed' && i.is_essential));
  const cardIds = new Set(cardItems.map((i) => i.id));
  const overflowNames = items
    .filter((i) => i.status === 'needed' && !cardIds.has(i.id))
    .map((i) => i.name)
    .sort();
  return { showFullList, fullItems, cardItems, overflowNames };
}

/** The item quick add matches by name, ignoring case, or undefined. */
export function findGroceryByName(items: GroceryItem[], name: string): GroceryItem | undefined {
  const key = name.toLowerCase();
  return items.find((i) => i.name?.toLowerCase() === key);
}

/** Quick add of a name already on the list puts it back to Needed instead of adding a duplicate. */
export function groceryNeededAgainPatch(nowIso: string): Pick<GroceryItem, 'status' | 'last_purchased_at' | 'status_changed_at'> {
  return { status: 'needed', last_purchased_at: null, status_changed_at: nowIso };
}
