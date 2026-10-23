// Recipes v2, scan match step: how a scanned (or imported) ingredient links to
// a Groceries item. One pure classifier serves the match step after a scan,
// the review sheet's chips, recipe capture's silent auto-link, and the
// Assistant's grocery tool, so every surface agrees.
//
// Two household tables teach it:
// - staples (`recipe_staples`): things the household always has, such as
//   salt and oil. They never go on the shopping list and count as "have".
//   DEFAULT_STAPLES apply with no rows. A row with staple=false switches a
//   default off, so the defaults need no seeding.
// - aliases (`ingredient_aliases`): "arborio rice" is our "Risotto rice".
//   Answering "Same" once records one, so the next scan links silently. An
//   alias that points at itself records "New item": keep it as its own item
//   and stop asking.

import { norm, rankItemMatches, ingredientMatchKey, matchIngredientToGrocery } from './recipes';
import type { GroceryItem, RecipeIngredient } from '../../types';
import { envRandomUUID } from '../../data/store-environment';

export interface RecipeStaple {
  id: string;
  group_id: string;
  name: string;
  /** false switches off a default staple. */
  staple: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

export interface IngredientAlias {
  id: string;
  group_id: string;
  /** The scanned name, as Gemini read it ("arborio rice"). */
  alias: string;
  /** The Groceries item it means ("Risotto rice"), or the alias itself for "its own item". */
  item_name: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

/** Staples every household starts with; editable per household. */
export const DEFAULT_STAPLES = ['Salt', 'Pepper', 'Black pepper', 'Olive oil', 'Vegetable oil', 'Water'];

/**
 * A staple key: lower case, single spaces. No plural folding: "peppers" are
 * bell peppers, not the pepper grinder.
 */
function fold(s: string): string {
  return norm(s).replace(/\s+/g, ' ');
}

/** The household's staples as keys: the defaults, plus rows on, minus rows off. */
export function stapleKeys(rows: readonly RecipeStaple[]): Set<string> {
  const keys = new Set(DEFAULT_STAPLES.map(fold));
  const live = rows.filter((r) => !r.deleted).sort((a, b) => (a.updated_at || '').localeCompare(b.updated_at || ''));
  for (const r of live) {
    const k = fold(r.name);
    if (!k) continue;
    if (r.staple) keys.add(k);
    else keys.delete(k);
  }
  return keys;
}

/** The staples as display names, for the staples editor (defaults first, then the household's own). */
export function stapleList(rows: readonly RecipeStaple[]): string[] {
  const keys = stapleKeys(rows);
  const out = new Map<string, string>();
  for (const d of DEFAULT_STAPLES) if (keys.has(fold(d))) out.set(fold(d), d);
  for (const r of rows) if (!r.deleted && r.staple && keys.has(fold(r.name)) && !out.has(fold(r.name))) out.set(fold(r.name), r.name.trim());
  return [...out.values()];
}

/**
 * Whether a name is a staple. "Salt and black pepper" or "salt, pepper" is a
 * staple when every part is, so a combined line stays off the list too, and
 * "sea salt" or "boiling water" is still salt or water.
 */
export function isStaple(name: string | null | undefined, staples: ReadonlySet<string>): boolean {
  const n = fold(name ?? '');
  if (!n) return false;
  if (staples.has(n)) return true;
  const parts = n
    .split(/\s*(?:,|&|\+|\band\b|\bor\b)\s*/)
    .map((p) => p.replace(QUALIFIERS, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return parts.length > 0 && parts.every((p) => staples.has(p));
}

/** Words that don't change what you buy: "freshly ground black pepper" is pepper you have. */
const QUALIFIERS =
  /\b(?:to taste|for seasoning|for frying|to serve|freshly|ground|cracked|sea|kosher|flaky|fine|table|extra virgin|light|a pinch of|pinch of|a little|some|plenty of|cold|warm|hot|boiling|tap)\b/g;

/** norm(alias) -> item name. Should two devices record one offline, the newest wins. */
export function aliasMap(rows: readonly IngredientAlias[]): Map<string, string> {
  const m = new Map<string, string>();
  const live = rows.filter((r) => !r.deleted).sort((a, b) => (a.updated_at || '').localeCompare(b.updated_at || ''));
  for (const r of live) {
    const k = norm(r.alias);
    if (k && r.item_name.trim()) m.set(k, r.item_name.trim());
  }
  return m;
}

/** Everything a match needs, built once per screen. */
export interface MatchContext {
  /** itemMatchLibrary(): grocery names plus names past recipes linked to. */
  library: readonly string[];
  staples: ReadonlySet<string>;
  aliases: ReadonlyMap<string, string>;
}

export type ScanMatch =
  | { kind: 'staple' }
  /** Linked with no question: an exact or plural name, or an alias the household taught. */
  | { kind: 'matched'; item: string; via: 'exact' | 'plural' | 'alias' }
  /** A close name: ask "is it your <item>?" */
  | { kind: 'check'; item: string }
  /** Nothing like it: a new Groceries item. */
  | { kind: 'new'; item: string };

/**
 * Classify one ingredient name. `candidate` is the item to buy (Gemini's
 * `item`, or the linked item_name); `line` is the full line, also checked
 * for staples and aliases.
 */
export function matchIngredientName(candidate: string, ctx: MatchContext, line?: string | null): ScanMatch {
  const item = candidate.trim() || (line ?? '').trim();
  if (isStaple(item, ctx.staples) || isStaple(line, ctx.staples)) return { kind: 'staple' };

  const taught = ctx.aliases.get(norm(item)) ?? (line ? ctx.aliases.get(norm(line)) : undefined);
  if (taught && norm(taught) !== norm(item)) return { kind: 'matched', item: taught, via: 'alias' };

  const top = rankItemMatches(item, ctx.library as string[])[0];
  if (top?.tier === 'exact' || top?.tier === 'plural') return { kind: 'matched', item: top.name, via: top.tier };
  // A self-alias is the household saying "its own item": never ask again.
  if (taught) return { kind: 'new', item };
  if (top) return { kind: 'check', item: top.name };
  return { kind: 'new', item };
}

/** The match for a stored ingredient row (keys on item_name ?? name). */
export function ingredientScanMatch(ing: Pick<RecipeIngredient, 'name' | 'item_name'>, ctx: MatchContext): ScanMatch {
  return matchIngredientName(ingredientMatchKey(ing), ctx, ing.name);
}

/**
 * The item_name a freshly scanned or imported line gets: the matched item
 * when the link is safe to make silently, else the candidate as its own name.
 */
export function scannedItemName(candidate: string, ctx: MatchContext, line?: string | null): string {
  const m = matchIngredientName(candidate, ctx, line);
  return m.kind === 'matched' ? m.item : (candidate.trim() || (line ?? '').trim());
}

export interface ScanMatchRow {
  ingredient: RecipeIngredient;
  match: ScanMatch;
  /** The Groceries item the row links to, if it is on the list or in stock. */
  grocery: GroceryItem | null;
}

export interface ScanMatchSummary {
  check: ScanMatchRow[];
  fresh: ScanMatchRow[];
  matched: ScanMatchRow[];
  staples: ScanMatchRow[];
  total: number;
}

/** The match step's sections, in ingredient order. */
export function summarizeScanMatch(
  ingredients: readonly RecipeIngredient[],
  groceryItems: readonly GroceryItem[],
  ctx: MatchContext,
): ScanMatchSummary {
  const out: ScanMatchSummary = { check: [], fresh: [], matched: [], staples: [], total: 0 };
  const live = ingredients.filter((i) => !i.deleted).sort((a, b) => a.position - b.position);
  for (const ingredient of live) {
    const match = ingredientScanMatch(ingredient, ctx);
    const grocery =
      match.kind === 'matched' ? matchIngredientToGrocery(match.item, groceryItems as GroceryItem[]) : null;
    const row = { ingredient, match, grocery };
    if (match.kind === 'check') out.check.push(row);
    else if (match.kind === 'new') out.fresh.push(row);
    else if (match.kind === 'matched') out.matched.push(row);
    else out.staples.push(row);
  }
  out.total = live.length;
  return out;
}

/** Ingredients the shopping list should ever hold: staples left out. */
export function withoutStaples<T extends Pick<RecipeIngredient, 'name' | 'item_name'>>(
  ingredients: readonly T[],
  staples: ReadonlySet<string> | undefined,
): T[] {
  if (!staples || staples.size === 0) return [...ingredients];
  return ingredients.filter((ing) => !isStaple(ingredientMatchKey(ing), staples) && !isStaple(ing.name, staples));
}

// Fresh rows leave the timestamps empty, so the store sends an INSERT and the
// server stamps them (create-group-store.ts, gotcha 5).
export function buildRecipeStaple(input: { groupId: string; name: string; staple: boolean; createdBy: string | null }): RecipeStaple {
  return {
    id: envRandomUUID(),
    group_id: input.groupId,
    name: input.name.trim(),
    staple: input.staple,
    created_by: input.createdBy,
    created_at: '',
    updated_at: '',
    deleted: false,
  };
}

export function buildIngredientAlias(input: { groupId: string; alias: string; itemName: string; createdBy: string | null }): IngredientAlias {
  return {
    id: envRandomUUID(),
    group_id: input.groupId,
    alias: input.alias.trim(),
    item_name: input.itemName.trim(),
    created_by: input.createdBy,
    created_at: '',
    updated_at: '',
    deleted: false,
  };
}
