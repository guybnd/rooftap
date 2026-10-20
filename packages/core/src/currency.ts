'use client';

// The household's currency. A household picks it in Settings > Household,
// stored on groups.currency; null there means "follow the region", so a
// household that only ever picked a country keeps getting that country's
// currency. Amounts are stored as plain numbers with no currency attached, so
// switching relabels them rather than converting.
//
// One process-wide store, like modules-store: each platform's
// DataCacheProvider feeds it the group (and its cold-boot snapshot) and every
// formatMoney/currencySymbol call reads it, so the many call sites that format
// money don't each need the group threaded in.

import { useSyncExternalStore } from 'react';
import type { PickerOption } from './types';
import { CURRENCY_BY_COUNTRY, currencyForCountry } from './region/currency-by-country';

export const DEFAULT_CURRENCY = 'AUD';

// Money reads in the app's English with the currency's own short symbol ("€",
// "£", "₪"), not "EUR 12": en-AU's plain symbol for anything but AUD is the
// ISO code. The household has one currency, so "$" for USD or CAD is not
// ambiguous inside it.
const LOCALE = 'en-AU';

/** The currency a household's money is shown in: its explicit pick, else its region's. */
export function householdCurrency(group: { region?: string | null; currency?: string | null } | null | undefined): string {
  const explicit = group?.currency?.toUpperCase();
  if (explicit && /^[A-Z]{3}$/.test(explicit)) return explicit;
  return group?.region ? currencyForCountry(group.region.toUpperCase()) : DEFAULT_CURRENCY;
}

let current = DEFAULT_CURRENCY;
let notified = DEFAULT_CURRENCY;
const listeners = new Set<() => void>();

/**
 * Set the household's currency. DataCacheProvider calls this with
 * `notify: false` while it renders, so the screens rendering under it in the
 * same pass already format in the new currency, then again from an effect to
 * wake useHouseholdCurrency subscribers (notifying during render would update
 * other components mid-render).
 */
export function setHouseholdCurrency(code: string | null | undefined, { notify = true }: { notify?: boolean } = {}): void {
  current = code && /^[A-Z]{3}$/.test(code) ? code : DEFAULT_CURRENCY;
  if (!notify || current === notified) return;
  notified = current;
  for (const l of listeners) l();
}

export function getHouseholdCurrency(): string {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The household currency, re-rendering when it changes. */
export function useHouseholdCurrency(): string {
  return useSyncExternalStore(subscribe, getHouseholdCurrency, () => DEFAULT_CURRENCY);
}

// Intl.NumberFormat is expensive to build and formatMoney runs per row.
const formatters = new Map<string, Intl.NumberFormat>();

/** A whole-unit formatter for `currency`, or null if this runtime can't build one. */
export function moneyFormatter(currency: string, fractionDigits = 0): Intl.NumberFormat | null {
  const key = `${currency}:${fractionDigits}`;
  const cached = formatters.get(key);
  if (cached) return cached;
  const base = { style: 'currency', currency, minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits } as const;
  let formatter: Intl.NumberFormat | null = null;
  try {
    formatter = new Intl.NumberFormat(LOCALE, { ...base, currencyDisplay: 'narrowSymbol' });
  } catch {
    // Older ICU builds reject narrowSymbol; the plain symbol is still right.
    try {
      formatter = new Intl.NumberFormat(LOCALE, base);
    } catch {
      formatter = null;
    }
  }
  if (formatter) formatters.set(key, formatter);
  return formatter;
}

/** The symbol money inputs use as their prefix, e.g. "$", "€", "£". */
export function currencySymbol(currency: string = current): string {
  const parts = moneyFormatter(currency)?.formatToParts?.(0);
  return parts?.find((p) => p.type === 'currency')?.value ?? currency;
}

/** Every currency some country uses, for the settings picker, named in `locale` where Intl can. */
export function currenciesToOptions(locale?: string): PickerOption[] {
  let display: Intl.DisplayNames | null = null;
  try {
    display = new Intl.DisplayNames(locale ? [locale] : undefined, { type: 'currency' });
  } catch {
    display = null;
  }
  const codes = [...new Set(Object.values(CURRENCY_BY_COUNTRY))];
  return codes
    .map((code) => ({
      value: code,
      primary: display?.of(code) ?? code,
      secondary: code,
      searchText: `${code} ${currencySymbol(code)}`,
    }))
    .sort((a, b) => a.primary.localeCompare(b.primary));
}

/** The currency picker's value for "no explicit pick, follow the region". */
export const FOLLOW_REGION_CURRENCY = 'region';

/**
 * Options for the household currency picker: "same as region" first, then
 * every currency. Codes and symbols are searchable, so "EUR" or "€" finds the euro.
 */
export function currencyPickerOptions(regionCurrency: string, locale?: string): PickerOption[] {
  return [
    {
      value: FOLLOW_REGION_CURRENCY,
      primary: 'Same as region',
      secondary: regionCurrency,
      group: { key: 'region', label: 'Default' },
    },
    ...currenciesToOptions(locale).map((o) => ({ ...o, group: { key: 'all', label: 'All currencies' } })),
  ];
}
