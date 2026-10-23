'use client';

// Occasions module: the household's occasions, gift ideas and wishlists,
// with the writes both apps' Occasions screens make. A gift idea's Budget
// line (occasions.costs) and Shopper watch (occasions.shopper) are written
// here too, so the two apps can't drift on what a surprise reveals.

import { useCallback, useEffect, useMemo } from 'react';
import { use$ } from '@legendapp/state/react';
import type { CostItem } from '../../types';
import type { ShopperWant } from '../shopper/shopper';
import { costItems$, giftIdeas$, occasions$, shopperWants$, wishlistItems$ } from '../../data/stores';
import { useReconnectSync, useStoreHelpers } from '../../data/create-group-store';
import { useStoreLoaded } from '../../data/use-store-loaded';
import { envRandomUUID } from '../../data/store-environment';
import { todayISO } from '../../date-utils';
import {
  buildGiftIdea,
  buildGiftWant,
  giftCostsToReveal,
  hidesFromSomeoneNew,
  planGiftCost,
  sortOccasions,
  wishlistOccasion,
  type GiftIdea,
  type Occasion,
  type WishlistItem,
} from './occasions';

function live<T extends { deleted: boolean }>(record: Record<string, T | undefined> | undefined): T[] {
  return Object.values(record ?? {}).filter((r): r is T => !!r && !r.deleted);
}

export interface SaveIdeaOptions {
  /** Keep a Budget line for it (needs occasions.costs). */
  inBudget: boolean;
  /** Add a Shopper watch for it, when it has none (needs occasions.shopper). */
  watch: boolean;
}

/**
 * `features` are the occasions.costs and occasions.shopper module features:
 * without one, ideas save without that module's link.
 */
export function useOccasions(
  groupId: string | undefined,
  currentUserId: string | null | undefined,
  features: { costs: boolean; shopper: boolean },
) {
  const o$ = occasions$(groupId);
  const i$ = giftIdeas$(groupId);
  const w$ = wishlistItems$(groupId);
  const costs$ = costItems$(features.costs ? groupId : undefined);
  const wants$ = shopperWants$(features.shopper ? groupId : undefined);
  useReconnectSync(o$);
  useReconnectSync(i$);
  useReconnectSync(w$);
  const loaded = useStoreLoaded(o$, i$, w$);

  const today = todayISO();
  const rawOccasions = use$(() => live(o$.get()));
  const ideas = use$(() => live(i$.get()));
  const wishlist = use$(() => live(w$.get()));
  const costs = use$(() => costs$.get() ?? {});
  const wants = use$(() => wants$.get() ?? {});

  const occasions = useMemo(() => sortOccasions(rawOccasions, today), [rawOccasions, today]);
  const occasionById = useMemo(() => new Map(rawOccasions.map((o) => [o.id, o])), [rawOccasions]);

  const occasionHelpers = useStoreHelpers(o$, currentUserId);
  const ideaHelpers = useStoreHelpers(i$, currentUserId);
  const wishHelpers = useStoreHelpers(w$, currentUserId);
  const costHelpers = useStoreHelpers(costs$, currentUserId);
  const wantHelpers = useStoreHelpers(wants$, currentUserId);
  const patchCost = costHelpers.patchRow;

  const linkedCostOf = useCallback(
    (idea: Pick<GiftIdea, 'cost_item_id'> | null | undefined): CostItem | null => {
      const cost = idea?.cost_item_id ? costs[idea.cost_item_id] : undefined;
      return cost && !cost.deleted ? cost : null;
    },
    [costs],
  );

  const linkedWantOf = useCallback(
    (idea: Pick<GiftIdea, 'shopper_want_id'> | null | undefined): ShopperWant | null => {
      const want = idea?.shopper_want_id ? wants[idea.shopper_want_id] : undefined;
      return want && !want.deleted ? want : null;
    },
    [wants],
  );

  // Once a kept gift's day has passed, its Budget line can say what it was.
  // Only people who can see the idea run this, so the name never comes from
  // the person it was kept from.
  useEffect(() => {
    if (!features.costs) return;
    const map = new Map(Object.entries(costs).filter((e): e is [string, CostItem] => !!e[1]));
    for (const { id, name } of giftCostsToReveal(ideas, occasionById, map, today)) {
      patchCost(id, { name });
    }
  }, [features.costs, costs, ideas, occasionById, today, patchCost]);

  const saveOccasion = useCallback((occasion: Occasion) => occasionHelpers.writeRow(occasion), [occasionHelpers]);

  /**
   * Save an idea with its links. When the save hides it from someone who
   * could see it, the row is replaced (hidesFromSomeoneNew) so their device
   * drops its copy. Returns the idea as written.
   */
  const saveIdea = useCallback(
    (next: GiftIdea, opts: SaveIdeaOptions): GiftIdea => {
      const prev = ideas.find((i) => i.id === next.id) ?? null;
      let idea = next;
      if (prev && hidesFromSomeoneNew(prev.hidden_from, next.hidden_from)) {
        ideaHelpers.softDeleteRow(prev.id);
        idea = { ...next, id: envRandomUUID(), created_at: '', updated_at: '' };
      }
      const occasion = idea.occasion_id ? occasionById.get(idea.occasion_id) ?? null : null;

      if (features.costs) {
        const planned = planGiftCost({
          idea,
          inBudget: opts.inBudget,
          occasion,
          existing: linkedCostOf(idea),
          newId: envRandomUUID,
          today,
          createdBy: currentUserId,
        });
        const { change } = planned;
        if (change.kind === 'create') costHelpers.writeRow(change.cost);
        else if (change.kind === 'update') costHelpers.patchRow(change.id, change.patch);
        else if (change.kind === 'remove') costHelpers.softDeleteRow(change.id);
        idea = planned.idea;
      }

      if (features.shopper) {
        const want = linkedWantOf(idea);
        if (want) {
          // The watch follows the idea's "Keep it from".
          const same = (want.hidden_from ?? []).join() === idea.hidden_from.join();
          if (!same) wantHelpers.patchRow(want.id, { hidden_from: [...idea.hidden_from] });
        } else if (opts.watch) {
          const made = buildGiftWant({ id: envRandomUUID(), idea, occasion, today, createdBy: currentUserId ?? null });
          wantHelpers.writeRow(made);
          idea = { ...idea, shopper_want_id: made.id, status: idea.status === 'idea' ? 'watching' : idea.status };
        }
      }

      ideaHelpers.writeRow(idea);
      return idea;
    },
    [ideas, occasionById, features.costs, features.shopper, linkedCostOf, linkedWantOf, today, currentUserId, ideaHelpers, costHelpers, wantHelpers],
  );

  /** The idea goes with its Budget line. Its Shopper watch stays, as Shopper's own. */
  const deleteIdea = useCallback(
    (idea: GiftIdea) => {
      const cost = linkedCostOf(idea);
      if (cost) costHelpers.softDeleteRow(cost.id);
      ideaHelpers.softDeleteRow(idea.id);
    },
    [linkedCostOf, costHelpers, ideaHelpers],
  );

  /** An occasion goes with the ideas you can see under it, and their Budget lines. */
  const deleteOccasion = useCallback(
    (occasionId: string) => {
      for (const idea of ideas) if (idea.occasion_id === occasionId) deleteIdea(idea);
      occasionHelpers.softDeleteRow(occasionId);
    },
    [ideas, deleteIdea, occasionHelpers],
  );

  const saveWish = useCallback((item: WishlistItem) => wishHelpers.writeRow(item), [wishHelpers]);
  const deleteWish = useCallback((id: string) => wishHelpers.softDeleteRow(id), [wishHelpers]);

  /** "I'll get this": a gift idea for a wishlist item, kept from its owner, under their next birthday. */
  const takeWish = useCallback(
    (item: WishlistItem): GiftIdea | null => {
      if (!groupId || item.user_id === currentUserId) return null;
      const occasion = wishlistOccasion(item.user_id, rawOccasions, today);
      const idea = buildGiftIdea({
        id: envRandomUUID(),
        groupId,
        title: item.title,
        occasionId: occasion?.id ?? null,
        forUserId: item.user_id,
        priceCents: item.price_cents,
        url: item.url,
        wishlistItemId: item.id,
        hiddenFrom: [item.user_id],
        createdBy: currentUserId ?? null,
      });
      ideaHelpers.writeRow(idea);
      return idea;
    },
    [groupId, currentUserId, rawOccasions, today, ideaHelpers],
  );

  return {
    loaded,
    today,
    occasions,
    occasionById,
    ideas,
    wishlist,
    linkedCostOf,
    linkedWantOf,
    saveOccasion,
    deleteOccasion,
    saveIdea,
    deleteIdea,
    saveWish,
    deleteWish,
    takeWish,
  };
}

export type OccasionsApi = ReturnType<typeof useOccasions>;
