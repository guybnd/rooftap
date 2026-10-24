'use client';

// The rows under an Assistant reply (assistant-reply-items.ts), read live from
// the household's stores. A store opens only when the reply links one of its
// items and its module is on, so a chat with no item links syncs nothing new.

import { useCallback, useMemo } from 'react';
import { use$ } from '@legendapp/state/react';
import { useReconnectSync, useStoreHelpers } from '../data/create-group-store';
import { apartments$, checklistItems$, checklists$, recipes$, shopperWants$ } from '../data/stores';
import { useModules } from '../modules-store';
import { syncedGroupId } from '../store-modules';
import type { ChecklistTaskItem } from '../types';
import { replyItemRefs, replyItemRows, type ReplyItemRow } from '../assistant-reply-items';

export function useReplyItems(
  groupId: string | null | undefined,
  text: string | null | undefined,
  currentUserId: string | null | undefined,
): { rows: ReplyItemRow[]; toggleToTry: ((id: string) => void) | null } {
  const modules = useModules();
  const refs = useMemo(() => replyItemRefs(text), [text]);
  const kinds = useMemo(() => new Set(refs.map((r) => r.kind)), [refs]);
  const open = (kind: string, store$: { collection: string }) =>
    kinds.has(kind as never) ? syncedGroupId(store$, groupId, modules.enabled) : undefined;

  const recipesStore$ = recipes$(open('recipe', recipes$));
  const checklistsStore$ = checklists$(open('checklist', checklists$));
  const itemsStore$ = checklistItems$(open('checklist', checklistItems$));
  const wantsStore$ = shopperWants$(open('watch', shopperWants$));
  const listingsStore$ = apartments$(open('listing', apartments$));
  useReconnectSync(recipesStore$);
  useReconnectSync(checklistsStore$);
  useReconnectSync(itemsStore$);
  useReconnectSync(wantsStore$);
  useReconnectSync(listingsStore$);

  const recipes = use$(recipesStore$);
  const checklists = use$(checklistsStore$);
  const items = use$(itemsStore$);
  const watches = use$(wantsStore$);
  const listings = use$(listingsStore$);

  const rows = useMemo(
    () =>
      replyItemRows(refs, {
        recipes,
        checklists,
        checklistItems: Object.values(items ?? {}).filter((i): i is ChecklistTaskItem => !!i),
        watches,
        listings,
      }),
    [refs, recipes, checklists, items, watches, listings],
  );

  const { patchRow } = useStoreHelpers(recipesStore$, currentUserId);
  const canToTry = modules.server('recipes.to-try');
  const toggle = useCallback(
    (id: string) => {
      const r = recipesStore$[id].peek();
      if (r) patchRow(id, { to_try: !r.to_try });
    },
    [recipesStore$, patchRow],
  );

  return { rows, toggleToTry: canToTry ? toggle : null };
}
