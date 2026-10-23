import type { GroceryAisle, GroceryCustomAisle, GroceryItem } from '../../types';
import { buildLibraryMap, resolveItemDefaults, type LibraryOverride } from './item-library';
import { canonicalizeItemName, lookupDefault } from './shelf-life-defaults';
import { addDaysISO, daysBetweenISO, todayISO } from "../../date-utils";
// formatMoney is available via the package barrel (money-format.ts) directly —
// no need to re-export it here too (a duplicate `export *` source would
// collide in packages/core/src/index.ts).

export const AISLE_META: Record<GroceryAisle, { label: string; color: string; icon: string }> = {
  produce:      { label: "Produce",         color: "bg-green-900/40 text-green-300",   icon: "🥦" },
  dairy_eggs:   { label: "Dairy & Eggs",    color: "bg-yellow-900/40 text-yellow-300", icon: "🥛" },
  meat_seafood: { label: "Meat & Seafood",  color: "bg-red-900/40 text-red-300",       icon: "🥩" },
  bakery:       { label: "Bakery",          color: "bg-amber-900/40 text-amber-300",   icon: "🍞" },
  pantry:       { label: "Pantry",          color: "bg-orange-900/40 text-orange-300", icon: "🥫" },
  frozen:       { label: "Frozen",          color: "bg-cyan-900/40 text-cyan-300",     icon: "🧊" },
  drinks:       { label: "Drinks",          color: "bg-blue-900/40 text-blue-300",     icon: "🧃" },
  household:    { label: "Household",       color: "bg-slate-700 text-slate-300",      icon: "🧹" },
  other:        { label: "Other",           color: "bg-slate-700/60 text-slate-400",   icon: "📦" },
};

export const AISLE_COLOR: Record<
  GroceryAisle,
  { fill: string; border: string; dot: string; text: string }
> = {
  produce:      { fill: "bg-green-500",   border: "border-l-green-500/60",   dot: "bg-green-400",   text: "text-green-300" },
  dairy_eggs:   { fill: "bg-yellow-500",  border: "border-l-yellow-500/60",  dot: "bg-yellow-400",  text: "text-yellow-300" },
  meat_seafood: { fill: "bg-red-500",     border: "border-l-red-500/60",     dot: "bg-red-400",     text: "text-red-300" },
  bakery:       { fill: "bg-amber-500",   border: "border-l-amber-500/60",   dot: "bg-amber-400",   text: "text-amber-300" },
  pantry:       { fill: "bg-orange-500",  border: "border-l-orange-500/60",  dot: "bg-orange-400",  text: "text-orange-300" },
  frozen:       { fill: "bg-cyan-500",    border: "border-l-cyan-500/60",    dot: "bg-cyan-400",    text: "text-cyan-300" },
  drinks:       { fill: "bg-blue-500",    border: "border-l-blue-500/60",    dot: "bg-blue-400",    text: "text-blue-300" },
  household:    { fill: "bg-slate-500",   border: "border-l-slate-500/60",   dot: "bg-slate-400",   text: "text-slate-300" },
  other:        { fill: "bg-slate-600",   border: "border-l-slate-600/60",   dot: "bg-slate-500",   text: "text-slate-400" },
};

export const AISLE_ORDER: GroceryAisle[] = [
  "produce",
  "dairy_eggs",
  "meat_seafood",
  "bakery",
  "pantry",
  "frozen",
  "drinks",
  "household",
  "other",
];

// ── "One list" flat sort mode (HOUP-317) ─────────────────────────────────────

export type GrocerySortMode = "aisle" | "flat";
export const DEFAULT_GROCERY_SORT_MODE: GrocerySortMode = "aisle";

/** Cap for Suggest re-add before it truncates behind "N more" (HOUP-317). */
export const GROCERY_SUGGEST_CAP = 3;

const STATUS_TIER: Record<GroceryItem["status"], number> = { needed: 0, bought: 1, have: 2 };

// One collator beats per-call `localeCompare` options over a long list.
const NAME_COLLATOR = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/**
 * Flat ("One list") ordering: status tier (needed -> bought -> have), then
 * essentials first within a tier, then name. Pure — copies before sorting.
 */
export function sortGroceriesFlat(items: GroceryItem[]): GroceryItem[] {
  return [...items].sort((a, b) => {
    // status/is_essential null-guarded alongside name (same tombstoned-row
    // risk): an unset value would otherwise make STATUS_TIER[undefined] or
    // Number(undefined) resolve to NaN, silently degrading the whole
    // comparator to arbitrary order instead of just this tier.
    const tier = (STATUS_TIER[a.status] ?? 0) - (STATUS_TIER[b.status] ?? 0);
    if (tier !== 0) return tier;
    const essential = Number(b.is_essential ?? false) - Number(a.is_essential ?? false);
    if (essential !== 0) return essential;
    // null-guarded per packages/core/src/sort.ts — a tombstoned row's `name`
    // can be undefined; a raw localeCompare here would crash the page.
    return NAME_COLLATOR.compare(a.name ?? "", b.name ?? "");
  });
}

// ── Custom aisle color palette ────────────────────────────────────────────────
export const CUSTOM_AISLE_COLOR_KEYS = ["violet", "pink", "indigo", "teal", "lime", "rose", "fuchsia", "sky"] as const;

const CUSTOM_COLOR_MAP: Record<string, { fill: string; border: string; dot: string; text: string }> = {
  violet:  { fill: "bg-violet-500",  border: "border-l-violet-500/60",  dot: "bg-violet-400",  text: "text-violet-300" },
  pink:    { fill: "bg-pink-500",    border: "border-l-pink-500/60",    dot: "bg-pink-400",    text: "text-pink-300" },
  indigo:  { fill: "bg-indigo-500",  border: "border-l-indigo-500/60",  dot: "bg-indigo-400",  text: "text-indigo-300" },
  teal:    { fill: "bg-teal-500",    border: "border-l-teal-500/60",    dot: "bg-teal-400",    text: "text-teal-300" },
  lime:    { fill: "bg-lime-500",    border: "border-l-lime-500/60",    dot: "bg-lime-400",    text: "text-lime-300" },
  rose:    { fill: "bg-rose-500",    border: "border-l-rose-500/60",    dot: "bg-rose-400",    text: "text-rose-300" },
  fuchsia: { fill: "bg-fuchsia-500", border: "border-l-fuchsia-500/60", dot: "bg-fuchsia-400", text: "text-fuchsia-300" },
  sky:     { fill: "bg-sky-500",     border: "border-l-sky-500/60",     dot: "bg-sky-400",     text: "text-sky-300" },
};

const FALLBACK_COLOR = { fill: "bg-slate-500", border: "border-l-slate-500/60", dot: "bg-slate-400", text: "text-slate-300" };

// ── Helpers for built-in + custom aisles ─────────────────────────────────────

export function getAisleMeta(
  aisle: string,
  customAisles?: GroceryCustomAisle[]
): { label: string; color: string; icon: string } {
  if (aisle in AISLE_META) return AISLE_META[aisle as GroceryAisle];
  const custom = customAisles?.find((a) => a.name === aisle);
  if (custom) return { label: custom.name, color: CUSTOM_COLOR_MAP[custom.color]?.text ?? "text-slate-300", icon: "🏷️" };
  return { label: aisle, color: "bg-slate-700/60 text-slate-400", icon: "🏷️" };
}

export function getAisleColor(
  aisle: string,
  customAisles?: GroceryCustomAisle[]
): { fill: string; border: string; dot: string; text: string } {
  if (aisle in AISLE_COLOR) return AISLE_COLOR[aisle as GroceryAisle];
  const custom = customAisles?.find((a) => a.name === aisle);
  if (custom) return CUSTOM_COLOR_MAP[custom.color] ?? FALLBACK_COLOR;
  return FALLBACK_COLOR;
}

// Disposition labels (swipe-driven). "have" = already have it / skip this trip.
export const STATUS_LABEL: Record<GroceryItem["status"], string> = {
  needed: "Needed",
  bought: "Got it",
  have: "Have it",
};

export function countNeeded(items: GroceryItem[]): number {
  return items.filter((i) => i.status === "needed").length;
}

/** The list's Show switch: only what still needs buying, or every item. */
export type GroceryShowFilter = "needed" | "all";
export const DEFAULT_GROCERY_SHOW: GroceryShowFilter = "all";
/** Device-local key that remembers the Show switch between visits. */
export const GROCERY_SHOW_KEY = "homeup-grocery-show";

export function parseGroceryShow(raw: string | null | undefined): GroceryShowFilter {
  return raw === "needed" || raw === "all" ? raw : DEFAULT_GROCERY_SHOW;
}

export function countHave(items: GroceryItem[]): number {
  return items.filter((i) => i.status === "have").length;
}

/** A "have it" item whose shelf life has passed — a candidate to suggest re-adding. */
export interface SuggestReAddItem extends GroceryItem {
  daysOverdue: number;
}

/**
 * Items marked 'have' whose effective shelf life (item's own `shelf_life_days`,
 * else library/code defaults via `resolveItemDefaults`) has passed
 * `status_changed_at` (the "marked have-it at" anchor) and aren't currently
 * snoozed (FLUX-207) or dismissed since they were last marked have-it.
 * Ordered essentials-first, then most days overdue. Items with no resolvable
 * shelf life are never suggested (nothing to compute expiry from).
 */
export function suggestReAdd(
  items: GroceryItem[],
  library?: Map<string, LibraryOverride>,
  today: string = todayISO()
): SuggestReAddItem[] {
  return items
    .filter((i) => i.status === "have" && i.status_changed_at)
    .map((i): SuggestReAddItem | null => {
      const days = i.shelf_life_days ?? resolveItemDefaults(i.name, library).days;
      if (days == null) return null;
      const dueISO = addDaysISO(i.status_changed_at!.slice(0, 10), days);
      const daysOverdue = daysBetweenISO(dueISO, today);
      if (daysOverdue <= 0) return null;
      if (i.re_add_snoozed_until && i.re_add_snoozed_until.slice(0, 10) > today) return null;
      if (isReAddDismissed(i)) return null;
      return { ...i, daysOverdue };
    })
    .filter((i): i is SuggestReAddItem => i != null)
    .sort((a, b) => {
      const rank = (i: GroceryItem) => (i.is_essential ? 0 : 1);
      return rank(a) - rank(b) || b.daysOverdue - a.daysOverdue;
    });
}

/** True when a re-add suggestion was dismissed during the item's current
 *  status stint. Compared as instants, not strings: the server echoes
 *  timestamptz as `+00:00` while the client writes `Z`. */
export function isReAddDismissed(item: Pick<GroceryItem, "re_add_dismissed_at" | "status_changed_at">): boolean {
  if (!item.re_add_dismissed_at || !item.status_changed_at) return false;
  return Date.parse(item.re_add_dismissed_at) >= Date.parse(item.status_changed_at);
}

/** Remaining-freshness window for a 'have it' item, anchored at
 *  `status_changed_at` (got-it date) through got-it + effective shelf life. */
export interface FreshnessWindow {
  totalDays: number;      // effective shelf life
  elapsedDays: number;    // today - gotIt, floored at 0
  remainingDays: number;  // due - today (negative = overdue)
  fraction: number;       // elapsed / total, clamped 0..1
  overdue: boolean;
}

/**
 * Computes a have-it item's freshness window from the got-it anchor
 * (`status_changed_at`) and its effective shelf life, reusing the same
 * got-it + shelf-life math as `suggestReAdd`. Returns `null` when there's
 * nothing to compute from — no got-it date, or no resolvable shelf life.
 */
export function freshnessWindow(
  gotItISO: string | null,
  days: number | null,
  today: string = todayISO()
): FreshnessWindow | null {
  if (!gotItISO || days == null || days <= 0) return null;
  const start = gotItISO.slice(0, 10);
  const dueISO = addDaysISO(start, days);
  const elapsedDays = Math.max(0, daysBetweenISO(start, today));
  const remainingDays = daysBetweenISO(today, dueISO);
  const fraction = Math.min(1, Math.max(0, elapsedDays / days));
  return { totalDays: days, elapsedDays, remainingDays, fraction, overdue: remainingDays <= 0 };
}

/**
 * Resolve a snooze shortcut to a YYYY-MM-DD "snoozed until" string. A custom
 * date is passed straight through (already a YYYY-MM-DD string from a native
 * `<input type="date">` — no Date-object parsing, which shifts a day outside
 * UTC, see `moving-tasks.ts`).
 */
export function snoozeUntilISO(kind: "1d" | "1w" | "1m" | string, today: string = todayISO()): string {
  if (kind === "1d") return addDaysISO(today, 1);
  if (kind === "1w") return addDaysISO(today, 7);
  if (kind === "1m") return addDaysISO(today, 30);
  return kind;
}

export function countBought(items: GroceryItem[]): number {
  return items.filter((i) => i.status === "bought").length;
}

/** Display string for quantity + unit (e.g. "2 kg", "1", "500 ml"). Missing
 *  quantity defaults to 1 (same convention as the cost calc above) — only an
 *  explicit 0 renders as "" (was previously conflated: a unit-only item with
 *  no explicit quantity silently lost its unit entirely). */
export function qtyLabel(item: GroceryItem): string {
  const quantity = item.quantity ?? 1;
  if (quantity === 0) return "";
  return item.unit ? `${quantity} ${item.unit}` : String(quantity);
}

// ── Search-bar entry parsing ─────────────────────────────────────────────────

/** Unit words the search bar recognises before a name ("500g butter",
 *  "2 packs pasta"), mapped to the unit stored on the item. */
const ENTRY_UNITS: Record<string, string> = {
  g: "g", gram: "g", grams: "g",
  kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg",
  ml: "ml", l: "L", lt: "L", litre: "L", litres: "L", liter: "L", liters: "L",
  lb: "lb", lbs: "lb", oz: "oz",
  pack: "pack", packs: "pack", pk: "pack",
  dozen: "dozen", doz: "dozen",
  bunch: "bunch", bunches: "bunch",
  can: "can", cans: "can", tin: "can", tins: "can",
  bottle: "bottle", bottles: "bottle",
  bag: "bag", bags: "bag",
};

export interface GroceryEntry {
  /** The item name with any quantity/unit stripped. */
  name: string;
  quantity: number | null;
  unit: string | null;
}

/**
 * Split a typed entry into name + quantity (+ unit): "2 milk", "2x milk",
 * "milk x2", "500g butter", "1.5 kg rice", "3 cans tomatoes". Anything that
 * doesn't parse cleanly comes back as the whole text with no quantity, so
 * names that merely contain digits ("7up") are left alone.
 */
export function parseGroceryEntry(input: string): GroceryEntry {
  const text = input.trim().replace(/\s+/g, " ");
  const plain: GroceryEntry = { name: text, quantity: null, unit: null };
  const num = (raw: string) => {
    const n = Number(raw.replace(",", "."));
    return Number.isFinite(n) && n > 0 && n < 1000 ? n : null;
  };
  const named = (name: string) => /\p{L}/u.test(name);

  const lead = /^(\d+(?:[.,]\d+)?)\s*([\p{L}]+)?\s+(.+)$/u.exec(text);
  if (lead) {
    const quantity = num(lead[1]);
    const word = lead[2]?.toLowerCase();
    if (quantity != null && named(lead[3])) {
      if (word === "x") return { name: lead[3], quantity, unit: null };
      if (word && ENTRY_UNITS[word]) return { name: lead[3], quantity, unit: ENTRY_UNITS[word] };
      // A plain word after the number is part of the name ("2 milk chocolate").
      return { name: text.slice(lead[1].length).trim(), quantity, unit: null };
    }
  }
  const leadX = /^(\d+(?:[.,]\d+)?)\s*[x×]\s*(.+)$/u.exec(text);
  if (leadX && num(leadX[1]) != null && named(leadX[2])) {
    return { name: leadX[2], quantity: num(leadX[1]), unit: null };
  }
  const trail = /^(.+?)\s+[x×]\s*(\d+(?:[.,]\d+)?)$/u.exec(text) ?? /^(.+?)\s*×\s*(\d+(?:[.,]\d+)?)$/u.exec(text);
  if (trail && num(trail[2]) != null && named(trail[1])) {
    return { name: trail[1], quantity: num(trail[2]), unit: null };
  }
  return plain;
}

/** Display label for a parsed quantity: "×2", "500g", "1.5 kg", "3 can". */
export function formatEntryQuantity(entry: Pick<GroceryEntry, "quantity" | "unit">): string | null {
  if (entry.quantity == null) return null;
  if (!entry.unit) return `×${entry.quantity}`;
  return /^(g|kg|ml|L|lb|oz)$/.test(entry.unit) ? `${entry.quantity}${entry.unit}` : `${entry.quantity} ${entry.unit}`;
}

/**
 * Aisles a search query names: the query (3+ characters) starts the aisle
 * label's first word ("dai" -> Dairy & Eggs) or the whole label/custom aisle
 * name. Searching an aisle lists everything in it.
 */
export function groceryAislesMatching(query: string, customAisles?: GroceryCustomAisle[]): string[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (q.length < 3) return [];
  const hits: string[] = [];
  for (const [key, meta] of Object.entries(AISLE_META)) {
    if (key === "other") continue;
    const label = meta.label.toLowerCase();
    if (label.split(" ")[0].startsWith(q) || label.startsWith(q)) hits.push(key);
  }
  for (const a of customAisles ?? []) {
    if (a.name.toLowerCase().startsWith(q)) hits.push(a.name);
  }
  return hits;
}

/** True when the query is an aisle's name outright ("dairy", "Produce"), so
 *  offering it as a new item would be noise. */
function isAisleName(query: string, customAisles?: GroceryCustomAisle[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    Object.entries(AISLE_META).some(([key, m]) => key !== "other" && (m.label.toLowerCase() === q || m.label.toLowerCase().split(" ")[0] === q)) ||
    (customAisles ?? []).some((a) => a.name.toLowerCase() === q)
  );
}

/**
 * "Buy again" picks for an empty, focused search box: items not currently
 * needed, most recently bought or marked first, one per name.
 */
export function recentGroceryPicks<
  T extends Pick<GroceryItem, "name" | "status" | "status_changed_at" | "last_purchased_at" | "updated_at">,
>(items: T[], limit = 8): T[] {
  const when = (i: T) =>
    Math.max(Date.parse(i.last_purchased_at ?? "") || 0, Date.parse(i.status_changed_at ?? "") || 0, Date.parse(i.updated_at ?? "") || 0);
  const seen = new Set<string>();
  return items
    .filter((i) => i.status !== "needed")
    .sort((a, b) => when(b) - when(a))
    .filter((i) => {
      const key = canonicalizeItemName(i.name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

export interface GrocerySearchAddOptions {
  /** The trimmed query to offer as a brand-new item, or `null` when the list
   *  (or an exact library suggestion below) already covers that name. */
  addName: string | null;
  /** Best-guess aisle for `addName`: the library's aisle, else the built-in
   *  catalog's, else `'other'`. */
  addAisle: string;
  /** Library entries matching the query that aren't on the list yet, exact
   *  name first, capped at `cap`. */
  librarySuggestions: LibraryOverride[];
  /** Quantity/unit typed with the name ("2 milk"), applied to whatever is added. */
  quantity: number | null;
  unit: string | null;
}

/**
 * What the groceries search bar offers to add for `query`. Shown alongside
 * any on-list matches (not only when nothing matched), so searching "milk"
 * with only "Oat milk" on the list still offers "Milk". Names compare by
 * canonical form, so "Eggs" covers a search for "egg".
 */
export function grocerySearchAddOptions(
  items: Pick<GroceryItem, "name">[],
  library: LibraryOverride[],
  query: string,
  customAisles?: GroceryCustomAisle[],
  cap = 6
): GrocerySearchAddOptions {
  const { name: q, quantity, unit } = parseGroceryEntry(query);
  const qKey = canonicalizeItemName(q);
  if (!qKey) return { addName: null, addAisle: "other", librarySuggestions: [], quantity: null, unit: null };

  const onList = new Set(items.map((i) => canonicalizeItemName(i.name)));
  const librarySuggestions = library
    .filter((o) => {
      if (o.hidden) return false;
      const key = canonicalizeItemName(o.item_name);
      return !!key && !onList.has(key) && (key.includes(qKey) || qKey.includes(key));
    })
    .sort((a, b) => {
      const exact = (o: LibraryOverride) => (canonicalizeItemName(o.item_name) === qKey ? 0 : 1);
      return exact(a) - exact(b) || a.item_name.localeCompare(b.item_name);
    })
    .slice(0, cap);

  const covered =
    onList.has(qKey) || librarySuggestions.some((o) => canonicalizeItemName(o.item_name) === qKey);
  const addAisle =
    resolveItemDefaults(q, buildLibraryMap(library)).aisle ?? lookupDefault(q)?.aisle ?? "other";
  const addName = covered || (quantity == null && isAisleName(q, customAisles)) ? null : q;
  return { addName, addAisle, librarySuggestions, quantity, unit };
}

/** The patch behind every "need it again" tap: Buy again chips, re-add
 *  suggestions' Add and Add all. */
export function groceryNeedAgainPatch(now: string = new Date().toISOString()): Pick<GroceryItem, "status" | "status_changed_at"> {
  return { status: "needed", status_changed_at: now };
}

/** Undo pill labels for the grocery single-tap actions, shared so web and
 *  mobile say the same thing. `name` is the item when `count` is 1. */
export const GROCERY_UNDO_LABELS = {
  added: (count: number, name: string) => (count === 1 ? `${name} added to list` : `${count} items added to list`),
  snoozed: (count: number, name: string) => (count === 1 ? `${name} snoozed` : `${count} items snoozed`),
  hidden: (count: number, name: string) => (count === 1 ? `Stopped suggesting ${name}` : `Stopped suggesting ${count} items`),
  reset: (count: number) => (count === 1 ? "1 item back to Needed" : `${count} items back to Needed`),
} as const;

/** Re-add suggestion chips shown before the rest hide behind "Show N more". */
export const RE_ADD_CHIP_CAP = 6;
/** The Home dashboard's groceries card shows fewer chips than the Groceries page. */
export const HOME_RE_ADD_CHIP_CAP = 4;

/** How far one tap moves an item's quantity, by its unit: half a kilo, 50 g, a quarter litre, 50 ml, else one. */
export function unitQtyStep(unit: string | null | undefined): number {
  const u = (unit ?? '').toLowerCase().trim();
  if (u === 'kg') return 0.5;
  if (u === 'g' || u === 'gram' || u === 'grams') return 50;
  if (u === 'l' || u === 'litre' || u === 'litres' || u === 'liter' || u === 'liters') return 0.25;
  if (u === 'ml' || u === 'millilitre' || u === 'millilitres' || u === 'milliliter') return 50;
  return 1;
}

/** The largest quantity the stepper allows, by the item's unit. */
export function unitQtyMax(unit: string | null | undefined): number {
  const u = (unit ?? '').toLowerCase().trim();
  if (u === 'kg') return 50;
  if (u === 'g' || u === 'gram' || u === 'grams') return 5000;
  if (u === 'l' || u === 'litre' || u === 'litres' || u === 'liter' || u === 'liters') return 20;
  if (u === 'ml' || u === 'millilitre' || u === 'millilitres' || u === 'milliliter') return 5000;
  return 999;
}
