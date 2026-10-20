'use client';

import { BookOpen, Plus } from 'lucide-react';
import { formatEntryQuantity, formatMoney, getAisleColor, getAisleMeta, type GroceryCustomAisle, type LibraryOverride } from '@homeup/core';
import { cn } from '@/lib/utils';

// Groceries search "add" panel (was FLUX-188's no-match state). Rendered
// under the search results whenever a query is active: an `Add "<query>"`
// row filed under its guessed aisle (unless the list already has that
// name), then up to 6 library entries matching the query that aren't on the
// list. With no on-list matches it opens with a one-line note. Mirrors
// apps/mobile/src/features/groceries/search-add.tsx.
function AisleTag({ aisle, customAisles }: { aisle: string; customAisles: GroceryCustomAisle[] }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn('h-2 w-2 rounded-full', getAisleColor(aisle, customAisles).dot)} />
      {getAisleMeta(aisle, customAisles).label}
    </span>
  );
}

export function GrocerySearchAdd({
  noMatches,
  addName,
  addAisle,
  suggestions,
  quantity,
  customAisles,
  onAddSuggestion,
  onAddPlain,
}: {
  noMatches: boolean;
  addName: string | null;
  addAisle: string;
  suggestions: LibraryOverride[];
  /** Quantity typed with the name ("2 milk"), applied to whatever is added. */
  quantity: { quantity: number | null; unit: string | null };
  customAisles: GroceryCustomAisle[];
  onAddSuggestion: (suggestion: LibraryOverride) => void;
  onAddPlain: (name: string, aisle: string) => void;
}) {
  if (!noMatches && !addName && suggestions.length === 0) return null;
  const qtyLabel = formatEntryQuantity(quantity);
  return (
    <div className="space-y-2">
      {noMatches && <p className="px-1 text-sm text-muted-foreground">Nothing on your list matches.</p>}

      {addName && (
        <button
          onClick={() => onAddPlain(addName, addAisle)}
          className="w-full min-h-[44px] flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-left hover:bg-primary/15 transition-colors"
        >
          <Plus className="h-4 w-4 text-primary flex-shrink-0" />
          <span className="flex-1 min-w-0 truncate text-sm font-medium text-primary">Add “{addName}”{qtyLabel && <span className="tabular-nums"> {qtyLabel}</span>}</span>
          <span className="flex-shrink-0 text-xs text-muted-foreground">
            <AisleTag aisle={addAisle} customAisles={customAisles} />
          </span>
        </button>
      )}

      {suggestions.length > 0 && (
        <div className="space-y-2 pt-1">
          <p className="px-1 text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground flex items-center gap-1.5">
            <BookOpen className="h-3.5 w-3.5" />
            From your library
          </p>
          {suggestions.map((s) => (
            <button
              key={s.item_name}
              onClick={() => onAddSuggestion(s)}
              className="w-full min-h-[44px] flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-left hover:bg-accent/60 transition-colors"
            >
              <Plus className="h-4 w-4 text-primary flex-shrink-0" />
              <span className="flex-1 min-w-0 truncate text-sm font-medium text-foreground">
                {s.item_name}
                {qtyLabel && <span className="tabular-nums text-muted-foreground"> {qtyLabel}</span>}
              </span>
              <span className="flex items-center gap-2 flex-shrink-0 text-xs text-muted-foreground">
                <AisleTag aisle={s.aisle ?? 'other'} customAisles={customAisles} />
                {s.typical_price_cents != null && (
                  <span className="tabular-nums">~{formatMoney(s.typical_price_cents)}</span>
                )}
                {s.shelf_life_days != null && <span className="tabular-nums">~{s.shelf_life_days}d</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
