// Pure logic for the Item Library screen (HOUP-228), split out of
// shelf-life.tsx so it's testable without pulling in react-native/expo-router
// (apps/mobile's vitest config is pure-logic-only — see apps/mobile/vitest.config.ts).
// Lives in src/features/groceries/, not src/app/groceries/, matching
// session-fetch-freshness.ts — anything under src/app/ is picked up by
// expo-router's route tree.
import { compareStrings } from '@homeup/core';

export interface MergedEntry {
  name: string;
  aisle: string;
  effectiveDays: number | null;
  effectivePriceCents: number | null;
  isOverridden: boolean;
  isCustom: boolean;
  hidden: boolean;
  created_at: string | null;
}

// Lifted out of `visible`'s memo so it's directly testable without mounting
// the screen.
export function matchesFilters(
  entry: MergedEntry,
  filters: { search: string; showHidden: boolean; customOnly: boolean; aisleFilter: string | null }
): boolean {
  const q = filters.search.trim().toLowerCase();
  return (
    (filters.showHidden || !entry.hidden) &&
    (!filters.customOnly || entry.isCustom) &&
    (!q || entry.name.toLowerCase().includes(q)) &&
    (!filters.aisleFilter || entry.aisle === filters.aisleFilter)
  );
}

export function compareByName(a: MergedEntry, b: MergedEntry): number {
  return compareStrings(a.name, b.name);
}

// Web's exact "Last added" comparator: null `created_at` (every
// un-overridden built-in and list-derived extra) sorts to the bottom in name
// order, not special-cased (non-transitive otherwise).
export function compareByAdded(a: MergedEntry, b: MergedEntry): number {
  return (b.created_at ?? '').localeCompare(a.created_at ?? '') || compareByName(a, b);
}

// The sheet edits days and price together and is the only way to clear
// either, so its validation rule is deliberately NOT web's inline-chip rule
// ("empty cancels" — correct there, since the chip has nothing to clear):
// empty clears that field to `null`, `0` is valid and saves, and a
// non-empty value that is non-numeric or negative is invalid (Save disabled
// while either field is invalid — no error copy, no toast).
export function parseDaysField(raw: string): { value: number | null; valid: boolean } {
  const trimmed = raw.trim();
  if (trimmed === '') return { value: null, valid: true };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return { value: null, valid: false };
  return { value: Math.trunc(n), valid: true };
}

export function parsePriceField(raw: string): { value: number | null; valid: boolean } {
  const trimmed = raw.trim();
  if (trimmed === '') return { value: null, valid: true };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return { value: null, valid: false };
  return { value: Math.round(n * 100), valid: true };
}
