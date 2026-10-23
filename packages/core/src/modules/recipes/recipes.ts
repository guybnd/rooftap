// FLUX-189: Recipes section — shared constants, pure row builders, and the
// recipe↔grocery matching rules.
//
// Like @/lib/checklists this module is intentionally side-effect-free: it builds
// row objects and computes rules, but never writes to a store itself. The pages
// own orchestration (calling useStoreHelpers write helpers). Keeping the shapes +
// rules here means every surface (list, detail, form, grocery badge) agrees.

import type { GroceryItem, Recipe, RecipeIngredient, RecipeMethod, RecipeSourceType } from '../../types';
import { envRandomUUID } from '../../data/store-environment';

// ── Name normalisation ─────────────────────────────────────────────────────────
// The recipe↔grocery match is name-based (decision 2). Replicated here rather than
// imported because `norm` is module-private in item-library.ts; matches the same
// trim().toLowerCase() precedent (FLUX-176). Tolerates a missing name: a local
// cache can hold a partial row with no `name` (see patchRow in
// create-group-store.ts), and one such row must not crash the Recipes screen.
export const norm = (s: string | null | undefined): string => (s ?? '').toLowerCase().trim();

// ── Cooking method ─────────────────────────────────────────────────────────────
export const RECIPE_METHODS: RecipeMethod[] = ['cooking', 'baking', 'roasting', 'other'];

export interface RecipeMethodMeta {
  method: RecipeMethod;
  emoji: string;
  label: string;
}

export const RECIPE_METHOD_META: Record<RecipeMethod, RecipeMethodMeta> = {
  cooking: { method: 'cooking', emoji: '🍳', label: 'Cooking' },
  baking: { method: 'baking', emoji: '🧁', label: 'Baking' },
  roasting: { method: 'roasting', emoji: '🔥', label: 'Roasting' },
  other: { method: 'other', emoji: '🍽️', label: 'Other' },
};

export function methodMeta(method: RecipeMethod | null | undefined): RecipeMethodMeta {
  return (method && RECIPE_METHOD_META[method]) || RECIPE_METHOD_META.other;
}

// ── Units (decision 7) ──────────────────────────────────────────────────────────
// A bounded cooking-unit list for the recipe form's Unit dropdown. This is a
// FORM-LEVEL constraint only — the DB column stays `unit text null`, so the set
// can grow freely later without a migration. '' is the unset/"—" option.
export interface UnitOption {
  value: string;
  label: string;
}

export const UNITS: UnitOption[] = [
  { value: '', label: '–' },
  { value: 'mg', label: 'mg' },
  { value: 'g', label: 'g' },
  { value: 'kg', label: 'kg' },
  { value: 'ml', label: 'ml' },
  { value: 'L', label: 'L' },
  { value: 'tsp', label: 'tsp' },
  { value: 'tbsp', label: 'tbsp' },
  { value: 'cup', label: 'cup' },
  { value: 'pcs', label: 'piece(s)' },
  { value: 'clove', label: 'clove' },
  { value: 'pinch', label: 'pinch' },
  { value: 'slice', label: 'slice' },
  { value: 'can', label: 'can' },
  { value: 'pack', label: 'pack' },
];

// ── Unit-aware drag step (decision 8) ────────────────────────────────────────────
// Maps the currently-selected unit to the DragNumberField `step`. The user's
// examples (g/mg ±50, ml ±10, L/kg ±1) are locked; the rest are sensible defaults.
export const UNIT_STEP: Record<string, number> = {
  mg: 50,
  g: 50,
  kg: 1,
  ml: 10,
  L: 1,
  tsp: 1,
  tbsp: 1,
  cup: 0.25,
  pcs: 1,
  clove: 1,
  pinch: 1,
  slice: 1,
  can: 1,
  pack: 1,
};

/** The drag step for a unit; default 1 for unset/unknown. */
export function stepForUnit(unit: string | null | undefined): number {
  return UNIT_STEP[(unit ?? '').trim()] ?? 1;
}

// ── Recipe ↔ grocery matching (decisions 2, 3) ───────────────────────────────────

/** The live status of an ingredient relative to the grocery list. */
export type IngredientStatus = 'have' | 'needed' | 'bought' | 'none';

/**
 * Name-match an ingredient to an active (non-deleted) grocery item. Case- and
 * whitespace-insensitive; re-evaluated against the given name each render (no
 * stored hard link). Returns null when nothing matches.
 *
 * Callers holding a `RecipeIngredient` MUST pass `ingredientMatchKey(ing)`
 * (item_name ?? name), not `ing.name` directly (FLUX-205) — this function stays
 * name-string-based so it also serves the plain autocomplete-suggestion case.
 */
export function matchIngredientToGrocery(
  name: string,
  items: GroceryItem[],
): GroceryItem | null {
  const n = norm(name);
  if (!n) return null;
  return items.find((i) => !i.deleted && norm(i.name) === n) ?? null;
}

/** The ingredient's status: its matched item's status, or 'none' if unmatched. */
export function ingredientStatus(name: string, items: GroceryItem[]): IngredientStatus {
  const match = matchIngredientToGrocery(name, items);
  return match ? match.status : 'none';
}

/**
 * FLUX-205: the key an ingredient is matched/added to the grocery list by —
 * the linked canonical item (`item_name`) when one has been picked, else the
 * full descriptor (`name`). Every have/need match + grocery-add call site
 * keys on this, not `ing.name` alone, so "white sugar" (descriptor) can link
 * to "sugar" (item_name) instead of spawning a near-duplicate.
 */
export function ingredientMatchKey(ing: Pick<RecipeIngredient, 'name' | 'item_name'>): string {
  return ing.item_name ?? ing.name;
}

export interface HaveCount {
  have: number;
  total: number;
}

/**
 * How many of a recipe's ingredients you already "have" (presence-based: the
 * matched grocery item is status==='have'). Guards zero-ingredient recipes.
 */
export function recipeHaveCount(
  ingredients: RecipeIngredient[],
  items: GroceryItem[],
): HaveCount {
  const live = ingredients.filter((i) => !i.deleted);
  const have = live.filter(
    (ing) => matchIngredientToGrocery(ingredientMatchKey(ing), items)?.status === 'have',
  ).length;
  return { have, total: live.length };
}

/**
 * A recipe can be made right now iff it has at least one ingredient and EVERY
 * ingredient's matched item is status==='have' (strict all-have; threshold mode
 * is a v2 follow-up). Zero-ingredient recipes are excluded.
 */
export function canBeMade(ingredients: RecipeIngredient[], items: GroceryItem[]): boolean {
  const live = ingredients.filter((i) => !i.deleted);
  if (live.length === 0) return false;
  return live.every((ing) => matchIngredientToGrocery(ingredientMatchKey(ing), items)?.status === 'have');
}

/**
 * Name suggestions for the ingredient-name autocomplete (decision 6): the
 * normalized-deduped union of active grocery item names + previously-used recipe
 * ingredient names, alphabetised. Free-typing a novel name is still allowed by the
 * caller — this only steers toward names that already exist.
 */
export function ingredientNameSuggestions(
  groceryItems: GroceryItem[],
  ingredients: RecipeIngredient[],
): string[] {
  const seen = new Map<string, string>(); // norm → first-seen display form
  const add = (raw: string | null | undefined) => {
    const k = norm(raw);
    if (k && !seen.has(k)) seen.set(k, (raw ?? '').trim());
  };
  for (const i of groceryItems) if (!i.deleted) add(i.name);
  for (const ing of ingredients) if (!ing.deleted) add(ing.name);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * FLUX-209: the candidate library for `rankItemMatches` (fuzzy item matching) —
 * the normalized-deduped union of active grocery item names + previously-linked
 * canonical `item_name` values, alphabetised. Deliberately excludes raw ingredient
 * descriptors (`ing.name`, e.g. "thinly sliced blood oranges, peeled"): unlike
 * `ingredientNameSuggestions` (which feeds the free-text autocomplete and wants
 * descriptors too), a fuzzy match TARGET should only ever be a canonical item
 * name — otherwise a long descriptor line can surface as a confusing suggestion
 * chip, including a row matching its own descriptor back at itself.
 */
export function itemMatchLibrary(
  groceryItems: GroceryItem[],
  ingredients: RecipeIngredient[],
): string[] {
  const seen = new Map<string, string>(); // norm → first-seen display form
  const add = (raw: string | null | undefined) => {
    if (!raw) return;
    const k = norm(raw);
    if (k && !seen.has(k)) seen.set(k, raw.trim());
  };
  for (const i of groceryItems) if (!i.deleted) add(i.name);
  for (const ing of ingredients) if (!ing.deleted) add(ing.item_name);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

// ── Fuzzy item matching (FLUX-205, decision D3) ─────────────────────────────────
// One pure ranker reused by three surfaces: recipe-capture auto-link, the
// review-sheet suggestion chips, and the row quick-editor's match section.
// The candidate library for these three surfaces is `itemMatchLibrary` (FLUX-209),
// not `ingredientNameSuggestions` (that stays reserved for the name autocomplete).

export type MatchTier = 'exact' | 'plural' | 'subset' | 'overlap';

export interface ScoredMatch {
  /** The library entry's display-form name. */
  name: string;
  tier: MatchTier;
  /** 0–1, informational (used for ordering within/between overlap results). */
  score: number;
}

/** Crude English singular/plural fold: "eggs" -> "egg", "berries" -> "berry". */
function singularize(word: string): string {
  if (word.endsWith('ies') && word.length > 3) return `${word.slice(0, -3)}y`;
  if (word.endsWith('ses') && word.length > 3) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 1) return word.slice(0, -1);
  return word;
}

function tokenize(s: string): string[] {
  return norm(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(singularize);
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  return a.size > 0 && [...a].every((t) => b.has(t));
}

/**
 * Tiered fuzzy match of `query` (a descriptor or candidate item name) against a
 * name library, best matches first: exact norm -> singular/plural -> token
 * subset (all of one name's tokens contained in the other's, e.g. "sugar" ⊂
 * "white sugar") -> token-overlap score. Returns the top matches at/above
 * `threshold` (default limits to 2–3 results). Dedupes the library by norm,
 * keeping first-seen display form.
 */
export function rankItemMatches(
  query: string,
  library: string[],
  opts: { limit?: number; threshold?: number } = {},
): ScoredMatch[] {
  const limit = opts.limit ?? 3;
  const threshold = opts.threshold ?? 0.34;
  const q = norm(query);
  if (!q) return [];
  const qSingular = singularize(q);
  const qTokens = new Set(tokenize(query));

  const results: ScoredMatch[] = [];
  const seen = new Set<string>();
  for (const raw of library) {
    const k = norm(raw);
    if (!k || seen.has(k)) continue;
    seen.add(k);

    if (k === q) {
      results.push({ name: raw, tier: 'exact', score: 1 });
      continue;
    }

    const kSingular = singularize(k);
    if (kSingular === qSingular) {
      results.push({ name: raw, tier: 'plural', score: 0.9 });
      continue;
    }

    const kTokens = new Set(tokenize(raw));
    if (isSubset(kTokens, qTokens) || isSubset(qTokens, kTokens)) {
      results.push({ name: raw, tier: 'subset', score: 0.75 });
      continue;
    }

    const overlap = [...qTokens].filter((t) => kTokens.has(t)).length;
    const union = new Set([...qTokens, ...kTokens]).size;
    const overlapScore = union > 0 ? overlap / union : 0;
    if (overlapScore >= threshold) {
      results.push({ name: raw, tier: 'overlap', score: overlapScore });
    }
  }

  const tierRank: Record<MatchTier, number> = { exact: 0, plural: 1, subset: 2, overlap: 3 };
  results.sort((a, b) => tierRank[a.tier] - tierRank[b.tier] || b.score - a.score);
  return results.slice(0, limit);
}

/** Trim a possibly-fractional quantity for display ("250", "0.5"). */
export function trimQty(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * The patch fragment that clears the ephemeral recipe note when a grocery item's
 * status leaves 'needed' (→ have/bought), and is a no-op while it stays 'needed'.
 * Never touches the user's own `notes`. Spread into any status-change payload so
 * every status surface (card swipe, edit modal, Home hub widget, recipe inline
 * toggle) enforces the same rule — a new fifth surface can't silently reintroduce
 * a stale badge (the FLUX-189 review gap). Returns {} while staying 'needed'.
 */
export function clearRecipeNoteOnLeaveNeeded(
  target: GroceryItem['status'],
): Partial<Pick<GroceryItem, 'recipe_note' | 'recipe_source_id'>> {
  return target !== 'needed' ? { recipe_note: null, recipe_source_id: null } : {};
}

/**
 * The ephemeral grocery note for an ingredient pushed onto the shopping list —
 * e.g. "250 g for Lasagna", or "for Lasagna" when it has no quantity.
 */
export function recipeNoteFor(ingredient: RecipeIngredient, recipeTitle: string): string {
  const amount =
    ingredient.quantity != null
      ? `${trimQty(ingredient.quantity)}${ingredient.unit ? ` ${ingredient.unit}` : ''} `
      : '';
  return `${amount}for ${recipeTitle.trim()}`.trim();
}

// ── Instructions ↔ step list (FLUX-202, decision 5) ──────────────────────────────
// `Recipe.instructions` stays a single `text` column (no schema change); the step
// editor UI (parsed and manual entry alike) just splits/joins on newlines, so
// every surface agrees on the same shape.

/** Split stored instructions text into ordered, non-blank step strings. */
export function stepsFromInstructions(instructions: string | null | undefined): string[] {
  return (instructions ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Join ordered step strings back into the newline-delimited `instructions` text. */
export function instructionsFromSteps(steps: string[]): string | null {
  const cleaned = steps.map((s) => s.trim()).filter(Boolean);
  return cleaned.length ? cleaned.join('\n') : null;
}

// ── id / time helpers ────────────────────────────────────────────────────────────
function freshId(): string {
  return envRandomUUID();
}
function nowISO(): string {
  return new Date().toISOString();
}

// ── Pure row builders ────────────────────────────────────────────────────────────
// Mirror the grocery/checklist pattern: explicit id + real `now` timestamps.
// useStoreHelpers.writeRow strips server timestamps and lets handle_times() fill
// them, classifying the row as an INSERT.

export function buildRecipe(input: {
  groupId: string;
  title: string;
  cuisines?: string[];
  method?: RecipeMethod | null;
  instructions?: string | null;
  servings?: number | null;
  prepMinutes?: number | null;
  cookMinutes?: number | null;
  source?: string | null;
  sourceType?: RecipeSourceType | null;
  draft?: boolean;
  createdBy?: string | null;
  id?: string;
}): Recipe {
  const now = nowISO();
  return {
    id: input.id ?? freshId(),
    group_id: input.groupId,
    title: input.title.trim(),
    cuisines: input.cuisines ?? [],
    method: input.method ?? null,
    instructions: input.instructions?.trim() || null,
    servings: input.servings ?? null,
    prep_minutes: input.prepMinutes ?? null,
    cook_minutes: input.cookMinutes ?? null,
    source: input.source?.trim() || null,
    source_type: input.sourceType ?? null,
    draft: input.draft ?? false,
    created_by: input.createdBy ?? null,
    created_at: now,
    updated_at: now,
    deleted: false,
  };
}

// ── Defensive cuisines reader (HOUP-333) ──────────────────────────────────────────
// `cuisines` is `text[] not null default '{}'` in the DB and buildRecipe always
// sets it, yet rows have reached render sites without it — production 2026-09-12:
// `Uncaught TypeError: t.cuisines is not iterable` inside a useMemo took down the
// whole /recipes page. Known sources: legacy local-cache rows written by the
// pre-d23b8f50 mobile form (which never defaulted the field) and any synced
// payload that drops the column. One malformed row must never take down a whole
// section, so every iteration of `cuisines` goes through this reader, and the
// recipes$ store runs normalizeRecipeRow over every row it receives from Supabase.

/**
 * Always-an-array view of a recipe's cuisine tags. Tolerates a missing, null or
 * non-array field; a bare non-empty string is kept as a single tag rather than
 * hidden; non-string members are dropped.
 */
export function recipeCuisines(recipe: { cuisines?: unknown } | null | undefined): string[] {
  const raw = recipe?.cuisines;
  if (Array.isArray(raw)) return raw.filter((c): c is string => typeof c === 'string');
  if (typeof raw === 'string' && raw.trim()) return [raw.trim()];
  return [];
}

/**
 * Store-boundary normaliser for recipes$ (createGroupStore `normalizeRow`).
 * Returns the SAME reference when `cuisines` is already a clean string array so
 * Legend's change detection sees no churn on the happy path.
 */
export function normalizeRecipeRow(row: Recipe): Recipe {
  const raw = (row as { cuisines?: unknown }).cuisines;
  if (Array.isArray(raw) && raw.every((c) => typeof c === 'string')) return row;
  return { ...row, cuisines: recipeCuisines(row) };
}

export function buildRecipeIngredient(input: {
  recipeId: string;
  groupId: string;
  name: string;
  /** Canonical grocery item this row links to, if any (FLUX-205). */
  itemName?: string | null;
  quantity?: number | null;
  unit?: string | null;
  position: number;
  id?: string;
}): RecipeIngredient {
  const now = nowISO();
  return {
    id: input.id ?? freshId(),
    recipe_id: input.recipeId,
    group_id: input.groupId,
    name: input.name.trim(),
    item_name: input.itemName?.trim() || null,
    quantity: input.quantity ?? null,
    unit: input.unit?.trim() || null,
    position: input.position,
    created_at: now,
    updated_at: now,
    deleted: false,
  };
}

/**
 * A fresh grocery item carrying an ephemeral recipe note (FLUX-205) — the shape
 * shared by every "add/link an ingredient to the grocery list" call site
 * (recipe detail's "Add to list" + quick-editor "Create new item", the review
 * sheet's new-item quick-editor). Default status 'needed'; callers override
 * quantity/unit/status when the source (e.g. the quick-editor) collected them.
 */
export function buildNeededGroceryItem(input: {
  groupId: string;
  name: string;
  recipeNote: string;
  recipeSourceId: string;
  createdBy: string | null;
  quantity?: number | null;
  unit?: string | null;
  status?: GroceryItem['status'];
}): GroceryItem {
  const now = nowISO();
  return {
    id: freshId(),
    group_id: input.groupId,
    name: input.name.trim(),
    aisle: 'other',
    quantity: input.quantity ?? null,
    unit: input.unit ?? null,
    status: input.status ?? 'needed',
    notes: null,
    assigned_to: null,
    private: false,
    template_key: null,
    sort_order: 0,
    created_by: input.createdBy,
    updated_by: null,
    created_at: now,
    updated_at: now,
    deleted: false,
    recurrence_days: null,
    status_changed_at: now,
    last_purchased_at: null,
    last_price: null,
    lowest_price: null,
    expiry_date: null,
    shelf_life_days: null,
    price_cents: null,
    is_essential: false,
    recipe_note: input.recipeNote,
    recipe_source_id: input.recipeSourceId,
    re_add_snoozed_until: null,
    re_add_dismissed_at: null,
  };
}

/**
 * A grocery status-change patch — clears the ephemeral recipe note when the
 * item leaves 'needed' (-> have/bought), never touches the user's own `notes`.
 * Shared by every status-flip surface (detail page, quick-editor, review sheet).
 */
export function groceryStatusPatch(
  nextStatus: GroceryItem['status'],
): Partial<GroceryItem> {
  return {
    status: nextStatus,
    status_changed_at: nowISO(),
    ...clearRecipeNoteOnLeaveNeeded(nextStatus),
  };
}
