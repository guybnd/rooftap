// Money as people read it, in the household's currency. Every module formats
// amounts, so this lives outside any one module's folder.

import { getHouseholdCurrency, moneyFormatter } from './currency';

/**
 * Format minor units as whole currency units, in the household's currency
 * (currency.ts) unless `currency` is given.
 */
export function formatMoney(minorUnits: number, { currency = getHouseholdCurrency() }: { currency?: string } = {}): string {
  const units = minorUnits / 100;
  const formatter = moneyFormatter(currency);
  return formatter ? formatter.format(units) : `${currency} ${Math.round(units)}`;
}
