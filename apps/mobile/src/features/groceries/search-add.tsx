// Groceries search "add" panel (was HOUP-225's no-match state, ported from
// web page.tsx). Rendered under the search results whenever a query is
// active: an `Add "<query>"` row filed under its guessed aisle (unless the
// list already has that name), then up to 6 library entries matching the
// query that aren't on the list (aisle dot, ~price, ~shelf life). With no
// on-list matches it opens with a one-line "nothing matches" note.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { BookOpen, Plus } from 'lucide-react-native';
import { Text, cn } from '@homeup/ui';
import { formatEntryQuantity, formatMoney, getAisleColor, getAisleMeta, type GroceryCustomAisle, type LibraryOverride } from '@homeup/core';

interface GroceriesSearchAddProps {
  noMatches: boolean;
  addName: string | null;
  addAisle: string;
  suggestions: LibraryOverride[];
  /** Quantity typed with the name ("2 milk"), applied to whatever is added. */
  quantity: { quantity: number | null; unit: string | null };
  customAisles?: GroceryCustomAisle[];
  onAddSuggestion: (suggestion: LibraryOverride) => void;
  onAddPlain: (name: string, aisle: string) => void;
}

function AisleTag({ aisle, customAisles }: { aisle: string; customAisles?: GroceryCustomAisle[] }) {
  return (
    <View className="flex-row items-center gap-1">
      <View className={cn('h-2 w-2 rounded-full', getAisleColor(aisle, customAisles).dot)} />
      <Text className="text-xs text-muted-foreground">{getAisleMeta(aisle, customAisles).label}</Text>
    </View>
  );
}

export function GroceriesSearchAdd({
  noMatches,
  addName,
  addAisle,
  suggestions,
  quantity,
  customAisles,
  onAddSuggestion,
  onAddPlain,
}: GroceriesSearchAddProps) {
  if (!noMatches && !addName && suggestions.length === 0) return null;
  const qtyLabel = formatEntryQuantity(quantity);
  return (
    <View className="gap-2 pt-4">
      {noMatches && (
        <Text className="px-1 text-sm text-muted-foreground">Nothing on your list matches.</Text>
      )}

      {addName && (
        <Pressable
          onPress={() => onAddPlain(addName, addAisle)}
          accessibilityRole="button"
          accessibilityLabel={`Add ${addName} to the list`}
          className="min-h-11 w-full flex-row items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2.5"
        >
          <Plus size={16} className="shrink-0 text-primary" />
          <Text numberOfLines={1} className="min-w-0 flex-1 text-sm font-medium text-primary">
            Add "{addName}"{qtyLabel ? ` ${qtyLabel}` : ''}
          </Text>
          <AisleTag aisle={addAisle} customAisles={customAisles} />
        </Pressable>
      )}

      {suggestions.length > 0 && (
        <View className="gap-2 pt-1">
          <View className="flex-row items-center gap-1.5 px-1">
            <BookOpen size={13} className="text-muted-foreground" />
            <Text className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
              From your library
            </Text>
          </View>
          {suggestions.map((s) => (
            <Pressable
              key={s.item_name}
              onPress={() => onAddSuggestion(s)}
              accessibilityRole="button"
              accessibilityLabel={`Add ${s.item_name} from your library`}
              className="min-h-11 w-full flex-row items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5"
            >
              <Plus size={16} className="shrink-0 text-primary" />
              <Text numberOfLines={1} className="min-w-0 flex-1 text-sm font-medium text-foreground">
                {s.item_name}
                {qtyLabel ? <Text className="text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>{` ${qtyLabel}`}</Text> : null}
              </Text>
              <View className="shrink-0 flex-row items-center gap-2">
                <AisleTag aisle={s.aisle ?? 'other'} customAisles={customAisles} />
                {s.typical_price_cents != null && (
                  <Text className="text-xs text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                    ~{formatMoney(s.typical_price_cents)}
                  </Text>
                )}
                {s.shelf_life_days != null && (
                  <Text className="text-xs text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                    ~{s.shelf_life_days}d
                  </Text>
                )}
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
