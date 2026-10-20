import { RegionProvider } from "./types";
import type { PickerOption } from "../types";
import { auProvider } from "./au";
import { deProvider } from "./de";
import { createGenericProvider } from "./generic";
import { CURRENCY_BY_COUNTRY, currencyForCountry } from "./currency-by-country";

export const DEFAULT_REGION = "AU";

// Countries with hand-written local content (retailers, listing sources,
// moving-task templates, grocery staples). Every other ISO country still works
// — it just gets the generic provider, which formats currency correctly and
// offers no local suggestions. Adding a country here is a content-only PR: no
// migration, no UI change.
const curatedProviders: Record<string, RegionProvider> = {
  AU: auProvider,
  DE: deProvider,
};

// createGenericProvider builds an Intl.NumberFormat, which is expensive enough
// to be worth not rebuilding on every render — getRegionProvider is called
// inside component bodies (apartment-card, groceries).
const genericCache = new Map<string, RegionProvider>();

export function getRegionProvider(region?: string): RegionProvider {
  const id = region?.toUpperCase();
  if (!id || !/^[A-Z]{2}$/.test(id)) return curatedProviders[DEFAULT_REGION];

  const curated = curatedProviders[id];
  if (curated) return curated;

  let generic = genericCache.get(id);
  if (!generic) {
    generic = createGenericProvider(id);
    genericCache.set(id, generic);
  }
  return generic;
}

/** True when this country has hand-written local content, not just currency. */
export function hasCuratedContent(region?: string): boolean {
  return !!region && region.toUpperCase() in curatedProviders;
}

export interface RegionOption {
  /** ISO 3166-1 alpha-2. */
  id: string;
  /** Localised country name, e.g. "Germany". */
  name: string;
  /** ISO 4217, e.g. "EUR". */
  currency: string;
  /** Whether this country has curated local content beyond currency. */
  curated: boolean;
}

/**
 * Every selectable region, for the settings picker. Country names come from
 * Intl.DisplayNames rather than a checked-in name table, so they arrive
 * already localised and can't drift from the currency table beside them.
 */
export function listRegions(locale?: string): RegionOption[] {
  let display: Intl.DisplayNames | null = null;
  try {
    display = new Intl.DisplayNames(locale ? [locale] : undefined, { type: "region" });
  } catch {
    display = null;
  }

  return Object.keys(CURRENCY_BY_COUNTRY)
    .map((id) => ({
      id,
      // `of()` returns the input back when ICU has no name for a code.
      name: display?.of(id) ?? id,
      currency: currencyForCountry(id),
      curated: id in curatedProviders,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Adapter for the shared SearchablePicker, mirroring `costItemsToOptions`.
 * Countries with curated local content group first so the two that actually
 * carry retailers and moving checklists are findable without scrolling 250
 * rows; everything else is still one search away. Codes and currencies are
 * searchable but not displayed, so typing "EUR" or "DE" finds Germany.
 */
export function regionsToOptions(locale?: string): PickerOption[] {
  return listRegions(locale).map((r) => ({
    value: r.id,
    primary: r.name,
    secondary: r.currency,
    group: r.curated
      ? { key: "curated", label: "With local content" }
      : { key: "all", label: "All countries" },
    searchText: `${r.id} ${r.currency}`,
  }));
}

export { auProvider } from "./au";
export { deProvider } from "./de";
export { createGenericProvider, DEFAULT_EXPENSE_CATEGORIES } from "./generic";
export { CURRENCY_BY_COUNTRY, currencyForCountry } from "./currency-by-country";
export type { RegionProvider, CurrencyFormatter, ListingSource, MovingTaskTemplate, GroceryStapleTemplate } from "./types";
