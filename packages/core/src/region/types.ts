export interface CurrencyFormatter {
  code: string;
  format: (amount: number) => string;
}

export interface GroceryStapleTemplate {
  template_key: string;
  name: string;
  aisle: string;
  quantity: number | null;
  unit: string | null;
}

export interface RegionProvider {
  id: string;
  currency: CurrencyFormatter;
  expenseCategories: string[];
  retailerHints: string[];
  listingSources: ListingSource[];
  movingTasks: MovingTaskTemplate[];
  groceryStaples: GroceryStapleTemplate[];
}

/**
 * A single entry in a region's curated "generate moving tasks" template.
 * `offset_days` is relative to the move-in date (0 = move-in day, negative = before).
 * `template_key` is stable per entry so regeneration is idempotent and date-shift
 * can find template-generated tasks later.
 */
export interface MovingTaskTemplate {
  template_key: string;
  title: string;
  offset_days: number;
  notes?: string;
}

export interface ListingSource {
  name: string;
  url: string;
  scrapable: boolean;
}
