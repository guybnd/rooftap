// Which search results are the thing a household is watching, not an
// accessory, a spare part or another product from the same brand. Sources
// search by words, so "LG C5" also finds a power cable "for LG C5" and an LG
// fridge. Every offer passes through relevantOffers before it is saved, so
// the cheapest price and the history only ever count real matches.

import type { SourceOffer } from './shopper-sources';

const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'with', 'in', 'inch', 'new', 'buy']);

// A title with one of these is an add-on, unless the search itself asks for it.
const ACCESSORY_WORDS = [
  'accessory', 'accessories', 'adapter', 'adaptor', 'bracket', 'cable', 'case', 'charger', 'cord',
  'cover', 'decal', 'filter', 'lead', 'manual', 'mount', 'part', 'parts', 'protector', 'remote',
  'replacement', 'skin', 'spare', 'sticker', 'strap', 'compatible',
];

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function queryTokens(query: string): string[] {
  return words(query).filter((w) => !STOPWORDS.has(w));
}

/** A model-like token: letters and digits together ("c5", "oled65c5", "xr70"), or a bare number. */
function isModelToken(token: string): boolean {
  return /\d/.test(token);
}

/** Whether the title carries a query token: as its own word, or inside a model number ("OLED65C5PSA" has "c5"). */
function hasToken(titleWords: readonly string[], token: string): boolean {
  if (titleWords.includes(token)) return true;
  if (!isModelToken(token)) return false;
  return titleWords.some((w) => /\d/.test(w) && /[a-z]/.test(w) && w.length > token.length && w.includes(token));
}

/** Why an offer isn't the thing searched for, or null when it is. */
export function offerMismatch(query: string, title: string): 'missing-model' | 'missing-words' | 'accessory' | null {
  const tokens = queryTokens(query);
  if (!tokens.length) return null;
  const titleWords = words(title);
  const model = tokens.filter(isModelToken);
  const plain = tokens.filter((t) => !isModelToken(t));
  if (model.some((t) => !hasToken(titleWords, t))) return 'missing-model';
  if (plain.length && plain.filter((t) => hasToken(titleWords, t)).length < Math.ceil(plain.length / 2)) return 'missing-words';
  // A search for an add-on ("LG C5 wall mount") wants add-ons.
  if (tokens.some((t) => ACCESSORY_WORDS.includes(t))) return null;
  if (ACCESSORY_WORDS.some((w) => titleWords.includes(w))) return 'accessory';
  // "for LG C5", "suits LG C5", "fits LG C5": made for the product, not the product.
  const lead = tokens[0];
  if (new RegExp(`\\b(for|fits|suits|suit)\\s+(the\\s+)?${lead}\\b`, 'i').test(title)) return 'accessory';
  return null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface RelevanceHints {
  /** The household's target or budget, when set: a price far under it is not the thing. */
  referenceCents?: number | null;
}

/**
 * The offers that are the thing searched for. Drops titles that miss the
 * search's model number or most of its words, add-ons ("cable", "for LG C5"),
 * and prices so far under the rest (or the household's target or budget)
 * that they can't be the same product.
 */
export function relevantOffers<T extends Pick<SourceOffer, 'title' | 'price_cents'>>(query: string, offers: readonly T[], hints: RelevanceHints = {}): T[] {
  const matching = offers.filter((o) => offerMismatch(query, o.title) === null);
  const floors: number[] = [];
  if (hints.referenceCents && hints.referenceCents > 0) floors.push(hints.referenceCents * 0.25);
  if (matching.length >= 3) floors.push(median(matching.map((o) => o.price_cents)) * 0.3);
  const floor = floors.length ? Math.max(...floors) : 0;
  return matching.filter((o) => o.price_cents >= floor);
}
