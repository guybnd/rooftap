'use client';

// Recipes' slots (.docs/modules.md, section 17). Search: every recipe, by
// title, cuisine and method.

import { useMemo } from 'react';
import { recipes$ } from '../../data/stores';
import type { GlobalHit } from '../../hooks/use-global-search-index';
import { useSlotRows } from '../../slots/rows';
import type { SearchSource } from '../../slots/types';
import type { Recipe } from '../../types';
import { recipeCuisines } from './recipes';

export function recipesSearchHits(recipes: readonly Recipe[]): GlobalHit[] {
  return recipes
    .filter((r) => !r.deleted)
    .map((r) => ({
      section: 'recipes',
      sectionId: 'recipes',
      sectionLabel: 'Recipes',
      id: r.id,
      title: r.title,
      // HOUP-333: cuisines can be absent on legacy/malformed rows — read via the
      // shared guard, or the search index memo crashes the whole shell.
      subtitle: recipeCuisines(r).join(', ') || undefined,
      keywords: [r.method, ...recipeCuisines(r)].filter(Boolean).join(' '),
      href: `/recipes/${r.id}`,
    }));
}

export const recipesSearchSource: SearchSource = {
  moduleId: 'recipes',
  useHits({ groupId, active }) {
    const recipes = useSlotRows(recipes$, groupId, active);
    return useMemo(() => ({ hits: recipesSearchHits(recipes) }), [recipes]);
  },
};
