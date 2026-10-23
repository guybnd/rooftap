'use client';

// Recipes scan match: the household's staples and taught names, plus the
// writes the match step makes ("Same", "New item", staple on or off). Both
// apps' Recipes screens, the review sheet and the meal week read it.
//
// Off (the inert stores, defaults only) when Recipes and Groceries aren't both
// on, or the server predates the tables (server-features.ts). The match step
// still works then; it just can't remember answers.

import { useCallback, useMemo } from 'react';
import { use$ } from '@legendapp/state/react';
import { ingredientAliases$, recipeStaples$ } from '../../data/stores';
import { useReconnectSync, useStoreHelpers } from '../../data/create-group-store';
import { useModules } from '../../modules-store';
import { norm } from './recipes';
import {
  aliasMap,
  buildIngredientAlias,
  buildRecipeStaple,
  stapleKeys,
  stapleList,
  type IngredientAlias,
  type MatchContext,
  type RecipeStaple,
} from './scan-match';

function live<T extends { deleted: boolean }>(record: Record<string, T | undefined> | undefined): T[] {
  return Object.values(record ?? {}).filter((r): r is T => !!r && !r.deleted);
}

export function useRecipeMatch(groupId: string | null | undefined, currentUserId: string | null | undefined) {
  const modules = useModules();
  const on = modules.feature('recipes.groceries') && modules.server('recipes.scan-match');
  const gid = on && groupId ? groupId : undefined;

  const staples$ = recipeStaples$(gid);
  const aliases$ = ingredientAliases$(gid);
  useReconnectSync(staples$);
  useReconnectSync(aliases$);
  const stapleRows = use$(() => live<RecipeStaple>(staples$.get()));
  const aliasRows = use$(() => live<IngredientAlias>(aliases$.get()));
  const stapleHelpers = useStoreHelpers(staples$, currentUserId);
  const aliasHelpers = useStoreHelpers(aliases$, currentUserId);

  const staples = useMemo(() => stapleKeys(stapleRows), [stapleRows]);
  const staplesShown = useMemo(() => stapleList(stapleRows), [stapleRows]);
  const aliases = useMemo(() => aliasMap(aliasRows), [aliasRows]);

  /** The match context for a given library (itemMatchLibrary()). */
  const context = useCallback(
    (library: readonly string[]): MatchContext => ({ library, staples, aliases }),
    [staples, aliases],
  );

  /** "Same": `alias` means `itemName` from now on. Pass the alias itself for "its own item". */
  const remember = useCallback(
    (alias: string, itemName: string) => {
      if (!gid || !norm(alias) || !norm(itemName)) return;
      const existing = aliasRows.find((r) => norm(r.alias) === norm(alias));
      if (existing) {
        if (existing.item_name !== itemName.trim()) aliasHelpers.patchRow(existing.id, { item_name: itemName.trim() });
        return;
      }
      aliasHelpers.writeRow(buildIngredientAlias({ groupId: gid, alias, itemName, createdBy: currentUserId ?? null }));
    },
    [gid, aliasRows, aliasHelpers, currentUserId],
  );

  /** Turn a name into a staple, or stop it being one (defaults included). */
  const setStaple = useCallback(
    (name: string, staple: boolean) => {
      if (!gid || !norm(name)) return;
      const existing = stapleRows.find((r) => norm(r.name) === norm(name));
      if (existing) {
        if (existing.staple !== staple) stapleHelpers.patchRow(existing.id, { staple });
        return;
      }
      stapleHelpers.writeRow(buildRecipeStaple({ groupId: gid, name, staple, createdBy: currentUserId ?? null }));
    },
    [gid, stapleRows, stapleHelpers, currentUserId],
  );

  return {
    /** Whether answers are remembered (the tables sync for this household). */
    canRemember: !!gid,
    staples,
    staplesShown,
    aliases,
    context,
    remember,
    setStaple,
  };
}
