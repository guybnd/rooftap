'use client';

// The Groceries search box, shared by apps/web/src/app/groceries/page.tsx and
// apps/mobile's groceries tab. Fuzzy search on name and notes (FLUX-110), and
// naming an aisle ("dairy") also lists everything in it. "2 milk" searches
// for "milk"; the quantity rides along in `searchEntry` for the add panel.
// The To buy filter is not applied here: each screen cuts that per aisle, so
// "no items match" never reads like "everything matched is hidden".

import { useMemo } from 'react';
import type { GroceryCustomAisle, GroceryItem } from '../../types';
import { useFuzzySearch } from '../../hooks/use-fuzzy-search';
import { groceryAislesMatching, parseGroceryEntry } from './groceries';
import { groceriesWithAisleMatches } from './grocery-list-view';

export function useGrocerySearch(items: GroceryItem[], search: string, customAisles: GroceryCustomAisle[]) {
  const searchEntry = useMemo(() => parseGroceryEntry(search), [search]);
  const fuzzyItems = useFuzzySearch(items, searchEntry.name, ['name', 'notes']);
  const searchedItems = useMemo(
    () => groceriesWithAisleMatches(fuzzyItems, items, groceryAislesMatching(searchEntry.name, customAisles)),
    [fuzzyItems, items, searchEntry.name, customAisles]
  );
  return { searchEntry, searchedItems };
}
