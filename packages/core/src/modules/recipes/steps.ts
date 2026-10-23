// Recipes v2 R1: structured steps with timers.
//
// `recipes.steps` (jsonb) holds the method as an ordered list of steps, each
// with its own timers, the ingredients it uses and an optional oven
// temperature. `recipes.instructions` stays the plain-text copy (one step per
// line) so an older app, a server without the column, and every text surface
// (search, the assistant) still read the method. Every write that sets
// `steps` also sets `instructions` from it.
//
// Reading always goes through `recipeSteps`: it uses the structured steps
// when they still match the text, and otherwise reads the text and finds the
// timers in it. So an old recipe gets timers too, and an edit made by an app
// that predates steps (it only changes `instructions`) wins over stale steps.

import type { Recipe, RecipeIngredient, RecipeStep, RecipeStepTimer } from '../../types';
import { trimQty } from './recipes';

const MAX_TIMER_SECONDS = 24 * 60 * 60;

function oneLine(s: unknown): string {
  return typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';
}

function cleanTimer(raw: unknown): RecipeStepTimer | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const seconds = Math.round(Number(t.seconds));
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return { label: oneLine(t.label) || 'Timer', seconds: Math.min(seconds, MAX_TIMER_SECONDS) };
}

/**
 * Read steps from a jsonb column or an AI answer. Tolerates junk: a non-array
 * gives null, a bare string becomes a step with no timers, bad timers and
 * empty steps are dropped. Returns null when nothing usable is left.
 */
export function normalizeSteps(raw: unknown): RecipeStep[] | null {
  if (!Array.isArray(raw)) return null;
  const steps: RecipeStep[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const text = oneLine(item);
      if (text) steps.push({ text, timers: [], ingredientIds: [] });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const s = item as Record<string, unknown>;
    const text = oneLine(s.text);
    if (!text) continue;
    const original = oneLine(s.original);
    const temp = oneLine(s.temp);
    steps.push({
      text,
      original: original && original !== text ? original : null,
      timers: Array.isArray(s.timers) ? s.timers.map(cleanTimer).filter((t): t is RecipeStepTimer => !!t) : [],
      ingredientIds: Array.isArray(s.ingredientIds)
        ? s.ingredientIds.filter((id): id is string => typeof id === 'string' && !!id)
        : [],
      temp: temp || null,
    });
  }
  return steps.length ? steps : null;
}

/** The plain-text copy of structured steps, for `recipes.instructions`. */
export function instructionsFromRecipeSteps(steps: readonly RecipeStep[]): string | null {
  const lines = steps.map((s) => oneLine(s.text)).filter(Boolean);
  return lines.length ? lines.join('\n') : null;
}

function textLines(instructions: string | null | undefined): string[] {
  return (instructions ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── Finding timers in plain text ─────────────────────────────────────────────

const UNIT_SECONDS: Record<string, number> = { h: 3600, m: 60, s: 1 };

function unitKey(unit: string): 'h' | 'm' | 's' | null {
  const u = unit.toLowerCase();
  if (/^(h|hr|hrs|hour|hours)$/.test(u)) return 'h';
  if (/^(m|min|mins|minute|minutes)$/.test(u)) return 'm';
  if (/^(s|sec|secs|second|seconds)$/.test(u)) return 's';
  return null;
}

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, sixty: 60, half: 0.5,
};

// "10 minutes", "10-12 mins", "1½ hours", "1 hour 20 minutes", "an hour", "half an hour".
const DURATION_RE =
  /\b(half an|an|a|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty-five|forty|sixty|\d+(?:[.,]\d+)?\s*½?|½)(?:\s*(?:-|–|to)\s*(\d+(?:[.,]\d+)?))?\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b(?:\s*(?:and\s*)?(\d+)\s*(minutes?|mins?|m)\b)?/gi;

function parseAmount(raw: string): number {
  const r = raw.trim().toLowerCase();
  if (r === 'half an') return 0.5;
  if (r in WORD_NUMBERS) return WORD_NUMBERS[r];
  const half = r.includes('½') ? 0.5 : 0;
  const n = parseFloat(r.replace('½', '').replace(',', '.'));
  return (Number.isFinite(n) ? n : 0) + half;
}

const SKIP_WORDS = new Set(['then', 'and', 'now', 'next', 'finally', 'meanwhile', 'after', 'for', 'about', 'the']);

function labelFor(text: string): string {
  const word = text
    .split(/[^A-Za-z'-]+/)
    .find((w) => w.length > 1 && !SKIP_WORDS.has(w.toLowerCase()));
  if (!word) return 'Timer';
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Timers written in a step's text ("simmer for 10 minutes"). A range takes
 * its low end, so the timer rings at the first time worth checking. Ignores
 * anything under 30 seconds or over a day, which is rarely a timer.
 */
export function detectTimers(text: string): RecipeStepTimer[] {
  const out: RecipeStepTimer[] = [];
  const label = labelFor(text);
  for (const m of text.matchAll(DURATION_RE)) {
    const key = unitKey(m[3]);
    if (!key) continue;
    // A lone "m" or "s" after a number is too often metres or a plural.
    if ((m[3] === 'm' || m[3] === 's') && !/\d/.test(m[1])) continue;
    let seconds = parseAmount(m[1]) * UNIT_SECONDS[key];
    if (m[4] && m[5] && key === 'h') seconds += Number(m[4]) * 60;
    seconds = Math.round(seconds);
    if (seconds < 30 || seconds > MAX_TIMER_SECONDS) continue;
    out.push({ label, seconds });
  }
  return out;
}

// ── Reading a recipe's steps ─────────────────────────────────────────────────

/**
 * The recipe's steps for display and cooking. Structured steps when they
 * match the text, else the text, one step per line, with timers found in it.
 */
export function recipeSteps(recipe: Pick<Recipe, 'instructions'> & { steps?: unknown }): RecipeStep[] {
  const structured = normalizeSteps(recipe.steps);
  const lines = textLines(recipe.instructions);
  if (structured && (lines.length === 0 || lines.join('\n') === instructionsFromRecipeSteps(structured))) {
    return structured;
  }
  return lines.map((text) => ({ text, timers: detectTimers(text), ingredientIds: [] }));
}

/** Whether any step keeps the book's own wording ("Show original"). */
export function hasOriginalWording(steps: readonly RecipeStep[]): boolean {
  return steps.some((s) => !!s.original && s.original !== s.text);
}

export function recipeTimerCount(steps: readonly RecipeStep[]): number {
  return steps.reduce((n, s) => n + s.timers.length, 0);
}

/** A step's ingredients that still exist, in recipe order. */
export function stepIngredients(step: RecipeStep, ingredients: readonly RecipeIngredient[]): RecipeIngredient[] {
  if (step.ingredientIds.length === 0) return [];
  const ids = new Set(step.ingredientIds);
  return ingredients.filter((i) => !i.deleted && ids.has(i.id)).sort((a, b) => a.position - b.position);
}

/** "320 g rice", "2 eggs", "salt". */
export function ingredientPillLabel(ing: Pick<RecipeIngredient, 'name' | 'item_name' | 'quantity' | 'unit'>): string {
  const name = ing.item_name ?? ing.name;
  if (ing.quantity == null) return ing.unit ? `${ing.unit} ${name}` : name;
  return `${trimQty(ing.quantity)}${ing.unit ? ` ${ing.unit}` : ''} ${name}`;
}

// ── Durations ────────────────────────────────────────────────────────────────

/** "45 s", "2 min", "1 h", "1 h 20 min". */
export function formatTimerDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h === 0) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** A countdown face: "0:48", "14:32", "1:05:00". Rounds up, so 0:00 means done. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// ── The recipe form's step rows (web and mobile share these) ────────────────

export interface StepFormRow {
  key: string;
  text: string;
  original: string | null;
  timers: RecipeStepTimer[];
  ingredientIds: string[];
  temp: string | null;
}

let stepRowSeq = 0;
function freshStepKey(): string {
  stepRowSeq += 1;
  return `step-${stepRowSeq}`;
}

export function emptyStepRow(): StepFormRow {
  return { key: freshStepKey(), text: '', original: null, timers: [], ingredientIds: [], temp: null };
}

/** Form rows for a recipe being edited; one empty row when it has no steps. */
export function stepRowsFromRecipe(recipe: (Pick<Recipe, 'instructions'> & { steps?: unknown }) | null | undefined): StepFormRow[] {
  const steps = recipe ? recipeSteps(recipe) : [];
  if (steps.length === 0) return [emptyStepRow()];
  return steps.map((s) => ({
    key: freshStepKey(),
    text: s.text,
    original: s.original ?? null,
    timers: s.timers.map((t) => ({ ...t })),
    ingredientIds: [...s.ingredientIds],
    temp: s.temp ?? null,
  }));
}

/** The structured steps a form saves; blank rows are dropped. */
export function stepsFromRows(rows: readonly StepFormRow[]): RecipeStep[] {
  return rows
    .map((r) => ({ ...r, text: oneLine(r.text) }))
    .filter((r) => r.text)
    .map((r) => ({
      text: r.text,
      original: r.original && r.original !== r.text ? r.original : null,
      timers: r.timers.map(cleanTimer).filter((t): t is RecipeStepTimer => !!t),
      ingredientIds: r.ingredientIds,
      temp: r.temp?.trim() || null,
    }));
}

/** A timer to offer for a step that has none: the first one its text names. */
export function suggestedTimer(text: string): RecipeStepTimer | null {
  return detectTimers(text)[0] ?? null;
}

/**
 * The fields a recipe save writes for its method: `instructions` always, and
 * `steps` only when the server has the column (`recipes.steps` server
 * feature). Writing an unknown column would make the server reject the row.
 */
export function methodFields(steps: readonly RecipeStep[], withSteps: boolean): Pick<Recipe, 'instructions'> & { steps?: RecipeStep[] | null } {
  const instructions = instructionsFromRecipeSteps(steps);
  return withSteps ? { instructions, steps: steps.length ? [...steps] : null } : { instructions };
}

/**
 * Structured steps from the parse API's `structuredSteps`, with ingredient
 * positions turned into the ids of the rows built from the same answer.
 */
export function stepsFromParsed(
  raw: unknown,
  ingredientIdAt: (index: number) => string | undefined,
): RecipeStep[] | null {
  if (!Array.isArray(raw)) return null;
  const withIds = raw.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const s = item as Record<string, unknown>;
    const ids = Array.isArray(s.ingredients)
      ? s.ingredients
          .map((n) => (typeof n === 'number' ? ingredientIdAt(Math.round(n)) : undefined))
          .filter((id): id is string => !!id)
      : [];
    return { ...s, ingredientIds: [...new Set(ids)] };
  });
  return normalizeSteps(withIds);
}
