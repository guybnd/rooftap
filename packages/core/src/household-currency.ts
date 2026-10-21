// The household currency rule, kept out of currency.ts because that file is
// 'use client' (it holds the React store). Next turns every export of a
// 'use client' module into a client reference, so a server route that called
// householdCurrency from there threw "Attempted to call householdCurrency()
// from the server" (Shopper's price lookup did, and hung on "Checking prices").
// Pure functions that server code needs belong here, not in currency.ts.

import { currencyForCountry } from './region/currency-by-country';

export const DEFAULT_CURRENCY = 'AUD';

/** The currency a household's money is shown in: its explicit pick, else its region's. */
export function householdCurrency(group: { region?: string | null; currency?: string | null } | null | undefined): string {
  const explicit = group?.currency?.toUpperCase();
  if (explicit && /^[A-Z]{3}$/.test(explicit)) return explicit;
  return group?.region ? currencyForCountry(group.region.toUpperCase()) : DEFAULT_CURRENCY;
}
