import { RegionProvider } from "./types";
import { currencyForCountry } from "./currency-by-country";

// Expense categories aren't country-specific — every household has groceries
// and utilities — so the generic provider carries the same list the curated
// providers do rather than leaving it empty.
export const DEFAULT_EXPENSE_CATEGORIES = [
  "Groceries",
  "Transport",
  "Utilities",
  "Rent",
  "Entertainment",
  "Dining Out",
  "Shopping",
  "Health",
  "Other",
];

/**
 * A region provider for any ISO 3166-1 alpha-2 country, built from Intl rather
 * than curation.
 *
 * The split that makes "support every region" tractable: currency and number
 * formatting are mechanical (Intl already knows every ISO 4217 currency and
 * every country's grouping and symbol placement), while retailers, listing
 * sources, moving-task templates and grocery staples are local knowledge that
 * only someone living there can author. Guessing at the latter is worse than
 * omitting it — a fabricated legal deadline in a moving checklist is a
 * liability, not a nice default — so those come back empty here and every
 * caller already treats empty as "no suggestions to offer" (the groceries
 * screens gate on `groceryStaples.length`, and generateMovingTasks inserts
 * nothing from an empty template list).
 *
 * A curated provider in `providers` overrides this for its country; adding one
 * is a content-only change with no schema or UI work.
 */
export function createGenericProvider(country: string): RegionProvider {
  const id = country.toUpperCase();
  const code = currencyForCountry(id);

  // `und-<COUNTRY>` asks Intl for "unknown language, this country", which is
  // what gets country-correct grouping and symbol placement without pinning a
  // language the household may not speak. Falls back to the runtime default
  // locale if an environment's ICU rejects the tag.
  const formatter = safeFormatter(`und-${id}`, code) ?? safeFormatter(undefined, code);

  return {
    id,
    currency: {
      code,
      format: (amount: number) =>
        formatter ? formatter.format(amount) : `${code} ${Math.round(amount)}`,
    },
    expenseCategories: [...DEFAULT_EXPENSE_CATEGORIES],
    retailerHints: [],
    listingSources: [],
    movingTasks: [],
    groceryStaples: [],
  };
}

function safeFormatter(locale: string | undefined, currency: string): Intl.NumberFormat | null {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      // Matches the curated providers: household money reads as whole units.
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  } catch {
    return null;
  }
}
