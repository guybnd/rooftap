// HOUP-110: pure grocery-disposition helper shared by the grocery item card
// (apps/mobile/src/features/groceries/grocery-item-card.tsx) and the Android
// widget's headless handler. Explicit target only — never infers an inverse
// from the item's current status.
import { clearRecipeNoteOnLeaveNeeded } from '../recipes/recipes';
import type { GroceryItem } from '../../types';

export function applyGroceryDisposition(
  item: GroceryItem,
  target: GroceryItem['status'],
  opts: { now?: Date; priceCents?: number | null } = {},
): Partial<GroceryItem> {
  const now = (opts.now ?? new Date()).toISOString();
  const patch: Partial<GroceryItem> = { status: target, status_changed_at: now };
  if (target === 'bought') {
    patch.last_purchased_at = now.slice(0, 10);
    // The widget has no access to the recipe-library price lookup the in-app
    // card uses for its fallback — `priceCents` lets the card still pass its
    // resolved `effectivePriceCents` while the widget falls back to the
    // item's own stored price only.
    patch.last_price = opts.priceCents !== undefined ? opts.priceCents : (item.price_cents ?? null);
  } else {
    patch.last_purchased_at = null;
  }
  Object.assign(patch, clearRecipeNoteOnLeaveNeeded(target));
  return patch;
}
